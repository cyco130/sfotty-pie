import type { AtariModel } from "@sfotty-pie/a8";

/**
 * The firmware selector's OS slots — one per machine class. The emulated models
 * map onto the first three; `1200xl`/`xegs` are selector-only until those are
 * real machines (picking them is remembered but doesn't drive anything yet).
 */
export type OsSlot = "800-ntsc" | "800-pal" | "xlxe" | "1200xl" | "xegs";

/** The OS slot a running machine draws its OS from. */
export function osSlotFor(model: AtariModel, tv: "ntsc" | "pal"): OsSlot {
	switch (model) {
		case "400/800":
			return tv === "pal" ? "800-pal" : "800-ntsc";
		case "1200xl":
			return "1200xl";
		case "xegs":
			return "xegs";
		default: // xl/xe
			return "xlxe";
	}
}
