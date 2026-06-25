import { useHead } from "../../head.ts";
import { messages } from "../../messages.ts";
import { NavLink, PlaceholderIndex } from "../../placeholder.tsx";

// /labs — index of the scratch/probe tools.
export default function LabsIndexPage() {
	const t = messages.pages.labs;
	useHead({ title: t.title });
	return (
		<PlaceholderIndex heading={t.heading}>
			<NavLink href="/labs/keyboard">{t.keyboard}</NavLink>
		</PlaceholderIndex>
	);
}
