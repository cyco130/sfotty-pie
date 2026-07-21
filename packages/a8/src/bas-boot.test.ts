import { expect, test } from "vitest";
import { DECODE, ReadOptions } from "@sfotty-pie/sfotty";
import { buildBasicBootDisk } from "./bas-boot.ts";
import { BAS_LOADER } from "./bas-loader-bytes.ts";
import { FILE_SIZE_OFFSET } from "./boot-disk.ts";
import { Atari } from "./machine.ts";
import { recognizableOs } from "./os-fixture.ts";

// The loader's fixed addresses, pinned against atari-src/bas-loader.s.
const LOAD_ADDRESS = 0x9a20;
const HATABS = 0x031a;

// A stand-in for a tokenized BASIC file: the loader serves bytes verbatim, so
// any pattern long enough to cross a sector boundary exercises it.
const PROGRAM = Uint8Array.from({ length: 200 }, (_, i) => (i * 7 + 3) & 0xff);

test("the assembled loader matches the boot disk's patch offset", () => {
	// The boot-continuation entry (clc, rts) sits right before file_size.
	expect(BAS_LOADER[FILE_SIZE_OFFSET - 2]).toBe(0x18);
	expect(BAS_LOADER[FILE_SIZE_OFFSET - 1]).toBe(0x60);
	// The boot header loads the image at LOAD_ADDRESS.
	expect(BAS_LOADER[2]! | (BAS_LOADER[3]! << 8)).toBe(LOAD_ADDRESS);
	expect(BAS_LOADER.length).toBe(384);
});

test("buildBasicBootDisk lays out loader, size, and data", () => {
	const disk = buildBasicBootDisk(PROGRAM);
	expect(disk.sectorSize).toBe(128);
	expect(disk.sectorCount).toBe(5); // 3 boot sectors + 200 bytes of file

	const boot = disk.readSector(1)!;
	expect([...boot.subarray(0, 4)]).toEqual([0x00, 0x03, 0x20, 0x9a]);
	expect(boot[FILE_SIZE_OFFSET]).toBe(PROGRAM.length);
	expect(boot[FILE_SIZE_OFFSET + 1]).toBe(0);

	const data = disk.readSector(4)!;
	expect([...data.subarray(0, 3)]).toEqual([...PROGRAM.subarray(0, 3)]);
});

test('init installs B:, types RUN "B:", and serves the file', () => {
	const disk = buildBasicBootDisk(PROGRAM);
	const machine = new Atari({ os: recognizableOs(10240) });
	machine.insertDisk(disk);
	const cpu = machine.cpu; // the machine's own CPU, which its built-in SIO drives

	const poke = (address: number, value: number) =>
		machine.mmu.write(address, value, ReadOptions.NONE);
	const peek = (address: number) => machine.mmu.read(address, ReadOptions.NONE);
	const peekWord = (address: number) =>
		peek(address) | (peek(address + 1) << 8);

	// Play OS: copy the boot sectors to their load address, like the real boot
	// would.
	for (let sector = 1; sector <= 3; sector++) {
		const data = disk.readSector(sector)!;
		for (let i = 0; i < data.length; i++) {
			poke(LOAD_ADDRESS + (sector - 1) * 128 + i, data[i]!);
		}
	}

	// The E: HATABS entry the OS would have installed, pointing at a fake
	// handler table with recognizable vector bytes.
	const fakeETable = 0x0680;
	for (let i = 0; i < 12; i++) poke(fakeETable + i, 0x10 + i);
	poke(HATABS, 0x45); // 'E'
	poke(HATABS + 1, fakeETable & 0xff);
	poke(HATABS + 2, fakeETable >> 8);

	// Mid-boot OS state: COLDST set, BOOT? not yet recorded.
	poke(0x0244, 0xff);
	poke(0x09, 0);

	cpu.RDY = true;
	cpu.reset(true);
	for (let i = 0; i < 20 && cpu.state !== DECODE; i++) cpu.cycle();

	// Call a loader routine like the OS/CIO would: push a sentinel return
	// address and run until the routine returns to it.
	const RETURN = 0xd000;
	const callSub = (target: number) => {
		poke(0x01fd, (RETURN - 1) >> 8);
		poke(0x01fc, (RETURN - 1) & 0xff);
		cpu.S = 0xfb;
		cpu.PC = target;
		for (
			let i = 0;
			i < 100_000 && !(cpu.PC === RETURN && cpu.state === DECODE);
			i++
		) {
			cpu.cycle();
		}
		expect(cpu.PC).toBe(RETURN);
	};

	// The loader prints its loading message (and used to echo the typed
	// line) through IOCB #0's cached E: PUT BYTE vector (ICPTL, address-1
	// RTS-style); point it at the loader's own boot-continuation clc/rts so
	// printing is a harmless no-op here.
	poke(0x0346, (LOAD_ADDRESS + 5) & 0xff);
	poke(0x0347, (LOAD_ADDRESS + 5) >> 8);

	// The boot init, through the header's init vector (goes to DOSINI).
	callSub(peekWord(LOAD_ADDRESS + 4));

	// The loader presented a completed disk boot (BOOT? = disk, COLDST clear)
	// and pointed DOSINI at the OS cold start, so a Reset re-boots the disk
	// instead of re-entering the spent loader.
	expect(peek(0x09)).toBe(1);
	expect(peek(0x0244)).toBe(0);
	expect(peekWord(0x0c)).toBe(0xe477);

	// B: went into the free HATABS entry; its handler table lives in the
	// loaded image.
	expect(peek(HATABS + 3)).toBe(0x42); // 'B'
	const bTable = peekWord(HATABS + 4);
	expect(bTable).toBeGreaterThanOrEqual(LOAD_ADDRESS);

	// The E: entry now points at the patched copy of the fake table - in the
	// loaded image - with the original vectors except GET BYTE.
	const eTable = peekWord(HATABS + 1);
	expect(eTable).toBeGreaterThanOrEqual(LOAD_ADDRESS);
	expect(eTable).toBeLessThan(LOAD_ADDRESS + 384);
	for (const i of [0, 1, 2, 3, 6, 7, 8, 9, 10, 11]) {
		expect(peek(eTable + i)).toBe(0x10 + i);
	}

	// Drive the patched E: GET BYTE like CIO would (table stores address-1):
	// it types RUN "B:" plus EOL...
	const eGetByte = peekWord(eTable + 4) + 1;
	let typed = "";
	for (let i = 0; i < 9; i++) {
		callSub(eGetByte);
		expect(cpu.Y).toBe(1);
		typed += String.fromCharCode(cpu.A);
	}
	expect(typed).toBe('RUN "B:"\x9b');
	// ...and restored the original E: handler table at the EOL.
	expect(peekWord(HATABS + 1)).toBe(fakeETable);

	// B: GET BYTE serves the whole file byte by byte, then EOF.
	const bGetByte = peekWord(bTable + 4) + 1;
	const served: number[] = [];
	for (let i = 0; i < PROGRAM.length; i++) {
		callSub(bGetByte);
		expect(cpu.Y).toBe(1);
		served.push(cpu.A);
	}
	expect(served).toEqual([...PROGRAM]);
	callSub(bGetByte);
	expect(cpu.Y).toBe(136); // EOF

	// CLOSE removes the B: entry again.
	callSub(peekWord(bTable + 2) + 1);
	expect(cpu.Y).toBe(1);
	expect(peek(HATABS + 3)).toBe(0);
	expect(peekWord(HATABS + 4)).toBe(0);
});
