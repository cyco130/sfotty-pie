import { Docs } from "../../../docs/docs.tsx";
import { useHead } from "../../../head.ts";
import { messages } from "../../../messages.ts";

// /a8/reference/atascii-and-keyboard — the generated character-set + keyboard
// tables. A content page, so it scrolls within the app shell.
export default function AtasciiKeyboardPage() {
	useHead({ title: messages.pages.atasciiKeyboard.title });
	return (
		<div class="h-full overflow-y-auto">
			<Docs />
		</div>
	);
}
