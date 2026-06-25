import type { ComponentChildren } from "preact";

// Shared chrome for the simple link-list index pages (section landings). Real
// content comes later; for now they're just navigation.
export function PlaceholderIndex({
	heading,
	children,
}: {
	heading: string;
	children: ComponentChildren;
}) {
	return (
		<main class="flex h-full flex-col items-center justify-center gap-6 bg-black p-8 text-center text-neutral-300">
			<h1 class="text-3xl font-semibold text-white">{heading}</h1>
			<nav class="flex flex-col gap-2">{children}</nav>
		</main>
	);
}

export function NavLink({
	href,
	children,
}: {
	href: string;
	children: ComponentChildren;
}) {
	return (
		<a href={href} class="text-neutral-200 underline hover:text-white">
			{children}
		</a>
	);
}
