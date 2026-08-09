import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { CliError, UsageError } from "../cli-error.ts";
import {
	isTextEncoding,
	recodeText,
	TEXT_ENCODINGS,
	type EolStyle,
	type TextEncoding,
} from "../text.ts";

export interface RecodeArgs {
	from: TextEncoding;
	to: TextEncoding;
	files: string[];
	inPlace: boolean;
	strict: boolean;
	eol: EolStyle;
}

const EOL_STYLES = ["lf", "crlf", "native"] as const;

export function parseRecodeArgs(args: string[]): RecodeArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				from: { type: "string", short: "f" },
				to: { type: "string", short: "t" },
				"in-place": { type: "boolean" },
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

	// Unicode is the other side of whichever one you name, so a single flag
	// is the usual way to say it.
	const encoding = (text: string | undefined, flag: string): TextEncoding => {
		if (text === undefined) {
			return "unicode";
		}
		const lowered = text.toLowerCase();
		if (!isTextEncoding(lowered)) {
			throw new UsageError(
				`unknown encoding "${text}" in ${flag} ` +
					`(known: ${TEXT_ENCODINGS.join(", ")})`,
			);
		}
		return lowered;
	};
	if (values.from === undefined && values.to === undefined) {
		throw new UsageError(
			`give --from (-f) or --to (-t); the other side defaults to unicode ` +
				`(known: ${TEXT_ENCODINGS.join(", ")})`,
		);
	}
	const from = encoding(values.from, "--from (-f)");
	const to = encoding(values.to, "--to (-t)");

	const eol = (values.eol ?? "lf").toLowerCase();
	if (!(EOL_STYLES as readonly string[]).includes(eol)) {
		throw new UsageError(
			`unknown --eol "${values.eol}" (valid: ${EOL_STYLES.join(", ")})`,
		);
	}

	const inPlace = values["in-place"] ?? false;
	if (inPlace && positionals.length === 0) {
		throw new UsageError("--in-place needs the files to convert");
	}

	return {
		from,
		to,
		files: positionals,
		inPlace,
		strict: values.strict ?? false,
		eol: eol as EolStyle,
	};
}

export async function recodeCommand(args: string[]): Promise<void> {
	const parsed = parseRecodeArgs(args);

	// Writing family bytes to a terminal is line noise, and there is no
	// output file to catch it - so say what to do instead.
	if (
		!parsed.inPlace &&
		parsed.to === "atascii" &&
		process.stdout.isTTY === true
	) {
		throw new CliError(
			"refusing to write atascii to the terminal; redirect it to a file, " +
				"or use --in-place",
		);
	}

	const sources: { name: string; bytes: Uint8Array }[] = [];
	if (parsed.files.length === 0) {
		sources.push({ name: "-", bytes: await readStdin() });
	}
	for (const file of parsed.files) {
		try {
			sources.push({ name: file, bytes: await readFile(file) });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new CliError(`${file}: no such file`);
			}
			throw error;
		}
	}

	// Everything converts before anything is written, so --strict leaves the
	// files as they were.
	const converted: { name: string; bytes: Uint8Array }[] = [];
	let lost = false;
	for (const source of sources) {
		let result;
		try {
			result = recodeText(source.bytes, parsed.from, parsed.to, {
				strict: parsed.strict,
				eol: parsed.eol,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${source.name}:\n${message}`);
		}
		for (const diagnostic of result.diagnostics) {
			process.stderr.write(`spift: ${source.name}: ${diagnostic}\n`);
			lost = true;
		}
		converted.push({ name: source.name, bytes: result.bytes });
	}

	if (parsed.inPlace) {
		for (const file of converted) {
			await writeFile(file.name, file.bytes);
		}
	} else {
		for (const file of converted) {
			process.stdout.write(file.bytes);
		}
	}
	if (lost) {
		process.exitCode = 1;
	}
}

async function readStdin(): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Uint8Array);
	}
	let length = 0;
	for (const chunk of chunks) {
		length += chunk.length;
	}
	const bytes = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.length;
	}
	return bytes;
}
