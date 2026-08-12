import { expect, test } from "vitest";
import { createBlankAtr } from "./atr.ts";
import {
	ATR_FORMAT,
	detectImageFormat,
	formatByExtension,
	formatByName,
} from "./formats.ts";

const dcm = Uint8Array.from([0xfa, 0x81, 1, 0, 0x45]);
const atr = createBlankAtr({ sectorSize: 128, sectorCount: 720 });

test("content decides, not the name", () => {
	// A DCM called .atr is still a DCM.
	expect(detectImageFormat(dcm, "disk.atr")?.name).toBe("dcm");
	expect(detectImageFormat(atr, "disk.dcm")?.name).toBe("atr");
	expect(detectImageFormat(Uint8Array.from([1, 2, 3, 4]), "x.atr")).toBe(
		undefined,
	);
});

test("formats answer to their name and their extensions", () => {
	expect(formatByName("atr")).toBe(ATR_FORMAT);
	expect(formatByName("ATR")).toBe(ATR_FORMAT);
	// One collection spells DiskComm files .dc3; they are the same format.
	expect(formatByName("dcm")?.name).toBe("dcm");
	expect(formatByName("dc3")?.name).toBe("dcm");
	expect(formatByExtension("games/disk.DC3")?.name).toBe("dcm");
	expect(formatByName("xfd")).toBe(undefined);
});

test("spift writes what it can encode and says so about the rest", () => {
	expect(ATR_FORMAT.encode).toBeDefined();
	// Decoding is enough to read a DCM and to convert one; an encoder is a
	// separate job nobody needs yet.
	expect(formatByName("dcm")?.encode).toBe(undefined);
});
