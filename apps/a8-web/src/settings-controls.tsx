import { messages } from "./messages.ts";

/** A labelled segmented control; each option applies its value via `onSelect`. */
export function Segmented({
	label,
	value,
	options,
}: {
	label: string;
	value: string;
	options: { value: string; label: string; onSelect: () => void }[];
}) {
	return (
		<div class="flex items-center justify-between gap-3">
			<span class="text-sm text-neutral-600">{label}</span>
			<div class="flex overflow-hidden rounded-sm border border-neutral-300">
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						class={
							option.value === value
								? "bg-neutral-800 px-2 py-0.5 text-sm text-white"
								: "bg-white px-2 py-0.5 text-sm text-neutral-700 hover:bg-neutral-100"
						}
						onClick={option.onSelect}
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}

/** A labelled dropdown; selecting a value calls `onSelect`. */
export function LabeledSelect({
	label,
	value,
	options,
	onSelect,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onSelect: (value: string) => void;
}) {
	return (
		<div class="flex items-center justify-between gap-3">
			<span class="text-sm text-neutral-600">{label}</span>
			<select
				class="rounded-sm border border-neutral-300 bg-white px-2 py-0.5 text-sm text-neutral-700"
				value={value}
				onChange={(event) => onSelect(event.currentTarget.value)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

/** An On/Off segmented row - the shape shared by the live toggles. */
export function OnOff({
	label,
	value,
	onSet,
}: {
	label: string;
	value: boolean;
	onSet: (value: boolean) => void;
}) {
	return (
		<Segmented
			label={label}
			value={value ? "on" : "off"}
			options={[
				{
					value: "on",
					label: messages.sidebar.on,
					onSelect: () => onSet(true),
				},
				{
					value: "off",
					label: messages.sidebar.off,
					onSelect: () => onSet(false),
				},
			]}
		/>
	);
}

/** A section heading within a settings form. */
export function GroupHeading({ label }: { label: string }) {
	return (
		<h2 class="mt-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
			{label}
		</h2>
	);
}
