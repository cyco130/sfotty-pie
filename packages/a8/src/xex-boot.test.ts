import { expect, test } from "vitest";
import { DECODE, ReadOptions, Sfotty } from "@sfotty-pie/sfotty";
import { Atari } from "./machine.ts";
import { createSioHandler, SIOV } from "./sio.ts";
import { buildBootDisk, FILE_SIZE_OFFSET } from "./xex-boot.ts";
import { XEX_LOADER } from "./xex-loader-bytes.ts";

// A four-chunk XEX exercising the whole protocol:
// - code at $3000: inc $3100, rts — then INITAD pointed at it (runs once
//   mid-load)
// - data at $2000-$2002
// - code at $3010: inc $3101, then spin at $3013 — then RUNAD pointed at it
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

test("booting the disk loads and runs the executable", () => {
	const disk = buildBootDisk(XEX);
	const machine = new Atari({ model: "800", os: new Uint8Array(10240) });
	const cpu = new Sfotty(machine, { withoutUndocumented: false });
	machine.addExecuteTrap(
		SIOV,
		createSioHandler({ machine, cpu, getDisk: () => disk }),
	);

	// Play OS: copy the boot sectors to their load address and call the boot
	// init vector (header bytes 4-5), like the real boot would.
	for (let sector = 1; sector <= 3; sector++) {
		const data = disk.readSector(sector)!;
		for (let i = 0; i < data.length; i++) {
			machine.write(
				0x0700 + (sector - 1) * 128 + i,
				data[i]!,
				ReadOptions.NONE,
			);
		}
	}

	cpu.RDY = true;
	cpu.reset(true);
	for (let i = 0; i < 20 && cpu.state !== DECODE; i++) cpu.run();
	cpu.PC =
		machine.read(0x0704, ReadOptions.NONE) |
		(machine.read(0x0705, ReadOptions.NONE) << 8);
	cpu.S = 0xfd;

	// Run until the executable spins at its RUNAD target. Check at
	// instruction boundaries only — mid-instruction, PC already points past
	// the operand while writes are still pending.
	for (
		let i = 0;
		i < 100_000 && !(cpu.PC === 0x3013 && cpu.state === DECODE);
		i++
	) {
		cpu.run();
	}
	expect(cpu.PC).toBe(0x3013);

	// The data chunk arrived...
	expect(machine.read(0x2000, ReadOptions.NONE)).toBe(0x11);
	expect(machine.read(0x2001, ReadOptions.NONE)).toBe(0x22);
	expect(machine.read(0x2002, ReadOptions.NONE)).toBe(0x33);
	// ...INITAD ran exactly once, and RUNAD ran.
	expect(machine.read(0x3100, ReadOptions.NONE)).toBe(1);
	expect(machine.read(0x3101, ReadOptions.NONE)).toBe(1);
});
