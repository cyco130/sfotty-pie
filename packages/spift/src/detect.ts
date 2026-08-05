// Filesystem family detection, following the OneDOS ladder adapted for
// images: geometry comes from the container instead of PERCOM/status.

import type { SectorMedium } from "./sector-medium.ts";
import { detectAtariDos, type AtariDosVariant } from "./atari-dos.ts";

export type DetectedFilesystem =
	| { family: "atari"; variant: AtariDosVariant }
	| { family: "sparta" };

export function detectFilesystem(
	medium: SectorMedium,
): DetectedFilesystem | undefined {
	if (isSpartaBoot(medium)) {
		return { family: "sparta" };
	}
	const variant = detectAtariDos(medium);
	if (variant !== undefined) {
		return { family: "atari", variant };
	}
	return undefined;
}

function isSpartaBoot(medium: SectorMedium): boolean {
	const boot = medium.readSector(1);
	if (boot === null) {
		return false;
	}
	// JMP $xx80 at offset 6 ($30xx for SpartaDOS, $08xx for BW-DOS), or
	// JMP $0440 for 512-byte-sector images.
	return (
		boot[6] === 0x4c &&
		(boot[7] === 0x80 || (boot[7] === 0x40 && boot[8] === 0x04))
	);
}
