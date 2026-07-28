#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { assemble, type Host } from "./index.ts";

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		options: { output: { type: "string", short: "o" } },
		allowPositionals: true,
	});

	const [input, ...extra] = positionals;
	if (!input || extra.length > 0 || !values.output) {
		process.stderr.write("usage: spasm INPUT_FILE -o OUTPUT_FILE\n");
		process.exit(2);
	}

	// Node-like module resolution: ids are absolute paths, and a relative
	// specifier resolves against the importing file's directory. Diagnostics
	// print cwd-relative paths when that's shorter.
	const host: Host = {
		resolve: (specifier, fromId) => resolve(dirname(fromId), specifier),
		read: (id) => readFile(id, "utf8"),
		shortName: (id) => {
			const rel = relative(process.cwd(), id);
			return rel.length < id.length ? rel : id;
		},
	};

	const result = await assemble(resolve(input), host);

	// Colors only when a human is watching (and NO_COLOR isn't set).
	const useColor = process.stderr.isTTY && !process.env.NO_COLOR;
	const rendered = result.diagnostics.map(
		(d) =>
			(useColor ? d.formattedColor : d.formatted) ??
			`${d.type} ${d.code}: ${d.message}`,
	);
	if (rendered.length) {
		process.stderr.write(rendered.join("\n\n") + "\n");
	}
	if (result.diagnostics.some((d) => d.type === "error")) {
		process.exit(1);
	}

	await writeFile(values.output, result.output);
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
	process.exit(1);
});
