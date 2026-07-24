// Convert a MIDI file into the two-stream music format the player reads: an
// instruction stream and a section list per channel. Run as
// `node midi2s.ts [input.mid] [output.s] [--bars=N]`; the defaults are
// ragtime-snake.mid -> src/music.s in 4-bar sections.
//
// MIDI channels 1-4 map to POKEY channels 1-4. Each channel must be
// monophonic and land on the unit grid (an eighth note); everything else is
// an error rather than a silent approximation.
//
// The song is cut into fixed-length sections at bar lines - the same lengths
// on every channel, so section N is the same musical moment on all four - and
// identical sections are stored once and replayed from the section list. An
// event that spans a boundary is cut in two: a rest divides without a seam,
// and a note is tied with a `hold`, which keeps it sounding without striking
// it again.
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

/**
 * The instruction set, as the macros the output uses. Every instruction is a
 * single byte: a note is its own 0-36 offset, `volume` and `duration` pack
 * their operand into the low bits of a tagged byte, and the rest are bare
 * markers. Volume and duration are sticky - they hold until set again.
 */
const MACROS = [
	{ name: "note", parameter: "offset", body: "offset", note: "$00-$3F" },
	{ name: "volume", parameter: "level", body: "$40 | level", note: "$4x" },
	{ name: "rest", body: "$60", note: "silence, volume untouched" },
	{ name: "next_section", body: "$61", note: "on to the next list entry" },
	{ name: "end_of_song", body: "$62", note: "unused: $0000 ends the list" },
	{ name: "hold", body: "$63", note: "keep sounding, do not strike" },
	{ name: "duration", parameter: "units", body: "$80 | units", note: "1-127" },
];

/** Widest duration the 7 bits under the tag can hold. */
const MAX_DURATION = 0x7f;

/** Widest volume the 4 bits under the tag can hold. */
const MAX_VOLUME = 0x0f;

/** Sticky volume per POKEY channel, indexed by MIDI channel 0-3. */
const CHANNEL_VOLUMES = [9, 6, 6, 9];

/** MIDI note number of C3, the bottom of the 37-note POKEY note table. */
const BASE_NOTE = 48;

/** Note count of that table (C3-C6 inclusive). */
const NOTE_COUNT = 37;

/** Names of the 12 pitch classes, as spelled by pokey.s's NoteOffsets. */
const PITCH_CLASSES = [
	"C",
	"Cs",
	"D",
	"Ds",
	"E",
	"F",
	"Fs",
	"G",
	"Gs",
	"A",
	"As",
	"B",
];

/** Section length in bars, unless --bars says otherwise. */
const DEFAULT_SECTION_BARS = 4;

/** A note-on/note-off pair, with absolute tick times. */
interface Note {
	/** Absolute start tick. */
	start: number;
	/** Length in ticks. */
	length: number;
	/** MIDI note number. */
	note: number;
}

/** A parsed MIDI file, reduced to what the converter needs. */
interface Midi {
	/** Ticks per quarter note. */
	division: number;
	/** Ticks per bar, from the time signature. */
	ticksPerBar: number;
	/** Notes per MIDI channel, in start order. */
	channels: Note[][];
}

/** A note or a rest, as a span of duration units. */
interface Event {
	/** Start, in duration units from the song start. */
	start: number;
	/** Length in duration units. */
	length: number;
	/** MIDI note number, or null for a rest. */
	note: number | null;
	/** Whether this continues the previous event's pitch instead of striking. */
	tied: boolean;
}

/** One emitted instruction: a note/rest/hold plus any sticky-state changes. */
interface Instruction {
	/** Bar this instruction starts in, counted from the song start. */
	bar: number;
	/** Assembled source lines. */
	lines: string[];
}

/** A distinct section body, stored once and played wherever it recurs. */
interface Body {
	/** Index in the channel's body list, which is also its label suffix. */
	id: number;
	/** Bar the section was first heard at, for the comments. */
	firstBar: number;
	/** How many bars it covers. */
	bars: number;
	/** Its instructions, ending with `next_section`. */
	instructions: Instruction[];
}

/** One channel's two streams, plus the counts worth reporting. */
interface Channel {
	/** Distinct section bodies, in first-played order. */
	bodies: Body[];
	/** Body ids in playback order. */
	order: number[];
	notes: number;
	rests: number;
	/** Bytes of instruction stream. */
	musicBytes: number;
	/** Bytes of section list, terminator included. */
	sectionBytes: number;
}

/** Read a MIDI file into per-channel monophonic note lists. */
function parseMidi(buf: Buffer): Midi {
	let pos = 0;

	const u8 = () => buf.readUInt8(pos++);
	const u16 = () => {
		const value = buf.readUInt16BE(pos);
		pos += 2;
		return value;
	};
	const u32 = () => {
		const value = buf.readUInt32BE(pos);
		pos += 4;
		return value;
	};
	const tag = () => {
		const value = buf.toString("latin1", pos, pos + 4);
		pos += 4;
		return value;
	};
	// Variable-length quantity: 7 bits per byte, high bit means "continues".
	const vlq = () => {
		let value = 0;
		for (;;) {
			const byte = u8();
			value = (value << 7) | (byte & 0x7f);
			if (!(byte & 0x80)) return value;
		}
	};

	if (tag() !== "MThd") throw new Error("not a MIDI file (no MThd header)");
	const headerLength = u32();
	const headerEnd = pos + headerLength;
	u16(); // format: 0 and 1 both play as one timeline, which is all we need
	u16(); // track count: we read to the end of the file instead
	const division = u16();
	if (division & 0x8000) throw new Error("SMPTE time division is unsupported");
	pos = headerEnd;

	const channels: Note[][] = [[], [], [], []];
	let ticksPerBar = division * 4; // 4/4 until a time signature says otherwise

	while (pos < buf.length) {
		const trackTag = tag();
		const trackLength = u32();
		const trackEnd = pos + trackLength;
		if (trackTag !== "MTrk") {
			pos = trackEnd; // unknown chunk types are skippable by spec
			continue;
		}

		let tick = 0;
		let status = 0;
		// Notes still waiting for their note-off, keyed by channel * 128 + note.
		const open = new Map<number, Note>();

		while (pos < trackEnd) {
			tick += vlq();

			// Running status: a data byte here repeats the last status byte.
			if (buf.readUInt8(pos) & 0x80) status = u8();
			const kind = status & 0xf0;
			const channel = status & 0x0f;

			if (status === 0xff) {
				const type = u8();
				const length = vlq();
				if (type === 0x58 && length >= 2) {
					const numerator = buf.readUInt8(pos);
					const denominator = 2 ** buf.readUInt8(pos + 1);
					ticksPerBar = (division * 4 * numerator) / denominator;
				}
				pos += length;
			} else if (status === 0xf0 || status === 0xf7) {
				pos += vlq();
			} else if (kind === 0x80 || kind === 0x90) {
				const note = u8();
				const velocity = u8();
				const key = channel * 128 + note;
				if (kind === 0x90 && velocity > 0) {
					const list = channels[channel];
					if (!list) {
						throw new Error(
							`MIDI channel ${channel + 1} is used, but only 1-4 map to POKEY`,
						);
					}
					if (open.has(key)) {
						throw new Error(`overlapping note ${note} at tick ${tick}`);
					}
					const entry: Note = { start: tick, length: 0, note };
					open.set(key, entry);
					list.push(entry);
				} else {
					const entry = open.get(key);
					if (entry) {
						entry.length = tick - entry.start;
						open.delete(key);
					}
				}
			} else if (kind === 0xa0 || kind === 0xb0 || kind === 0xe0) {
				pos += 2;
			} else if (kind === 0xc0 || kind === 0xd0) {
				pos += 1;
			} else {
				throw new Error(`unhandled status byte $${status.toString(16)}`);
			}
		}

		if (open.size) throw new Error(`${open.size} notes never ended`);
		pos = trackEnd;
	}

	for (const list of channels) list.sort((a, b) => a.start - b.start);
	return { division, ticksPerBar, channels };
}

/** `NoteOffsets::` name for a MIDI note number. */
function noteName(note: number): string {
	const offset = note - BASE_NOTE;
	if (offset < 0 || offset >= NOTE_COUNT) {
		throw new Error(`note ${note} is outside the C3-C6 table`);
	}
	const pitchClass = PITCH_CLASSES[offset % 12]!;
	const octave = 3 + Math.floor(offset / 12);
	return `NoteOffsets::${pitchClass}${octave}`;
}

/**
 * Lay one channel's notes out on the unit grid as a gapless run of notes and
 * rests, padded to the song length so every channel loops in step.
 */
function buildEvents(notes: Note[], unit: number, totalUnits: number): Event[] {
	const units = (ticks: number, what: string) => {
		if (ticks % unit) {
			throw new Error(`${what} of ${ticks} ticks is off the unit grid`);
		}
		return ticks / unit;
	};

	const events: Event[] = [];
	let cursor = 0;

	const push = (start: number, length: number, note: number | null) => {
		if (length > MAX_DURATION) {
			throw new Error(`span of ${length} units exceeds ${MAX_DURATION}`);
		}
		events.push({ start, length, note, tied: false });
	};

	for (const note of notes) {
		if (note.start < cursor) {
			throw new Error(`note at tick ${note.start} overlaps the previous one`);
		}
		if (note.start > cursor) {
			push(cursor / unit, units(note.start - cursor, "rest"), null);
		}
		push(units(note.start, "onset"), units(note.length, "note"), note.note);
		cursor = note.start + note.length;
	}

	const total = totalUnits * unit;
	if (cursor < total) push(cursor / unit, units(total - cursor, "rest"), null);
	else if (cursor > total) {
		throw new Error(`channel runs past the song end (${cursor} > ${total})`);
	}

	return events;
}

/**
 * Cut every event that spans a section boundary in two. The tail of a note
 * is tied - it keeps sounding, it is not struck again - and the tail of a
 * rest is just more silence.
 */
function splitEvents(events: Event[], boundaries: Set<number>): Event[] {
	const out: Event[] = [];
	for (const event of events) {
		const note = event.note;
		let { start, length, tied } = event;
		for (let cut = start + 1; cut < start + length; cut++) {
			if (!boundaries.has(cut)) continue;
			out.push({ start, length: cut - start, note, tied });
			length -= cut - start;
			start = cut;
			tied = note !== null;
		}
		out.push({ start, length, note, tied });
	}
	return out;
}

/**
 * Encode one section. The sticky duration is treated as unknown on entry,
 * since a section can be reached from anywhere in the section list; the
 * volume is only passed for the section that plays first, because nothing
 * after it ever changes the channel's volume.
 */
function encodeSection(
	events: Event[],
	unitsPerBar: number,
	volume: number | null,
): Instruction[] {
	const out: Instruction[] = [];
	let currentDuration = -1;
	let pendingVolume = volume;

	for (const event of events) {
		const lines: string[] = [];
		if (pendingVolume !== null) {
			lines.push(`volume ${pendingVolume}`);
			pendingVolume = null;
		}
		if (event.length !== currentDuration) {
			lines.push(`duration ${event.length}`);
			currentDuration = event.length;
		}
		if (event.note === null) lines.push("rest");
		else if (event.tied) lines.push("hold");
		else lines.push(`note ${noteName(event.note)}`);
		out.push({ bar: Math.floor(event.start / unitsPerBar), lines });
	}

	out.push({ bar: -1, lines: ["next_section"] });
	return out;
}

/** Byte length of an encoded section - one byte per instruction. */
function byteLength(instructions: Instruction[]): number {
	return instructions.reduce((sum, { lines }) => sum + lines.length, 0);
}

/** Split one channel into deduplicated sections plus the order to play them. */
function buildChannel(
	events: Event[],
	volume: number,
	unitsPerBar: number,
	sectionBars: number,
	totalBars: number,
): Channel {
	// Section starts, in units. The last section absorbs any short remainder,
	// which is still a whole bar or more.
	const starts: number[] = [];
	for (let bar = 0; bar < totalBars; bar += sectionBars) {
		starts.push(bar * unitsPerBar);
	}
	if (volume < 0 || volume > MAX_VOLUME) {
		throw new Error(`volume ${volume} is outside 0-${MAX_VOLUME}`);
	}
	const split = splitEvents(events, new Set(starts.slice(1)));

	const bodies: Body[] = [];
	const order: number[] = [];
	const ids = new Map<string, number>();

	starts.forEach((start, index) => {
		const end = starts[index + 1] ?? totalBars * unitsPerBar;
		const slice = split.filter((e) => e.start >= start && e.start < end);
		// A section that opens with a tie inherits its pitch from whoever played
		// before it, so that pitch is part of its identity - a tied event keeps
		// the note number it continues, which the key picks up for free.
		const key = slice
			.map((e) => `${e.note ?? "r"}${e.tied ? "~" : ""}:${e.length}`)
			.join(",");

		let id = ids.get(key);
		if (id === undefined) {
			id = bodies.length;
			ids.set(key, id);
			bodies.push({
				id,
				firstBar: start / unitsPerBar,
				bars: (end - start) / unitsPerBar,
				instructions: encodeSection(
					slice,
					unitsPerBar,
					id === 0 ? volume : null,
				),
			});
		}
		order.push(id);
	});

	return {
		bodies,
		order,
		notes: split.filter((e) => e.note !== null && !e.tied).length,
		rests: split.filter((e) => e.note === null).length,
		musicBytes: bodies.reduce((sum, b) => sum + byteLength(b.instructions), 0),
		sectionBytes: 2 * (order.length + 1),
	};
}

const PREAMBLE = [
	"; The instruction set: one byte each, volume and duration sticky. A",
	"; section sets its own duration before its first note, since it can be",
	"; reached from anywhere in the list; only the first section sets the",
	"; volume. The section list is one address per section, $0000-terminated.",
	...MACROS.flatMap(({ name, parameter, body, note }) => [
		"",
		`; ${note}`,
		`.macro ${name}${parameter ? ` ${parameter}` : ""}`,
		`\t.byte ${body}`,
		".endmacro",
	]),
].join("\n");

/** Bar range of a section occurrence, as a comment fragment. */
function barRange(startBar: number, bars: number): string {
	return bars === 1
		? `bar ${startBar + 1}`
		: `bars ${startBar + 1}-${startBar + bars}`;
}

/** Render the whole .s file. */
function render(
	source: string,
	sectionBars: number,
	channels: Channel[],
): string {
	const lines: string[] = [
		`; Generated from ${source} by midi2s.ts - do not edit by hand.`,
		"",
		'.import "./lib/atari/pokey.s"',
		"",
		PREAMBLE,
		"",
		".rodata",
	];

	channels.forEach((channel, index) => {
		lines.push(
			"",
			`\t; POKEY channel ${index + 1}: ${channel.notes} notes, ` +
				`${channel.rests} rests, ${channel.order.length} sections ` +
				`(${channel.bodies.length} distinct), ${channel.musicBytes} bytes`,
			`\t.export channel_${index + 1}_music:`,
		);
		for (const body of channel.bodies) {
			lines.push(
				`\t; section ${body.id} - first heard at ` +
					`${barRange(body.firstBar, body.bars)}`,
				`\tchannel_${index + 1}_section_${body.id}:`,
			);
			let bar = -1;
			for (const instruction of body.instructions) {
				if (instruction.bar >= 0 && instruction.bar !== bar) {
					bar = instruction.bar;
					lines.push(`\t\t; bar ${bar + 1}`);
				}
				for (const line of instruction.lines) lines.push(`\t\t${line}`);
			}
		}
	});

	lines.push(
		"",
		`\t; Section lists: the order the sections play in, ` +
			`${sectionBars} bars each.`,
		"\t; A zero entry ends the song - the player rewinds to the first one.",
	);
	channels.forEach((channel, index) => {
		lines.push("", `\t.export channel_${index + 1}_sections:`);
		channel.order.forEach((id, position) => {
			const startBar = position * sectionBars;
			const bars = channel.bodies[id]!.bars;
			lines.push(
				`\t\t.word channel_${index + 1}_section_${id}` +
					`\t; ${barRange(startBar, bars)}`,
			);
		});
		lines.push("\t\t.word 0");
	});

	lines.push("");
	return lines.join("\n");
}

/** Convert a parsed file at a given section length. */
function convert(midi: Midi, sectionBars: number) {
	const unit = midi.division / 2; // one duration unit is an eighth note
	const unitsPerBar = midi.ticksPerBar / unit;
	const end = Math.max(
		...midi.channels.flatMap((notes) =>
			notes.map((note) => note.start + note.length),
		),
	);
	const totalBars = Math.ceil(end / midi.ticksPerBar);
	const totalUnits = totalBars * unitsPerBar;

	const channels = midi.channels.map((notes, index) =>
		buildChannel(
			buildEvents(notes, unit, totalUnits),
			CHANNEL_VOLUMES[index]!,
			unitsPerBar,
			sectionBars,
			totalBars,
		),
	);
	const bytes = channels.reduce(
		(sum, c) => sum + c.musicBytes + c.sectionBytes,
		0,
	);
	return { unit, unitsPerBar, totalBars, totalUnits, channels, bytes };
}

if (process.argv[1] === import.meta.filename) {
	const args = process.argv.slice(2);
	const barsArg = args.find((arg) => arg.startsWith("--bars="));
	const sectionBars = barsArg
		? Number(barsArg.slice("--bars=".length))
		: DEFAULT_SECTION_BARS;
	if (!Number.isInteger(sectionBars) || sectionBars < 1) {
		throw new Error("--bars must be a whole number of bars, at least 1");
	}
	const positional = args.filter((arg) => !arg.startsWith("--"));
	const input = resolve(
		import.meta.dirname,
		positional[0] ?? "ragtime-snake.mid",
	);
	const output = resolve(import.meta.dirname, positional[1] ?? "src/music.s");

	const midi = parseMidi(await readFile(input));
	const result = convert(midi, sectionBars);
	await writeFile(
		output,
		render(basename(input), sectionBars, result.channels),
	);

	const pad = (value: number, width: number) => String(value).padStart(width);
	const report = [
		`Wrote ${output}`,
		`  ${result.totalUnits} units of ${result.unit} ticks (eighth notes), ` +
			`${result.totalBars} bars, ${sectionBars} bars per section`,
		...result.channels.map((channel, index) => {
			const offsets = channel.musicBytes <= 256 ? "" : " (over 256!)";
			return (
				`  channel ${index + 1}: ${pad(channel.notes, 3)} notes, ` +
				`${pad(channel.rests, 3)} rests, ` +
				`${pad(channel.order.length, 2)} sections ` +
				`(${pad(channel.bodies.length, 2)} distinct), ` +
				`${pad(channel.musicBytes, 3)} + ${pad(channel.sectionBytes, 2)} ` +
				`= ${pad(channel.musicBytes + channel.sectionBytes, 3)} bytes` +
				offsets
			);
		}),
		`  total ${result.bytes} bytes`,
		"  section length: " +
			Array.from({ length: result.totalBars }, (_, i) => i + 1)
				.filter((bars) => result.totalBars % bars === 0)
				.map((bars) => {
					const total = convert(midi, bars).bytes;
					return `${bars}->${total}${bars === sectionBars ? "*" : ""}`;
				})
				.join(" "),
	];
	process.stdout.write(report.join("\n") + "\n");
}

export { parseMidi, convert };
