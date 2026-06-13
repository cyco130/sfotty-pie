import type { FirmwareKey } from "./detect-firmware.ts";
import type { AtariModel } from "./machine.ts";

/** The machine context that decides which OS firmware is preferred. */
export interface FirmwareContext {
	model: AtariModel;
	tv: "ntsc" | "pal";
}

// OS firmware, best-first. These cover the four emulated machines; 800XL and
// 130XE share the XL/XE list. Only ROMs the emulator can actually run on the
// machine are listed — the XL/XE list is 16K-only (the 10K Xformer patch, a
// real-hardware fallback, is omitted because the XL/XE machine maps a 16K OS).
const OS_800_NTSC: readonly FirmwareKey[] = [
	"os-b-ntsc",
	"os-b-ntsc-xformer",
	"os-a-ntsc",
	"altirra-os-800",
	"os-a-pal",
	"os-b-pal",
];

const OS_800_PAL: readonly FirmwareKey[] = [
	"os-a-pal",
	"os-b-pal",
	"altirra-os-800",
	"os-b-ntsc",
	"os-b-ntsc-xformer",
	"os-a-ntsc",
];

const OS_XLXE: readonly FirmwareKey[] = [
	"xlxe-os-rev2",
	"xlxe-os-rev3",
	"xlxe-os-rev1",
	"xlxe-os-rev4-xegs",
	"altirra-os-xlxe",
	"atarixx-os",
	"os-1200xl-rev10",
	"os-1200xl-rev11",
	"xlxe-os-arabic-1987",
	"xlxe-os-arabic-1988",
];

/** OS firmware keys, best-first, for the given machine. */
export function preferredOsKeys(ctx: FirmwareContext): readonly FirmwareKey[] {
	if (ctx.model === "800") {
		return ctx.tv === "pal" ? OS_800_PAL : OS_800_NTSC;
	}
	return OS_XLXE; // 800XL, 130XE
}

// BASIC firmware, best-first. Machine-independent (any BASIC runs on any
// machine; XL/XE shipped rev C). The replacements rank below the real rev C but
// above the buggier original revisions.
const BASIC_PREFERENCE: readonly FirmwareKey[] = [
	"basic-c",
	"altirra-basic",
	"atarixx-basic",
	"basic-a",
	"basic-b",
];

/** BASIC firmware keys, best-first. */
export function preferredBasicKeys(): readonly FirmwareKey[] {
	return BASIC_PREFERENCE;
}
