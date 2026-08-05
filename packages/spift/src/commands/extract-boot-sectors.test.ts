import { expect, test } from "vitest";
import { parseExtractBootSectorsArgs } from "./extract-boot-sectors.ts";

test("parses image, output file, and options", () => {
	expect(parseExtractBootSectorsArgs(["disk.atr", "boot.bin"])).toEqual({
		image: "disk.atr",
		file: "boot.bin",
		sectorCount: undefined,
		force: false,
	});
	expect(
		parseExtractBootSectorsArgs([
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
	expect(() => parseExtractBootSectorsArgs([])).toThrow(/missing IMAGE_FILE/);
	expect(() => parseExtractBootSectorsArgs(["disk.atr"])).toThrow(
		/missing OUTPUT_FILE/,
	);
	expect(() =>
		parseExtractBootSectorsArgs(["a.atr", "b", "--sector-count", "0"]),
	).toThrow(/positive integer/);
});
