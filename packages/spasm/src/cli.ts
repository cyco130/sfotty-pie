#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
	// specifier resolves against the importing file's directory.
	const host: Host = {
		resolve: (specifier, fromId) => resolve(dirname(fromId), specifier),
		read: (id) => readFile(id, "utf8"),
	};

	const result = await assemble(resolve(input), host);

	for (const diagnostic of result.diagnostics) {
		process.stderr.write(`${diagnostic.type}: ${diagnostic.message}\n`);
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
