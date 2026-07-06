import { paletteFor } from "@sfotty-pie/a8";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
	defaultDisplaySettings,
	OVERSCAN_MAX_HEIGHT,
	OVERSCAN_MAX_WIDTH,
	OVERSCAN_MIN_HEIGHT,
	OVERSCAN_MIN_WIDTH,
	OVERSCAN_PRESETS,
	type OverscanSettings,
	PALETTE_PRESETS,
	type PaletteSettings,
	PRIMARIES_OPTIONS,
} from "./display-settings.ts";
import type { EmulatorHost } from "./host.ts";
import type { TvStandard } from "./machine-config.ts";
import { messages } from "./messages.ts";

// A palette word (0xAABBGGRR) as a CSS color — in the same color space the
// palette was generated for, so the guide matches the machine canvas exactly
// (CSS `color(display-p3 …)` with the same component values IS the same
// color as P3 ImageData).
function cssColor(palette: Uint32Array, wide: boolean) {
	return (index: number): string => {
		const w = palette[index]!;
		const r = w & 0xff;
		const g = (w >>> 8) & 0xff;
		const b = (w >>> 16) & 0xff;
		return wide
			? `color(display-p3 ${r / 255} ${g / 255} ${b / 255})`
			: `rgb(${r} ${g} ${b})`;
	};
}

// Whether CSS can express display-p3 (true everywhere the canvas can be P3,
// except some ancient Chromium versions — those fall back to rgb()).
// Evaluated lazily: this module is prerendered, where DOM globals are off
// limits at module scope.
let cssP3: boolean | undefined;
const supportsCssP3 = () =>
	(cssP3 ??=
		typeof CSS !== "undefined" &&
		CSS.supports("color", "color(display-p3 1 0 0)"));

function Slider({
	label,
	min,
	max,
	step,
	value,
	digits = 0,
	onChange,
}: {
	label: string;
	min: number;
	max: number;
	step: number;
	value: number;
	/** Decimal places for the value readout. */
	digits?: number;
	onChange: (value: number) => void;
}) {
	return (
		<label class="flex items-center gap-2">
			<span class="w-24 shrink-0 text-xs text-neutral-500">{label}</span>
			<input
				type="range"
				class="min-w-0 flex-1"
				min={min}
				max={max}
				step={step}
				value={value}
				onInput={(e) => onChange(Number(e.currentTarget.value))}
			/>
			<span class="w-10 shrink-0 text-right text-xs text-neutral-600 tabular-nums">
				{value.toFixed(digits)}
			</span>
		</label>
	);
}

// A row of preset buttons; the one matching the current values is highlighted
// (none highlighted = custom).
function Presets<T extends object>({
	presets,
	labels,
	current,
	onPick,
}: {
	presets: Record<string, T>;
	labels: Record<string, string>;
	current: T;
	onPick: (preset: T) => void;
}) {
	const matches = (p: T) =>
		Object.entries(p).every(
			([k, v]) => current[k as keyof T] === (v as T[keyof T]),
		);
	return (
		<div class="flex flex-wrap gap-1">
			{Object.entries(presets).map(([id, preset]) => (
				<button
					key={id}
					type="button"
					class={`rounded-sm px-2 py-0.5 text-xs ${
						matches(preset)
							? "bg-neutral-700 text-white"
							: "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
					}`}
					onClick={() => onPick({ ...preset })}
				>
					{labels[id] ?? id}
				</button>
			))}
		</div>
	);
}

function GuideRow({
	label,
	children,
}: {
	label: string;
	children: ComponentChildren;
}) {
	return (
		<div class="flex flex-col gap-0.5">
			<span class="text-xs text-neutral-400">{label}</span>
			<div class="flex h-5 overflow-hidden rounded-sm">{children}</div>
		</div>
	);
}

/**
 * The visual guide: swatch rows generated from the edited standard's palette
 * parameters, so tuning previews here even when the machine runs the other
 * standard. The GR.0 sample uses the OS default colors (background/border
 * from PF2 $94, text = PF2's hue at PF1's luminance → $9A); the hue-1/15 row
 * shows NTSC's pot-dependent wheel wrap (on PAL the generator pins 15 to 1).
 */
function Guide({
	tab,
	color,
}: {
	tab: TvStandard;
	color: (index: number) => string;
}) {
	const lumas = Array.from({ length: 16 }, (_, i) => i);
	const hues = Array.from({ length: 15 }, (_, i) => i + 1);
	// OS defaults: PF0 $28, PF1 $CA, PF2 $94, PF3 $46.
	const osDefaults = [0x28, 0xca, 0x94, 0x46];
	// A black backdrop, like the letterboxed screen: colors read against it
	// the way they do on the machine, and light swatches don't bleed into the
	// panel background.
	return (
		<div class="flex flex-col gap-2 rounded-md bg-black p-3">
			<GuideRow label={messages.display.guideGrays}>
				{lumas.map((l) => (
					<div key={l} class="flex-1" style={{ background: color(l) }} />
				))}
			</GuideRow>
			<GuideRow label={messages.display.guideHues}>
				{hues.map((h) => (
					<div
						key={h}
						class="flex-1"
						style={{ background: color(h * 16 + 8) }}
					/>
				))}
			</GuideRow>
			<div
				class="rounded-sm px-3 py-2 font-mono text-sm/tight"
				style={{ background: color(0x94), color: color(0x9a) }}
			>
				READY
				<br />
				<span
					class="inline-block h-[1em] w-[0.8em] translate-y-[0.15em]"
					style={{ background: color(0x9a) }}
				/>
			</div>
			<GuideRow label={messages.display.guideOs}>
				{osDefaults.map((index) => (
					<div
						key={index}
						class="flex-1"
						style={{ background: color(index) }}
					/>
				))}
			</GuideRow>
			{tab === "ntsc" && (
				<GuideRow label={messages.display.guideWrap}>
					<div class="flex-1" style={{ background: color(0x18) }} />
					<div class="flex-1" style={{ background: color(0xf8) }} />
				</GuideRow>
			)}
		</div>
	);
}

/**
 * The display settings panel: per-standard tabs (defaulting to the running
 * standard) over live-applied overscan and palette-generation controls.
 * Preset buttons just set parameters — only the parameters persist. Editing
 * the running standard adjusts the machine window immediately; either way the
 * guide below previews the edited standard's palette.
 */
export function DisplayView({ host }: { host: EmulatorHost }) {
	const runningTv = host.config.value.tv;
	const [tab, setTab] = useState<TvStandard>(runningTv);
	const settings = host.displaySettings.value[tab];
	// Generate the guide's palette in the same color space the screen canvas
	// got, and emit CSS in that space — so the guide matches the machine
	// exactly, including the extra P3 saturation of corrected palettes.
	const wide = host.outputGamut.value === "display-p3" && supportsCssP3();
	const color = useMemo(
		() =>
			cssColor(
				paletteFor(tab, {
					...settings.palette,
					outputGamut: wide ? "display-p3" : "srgb",
				}),
				wide,
			),
		[tab, settings.palette, wide],
	);

	const setOverscan = (overscan: OverscanSettings) =>
		host.setOverscan(tab, overscan);
	const setPalette = (palette: Partial<PaletteSettings>) =>
		host.setPalette(tab, palette);
	const reset = () => {
		const defaults = defaultDisplaySettings()[tab];
		host.setOverscan(tab, defaults.overscan);
		host.setPalette(tab, defaults.palette);
		host.setFrameBlending(tab, defaults.frameBlending);
	};

	// NTSC / PAL are hardware tokens — inline, not translated.
	const tabButton = (tv: TvStandard, label: string) => (
		<button
			type="button"
			aria-pressed={tab === tv}
			class={`rounded-sm px-3 py-1 text-sm ${
				tab === tv
					? "bg-neutral-700 text-white"
					: "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
			}`}
			onClick={() => setTab(tv)}
		>
			{label}
		</button>
	);

	return (
		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
			<div class="flex gap-1">
				{tabButton("ntsc", "NTSC")}
				{tabButton("pal", "PAL")}
			</div>
			{tab !== runningTv && (
				<p class="rounded-sm bg-amber-50 px-2 py-1 text-xs text-amber-800">
					{messages.display.notRunning}
				</p>
			)}

			<section class="flex flex-col gap-2">
				<h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
					{messages.display.overscan}
				</h3>
				<Presets
					presets={OVERSCAN_PRESETS[tab]}
					labels={messages.display.overscanPresets}
					current={settings.overscan}
					onPick={setOverscan}
				/>
				<Slider
					label={messages.display.width}
					min={OVERSCAN_MIN_WIDTH}
					max={OVERSCAN_MAX_WIDTH}
					step={2}
					value={settings.overscan.width}
					onChange={(width) => setOverscan({ ...settings.overscan, width })}
				/>
				<Slider
					label={messages.display.height}
					min={OVERSCAN_MIN_HEIGHT}
					max={OVERSCAN_MAX_HEIGHT}
					step={2}
					value={settings.overscan.height}
					onChange={(height) => setOverscan({ ...settings.overscan, height })}
				/>
			</section>

			<section class="flex flex-col gap-2">
				<h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
					{messages.display.frameBlendingTitle}
				</h3>
				<Slider
					label={messages.display.frameBlending}
					min={0}
					max={0.9}
					step={0.01}
					digits={2}
					value={settings.frameBlending}
					onChange={(value) => host.setFrameBlending(tab, value)}
				/>
			</section>

			<section class="flex flex-col gap-2">
				<h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
					{messages.display.palette}
				</h3>
				<Presets
					presets={PALETTE_PRESETS[tab]}
					labels={messages.display.palettePresets}
					current={settings.palette}
					onPick={setPalette}
				/>
				<Slider
					label={messages.display.tint}
					min={0}
					max={360}
					step={1}
					value={settings.palette.hue1Angle}
					onChange={(hue1Angle) => setPalette({ hue1Angle })}
				/>
				<Slider
					label={messages.display.hueStep}
					min={0}
					max={35}
					step={0.1}
					digits={1}
					value={settings.palette.hueStep}
					onChange={(hueStep) => setPalette({ hueStep })}
				/>
				<Slider
					label={messages.display.saturation}
					min={0}
					max={0.5}
					step={0.005}
					digits={2}
					value={settings.palette.saturation}
					onChange={(saturation) => setPalette({ saturation })}
				/>
				<Slider
					label={messages.display.brightness}
					min={-0.5}
					max={0.5}
					step={0.01}
					digits={2}
					value={settings.palette.brightness}
					onChange={(brightness) => setPalette({ brightness })}
				/>
				<Slider
					label={messages.display.contrast}
					min={0}
					max={2}
					step={0.02}
					digits={2}
					value={settings.palette.contrast}
					onChange={(contrast) => setPalette({ contrast })}
				/>
				<Slider
					label={messages.display.gamma}
					min={0.5}
					max={2}
					step={0.01}
					digits={2}
					value={settings.palette.gamma}
					onChange={(gamma) => setPalette({ gamma })}
				/>
				<div class="flex items-center gap-2">
					<span class="w-24 shrink-0 text-xs text-neutral-500">
						{messages.display.primaries}
					</span>
					<div class="flex flex-wrap gap-1">
						{PRIMARIES_OPTIONS[tab].map((option) => (
							<button
								key={option}
								type="button"
								aria-pressed={settings.palette.primaries === option}
								class={`rounded-sm px-2 py-0.5 text-xs ${
									settings.palette.primaries === option
										? "bg-neutral-700 text-white"
										: "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
								}`}
								onClick={() => setPalette({ primaries: option })}
							>
								{messages.display.primariesNames[option] ?? option}
							</button>
						))}
					</div>
				</div>
				<p class="text-xs text-neutral-400">
					{host.outputGamut.value === "display-p3"
						? messages.display.wideGamutActive
						: messages.display.wideGamutOff}
				</p>
			</section>

			<Guide tab={tab} color={color} />

			<button
				type="button"
				class="self-start text-xs text-neutral-500 underline hover:text-neutral-700"
				onClick={reset}
			>
				{messages.display.reset}
			</button>
		</div>
	);
}
