import type { FirmwareKey } from "./detect-firmware.ts";
import type { AtariModel } from "./machine.ts";

/**
 * Models the firmware ranking knows about. A superset of the currently-emulated
 * `AtariModel`: `1200XL` and `XEGS` get their own OS rankings ahead of full
 * machine support, so the firmware selector can rank those slots today. The
 * emulator runs them as XL/XE for now; once they're real machines this widening
 * collapses back into `AtariModel` and the `switch` below already handles them.
 */
export type FirmwareModel = AtariModel | "1200XL" | "XEGS";

/** The machine context that decides which OS firmware is preferred. */
export interface FirmwareContext {
	model: FirmwareModel;
	tv: "ntsc" | "pal";
}

// OS firmware, best-first. The emulated machines (800 NTSC/PAL, and 800XL/130XE
// → the shared XL/XE list) and the not-yet-emulated 1200XL/XEGS each rank toward
// their own native ROMs first, then the rest of the XL/XE-class OSes (which all
// run with some missing functionality).
//
// `os-b-ntsc-xformer` is a 10K patch that also runs on XL/XE-class hardware, so
// it trails every XL/XE-class list as a last resort. (Whether the bus manager
// maps a 10K OS on an XL/XE machine is untested — to be fixed later.)
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
	"os-1200xl-rev11",
	"os-1200xl-rev10",
	"xlxe-os-arabic-1988",
	"xlxe-os-arabic-1987",
	"os-b-ntsc-xformer",
];

// 1200XL: its own ROMs first, then the Altirra XL OS (supports it), then the
// rest of the XL/XE-class OSes.
const OS_1200XL: readonly FirmwareKey[] = [
	"os-1200xl-rev11",
	"os-1200xl-rev10",
	"xlxe-os-rev2",
	"xlxe-os-rev3",
	"xlxe-os-rev1",
	"altirra-os-xlxe",
	"xlxe-os-rev4-xegs",
	"atarixx-os",
	"xlxe-os-arabic-1988",
	"xlxe-os-arabic-1987",
	"os-b-ntsc-xformer",
];

// XEGS: its own OS first, then the Altirra XL OS, then the rest.
const OS_XEGS: readonly FirmwareKey[] = [
	"xlxe-os-rev4-xegs",
	"altirra-os-xlxe",
	"xlxe-os-rev2",
	"xlxe-os-rev3",
	"xlxe-os-rev1",
	"atarixx-os",
	"os-1200xl-rev11",
	"os-1200xl-rev10",
	"xlxe-os-arabic-1988",
	"xlxe-os-arabic-1987",
	"os-b-ntsc-xformer",
];

/** OS firmware keys, best-first, for the given machine. */
export function preferredOsKeys(ctx: FirmwareContext): readonly FirmwareKey[] {
	switch (ctx.model) {
		case "800":
			return ctx.tv === "pal" ? OS_800_PAL : OS_800_NTSC;
		case "1200XL":
			return OS_1200XL;
		case "XEGS":
			return OS_XEGS;
		default: // 800XL, 130XE
			return OS_XLXE;
	}
}

// BASIC firmware, best-first. Machine-independent (any BASIC runs on any
// machine; XL/XE shipped rev C). The replacements rank below the real rev C but
// above the buggier original revisions.
const BASIC_PREFERENCE: readonly FirmwareKey[] = [
	"basic-c",
	"basic-a",
	"basic-b",
	"altirra-basic",
	"atarixx-basic",
];

/** BASIC firmware keys, best-first. */
export function preferredBasicKeys(): readonly FirmwareKey[] {
	return BASIC_PREFERENCE;
}
