import { Atari } from "@sfotty-pie/a8";

// Scaffold only: prove the headless a8 core resolves in the browser bundle.
// Next: load ROMs, construct an `Atari`, and wire it to a canvas/keyboard/audio
// host (rendering a framebuffer the core produces).
function main(): void {
	const root = document.querySelector<HTMLElement>("#app");
	if (root) {
		root.textContent = `sfotty-pie — ${Atari.name} core loaded`;
	}
}

main();
