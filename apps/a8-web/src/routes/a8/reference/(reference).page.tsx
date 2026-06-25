import { useHead } from "../../../head.ts";
import { messages } from "../../../messages.ts";
import { NavLink, PlaceholderIndex } from "../../../placeholder.tsx";

// /a8/reference — reference index.
export default function ReferenceIndexPage() {
	const t = messages.pages.reference;
	useHead({ title: t.title });
	return (
		<PlaceholderIndex heading={t.heading}>
			<NavLink href="/a8/reference/atascii-and-keyboard">
				{t.atasciiKeyboard}
			</NavLink>
		</PlaceholderIndex>
	);
}
