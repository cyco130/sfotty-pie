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
