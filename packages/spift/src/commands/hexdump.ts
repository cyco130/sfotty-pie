import { parseArgs } from "node:util";
import type { AtariDosVariant } from "../atari-dos.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { atasciiGlyph } from "../text.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface HexdumpArgs {
	image: string;
	specs: string[];
	sectors: { first: number; last: number } | undefined;
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
}

export function parseHexdumpArgs(args: string[]): HexdumpArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				sectors: { type: "string", short: "s" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}

	let sectors;
	if (values.sectors !== undefined) {
		const range = /^(\d+)(?:-(\d+))?$/.exec(values.sectors);
		if (range === null) {
			throw new UsageError(
				`--sectors takes a sector or a range like 361-368, not ` +
					`"${values.sectors}"`,
			);
		}
		const first = Number(range[1]);
		const last = range[2] === undefined ? first : Number(range[2]);
		if (first < 1 || last < first) {
			throw new UsageError(`--sectors ${values.sectors} is not a range`);
		}
		sectors = { first, last };
	}

	if (sectors === undefined && positionals.length === 0) {
		throw new UsageError("missing a file to dump, or --sectors (-s)");
	}
	if (sectors !== undefined && positionals.length > 0) {
		throw new UsageError("give files or --sectors (-s), not both");
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		specs: positionals,
		sectors,
		fs: selection?.family,
		variant: selection?.variant,
	};
}

const REVERSE = "\x1b[7m";
const RESET = "\x1b[0m";

/**
 * One line of sixteen bytes: offset, hex, then what an Atari would show for
 * them. The glyph column is the point - piping to xxd gives ASCII, which
 * renders EOL and every graphics character as a dot. Inverse video is shown
 * in reverse video where the terminal can.
 */
export function hexdumpLine(
	offset: number,
	bytes: Uint8Array,
	color: boolean,
): string {
	let hex = "";
	for (let i = 0; i < 16; i++) {
		hex += i < bytes.length ? bytes[i]!.toString(16).padStart(2, "0") : "  ";
		hex += i === 7 ? "  " : " ";
	}
	let glyphs = "";
	let inverse = false;
	for (const byte of bytes) {
		const high = (byte & 0x80) !== 0;
		if (color && high !== inverse) {
			glyphs += high ? REVERSE : RESET;
			inverse = high;
		}
		glyphs += atasciiGlyph(byte);
	}
	if (color && inverse) {
		glyphs += RESET;
	}
	return `${offset.toString(16).padStart(8, "0")}  ${hex} |${glyphs}|\n`;
}

function dump(bytes: Uint8Array, color: boolean): string {
	let out = "";
	for (let at = 0; at < bytes.length; at += 16) {
		out += hexdumpLine(at, bytes.subarray(at, at + 16), color);
	}
	return out;
}

export async function hexdumpCommand(args: string[]): Promise<void> {
	const parsed = parseHexdumpArgs(args);
	const { filesystem, medium } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);
	const color = process.stdout.isTTY === true && !process.env["NO_COLOR"];

	if (parsed.sectors !== undefined) {
		const { first, last } = parsed.sectors;
		if (last > medium.sectorCount) {
			throw new CliError(
				`${parsed.image} has ${medium.sectorCount} sectors, so ${last} ` +
					`is past its end`,
			);
		}
		for (let sector = first; sector <= last; sector++) {
			const data = medium.readSector(sector);
			if (data === null) {
				throw new CliError(`sector ${sector} could not be read`);
			}
			process.stdout.write(`sector ${sector}\n`);
			process.stdout.write(dump(data, color));
		}
		return;
	}

	let damaged = false;
	const many = parsed.specs.length > 1;
	for (const spec of parsed.specs) {
		let matched;
		try {
			matched = [...filesystem.entries(spec, { listContents: false })];
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${parsed.image}: ${message}`);
		}
		if (matched.length === 0) {
			throw new CliError(`no files match "${spec}"`);
		}
		for (const entry of matched) {
			if (entry.kind === "dir") {
				throw new CliError(`${entry.path} is a directory`);
			}
			const contents = filesystem.readFile(entry.path);
			if (contents === null) {
				throw new CliError(`${entry.path} could not be read`);
			}
			for (const diagnostic of contents.diagnostics) {
				process.stderr.write(`spift: ${entry.path}: ${diagnostic}\n`);
				damaged = true;
			}
			if (many || matched.length > 1) {
				process.stdout.write(`${entry.path}\n`);
			}
			process.stdout.write(dump(contents.bytes, color));
		}
	}
	if (damaged) {
		process.exitCode = 1;
	}
}
