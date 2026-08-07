import { expect, test } from "vitest";
import { parseWriteBootSectorsArgs } from "./write-boot-sectors.ts";

test("parses image, boot file, and options", () => {
	expect(parseWriteBootSectorsArgs(["-i", "disk.atr", "boot.bin"])).toEqual({
		image: "disk.atr",
		file: "boot.bin",
		pad: false,
		force: false,
	});
	expect(
		parseWriteBootSectorsArgs(["-i", "disk.atr", "boot.bin", "--pad", "-f"]),
	).toEqual({ image: "disk.atr", file: "boot.bin", pad: true, force: true });
});

test("validates the argument list", () => {
	expect(() => parseWriteBootSectorsArgs([])).toThrow(/missing --image/);
	expect(() => parseWriteBootSectorsArgs(["-i", "disk.atr"])).toThrow(
		/missing BOOT_FILE/,
	);
	expect(() => parseWriteBootSectorsArgs(["-i", "disk.atr", "a", "b"])).toThrow(
		/unexpected argument/,
	);
});
