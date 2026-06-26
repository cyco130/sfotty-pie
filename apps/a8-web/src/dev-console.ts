/* eslint-disable no-console -- this module's whole job is to print to the console */
import { canonicalize } from "@sfotty-pie/a8";
import { disassemble, ReadOptions } from "@sfotty-pie/sfotty";
import { setCommandTrace } from "./commands.ts";
import type { EmulatorHost } from "./host.ts";
import { idbBlobStore } from "./images/blob-store.ts";
import { deflateRaw, inflateRaw } from "./images/compress.ts";
import {
	type BlobRecord,
	openLibraryDb,
	STORE_BLOBS,
	withStore,
} from "./images/db.ts";
import { sha256Hex } from "./images/hash.ts";
import {
	addImage,
	getImage,
	getImageBytes,
	libraryEntries,
	readyLibrary,
	removeImage,
} from "./images/library.ts";
import { builtinLibrary } from "./library.ts";
import { builtinFirmware } from "virtual:firmware-library";

function hex(value: number, width: number): string {
	return value.toString(16).padStart(width, "0");
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => hex(byte, 2)).join("");
}

/** Read a single file the user picks — a stand-in for the upload UI. */
function pickFile(): Promise<{ name: string; bytes: Uint8Array }> {
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) {
				reject(new Error("no file selected"));
				return;
			}
			file
				.arrayBuffer()
				.then((buffer) =>
					resolve({ name: file.name, bytes: new Uint8Array(buffer) }),
				)
				.catch(reject);
		};
		input.click();
	});
}

type ImageInput = File | Uint8Array | { name?: string; bytes: Uint8Array };

async function toBytes(
	input: ImageInput,
): Promise<{ name: string | undefined; bytes: Uint8Array }> {
	if (input instanceof Uint8Array) return { name: undefined, bytes: input };
	if (input instanceof File) {
		return {
			name: input.name,
			bytes: new Uint8Array(await input.arrayBuffer()),
		};
	}
	return { name: input.name, bytes: input.bytes };
}

/**
 * `window.a8.images`: a console harness for the image library before the UI
 * exists. Pick or pass a file, canonicalize it, and round-trip blobs.
 *
 *   a8.images.canonicalize(await a8.images.pick())
 *   a8.images.blobs.put("k", new Uint8Array([1,2,3]))
 */
const images = {
	pick: pickFile,
	sha256: sha256Hex,
	// The built-in firmware manifest (with precomputed canonical hash + kind).
	builtin: builtinFirmware,
	// The unified library (built-ins ∪ user uploads) and its operations.
	//   await a8.images.library.ready()
	//   const f = await a8.images.pick(); await a8.images.library.add(f.bytes, f.name)
	//   a8.images.library.entries.value
	library: {
		ready: readyLibrary,
		entries: libraryEntries,
		add: addImage,
		get: getImage,
		bytes: getImageBytes,
		remove: removeImage,
	},
	deflate: deflateRaw,
	inflate: inflateRaw,
	blobs: idbBlobStore(),
	db: openLibraryDb,
	// Inspect a stored blob's encoding and on-disk size (to confirm store-smaller).
	async stat(ref: string) {
		const db = await openLibraryDb();
		const record = await withStore<BlobRecord | undefined>(
			db,
			STORE_BLOBS,
			"readonly",
			(store) => store.get(ref),
		);
		return record
			? { encoding: record.encoding, storedSize: record.bytes.byteLength }
			: undefined;
	},
	// Canonicalize and summarize each piece — role, kind, the source range and
	// header recipe (the built-in locator), and the canonical hash.
	async canonicalize(input: ImageInput) {
		const { name, bytes } = await toBytes(input);
		const pieces = canonicalize(bytes, name);
		return Promise.all(
			pieces.map(async (piece) => ({
				role: piece.role,
				kind: piece.kind,
				size: piece.bytes.length,
				from: piece.from,
				to: piece.to,
				header: bytesToHex(piece.header),
				hash: await sha256Hex(piece.bytes),
			})),
		);
	},
};

/**
 * Install `window.a8`: a poor-man's monitor for the browser console — live
 * machine/cpu access, peek/poke, a disassembler, and the CPU/command traces.
 *
 *   a8.trace.cpu(true); …reproduce…; a8.trace.dump(300)
 *   a8.peek(0x0244)        a8.disasm(a8.cpu.PC)
 */
export function installDevConsole(host: EmulatorHost): void {
	const peek = (address: number) =>
		host.emulator.machine.read(address & 0xffff, ReadOptions.PEEK);

	const a8 = {
		get emulator() {
			return host.emulator;
		},
		get machine() {
			return host.emulator.machine;
		},
		get cpu() {
			return host.emulator.cpu;
		},
		peek,
		poke: (address: number, value: number) =>
			host.emulator.machine.write(
				address & 0xffff,
				value & 0xff,
				ReadOptions.NONE,
			),
		disasm: (address: number, count = 16) => {
			let pc = address & 0xffff;
			const lines: string[] = [];
			for (let i = 0; i < count; i++) {
				const { text, length } = disassemble(peek, pc);
				lines.push(`${hex(pc, 4)}  ${text}`);
				pc = (pc + length) & 0xffff;
			}
			console.log(lines.join("\n"));
		},
		// The built-in image library (merged committed + local folders).
		get library() {
			return builtinLibrary;
		},
		// The image-library harness (uploads/canonicalization/blob store).
		images,
		trace: {
			cpu: (enabled: boolean) => host.setCpuTrace(enabled),
			commands: (enabled: boolean) => setCommandTrace(enabled),
			clear: () => host.clearCpuTrace(),
			// No count → the whole capture (after a reset, the captured boot).
			dump: (count?: number) =>
				console.log(host.dumpCpuTrace(count).join("\n")),
		},
	};

	Object.assign(window, { a8 });
	console.log("Dev console ready: window.a8 (try a8.trace.cpu(true))");
}
