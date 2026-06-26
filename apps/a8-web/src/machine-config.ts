import type { AtariModel } from "@sfotty-pie/a8";

export type { AtariModel };

/**
 * PORTB-banked extended RAM. `size` is the *total* RAM with the extension
 * (128/192/320/576/1088 KB); `antic` is separate CPU/ANTIC banking.
 */
export interface ExtendedRam {
	size: number;
	antic: boolean;
}

/** The user-facing machine configuration the menu edits. */
export interface MachineSettings {
	model: AtariModel;
	/** Conventional RAM (KB): 16/48/64. */
	memory: number;
	/** PORTB-banked extended RAM, or null for none. */
	portbExtendedRam: ExtendedRam | null;
	tv: "ntsc" | "pal";
	/** 400/800 & 1200XL: no BASIC cart. XL/XE & XEGS: hold OPTION at boot. */
	basicDisabled: boolean;
}

/** Model classes in menu order, with display labels. */
export const MODELS: readonly AtariModel[] = [
	"400/800",
	"1200xl",
	"xl/xe",
	"xegs",
];

export const MODEL_LABELS: Record<AtariModel, string> = {
	"400/800": "400/800",
	"1200xl": "1200XL",
	"xl/xe": "XL/XE",
	xegs: "XEGS",
};

/** XL/XE & XEGS have built-in BASIC; 400/800 & 1200XL take it as a cartridge. */
export function hasBuiltinBasic(model: AtariModel): boolean {
	return model === "xl/xe" || model === "xegs";
}

// All XL/XE-class machines share the same range — PORTB shared-function
// latching makes every extension safe regardless of model.
const XL_RAM: readonly number[] = [16, 64, 128, 192, 320, 576, 1088];

/** Total RAM sizes (KB) offered per model. The 400/800 caps at 48K. */
export const RAM_SIZES: Record<AtariModel, readonly number[]> = {
	"400/800": [16, 48],
	"1200xl": XL_RAM,
	"xl/xe": XL_RAM,
	xegs: XL_RAM,
};

const RAM_BASE: Record<AtariModel, number> = {
	"400/800": 48,
	"1200xl": 64,
	"xl/xe": 64,
	xegs: 64,
};

/** The total RAM (KB) a settings object represents. */
export function ramTotal(settings: MachineSettings): number {
	return settings.portbExtendedRam?.size ?? settings.memory;
}

/** Split a total RAM size into conventional RAM + PORTB-extended banks. */
export function ramConfig(
	totalKB: number,
): Pick<MachineSettings, "memory" | "portbExtendedRam"> {
	if (totalKB <= 64) return { memory: totalKB, portbExtendedRam: null };
	// 128K forces separate ANTIC access (the 130XE); larger sizes default it off
	// and are toggleable; 1088K can't have it. (The toggle UI is a later step.)
	return {
		memory: 64,
		portbExtendedRam: { size: totalKB, antic: totalKB === 128 },
	};
}

/** Keep a settings' RAM valid for a (possibly new) model. */
export function clampRam(
	model: AtariModel,
	settings: MachineSettings,
): Pick<MachineSettings, "memory" | "portbExtendedRam"> {
	const total = ramTotal(settings);
	return ramConfig(RAM_SIZES[model].includes(total) ? total : RAM_BASE[model]);
}

/**
 * Coerce a persisted/untrusted value into valid {@link MachineSettings},
 * clamping RAM to the model — returns `fallback` if it isn't a recognizable
 * settings object (e.g. an unknown model from an older or corrupt store).
 */
export function sanitizeSettings(
	value: unknown,
	fallback: MachineSettings,
): MachineSettings {
	if (typeof value !== "object" || value === null) return fallback;
	const v = value as Partial<MachineSettings>;
	if (!MODELS.includes(v.model as AtariModel)) return fallback;
	const model = v.model as AtariModel;
	const ext = v.portbExtendedRam;
	const base: MachineSettings = {
		model,
		memory: typeof v.memory === "number" ? v.memory : RAM_BASE[model],
		portbExtendedRam:
			ext && typeof ext === "object"
				? { size: Number(ext.size) || 0, antic: Boolean(ext.antic) }
				: null,
		tv: v.tv === "pal" ? "pal" : "ntsc",
		basicDisabled: Boolean(v.basicDisabled),
	};
	return { ...base, ...clampRam(model, base) };
}

export type AnticPolicy = "on" | "off" | "optional";

/**
 * Whether separate ANTIC access is forced on/off or user-toggleable at a given
 * total RAM size: 128K (130XE) is always separate; 1088K (64 banks) can't be;
 * the sizes between are optional.
 */
export function anticPolicy(size: number): AnticPolicy {
	if (size === 128) return "on";
	if (size >= 192 && size <= 576) return "optional";
	return "off";
}

export function settingsEqual(a: MachineSettings, b: MachineSettings): boolean {
	return (
		a.model === b.model &&
		a.tv === b.tv &&
		a.basicDisabled === b.basicDisabled &&
		a.memory === b.memory &&
		a.portbExtendedRam?.size === b.portbExtendedRam?.size &&
		a.portbExtendedRam?.antic === b.portbExtendedRam?.antic
	);
}
