import { expect, test } from "vitest";
import { DECODE, ReadOptions } from "@sfotty-pie/sfotty";
import { Atari } from "./machine.ts";
import { recognizableOs } from "./os-fixture.ts";
import { FILE_SIZE_OFFSET } from "./boot-disk.ts";
import { buildBootDisk } from "./xex-boot.ts";
import { XEX_LOADER } from "./xex-loader-bytes.ts";

// A four-chunk XEX exercising the whole protocol:
// - code at $3000: inc $3100, rts - then INITAD pointed at it (runs once
//   mid-load)
// - data at $2000-$2002
// - code at $3010: inc $3101, then spin at $3013 - then RUNAD pointed at it
const XEX = Uint8Array.from([
	0xff, 0xff,
	// prettier-ignore
	0x00, 0x30, 0x05, 0x30, /* $3000: */ 0xee, 0x00, 0x31, 0x60, 0x00, 0x00, 0xe2,
	0x02, 0xe3, 0x02, /* INITAD: */ 0x00, 0x30, 0x00, 0x20, 0x02, 0x20,
	/* $2000: */ 0x11, 0x22, 0x33,
	// prettier-ignore
	0x10, 0x30, 0x15, 0x30, /* $3010: */ 0xee, 0x01, 0x31, 0x4c, 0x13, 0x30, 0xe0,
	0x02, 0xe1, 0x02, /* RUNAD: */ 0x10, 0x30,
]);

test("the assembled loader matches buildBootDisk's patch offset", () => {
	// The boot-continuation entry (clc, rts) sits right before file_size.
	expect(XEX_LOADER[FILE_SIZE_OFFSET - 2]).toBe(0x18);
	expect(XEX_LOADER[FILE_SIZE_OFFSET - 1]).toBe(0x60);
	expect(XEX_LOADER.length).toBe(384);
});

test("buildBootDisk lays out loader, size, and data", () => {
	const disk = buildBootDisk(XEX);
	expect(disk.sectorSize).toBe(128);
	expect(disk.sectorCount).toBe(4); // 3 boot sectors + 41 bytes of file

	const boot = disk.readSector(1)!;
	expect([...boot.subarray(0, 4)]).toEqual([0x00, 0x03, 0x00, 0x07]);
	expect(boot[FILE_SIZE_OFFSET]).toBe(XEX.length);
	expect(boot[FILE_SIZE_OFFSET + 1]).toBe(0);

	const data = disk.readSector(4)!;
	expect([...data.subarray(0, 2)]).toEqual([0xff, 0xff]);
});

// Play OS: copy the boot sectors to their load address, present mid-boot
// state, and call the boot init vector (header bytes 4-5), like the real
// boot would. Runs until the executable spins at its RUNAD target ($3013 in
// both test files) and returns the machine for assertions.
function bootAndRun(xex: Uint8Array): Atari {
	const disk = buildBootDisk(xex);
	const machine = new Atari({ os: recognizableOs(10240) });
	machine.insertDisk(disk);
	const cpu = machine.cpu; // the machine's own CPU, which its built-in SIO drives

	for (let sector = 1; sector <= 3; sector++) {
		const data = disk.readSector(sector)!;
		for (let i = 0; i < data.length; i++) {
			machine.mmu.write(
				0x0700 + (sector - 1) * 128 + i,
				data[i]!,
				ReadOptions.NONE,
			);
		}
	}

	// Mid-boot OS state: COLDST set, BOOT? not yet recorded. The loader must
	// flip these before running game code.
	machine.mmu.write(0x0244, 0xff, ReadOptions.NONE);
	machine.mmu.write(0x09, 0, ReadOptions.NONE);

	cpu.RDY = true;
	cpu.reset(true);
	for (let i = 0; i < 20 && cpu.state !== DECODE; i++) cpu.cycle();
	cpu.PC =
		machine.mmu.read(0x0704, ReadOptions.NONE) |
		(machine.mmu.read(0x0705, ReadOptions.NONE) << 8);
	cpu.S = 0xfd;

	// Run until the executable spins at its RUNAD target. Check at
	// instruction boundaries only - mid-instruction, PC already points past
	// the operand while writes are still pending.
	for (
		let i = 0;
		i < 2_000_000 && !(cpu.PC === 0x3013 && cpu.state === DECODE);
		i++
	) {
		cpu.cycle();
	}
	expect(cpu.PC).toBe(0x3013);
	return machine;
}

test("booting the disk loads and runs the executable", () => {
	const machine = bootAndRun(XEX);

	// The data chunk arrived...
	expect(machine.mmu.read(0x2000, ReadOptions.NONE)).toBe(0x11);
	expect(machine.mmu.read(0x2001, ReadOptions.NONE)).toBe(0x22);
	expect(machine.mmu.read(0x2002, ReadOptions.NONE)).toBe(0x33);
	// ...INITAD ran exactly once, and RUNAD ran.
	expect(machine.mmu.read(0x3100, ReadOptions.NONE)).toBe(1);
	expect(machine.mmu.read(0x3101, ReadOptions.NONE)).toBe(1);
	// The loader presented a completed disk boot before running game code
	// (BOOT? = disk, COLDST clear), so a game that restarts itself through
	// the OS warmstart isn't cold-rebooted into the loader (Bruce Lee).
	expect(machine.mmu.read(0x09, ReadOptions.NONE)).toBe(1);
	expect(machine.mmu.read(0x0244, ReadOptions.NONE)).toBe(0);
	// ...and defaulted DOSINI to the OS cold start, so a Reset with no game
	// hook re-boots the disk instead of re-entering the spent loader.
	expect(machine.mmu.read(0x0c, ReadOptions.NONE)).toBe(0x77);
	expect(machine.mmu.read(0x0d, ReadOptions.NONE)).toBe(0xe4);
});

// A file sized an exact multiple of 128 completely fills its last sector.
// The loader's copy loop used to refill the buffer eagerly when it emptied,
// prefetching one sector past the file's last - a sector the boot disk
// doesn't have - and dying with a disk error.
test("a file that exactly fills its last sector boots", () => {
	// A data chunk at $2000 padding the file to 384 bytes, then the same
	// RUNAD chunk as XEX: code at $3010 (inc $3101, spin at $3013).
	// prettier-ignore
	const tail = [
		0x10, 0x30, 0x15, 0x30, 0xee, 0x01, 0x31, 0x4c, 0x13, 0x30,
		0xe0, 0x02, 0xe1, 0x02, 0x10, 0x30,
	];
	const padData = 384 - 2 - 4 - tail.length;
	const end = 0x2000 + padData - 1;
	// prettier-ignore
	const xex = Uint8Array.from([
		0xff, 0xff,
		0x00, 0x20, end & 0xff, end >> 8,
		...new Array(padData).fill(0xaa),
		...tail,
	]);
	expect(xex.length % 128).toBe(0);

	const machine = bootAndRun(xex);
	expect(machine.mmu.read(0x3101, ReadOptions.NONE)).toBe(1);
});
