import { expect, test } from "vitest";
import { parseExtractBootSectorsArgs } from "./extract-boot-sectors.ts";

test("parses image, output file, and options", () => {
	expect(parseExtractBootSectorsArgs(["-i", "disk.atr", "boot.bin"])).toEqual({
		image: "disk.atr",
		file: "boot.bin",
		sectorCount: undefined,
		force: false,
	});
	expect(
		parseExtractBootSectorsArgs([
			"-i",
			"disk.atr",
			"boot.bin",
			"--sector-count",
			"5",
			"-f",
		]),
	).toEqual({
		image: "disk.atr",
		file: "boot.bin",
		sectorCount: 5,
		force: true,
	});
});

test("validates the argument list", () => {
	expect(() => parseExtractBootSectorsArgs([])).toThrow(/missing --image/);
	expect(() => parseExtractBootSectorsArgs(["-i", "disk.atr"])).toThrow(
		/missing OUTPUT_FILE/,
	);
	expect(() =>
		parseExtractBootSectorsArgs(["-i", "a.atr", "b", "--sector-count", "0"]),
	).toThrow(/positive integer/);
});
