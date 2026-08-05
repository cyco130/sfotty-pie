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
	filename: string;
	type: "atr";
	sectorSize: AtrSectorSize;
	sectorCount: number;
	force: boolean;
}

const GEOMETRY_SHORTHANDS = {
	sd: { sectorSize: 128, sectorCount: 720 },
	ed: { sectorSize: 128, sectorCount: 1040 },
	dd: { sectorSize: 256, sectorCount: 720 },
} as const;

export function parseCreateArgs(args: string[]): CreateSpec {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
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

	const [filename, ...extra] = positionals;
	if (!filename) {
		throw new UsageError("missing FILENAME");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	const type =
		values.type?.toLowerCase() ??
		/\.([^.]+)$/.exec(filename)?.[1]?.toLowerCase();
	if (type === undefined) {
		throw new UsageError(
			`cannot infer the image type from "${filename}"; specify --type`,
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
	if (
		shorthand !== undefined &&
		(values["sector-size"] !== undefined ||
			values["sector-count"] !== undefined)
	) {
		throw new UsageError(
			`--${shorthand} cannot be combined with --sector-size/--sector-count`,
		);
	}

	const base = GEOMETRY_SHORTHANDS[shorthand ?? "sd"];
	let sectorSize: AtrSectorSize = base.sectorSize;
	let sectorCount: number = base.sectorCount;
	if (values["sector-size"] !== undefined) {
		const size = parsePositiveInt(values["sector-size"], "--sector-size");
		if (!(ATR_SECTOR_SIZES as readonly number[]).includes(size)) {
			throw new UsageError(
				`invalid --sector-size ${size} ` +
					`(valid: ${ATR_SECTOR_SIZES.join(", ")})`,
			);
		}
		sectorSize = size as AtrSectorSize;
	}
	if (values["sector-count"] !== undefined) {
		sectorCount = parsePositiveInt(values["sector-count"], "--sector-count");
		if (sectorCount > ATR_MAX_SECTOR_COUNT) {
			throw new UsageError(
				`--sector-count ${sectorCount} is too large ` +
					`(max ${ATR_MAX_SECTOR_COUNT})`,
			);
		}
	}

	return {
		filename,
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
		await writeFile(spec.filename, bytes, { flag: spec.force ? "w" : "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new CliError(
				`${spec.filename} already exists, not overwriting (use --force)`,
			);
		}
		throw error;
	}
	process.stdout.write(
		`created ${spec.filename}: ${spec.sectorCount} x ` +
			`${spec.sectorSize}-byte sectors, ${bytes.length} bytes\n`,
	);
}
