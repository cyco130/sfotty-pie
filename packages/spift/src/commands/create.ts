import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
	ATR_MAX_SECTOR_COUNT,
	ATR_SECTOR_SIZES,
	type AtrSectorSize,
	createBlankAtr,
} from "../atr.ts";
import { CliError, UsageError } from "../cli-error.ts";

export interface CreateSpec {
	image: string;
	type: "atr";
	sectorSize: AtrSectorSize;
	sectorCount: number;
	force: boolean;
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

	return {
		image,
		type,
		sectorSize,
		sectorCount,
		force: values.force ?? false,
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
	try {
		await writeFile(spec.image, bytes, { flag: spec.force ? "w" : "wx" });
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
			`${spec.sectorSize}-byte sectors, ${bytes.length} bytes\n`,
	);
}
