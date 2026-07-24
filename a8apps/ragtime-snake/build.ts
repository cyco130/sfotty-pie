// Assemble the game with spasm into dist/ragtime-snake.xex. Runs as
// `pnpm build`; spasm must be built first - the root build orders that via
// the workspace dependency.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assemble, type Host } from "@sfotty-pie/spasm";

// Node-like resolution: ids are absolute paths; relative specifiers resolve
// against the importing file's directory.
const host: Host = {
	resolve: (specifier, fromId) => resolve(dirname(fromId), specifier),
	read: (id) => readFile(id, "utf8"),
};

/** Assemble the game, throwing on assembly errors. */
export async function buildGame(): Promise<Uint8Array> {
	const entry = resolve(import.meta.dirname, "src/main.s");
	const result = await assemble(entry, host);
	for (const diagnostic of result.diagnostics) {
		process.stderr.write(
			`${diagnostic.formatted ?? `${diagnostic.type}: ${diagnostic.message}`}\n`,
		);
	}
	if (result.diagnostics.some((d) => d.type === "error")) {
		throw new Error("Assembly failed");
	}
	return result.output;
}

// Script mode: write the artifact.
if (process.argv[1] === import.meta.filename) {
	const xex = await buildGame();
	const outDir = join(import.meta.dirname, "dist");
	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, "ragtime-snake.xex"), xex);
	process.stdout.write(`Wrote dist/ragtime-snake.xex (${xex.length} bytes)\n`);
}
