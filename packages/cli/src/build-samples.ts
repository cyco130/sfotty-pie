// Assemble the sample programs in `src/samples/` with spasm into the shipped
// `samples/*.65` binaries. Run with `pnpm --filter @sfotty-pie/cli build:samples`
// (spasm must be built first).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assemble, type Host } from "@sfotty-pie/spasm";

const sourceDir = resolve(import.meta.dirname, "samples");
const outputDir = resolve(import.meta.dirname, "../samples");

// Node-like resolution: ids are absolute paths; relative specifiers resolve
// against the importing file's directory.
const host: Host = {
	resolve: (specifier, fromId) => resolve(dirname(fromId), specifier),
	read: (id) => readFile(id, "utf8"),
};

await mkdir(outputDir, { recursive: true });

for (const name of ["hello", "echo", "cat", "guess"]) {
	const result = await assemble(resolve(sourceDir, `${name}.s`), host);

	for (const diagnostic of result.diagnostics) {
		process.stderr.write(
			`${name}.s: ${diagnostic.type}: ${diagnostic.message}\n`,
		);
	}
	if (result.diagnostics.some((d) => d.type === "error")) {
		process.exitCode = 1;
		continue;
	}

	await writeFile(resolve(outputDir, `${name}.65`), result.output);
	process.stdout.write(`samples/${name}.65 — ${result.output.length} bytes\n`);
}
