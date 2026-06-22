import { render } from "preact";
import { Docs } from "./docs.tsx";
import "../index.css";

function main(): void {
	const root = document.querySelector<HTMLElement>("#app");
	if (root) render(<Docs />, root);
}

main();
