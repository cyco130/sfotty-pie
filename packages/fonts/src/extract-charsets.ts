// Dev-only tool: regenerates src/data/*.bin from an Atari XL/XE OS ROM image.
// The extracted data is committed, so this only needs to run again if the
// source ROM ever changes (it won't - the character sets were identical across
// all OS revisions that carried them).
//
// Usage: node src/extract-charsets.ts <path-to-16KB-XL/XE-OS-ROM>
//
// The XL/XE OS is mapped at $C000-$FFFF. The standard character set lives at
// $E000-$E3FF (ROM offset $2000) and is byte-identical to the one in the
// 400/800 OS. The international character set lives at $CC00-$CFFF (ROM
// offset $0C00); it replaces the control-graphics characters (ATASCII
// $00-$1A) plus $60 and $7B with accented Latin letters.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const romPath = process.argv[2];
if (!romPath) {
	console.error("Usage: node src/extract-charsets.ts <XL/XE OS ROM>");
	process.exit(1);
}

const rom = readFileSync(romPath);
if (rom.length !== 16384) {
	console.error(`Expected a 16384-byte XL/XE OS ROM, got ${rom.length} bytes`);
	process.exit(1);
}

const dataDir = join(import.meta.dirname, "data");
writeFileSync(
	join(dataDir, "charset-standard.bin"),
	rom.subarray(0x2000, 0x2400),
);
writeFileSync(
	join(dataDir, "charset-international.bin"),
	rom.subarray(0x0c00, 0x1000),
);
process.stdout.write(
	"Wrote charset-standard.bin and charset-international.bin\n",
);
