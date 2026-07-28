// Assemble OneDOS with spasm and build its disk images. Runs as `pnpm build`;
// spasm must be built first - the root build orders that via the workspace
// dependency.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assemble, type Host, type Value } from "@sfotty-pie/spasm";
import { buildDiskImage, SECTOR_LINK_OFFSET } from "./disk.ts";

// Node-like resolution: ids are absolute paths; relative specifiers resolve
// against the importing file's directory.
const host: Host = {
	resolve: (specifier, fromId) => resolve(dirname(fromId), specifier),
	read: (id) => readFile(id, "utf8"),
};

/** Assemble one entry point, throwing on assembly errors. */
async function build(
	entry: string,
): Promise<{ output: Uint8Array; symbols: Map<string, Value> }> {
	const result = await assemble(resolve(import.meta.dirname, entry), host);
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
		throw new Error(`Assembly failed: ${entry}`);
	}
	return result;
}

/** A symbol's value, as a number - it has to be a resolved integer. */
function address(symbols: Map<string, Value>, name: string): number {
	const value = symbols.get(name);
	if (typeof value !== "bigint") {
		throw new Error(`"${name}" is not defined as an address`);
	}
	return Number(value);
}

/**
 * The "No DOS" boot loader: three boot sectors that print a message and
 * return a boot error. The sector-link offset is patched in here rather than
 * assembled in, because it describes the *disk* the loader ships on - the
 * loader reads it back to learn the sector size.
 */
export async function buildNoDosLoader(): Promise<Uint8Array> {
	const { output, symbols } = await build("src/boot-loaders/adfs-boot-stub.s");
	const boot = new Uint8Array(output);
	const offset =
		address(symbols, "sector_link_offset") - address(symbols, "LOAD_ADDRESS");
	if (offset < 0 || offset >= boot.length) {
		throw new Error(`sector_link_offset lies outside the boot image`);
	}
	boot[offset] = SECTOR_LINK_OFFSET;
	return boot;
}

/** A bootable single-density disk with no DOS on it. */
export async function buildNoDosDisk(): Promise<Uint8Array> {
	return buildDiskImage(await buildNoDosLoader());
}

/** The DOS itself: a binary-load file at $0700. */
export async function buildDos(): Promise<Uint8Array> {
	return (await build("src/dos.s")).output;
}

// Script mode: write the artifacts.
if (process.argv[1] === import.meta.filename) {
	const [disk, dos] = await Promise.all([buildNoDosDisk(), buildDos()]);
	const outDir = join(import.meta.dirname, "dist");
	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, "nodos.atr"), disk);
	await writeFile(join(outDir, "onedos.xex"), dos);
	process.stdout.write(
		`Wrote dist/nodos.atr (${disk.length} bytes)\n` +
			`Wrote dist/onedos.xex (${dos.length} bytes)\n`,
	);
}
