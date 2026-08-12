import { parseArgs } from "node:util";
import type { DirEntry, DirEntryAttribute, VolumeInfo } from "../filesystem.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { fsId, parseFsOption, type FsVariant } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface LsArgs {
	image: string;
	spec: string | undefined;
	fs: "atari" | "sparta" | undefined;
	variant: FsVariant | undefined;
	long: boolean;
	verbose: boolean;
	recursive: boolean;
}

export function parseLsArgs(args: string[]): LsArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				long: { type: "boolean", short: "l" },
				verbose: { type: "boolean", short: "v" },
				recursive: { type: "boolean", short: "R" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const [spec, ...extra] = positionals;
	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		spec,
		fs: selection?.family,
		variant: selection?.variant,
		long: values.long ?? false,
		verbose: values.verbose ?? false,
		recursive: values.recursive ?? false,
	};
}

export async function lsCommand(args: string[]): Promise<void> {
	const parsed = parseLsArgs(args);
	const opened = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);
	const { filesystem, medium } = opened;
	let entries;
	try {
		entries = [
			...filesystem.entries(parsed.spec, {
				includeUnlisted: parsed.verbose,
				recursive: parsed.recursive,
			}),
		];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}
	const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
	if (parsed.long) {
		process.stdout.write(
			renderStatus(
				{
					format: opened.format.name,
					sectorCount: medium.sectorCount,
					sectorSize: medium.sectorSize,
				},
				{
					id: fsId(filesystem.family, filesystem.variant),
					volume: filesystem.volume(),
				},
				color,
			),
		);
	}
	// Recursing makes bare leaf names ambiguous, so show where each entry
	// lives once more than one directory is in play.
	const named = parsed.recursive
		? entries.map((entry) => ({ ...entry, name: entry.path }))
		: entries;
	process.stdout.write(
		parsed.long ? renderLong(named, color) : renderShort(named, color),
	);
}

export interface ContainerStatus {
	format: string;
	sectorCount: number;
	sectorSize: number;
}

/**
 * The two lines -l leads with: the physical image, then the filesystem
 * living on it.
 */
export function renderStatus(
	container: ContainerStatus,
	filesystem: { id: string; volume: VolumeInfo },
	color: boolean,
): string {
	const paint = (text: string, codes: string): string =>
		color ? `\x1b[${codes}m${text}\x1b[0m` : text;
	const { volume } = filesystem;
	const physical =
		paint(container.format, "1") +
		"  " +
		`${container.sectorCount} sectors x ${container.sectorSize} bytes`;
	const parts = [
		`${paint(filesystem.id, "1")} file system`,
		`${volume.totalSectors} sectors, ${volume.freeSectors} free`,
	];
	if (volume.label !== undefined) {
		parts.splice(1, 0, `"${volume.label}"`);
	}
	let logical = parts.join("  ");
	for (const detail of volume.details) {
		logical += paint(`  (${detail})`, "2");
	}
	return `${physical}\n${logical}\n`;
}

const ATTRIBUTE_LABELS: Record<DirEntryAttribute, string> = {
	ReadOnly: "read-only",
	Deleted: "deleted",
	OpenForOutput: "open-output",
	BootFile: "dos-file",
	Hidden: "hidden",
	Archived: "archived",
	Symlink: "symlink",
	AtariDos10: "dos1",
	AtariDos25: "dos2.5",
	AtariMyDos: "mydos",
};

const ATTRIBUTE_COLORS: Record<DirEntryAttribute, string> = {
	Deleted: "31",
	OpenForOutput: "35",
	ReadOnly: "33",
	BootFile: "1;32",
	Hidden: "2",
	Archived: "2",
	Symlink: "36",
	AtariDos10: "36",
	AtariDos25: "36",
	AtariMyDos: "36",
};

const DIRECTORY_COLOR = "1;34";

/**
 * How a name is painted: directories stand out, and so do the entries a
 * listing would normally pass over - deleted ones and those left open for
 * output, each in its own color.
 */
function nameColor(entry: DirEntry): string {
	if (entry.kind === "dir") {
		return DIRECTORY_COLOR;
	}
	for (const attribute of ["Deleted", "OpenForOutput"] as const) {
		if (entry.attributes.includes(attribute)) {
			return ATTRIBUTE_COLORS[attribute];
		}
	}
	return "";
}

export function renderShort(
	entries: readonly DirEntry[],
	color: boolean,
): string {
	return entries
		.map((entry) => {
			const codes = nameColor(entry);
			const name = displayName(entry);
			return (
				(color && codes !== "" ? `\x1b[${codes}m${name}\x1b[0m` : name) + "\n"
			);
		})
		.join("");
}

export function renderLong(
	entries: readonly DirEntry[],
	color: boolean,
): string {
	const paint = (text: string, codes: string): string =>
		color && codes !== "" ? `\x1b[${codes}m${text}\x1b[0m` : text;
	const rows = entries.map((entry) => ({
		name: displayName(entry),
		nameCodes: nameColor(entry),
		sectors: entry.sectors === undefined ? "" : String(entry.sectors),
		size: entry.size === undefined ? "" : String(entry.size),
		timestamp: renderTimestamp(entry.timestamp),
		start: entry.startSector === undefined ? "" : String(entry.startSector),
		// Names carry no marker, so this column is where a directory is
		// spelled out for anything that cannot see color.
		attributes: [
			...(entry.kind === "dir"
				? [{ label: "dir", codes: DIRECTORY_COLOR }]
				: []),
			...entry.attributes.map((a) => ({
				label: ATTRIBUTE_LABELS[a],
				codes: ATTRIBUTE_COLORS[a],
			})),
		],
	}));
	const width = (texts: string[]): number =>
		texts.reduce((max, text) => Math.max(max, text.length), 0);
	const nameWidth = width(rows.map((row) => row.name));
	const sectorsWidth = width(rows.map((row) => row.sectors));
	const sizeWidth = width(rows.map((row) => row.size));
	const timestampWidth = width(rows.map((row) => row.timestamp));
	const startWidth = width(rows.map((row) => row.start));
	let out = "";
	for (const row of rows) {
		const attributes = row.attributes
			.map(({ label, codes }) => paint(label, codes))
			.join(" ");
		// A family without a column - Atari DOS has no sizes or timestamps,
		// SpartaDOS reports no sector counts - contributes zero width, and
		// its column vanishes rather than printing as a rail of blanks.
		const columns = [
			paint(row.name.padEnd(nameWidth), row.nameCodes),
			...(sectorsWidth === 0 ? [] : [row.sectors.padStart(sectorsWidth)]),
			...(sizeWidth === 0 ? [] : [row.size.padStart(sizeWidth)]),
			...(timestampWidth === 0
				? []
				: [paint(row.timestamp.padEnd(timestampWidth), "2")]),
			...(startWidth === 0 ? [] : [paint(row.start.padStart(startWidth), "2")]),
		];
		out += columns.join("  ") + (attributes === "" ? "" : "  " + attributes);
		out += "\n";
	}
	return out;
}

/** "1995-12-11 14:57:44", or nothing when the entry carries no time. */
function renderTimestamp(timestamp: Date | undefined): string {
	if (timestamp === undefined) {
		return "";
	}
	const pad = (value: number): string => String(value).padStart(2, "0");
	return (
		`${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-` +
		`${pad(timestamp.getDate())} ${pad(timestamp.getHours())}:` +
		`${pad(timestamp.getMinutes())}:${pad(timestamp.getSeconds())}`
	);
}

// Names are the names; directories are shown by color, and -l spells out
// what a plain listing leaves to it.
function displayName(entry: DirEntry): string {
	return entry.name;
}
