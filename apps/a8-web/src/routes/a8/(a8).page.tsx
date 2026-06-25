import { useHead } from "../../head.ts";
import { messages } from "../../messages.ts";
import { NavLink, PlaceholderIndex } from "../../placeholder.tsx";

// /a8 — the Atari section index (emulator, reference; later: docs/manual).
export default function AtariIndexPage() {
	const t = messages.pages.atari;
	useHead({ title: t.title });
	return (
		<PlaceholderIndex heading={t.heading}>
			<NavLink href="/a8/emu">{t.emu}</NavLink>
			<NavLink href="/a8/reference">{t.reference}</NavLink>
		</PlaceholderIndex>
	);
}
