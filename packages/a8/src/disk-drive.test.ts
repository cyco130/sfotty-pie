import { expect, test } from "vitest";
import { makeAtr } from "./atr-fixture.ts";
import { AtrImage } from "./atr.ts";
import { DiskDrive } from "./disk-drive.ts";
import type { SioCommandResponse } from "./sio-connector.ts";

function drive(image?: Uint8Array) {
	const d = new DiskDrive(1);
	if (image) d.disk = new AtrImage(image);
	return d;
}

function data(response: SioCommandResponse): number[] {
	if (response.kind !== "complete" || !response.data) {
		throw new Error(`expected complete-with-data, got ${response.kind}`);
	}
	return Array.from(response.data);
}

const frame = (command: number, aux1 = 0, aux2 = 0) => ({
	device: 0x31,
	command,
	aux1,
	aux2,
});

test("the $3F speed query returns the index; a stock drive NAKs it", () => {
	const d = drive(makeAtr(128, 720));
	d.highSpeedIndex = 6;
	expect(data(d.command(frame(0x3f)))).toEqual([6]);

	d.highSpeedIndex = undefined;
	expect(d.command(frame(0x3f)).kind).toBe("nak");
});

test("PERCOM read reports the classic physical geometries", () => {
	// Single density: 40 tracks x 18 x 128, FM.
	expect(data(drive(makeAtr(128, 720)).command(frame(0x4e)))).toEqual([
		40, 0, 0, 18, 0, 0, 0, 128, 0xff, 0, 0, 0,
	]);
	// Enhanced density: 26 sectors per track, MFM.
	expect(data(drive(makeAtr(128, 1040)).command(frame(0x4e)))).toEqual([
		40, 0, 0, 26, 0, 4, 0, 128, 0xff, 0, 0, 0,
	]);
	// Double density: 256-byte sectors, MFM.
	expect(data(drive(makeAtr(256, 720)).command(frame(0x4e)))).toEqual([
		40, 0, 0, 18, 0, 4, 1, 0, 0xff, 0, 0, 0,
	]);
	// Double-sided double density (XF551 layout).
	expect(data(drive(makeAtr(256, 1440)).command(frame(0x4e)))).toEqual([
		40, 0, 0, 18, 1, 4, 1, 0, 0xff, 0, 0, 0,
	]);
});

test("PERCOM read uses the single-track convention for odd sizes", () => {
	// 4 sectors of 128: no physical format - 1 track, 4 sectors per track.
	expect(data(drive(makeAtr(128, 4)).command(frame(0x4e)))).toEqual([
		1, 0, 0, 4, 0, 0, 0, 128, 0xff, 0, 0, 0,
	]);
});

test("PERCOM write takes a 12-byte frame and is accepted", () => {
	const response = drive(makeAtr(128, 720)).command(frame(0x4f));
	if (response.kind !== "receive") throw new Error(response.kind);
	expect(response.length).toBe(12);
	expect(response.then(new Uint8Array(12)).kind).toBe("complete");
});

function sendPercom(d: DiskDrive, bytes: number[]) {
	const response = d.command(frame(0x4f));
	if (response.kind !== "receive") throw new Error(response.kind);
	response.then(Uint8Array.from(bytes));
}

test("format follows the set PERCOM block and zeroes the disk", () => {
	const d = drive(makeAtr(128, 720));
	const image = d.disk!;
	image.writeSector(100, new Uint8Array(128).fill(0xaa));
	// ED geometry: 40 tracks x 26 x 128 bytes.
	sendPercom(d, [40, 0, 0, 26, 0, 4, 0, 128, 0xff, 0, 0, 0]);
	const list = data(d.command(frame(0x21)));
	expect(list).toHaveLength(128);
	expect(list.slice(0, 2)).toEqual([0xff, 0xff]);
	expect([image.sectorSize, image.sectorCount]).toEqual([128, 1040]);
	expect(image.readSector(100)?.every((b) => b === 0)).toBe(true);
	expect(image.dirty).toBe(true);
	// The set block sticks and is echoed by PERCOM read.
	expect(data(d.command(frame(0x4e)))).toEqual([
		40, 0, 0, 26, 0, 4, 0, 128, 0xff, 0, 0, 0,
	]);
});

test("format without a set PERCOM keeps the disk's own geometry", () => {
	const d = drive(makeAtr(128, 720));
	d.disk!.writeSector(5, new Uint8Array(128).fill(1));
	data(d.command(frame(0x21)));
	expect(d.disk!.sectorCount).toBe(720);
	expect(d.disk!.readSector(5)?.every((b) => b === 0)).toBe(true);
});

test("format to double density: 256-byte list, 128-byte boot slots", () => {
	const d = drive(makeAtr(128, 720));
	sendPercom(d, [40, 0, 0, 18, 0, 4, 1, 0, 0xff, 0, 0, 0]);
	expect(data(d.command(frame(0x21)))).toHaveLength(256);
	expect(d.disk!.sectorSize).toBe(256);
	expect(d.disk!.readSector(1)).toHaveLength(128);
	expect(d.disk!.readSector(4)).toHaveLength(256);
});

test("format medium density always makes an ED disk", () => {
	const d = drive(makeAtr(256, 720));
	sendPercom(d, [40, 0, 0, 18, 0, 4, 1, 0, 0xff, 0, 0, 0]);
	expect(data(d.command(frame(0x22)))).toHaveLength(128);
	expect([d.disk!.sectorSize, d.disk!.sectorCount]).toEqual([128, 1040]);
});

test("format refuses protected media and impossible geometries", () => {
	const d = drive(makeAtr(128, 720));
	d.disk!.writeProtected = true;
	expect(d.command(frame(0x21)).kind).toBe("error");
	d.disk!.writeProtected = false;
	sendPercom(d, [0, 0, 0, 0, 0, 0, 0, 128, 0xff, 0, 0, 0]);
	expect(d.command(frame(0x21)).kind).toBe("error");
	expect(d.disk!.sectorCount).toBe(720); // untouched
});
