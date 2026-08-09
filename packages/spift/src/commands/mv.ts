import { parseArgs } from "node:util";
import { CliError, UsageError } from "../cli-error.ts";
import { destinationIsDirectory } from "../copy.ts";
import type { DirEntry, FileStore } from "../filesystem.ts";
import type { EolStyle } from "../text.ts";
import {
	CONTAINER_ARG_OPTIONS,
	parseContainerOptions,
	resolveContainers,
	type ContainerOptions,
} from "./containers.ts";
import { runCopy } from "./cp.ts";
import { parseEol } from "./eol-option.ts";
import { parseFsOption } from "./fs-option.ts";

export interface MvArgs {
	containers: ContainerOptions;
	sources: string[];
	destination: string;
	force: boolean;
	noAttributes: boolean;
	removeSource: boolean;
	text: boolean;
	strict: boolean;
	eol: EolStyle;
}

export function parseMvArgs(args: string[]): MvArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				...CONTAINER_ARG_OPTIONS,
				force: { type: "boolean", short: "f" },
				"no-attributes": { type: "boolean" },
				"remove-source": { type: "boolean" },
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
		force: values.force ?? false,
		noAttributes: values["no-attributes"] ?? false,
		removeSource: values["remove-source"] ?? false,
		text: values.text ?? false,
		strict: values.strict ?? false,
		eol: parseEol(values.eol),
	};
}

export async function mvCommand(args: string[]): Promise<void> {
	const parsed = parseMvArgs(args);
	const containers = await resolveContainers(parsed.containers);

	// The two directions of a cross-container move are not equally
	// reversible. Removing from an image leaves the entry with its name
	// under the deleted flag, the way the DOSes leave it, so it is still
	// there to be recovered; removing from the host is a real unlink. The
	// irreversible half is opt-in, and everywhere else spift treats the host
	// as where its inputs and outputs live rather than something it deletes.
	if (containers.source.family === "host" && !parsed.removeSource) {
		throw new CliError(
			"this would delete host files, which unlike an image's entries " +
				"cannot be undeleted - pass --remove-source if you mean it",
		);
	}

	// Moving inside one store is a bookkeeping change, not a copy: the entry
	// keeps its sectors, a rename within a directory keeps its very slot, and
	// what the boot record points at goes on pointing at it. A move that
	// crosses containers has to read the file and write it again - and so
	// does --no-attributes, which is a request to write the file differently
	// (dropping DOS 1.0 format, say) and cannot be honoured by an entry
	// rewrite that never touches the data sectors.
	if (!containers.sameContainer || parsed.noAttributes) {
		await runCopy({ ...parsed, recursive: true }, true);
		return;
	}

	const store = containers.source;
	const fail = (error: unknown): never => {
		if (error instanceof CliError) {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${containers.sourceName}: ${message}`);
	};

	let sources;
	try {
		sources = matchSources(store, parsed.sources);
	} catch (error) {
		fail(error);
	}
	if (sources === undefined || sources.length === 0) {
		throw new CliError(`no files match "${parsed.sources.join('", "')}"`);
	}

	// The destination is a directory when it says so with a trailing
	// separator or by being one; otherwise it is a name template.
	const intoDirectory = destinationIsDirectory(store, parsed.destination);
	const destinationParts = store.splitPath(parsed.destination);
	const template = intoDirectory ? undefined : destinationParts.pop();
	if (
		template !== undefined &&
		/[*?]/.test(template) &&
		store.applyNameTemplate === undefined
	) {
		throw new CliError(
			`"${parsed.destination}" is a name template, and ${store.family} ` +
				`has no template rule - give a plain name or a directory`,
		);
	}
	if (template !== undefined && sources.length > 1 && !/[*?]/.test(template)) {
		throw new CliError(
			`"${parsed.destination}" names one file but ${sources.length} ` +
				`match - use a template like '*.txt' or a directory`,
		);
	}

	let damaged = false;
	for (const entry of sources) {
		const leaf =
			template === undefined
				? entry.name
				: (store.applyNameTemplate?.(entry.name, template) ?? template);
		const to = [...destinationParts, leaf].join("/");
		let diagnostics: string[];
		try {
			diagnostics = store.moveFile(entry.path, to, { force: parsed.force });
		} catch (error) {
			fail(error);
			return;
		}
		for (const diagnostic of diagnostics) {
			process.stderr.write(`spift: ${entry.path}: ${diagnostic}\n`);
		}
		damaged ||= diagnostics.length > 0;
		process.stdout.write(`${entry.path} -> ${to}\n`);
	}

	// Nothing touched the disk until here.
	await containers.commit({ source: true });
	if (damaged) {
		process.exitCode = 1;
	}
}

/** Each spec names things to move, so one naming a directory means itself. */
function matchSources(store: FileStore, specs: readonly string[]): DirEntry[] {
	const matched: DirEntry[] = [];
	for (const spec of specs) {
		for (const entry of store.entries(spec, { listContents: false })) {
			if (!matched.some((seen) => seen.path === entry.path)) {
				matched.push(entry);
			}
		}
	}
	return matched;
}
