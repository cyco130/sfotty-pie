import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
	ATR_MAX_SECTOR_COUNT,
	ATR_SECTOR_SIZES,
	type AtrSectorSize,
	createBlankAtr,
	openAtr,
} from "../atr.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { formatImage, parseFormatValues, type MkfsArgs } from "./mkfs.ts";

export interface CreateSpec {
	image: string;
	type: "atr";
	sectorSize: AtrSectorSize;
	sectorCount: number;
	force: boolean;
	/** The mkfs run that follows creation; undefined is --fs none, blank. */
	format: MkfsArgs | undefined;
}

export function parseCreateArgs(args: string[]): CreateSpec {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				type: { type: "string", short: "t" },
				force: { type: "boolean", short: "f" },
				"sector-size": { type: "string" },
				"sector-count": { type: "string" },
				sd: { type: "boolean" },
				ed: { type: "boolean" },
				dd: { type: "boolean" },
				fs: { type: "string" },
				"boot-sectors": { type: "string" },
				master: { type: "string" },
				"install-dos": { type: "boolean" },
				"volume-name": { type: "string" },
				"reserve-last-sector": { type: "boolean" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const extra = positionals;
	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	const type =
		values.type?.toLowerCase() ?? /\.([^.]+)$/.exec(image)?.[1]?.toLowerCase();
	if (type === undefined) {
		throw new UsageError(
			`cannot infer the image type from "${image}"; specify --type`,
		);
	}
	if (type !== "atr") {
		throw new UsageError(`unsupported image type "${type}" (supported: atr)`);
	}

	const shorthands = (["sd", "ed", "dd"] as const).filter((k) => values[k]);
	if (shorthands.length > 1) {
		throw new UsageError(
			`--${shorthands.join(" and --")} are mutually exclusive`,
		);
	}
	const shorthand = shorthands[0];
	const sizeArg = values["sector-size"];
	const countArg = values["sector-count"];
	// --sd and --dd only name a sector size (128 and 256), so they combine
	// with an explicit --sector-count - `--dd --sector-count 65535` is a
	// 256-byte hard-disk image - but not a second --sector-size. --ed names a
	// whole geometry, enhanced density's fixed 1040 x 128, so it takes neither.
	if (shorthand === "ed" && (sizeArg !== undefined || countArg !== undefined)) {
		throw new UsageError(
			`--ed is a complete geometry and cannot be combined with ` +
				`--sector-size or --sector-count`,
		);
	}
	if ((shorthand === "sd" || shorthand === "dd") && sizeArg !== undefined) {
		throw new UsageError(
			`--${shorthand} already sets the sector size; drop --sector-size`,
		);
	}

	let sectorSize: AtrSectorSize = shorthand === "dd" ? 256 : 128;
	let sectorCount = shorthand === "ed" ? 1040 : 720;
	if (sizeArg !== undefined) {
		const size = parsePositiveInt(sizeArg, "--sector-size");
		if (!(ATR_SECTOR_SIZES as readonly number[]).includes(size)) {
			throw new UsageError(
				`invalid --sector-size ${size} ` +
					`(valid: ${ATR_SECTOR_SIZES.join(", ")})`,
			);
		}
		sectorSize = size as AtrSectorSize;
	}
	if (countArg !== undefined) {
		sectorCount = parsePositiveInt(countArg, "--sector-count");
		if (sectorCount > ATR_MAX_SECTOR_COUNT) {
			throw new UsageError(
				`--sector-count ${sectorCount} is too large ` +
					`(max ${ATR_MAX_SECTOR_COUNT})`,
			);
		}
	}

	// The image comes formatted unless --fs none asks for a blank one; the
	// formatting flags are mkfs's, resolved by the same shared code so the
	// two commands cannot drift apart.
	let format: MkfsArgs | undefined;
	if (values.fs?.toLowerCase() === "none") {
		const stray = (
			[
				"master",
				"boot-sectors",
				"install-dos",
				"volume-name",
				"reserve-last-sector",
			] as const
		).find((flag) => values[flag] !== undefined);
		if (stray !== undefined) {
			throw new UsageError(
				`--fs none makes a blank unformatted image; --${stray} is a ` +
					`formatting option`,
			);
		}
	} else {
		if (values.fs === undefined && ![128, 256, 512].includes(sectorSize)) {
			throw new UsageError(
				`${sectorSize}-byte sectors hold no spift filesystem; ` +
					`create the image blank with --fs none`,
			);
		}
		format = { image, ...parseFormatValues(values) };
		// The inverse of geometry-picks-the-filesystem: a filesystem choice
		// picks its home geometry. Only DOS 2.5 differs from the global
		// 720-sector default (its second VTOC lives at sector 1024). An
		// explicit count still wins, and --sd keeps naming just the sector
		// size, so it does not pin the count to 720 here either.
		if (
			format.variant === "dos25" &&
			countArg === undefined &&
			shorthand !== "ed"
		) {
			sectorCount = 1040;
		}
	}

	return {
		image,
		type,
		sectorSize,
		sectorCount,
		force: values.force ?? false,
		format,
	};
}

function parsePositiveInt(text: string, flag: string): number {
	if (!/^[0-9]+$/.test(text) || Number(text) < 1) {
		throw new UsageError(`${flag} expects a positive integer, got "${text}"`);
	}
	return Number(text);
}

export async function createCommand(args: string[]): Promise<void> {
	const spec = parseCreateArgs(args);
	const bytes = createBlankAtr({
		sectorSize: spec.sectorSize,
		sectorCount: spec.sectorCount,
	});
	// Formatting happens in memory before the file exists, so a bad format
	// never leaves a half-made image behind.
	let summary = "";
	let output: Uint8Array = bytes;
	if (spec.format !== undefined) {
		const medium = openAtr(bytes);
		summary = await formatImage(spec.format, medium);
		output = medium.bytes;
	}
	try {
		await writeFile(spec.image, output, { flag: spec.force ? "w" : "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new CliError(
				`${spec.image} already exists, not overwriting (use --force)`,
			);
		}
		throw error;
	}
	process.stdout.write(
		`created ${spec.image}: ${spec.sectorCount} x ` +
			`${spec.sectorSize}-byte sectors, ${output.length} bytes` +
			`${spec.format === undefined ? ", no filesystem" : ""}\n` +
			summary,
	);
}
