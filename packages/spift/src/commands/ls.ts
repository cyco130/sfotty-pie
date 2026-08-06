import { parseArgs } from "node:util";
import type { AtariDosVariant } from "../atari-dos.ts";
import type { DirEntry, DirEntryAttribute } from "../filesystem.ts";
import { UsageError } from "../cli-error.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface LsArgs {
	image: string;
	spec: string | undefined;
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	long: boolean;
}

export function parseLsArgs(args: string[]): LsArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				fs: { type: "string" },
				long: { type: "boolean", short: "l" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const [image, spec, ...extra] = positionals;
	if (image === undefined) {
		throw new UsageError("missing IMAGE_FILE");
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
	};
}

export async function lsCommand(args: string[]): Promise<void> {
	const parsed = parseLsArgs(args);
	const { filesystem } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);
	const entries = [...filesystem.entries(parsed.spec)];
	const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
	process.stdout.write(
		parsed.long ? renderLong(entries, color) : renderShort(entries),
	);
}

const ATTRIBUTE_LABELS: Record<DirEntryAttribute, string> = {
	ReadOnly: "read-only",
	OpenForOutput: "open-output",
	AtariDos10: "dos1",
	AtariDos25: "dos2.5",
	AtariMyDos: "mydos",
};

export function renderShort(entries: readonly DirEntry[]): string {
	return entries.map((entry) => displayName(entry) + "\n").join("");
}

export function renderLong(
	entries: readonly DirEntry[],
	color: boolean,
): string {
	const paint = (text: string, codes: string): string =>
		color && codes !== "" ? `\x1b[${codes}m${text}\x1b[0m` : text;
	const rows = entries.map((entry) => ({
		name: displayName(entry),
		dir: entry.kind === "dir",
		sectors: String(entry.sectors),
		start: String(entry.startSector),
		attributes: entry.attributes.map((a) => ATTRIBUTE_LABELS[a]),
	}));
	const width = (texts: string[]): number =>
		texts.reduce((max, text) => Math.max(max, text.length), 0);
	const nameWidth = width(rows.map((row) => row.name));
	const sectorsWidth = width(rows.map((row) => row.sectors));
	const startWidth = width(rows.map((row) => row.start));
	let out = "";
	for (const row of rows) {
		const attributes = row.attributes
			.map((label) => paint(label, label === "read-only" ? "33" : "36"))
			.join(" ");
		out +=
			[
				paint(row.name.padEnd(nameWidth), row.dir ? "1;34" : ""),
				row.sectors.padStart(sectorsWidth),
				paint(row.start.padStart(startWidth), "2"),
			].join("  ") + (attributes === "" ? "" : "  " + attributes);
		out += "\n";
	}
	return out;
}

function displayName(entry: DirEntry): string {
	return entry.kind === "dir" ? `${entry.name}/` : entry.name;
}
