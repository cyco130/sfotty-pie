import { useEffect } from "preact/hooks";
import type { EmulatorHost } from "./host.ts";

/** A transient error toast (e.g. an unrecognized file). Click or wait to dismiss. */
export function Alert({ host }: { host: EmulatorHost }) {
	const message = host.alert.value;

	useEffect(() => {
		if (!message) return;
		const timer = setTimeout(() => {
			host.dismissAlert();
		}, 5000);
		return () => clearTimeout(timer);
	}, [message, host]);

	if (!message) return null;

	return (
		<div
			role="alert"
			class="fixed top-3 left-1/2 z-20 max-w-[90%] -translate-x-1/2 cursor-pointer rounded bg-red-600 px-3 py-1.5 text-sm text-white shadow-lg"
			onClick={() => {
				host.dismissAlert();
			}}
		>
			{message}
		</div>
	);
}
