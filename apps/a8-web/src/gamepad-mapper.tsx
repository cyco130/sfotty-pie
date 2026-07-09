import { useEffect, useRef, useState } from "preact/hooks";
import { STANDARD_AXES, STANDARD_BUTTONS } from "./gamepad-labels.ts";
import {
	type AxisSource,
	type ButtonSource,
	type CalibrationSample,
	type Change,
	deviates,
	dominantChange,
	type HatSource,
	type NormalizeProfile,
	type PadView,
	samplePad,
	STANDARD_AXIS_COUNT,
	STANDARD_BUTTON_COUNT,
} from "./gamepad-normalize.ts";
import { messages } from "./messages.ts";

// A row of the mapping table - a Standard button, or a Standard axis.
interface Row {
	kind: "button" | "axis";
	index: number;
}

// A capture must stay firmly held this many monitor frames before it lands -
// debounces transients brushed on the way to the intended control.
const HOLD_FRAMES = 10;

// Select values: "default" (the pad's own control), "none" (explicitly
// nothing), "b3" (raw button 3), "a2" (raw axis 2), "a2+" / "a2-" (one side
// of raw axis 2, for button targets).
type Sel = string;

// The current profile entries, encoded as select values. Lossy for
// calibrated anchor details - save keeps the original entry for rows the
// user didn't touch (see save()).
function encode(profile: NormalizeProfile | undefined): {
	buttons: Sel[];
	axes: Sel[];
	inverted: boolean[];
} {
	const buttons = Array.from({ length: STANDARD_BUTTON_COUNT }, (_, i): Sel => {
		const source = profile?.buttons[i];
		if (source === undefined) return "default";
		if (source === null) return "none";
		if ("button" in source) return `b${source.button}`;
		const { axis, rest, pressed } = source.axisButton;
		return `a${axis}${pressed >= rest ? "+" : "-"}`;
	});
	const axes = Array.from({ length: STANDARD_AXIS_COUNT }, (_, i): Sel => {
		const source = profile?.axes[i];
		if (source === undefined) return "default";
		if (source === null) return "none";
		return `a${source.axis}`;
	});
	const inverted = Array.from({ length: STANDARD_AXIS_COUNT }, (_, i) => {
		const source = profile?.axes[i];
		return !!source && source.posAt < source.negAt;
	});
	return { buttons, axes, inverted };
}

// Build the profile entry a select value describes. The rest sample anchors
// axis-shaped sources at the axis's observed resting value.
function decodeButton(
	value: Sel,
	rest: CalibrationSample,
): ButtonSource | null | undefined {
	if (value === "default") return undefined;
	if (value === "none") return null;
	if (value.startsWith("b")) return { button: Number(value.slice(1)) };
	const axis = Number(value.slice(1, -1));
	return {
		axisButton: {
			axis,
			rest: rest.axes[axis] ?? 0,
			pressed: value.endsWith("+") ? 1 : -1,
		},
	};
}

function decodeAxis(
	value: Sel,
	inverted: boolean,
	rest: CalibrationSample,
): AxisSource | null | undefined {
	if (value === "default") return undefined;
	if (value === "none") return null;
	const axis = Number(value.slice(1));
	return {
		axis,
		rest: rest.axes[axis] ?? 0,
		negAt: inverted ? 1 : -1,
		posAt: inverted ? -1 : 1,
	};
}

// The inputs active in `now` but not at rest, described tersely for the live
// readout ("#5", "axis 3 → −0.43") - how you find out which raw index a
// physical control is, without trusting its printed label.
function describe(rest: CalibrationSample, now: CalibrationSample): string {
	const parts: string[] = [];
	now.buttons.forEach((b, i) => {
		if (b && !rest.buttons[i]) parts.push(`#${i}`);
	});
	now.axes.forEach((v, i) => {
		if (Math.abs(v - (rest.axes[i] ?? 0)) >= 0.5) {
			parts.push(`axis ${i} → ${v.toFixed(2)}`);
		}
	});
	return parts.join(", ");
}

const selectClass =
	"rounded-sm border border-neutral-200 bg-white px-1 py-0.5 text-xs text-neutral-700";

/**
 * The mapping editor for one pad: an explicit translation table. Every
 * Standard button picks its source - the pad's own control (default), nothing,
 * a raw button, or one side of a raw axis - and every Standard axis picks a
 * raw axis with an inverted toggle. Each row also has a capture assist: arm
 * it, press/push the physical control, and the row's select snaps to what
 * moved (axis rows ask for the positive - right/down - push and derive the
 * inverted flag from the direction the value went). The live "now active"
 * readout above shows what the pad is sending, so raw indices are identified
 * by pressing things, not by reading printed labels. An existing hat mapping
 * (from dev-console calibration) is shown and removable; rows the user
 * doesn't touch keep their existing entries exactly (calibrated anchors
 * survive).
 */
export function MapperForm({
	pad,
	profile,
	onSave,
	onCancel,
}: {
	/** The live pad snapshot - fresh every monitor frame (see useLivePads). */
	pad: PadView;
	profile: NormalizeProfile | undefined;
	onSave: (profile: NormalizeProfile | null) => void;
	onCancel: () => void;
}) {
	const [rest] = useState<CalibrationSample>(() => samplePad(pad));
	const [initial] = useState(() => encode(profile));
	const [buttons, setButtons] = useState<Sel[]>(() => [...initial.buttons]);
	const [axes, setAxes] = useState<Sel[]>(() => [...initial.axes]);
	const [inverted, setInverted] = useState<boolean[]>(() => [
		...initial.inverted,
	]);
	const [hat, setHat] = useState<HatSource | undefined>(profile?.hat);

	// The raw controls on offer, counted when the form opened.
	const [rawButtons] = useState(pad.buttons.length);
	const [rawAxes] = useState(pad.axes.length);

	// The row whose capture assist is armed, and whether the pad has returned
	// to rest since arming (so a control still held from the previous capture
	// can't capture itself).
	const [capturing, setCapturing] = useState<{
		row: Row;
		released: boolean;
	} | null>(null);
	// Consecutive firm frames while armed, counted up to HOLD_FRAMES.
	const framesRef = useRef(0);

	const now = samplePad(pad);
	const active = describe(rest, now);

	// Runs on every monitor frame (`now` is a fresh snapshot each render, and
	// the parent re-renders per frame): advance the armed row's gate, and on a
	// sustained hold snap the row's select to what moved. For axis rows the
	// prompt asks for the positive push, so a value that moved below rest
	// means inverted; unusable changes (nothing dominant, or a button press
	// for an axis row) leave the capture armed.
	useEffect(() => {
		if (!capturing) return;
		if (!deviates(rest, now)) {
			framesRef.current = 0;
			if (!capturing.released) {
				setCapturing({ ...capturing, released: true });
			}
			return;
		}
		if (!capturing.released) return;
		framesRef.current++;
		if (framesRef.current < HOLD_FRAMES) return;
		framesRef.current = 0;

		const applyCapture = (row: Row, change: Change): boolean => {
			if (!change) return false;
			if (row.kind === "button") {
				const value =
					"button" in change
						? `b${change.button}`
						: `a${change.axis}${
								change.value >= (rest.axes[change.axis] ?? 0) ? "+" : "-"
							}`;
				setButtons((all) => all.map((x, j) => (j === row.index ? value : x)));
				return true;
			}
			if ("button" in change) return false;
			setAxes((all) =>
				all.map((x, j) => (j === row.index ? `a${change.axis}` : x)),
			);
			const flipped = change.value < (rest.axes[change.axis] ?? 0);
			setInverted((all) => all.map((x, j) => (j === row.index ? flipped : x)));
			return true;
		};
		if (applyCapture(capturing.row, dominantChange(rest, now))) {
			setCapturing(null);
		}
	}, [capturing, rest, now]);

	// Cancel a pending capture on Escape.
	useEffect(() => {
		if (!capturing) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setCapturing(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [capturing]);

	const arm = (row: Row) => {
		framesRef.current = 0;
		setCapturing({ row, released: false });
	};

	// The capture-assist slot for one row: the armed prompt, or the button.
	const captureSlot = (row: Row) => {
		const armed =
			capturing !== null &&
			capturing.row.kind === row.kind &&
			capturing.row.index === row.index;
		if (armed) {
			return (
				<span class="text-amber-700">
					{!capturing.released
						? messages.controllers.releaseFirst
						: row.kind === "axis"
							? messages.controllers.pushPositive
							: messages.controllers.pressTarget}
				</span>
			);
		}
		return (
			<button
				type="button"
				class="rounded-sm border border-dashed border-neutral-300 px-1.5 py-0.5 text-neutral-500 hover:border-neutral-400"
				onClick={() => arm(row)}
			>
				{messages.controllers.capture}
			</button>
		);
	};

	const save = () => {
		const out: NormalizeProfile = { buttons: {}, axes: {} };
		for (let i = 0; i < STANDARD_BUTTON_COUNT; i++) {
			// Untouched rows keep their existing entry exactly.
			const entry =
				buttons[i] === initial.buttons[i] && profile
					? profile.buttons[i]
					: decodeButton(buttons[i]!, rest);
			if (entry !== undefined) out.buttons[i] = entry;
		}
		for (let i = 0; i < STANDARD_AXIS_COUNT; i++) {
			const untouched =
				axes[i] === initial.axes[i] && inverted[i] === initial.inverted[i];
			const entry =
				untouched && profile
					? profile.axes[i]
					: decodeAxis(axes[i]!, inverted[i]!, rest);
			if (entry !== undefined) out.axes[i] = entry;
		}
		if (hat) out.hat = hat;
		const empty =
			!out.hat &&
			Object.keys(out.buttons).length === 0 &&
			Object.keys(out.axes).length === 0;
		onSave(empty ? null : out);
	};

	// What "Default" resolves to for a row, spelled out in the option label:
	// the pad's own control at the same index, the hat for D-pad rows while a
	// hat mapping exists, or nothing when the pad has no control there.
	const DPAD = [12, 13, 14, 15];
	const defaultDetail = (row: Row): string => {
		if (row.kind === "button") {
			if (hat && DPAD.includes(row.index))
				return messages.controllers.mappingHat;
			return row.index < rawButtons
				? messages.controllers.buttonNumber(row.index)
				: messages.controllers.mappingNone;
		}
		return row.index < rawAxes
			? messages.controllers.axisNumber(row.index)
			: messages.controllers.mappingNone;
	};
	const baseOptions = (row: Row) => (
		<>
			<option value="default">
				{messages.controllers.mappingDefaultDetail(defaultDetail(row))}
			</option>
			<option value="none">{messages.controllers.mappingNone}</option>
		</>
	);

	return (
		<div class="mt-3 flex flex-col gap-2 border-t border-neutral-200 pt-2">
			<p class="text-xs text-neutral-500">
				{messages.controllers.nowActive}{" "}
				<span class="font-medium text-neutral-700 tabular-nums">
					{active || messages.controllers.nothingActive}
				</span>
			</p>

			<p class="text-xs font-medium text-neutral-500">
				{messages.controllers.buttons}
			</p>
			<div class="flex flex-col gap-1">
				{buttons.map((value, i) => (
					<div key={i} class="flex items-center gap-2 text-xs">
						<span class="w-16 shrink-0 text-neutral-600">
							{STANDARD_BUTTONS[i] ?? `#${i}`}
						</span>
						<select
							class={selectClass}
							value={value}
							onChange={(e) => {
								const v = (e.target as HTMLSelectElement).value;
								setButtons((all) => all.map((x, j) => (j === i ? v : x)));
							}}
						>
							{baseOptions({ kind: "button", index: i })}
							{Array.from({ length: rawButtons }, (_, n) => (
								<option key={`b${n}`} value={`b${n}`}>
									{messages.controllers.buttonNumber(n)}
								</option>
							))}
							{Array.from({ length: rawAxes }, (_, n) => (
								<>
									<option key={`a${n}+`} value={`a${n}+`}>
										{messages.controllers.axisNumber(n)} +
									</option>
									<option key={`a${n}-`} value={`a${n}-`}>
										{messages.controllers.axisNumber(n)} −
									</option>
								</>
							))}
						</select>
						{captureSlot({ kind: "button", index: i })}
					</div>
				))}
			</div>

			<p class="text-xs font-medium text-neutral-500">
				{messages.controllers.axes}
			</p>
			<div class="flex flex-col gap-1">
				{axes.map((value, i) => (
					<div key={i} class="flex items-center gap-2 text-xs">
						<span class="w-16 shrink-0 text-neutral-600">
							{STANDARD_AXES[i] ?? `Axis ${i}`}
						</span>
						<select
							class={selectClass}
							value={value}
							onChange={(e) => {
								const v = (e.target as HTMLSelectElement).value;
								setAxes((all) => all.map((x, j) => (j === i ? v : x)));
							}}
						>
							{baseOptions({ kind: "axis", index: i })}
							{Array.from({ length: rawAxes }, (_, n) => (
								<option key={`a${n}`} value={`a${n}`}>
									{messages.controllers.axisNumber(n)}
								</option>
							))}
						</select>
						<label class="flex items-center gap-1 text-neutral-600">
							<input
								type="checkbox"
								checked={inverted[i]}
								onChange={(e) => {
									const v = (e.target as HTMLInputElement).checked;
									setInverted((all) => all.map((x, j) => (j === i ? v : x)));
								}}
							/>
							{messages.controllers.invertedAxis}
						</label>
						{captureSlot({ kind: "axis", index: i })}
					</div>
				))}
			</div>

			{hat && (
				<p class="flex items-center gap-2 text-xs text-neutral-600">
					{messages.controllers.hatMapping(hat.axis)}
					<button
						type="button"
						class="px-1 text-neutral-400 hover:text-neutral-700"
						onClick={() => setHat(undefined)}
					>
						✕
					</button>
				</p>
			)}

			<div class="flex gap-2">
				<button
					type="button"
					class="rounded-sm bg-neutral-700 px-2 py-0.5 text-xs text-white hover:bg-neutral-600"
					onClick={save}
				>
					{messages.controllers.saveMapping}
				</button>
				<button
					type="button"
					class="rounded-sm bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-200"
					onClick={onCancel}
				>
					{messages.controllers.cancel}
				</button>
			</div>
		</div>
	);
}
