import { parseArgs } from "node:util";
import { CliError, UsageError } from "../cli-error.ts";
import type { EolStyle } from "../text.ts";
import { copyEntries } from "../copy.ts";
import {
	CONTAINER_ARG_OPTIONS,
	parseContainerOptions,
	resolveContainers,
	type ContainerOptions,
} from "./containers.ts";
import { parseEol } from "./eol-option.ts";
import { parseFsOption } from "./fs-option.ts";

export interface CpArgs {
	containers: ContainerOptions;
	sources: string[];
	destination: string;
	recursive: boolean;
	force: boolean;
	noAttributes: boolean;
	/** Carry timestamps across, as cp -p does; a cross-container mv always does. */
	preserveTimestamps: boolean;
	text: boolean;
	strict: boolean;
	eol: EolStyle;
}

export function parseCpArgs(args: string[]): CpArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				...CONTAINER_ARG_OPTIONS,
				recursive: { type: "boolean", short: "R" },
				r: { type: "boolean" },
				force: { type: "boolean", short: "f" },
				preserve: { type: "boolean", short: "p" },
				"no-attributes": { type: "boolean" },
				text: { type: "boolean" },
				strict: { type: "boolean" },
				eol: { type: "string" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const containers = parseContainerOptions(values, parseFsOption);
	const destination = positionals.pop();
	if (destination === undefined || positionals.length === 0) {
		throw new UsageError("missing SOURCE and DESTINATION");
	}

	return {
		containers,
		sources: positionals,
		destination,
		recursive: values.recursive === true || values.r === true,
		force: values.force ?? false,
		noAttributes: values["no-attributes"] ?? false,
		preserveTimestamps: values.preserve ?? false,
		text: values.text ?? false,
		strict: values.strict ?? false,
		eol: parseEol(values.eol),
	};
}

export async function cpCommand(args: string[]): Promise<void> {
	const parsed = parseCpArgs(args);
	await runCopy(parsed, false);
}

/**
 * The body cp and a cross-container mv share: resolve both sides, copy, and
 * write out what changed. Nothing reaches a disk until copyEntries has run to
 * the end without throwing.
 */
export async function runCopy(parsed: CpArgs, move: boolean): Promise<void> {
	const containers = await resolveContainers(parsed.containers);

	let result;
	try {
		result = copyEntries(containers.source, containers.target, {
			sources: parsed.sources,
			destination: parsed.destination,
			recursive: parsed.recursive || move,
			force: parsed.force,
			noAttributes: parsed.noAttributes,
			// Naming dos10 for the target is a request to write DOS 1.0 format
			// chains, which nothing later than DOS 1.0 can read. Every other
			// variant writes DOS 2 format, whatever the disk was formatted
			// with, since that reads everywhere from DOS 2.0 on.
			attributes:
				parsed.containers.toVariant === "dos10" ? ["AtariDos10"] : undefined,
			text: parsed.text,
			strict: parsed.strict,
			eol: parsed.eol,
			// mv(1) always moves the metadata with the file; cp(1) needs -p.
			preserveTimestamps: parsed.preserveTimestamps || move,
			move,
		});
	} catch (error) {
		if (error instanceof CliError) {
			throw error;
		}
		throw new CliError(error instanceof Error ? error.message : String(error));
	}

	await containers.commit({ source: move });

	let damaged = false;
	for (const file of result.files) {
		for (const diagnostic of file.diagnostics) {
			process.stderr.write(`spift: ${file.from}: ${diagnostic}\n`);
			damaged = true;
		}
		process.stdout.write(`${file.from} -> ${file.to}\n`);
	}
	if (damaged) {
		process.exitCode = 1;
	}
}
