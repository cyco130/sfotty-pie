// Filesystem family detection, following the OneDOS ladder adapted for
// images: geometry comes from the container instead of PERCOM/status.
// SpartaDOS goes first - its boot signature plus a validated parameter
// block outranks the Atari DOS VTOC heuristics - and the validation
// matters: 38 of the 150 signature hits in the corpus are boot-only game
// disks reusing the Sparta loader over garbage parameters.

import type { SectorMedium } from "./sector-medium.ts";
import { detectAtariDos, type AtariDosVariant } from "./atari-dos.ts";
import { detectSpartaDos, type SpartaDosVariant } from "./sparta-dos.ts";

export type DetectedFilesystem =
	| { family: "atari"; variant: AtariDosVariant }
	| { family: "sparta"; variant: SpartaDosVariant };

export function detectFilesystem(
	medium: SectorMedium,
): DetectedFilesystem | undefined {
	const sparta = detectSpartaDos(medium);
	if (sparta !== undefined) {
		return { family: "sparta", variant: sparta };
	}
	const variant = detectAtariDos(medium);
	if (variant !== undefined) {
		return { family: "atari", variant };
	}
	return undefined;
}
