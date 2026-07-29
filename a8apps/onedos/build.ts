// Assemble OneDOS with spasm and build its disk images. Runs as `pnpm build`;
// spasm must be built first - the root build orders that via the workspace
// dependency.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assemble, type Host, type Value } from "@sfotty-pie/spasm";
import {
	buildDiskImage,
	planFiles,
	SECTOR_LINK_OFFSET,
	type PlannedFile,
} from "./disk.ts";

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
 * Patch bytes into an assembled boot image at a symbol's address. The boot
 * params are patched rather than assembled in because they describe the
 * *disk* the loader ships on - the same loader boots differently formatted
 * disks.
 */
function patch(
	boot: Uint8Array,
	symbols: Map<string, Value>,
	name: string,
	...bytes: number[]
): void {
	const offset = address(symbols, name) - address(symbols, "LOAD_ADDRESS");
	if (offset < 0 || offset + bytes.length > boot.length) {
		throw new Error(`"${name}" lies outside the boot image`);
	}
	boot.set(bytes, offset);
}

/**
 * The "No DOS" boot loader: three boot sectors that print a message and
 * return a boot error. The sector-link offset describes the disk it ships
 * on - the loader reads it back to learn the sector size.
 */
export async function buildNoDosLoader(): Promise<Uint8Array> {
	const { output, symbols } = await build("src/boot-loaders/adfs-boot-stub.s");
	const boot = new Uint8Array(output);
	patch(boot, symbols, "sector_link_offset", SECTOR_LINK_OFFSET);
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

/**
 * The ADFS boot loader, patched for the disk it boots: an Atari DOS 2.0
 * single-density disk carrying the DOS image as a file starting at
 * `dosFirstSector`.
 */
export async function buildAdfsBootLoader(
	dosFirstSector: number,
): Promise<Uint8Array> {
	const { output, symbols } = await build("src/boot-loaders/adfs-boot.s");
	const boot = new Uint8Array(output);
	patch(boot, symbols, "boot_drive", 0x31); // SIO device: disk (D1:)
	patch(boot, symbols, "link_mask", 0x03); // Atari DOS: 6-bit file numbers
	patch(boot, symbols, "has_dos", 1); // DOS present, 128-byte sectors
	patch(
		boot,
		symbols,
		"dos_file_first_sector",
		dosFirstSector & 0xff,
		(dosFirstSector >> 8) & 0xff,
	);
	patch(boot, symbols, "sector_link_offset", SECTOR_LINK_OFFSET);
	return boot;
}

/**
 * The OneDOS disk: ADFS boot sectors plus the DOS image stored as the file
 * ONEDOS.DOS, its first sector patched into the boot params.
 */
export async function buildOneDosDisk(): Promise<{
	image: Uint8Array;
	files: PlannedFile[];
}> {
	const dos = await buildDos();
	const files = planFiles([{ name: "ONEDOS.DOS", data: dos }]);
	const boot = await buildAdfsBootLoader(files[0]!.sectors[0]!);
	return { image: buildDiskImage(boot, files), files };
}

// Script mode: write the artifacts.
if (process.argv[1] === import.meta.filename) {
	const [disk, dos, onedos] = await Promise.all([
		buildNoDosDisk(),
		buildDos(),
		buildOneDosDisk(),
	]);
	const outDir = join(import.meta.dirname, "dist");
	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, "nodos.atr"), disk);
	await writeFile(join(outDir, "onedos.xex"), dos);
	await writeFile(join(outDir, "onedos.atr"), onedos.image);
	process.stdout.write(
		`Wrote dist/nodos.atr (${disk.length} bytes)\n` +
			`Wrote dist/onedos.xex (${dos.length} bytes)\n` +
			`Wrote dist/onedos.atr (${onedos.image.length} bytes, ` +
			`ONEDOS.DOS in ${onedos.files[0]!.sectors.length} sectors)\n`,
	);
}
