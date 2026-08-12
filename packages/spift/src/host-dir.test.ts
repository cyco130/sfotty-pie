import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	applyHostNameTemplate,
	compileHostPattern,
	openHostDirectory,
} from "./host-dir.ts";

const text = (raw: Uint8Array | undefined) =>
	raw === undefined ? undefined : new TextDecoder().decode(raw);

function scratch(): string {
	const root = mkdtempSync(join(tmpdir(), "spift-host-"));
	writeFileSync(join(root, "a.txt"), "alpha");
	writeFileSync(join(root, "b.bin"), "beta");
	mkdirSync(join(root, "sub"));
	writeFileSync(join(root, "sub", "c.txt"), "gamma");
	return root;
}

test("lists a directory, with host wildcard semantics", () => {
	const store = openHostDirectory(scratch());
	expect([...store.entries()].map((entry) => entry.name)).toEqual([
		"a.txt",
		"b.bin",
		"sub",
	]);
	expect([...store.entries("*.txt")].map((entry) => entry.name)).toEqual([
		"a.txt",
	]);
	// A spec naming a directory lists it, as on an image.
	expect([...store.entries("sub")].map((entry) => entry.path)).toEqual([
		"sub/c.txt",
	]);
	expect(
		[...store.entries("sub", { listContents: false })].map(
			(entry) => entry.kind,
		),
	).toEqual(["dir"]);
	expect(
		[...store.entries("*", { recursive: true })].map((entry) => entry.path),
	).toEqual(["a.txt", "b.bin", "sub", "sub/c.txt"]);
});

test("host patterns span the whole name, unlike the Atari 8.3 fields", () => {
	const matches = compileHostPattern("*.tar.gz");
	expect(matches("archive.tar.gz")).toBe(true);
	expect(matches("archive.tar")).toBe(false);
	expect(compileHostPattern("READ??")("readme")).toBe(true);
});

test("mutations stay in the overlay until commit", async () => {
	const root = scratch();
	const store = openHostDirectory(root);
	store.writeFile("new.txt", new TextEncoder().encode("delta"));
	store.removeFile("a.txt");

	// Nothing on disk yet, but the store's own reads see it all.
	expect(statSync(join(root, "new.txt"), { throwIfNoEntry: false })).toBe(
		undefined,
	);
	expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("alpha");
	expect([...store.entries()].map((entry) => entry.name)).toEqual([
		"b.bin",
		"new.txt",
		"sub",
	]);
	expect(text(store.readFile("new.txt")?.bytes)).toBe("delta");
	expect(store.readFile("a.txt")).toBe(null);
	expect(store.pending()).toBe(true);

	await store.commit();
	expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("delta");
	expect(statSync(join(root, "a.txt"), { throwIfNoEntry: false })).toBe(
		undefined,
	);
	expect(store.pending()).toBe(false);
});

test("an overwrite needs saying so, whether staged or on disk", () => {
	const store = openHostDirectory(scratch());
	const bytes = new Uint8Array([1]);
	expect(() => store.writeFile("a.txt", bytes)).toThrow(/already exists/);
	store.writeFile("a.txt", bytes, { overwrite: true });
	store.writeFile("fresh.txt", bytes);
	expect(() => store.writeFile("fresh.txt", bytes)).toThrow(/already exists/);
});

test("read-only survives a round trip through the overlay", async () => {
	const root = scratch();
	const store = openHostDirectory(root);
	store.writeFile("locked.txt", new Uint8Array([1]), {
		attributes: ["ReadOnly"],
	});
	await store.commit();
	expect(statSync(join(root, "locked.txt")).mode & 0o200).toBe(0);
	expect(
		[...openHostDirectory(root).entries("locked.txt")][0]?.attributes,
	).toEqual(["ReadOnly"]);
});

test("a named container confines what goes into it", () => {
	const store = openHostDirectory(scratch());
	expect(() => store.writeFile("../escape", new Uint8Array())).toThrow(
		/leaves the directory/,
	);
	expect(() => store.writeFile("/tmp/escape", new Uint8Array())).toThrow(
		/absolute path/,
	);
	// Going up and back down again stays inside, so it is allowed.
	expect(text(store.readFile("sub/../a.txt")?.bytes)).toBe("alpha");
});

test("without confine, host paths mean what they mean in a shell", () => {
	const root = scratch();
	const outside = scratch();
	writeFileSync(join(outside, "far.txt"), "far away");
	const store = openHostDirectory(root, { confine: false });

	// Absolute, and outside the directory relative paths start from.
	expect(text(store.readFile(join(outside, "far.txt"))?.bytes)).toBe(
		"far away",
	);
	expect(
		[...store.entries(join(outside, "far*"))].map((entry) => entry.name),
	).toEqual(["far.txt"]);
	// A path inside is still spelled relatively, so output stays readable.
	expect([...store.entries("*.txt")].map((entry) => entry.path)).toEqual([
		"a.txt",
	]);
});

test("directories are made and removed through the overlay too", async () => {
	const root = scratch();
	const store = openHostDirectory(root);
	store.makeDirectory("one/two", { parents: true });
	store.writeFile("one/two/deep.txt", new Uint8Array([7]));
	expect(() => store.removeDirectory("sub")).toThrow(/not empty/);
	await store.commit();
	expect(readFileSync(join(root, "one/two/deep.txt"))).toEqual(
		Buffer.from([7]),
	);
});

test("a host destination directory is made on demand", async () => {
	const root = scratch();
	const store = openHostDirectory(root);
	// No makeDirectory call: copying into "fresh/" should still land, the way
	// extracting into a directory that is not there yet does.
	store.writeFile("fresh/landed.txt", new TextEncoder().encode("here"));
	await store.commit();
	expect(readFileSync(join(root, "fresh/landed.txt"), "utf8")).toBe("here");
});

test("host rename templates follow the DOS rule over stem and extension", () => {
	const apply = applyHostNameTemplate;
	expect(apply("readme.ttt", "*.txt")).toBe("readme.txt");
	expect(apply("ab.txt", "q*.bak")).toBe("qb.bak");
	// A template that runs out drops the rest, as blanking the field does on
	// a padded 8.3 entry.
	expect(apply("abcdefgh.txt", "??z.bak")).toBe("abz.bak");
	// The split is at the last dot, so a compound extension keeps its stem.
	expect(apply("archive.tar.gz", "*.zip")).toBe("archive.tar.zip");
	// A leading dot is part of the name, not an empty stem.
	expect(apply(".gitignore", "*")).toBe(".gitignore");
	// Nothing to pad with, so "?" past the end of the source adds nothing -
	// the one place this parts company with the 8.3 rule.
	expect(apply("ab.txt", "???z.txt")).toBe("abz.txt");
	// A template with no extension drops the source's, as on the DOSes.
	expect(apply("notes.txt", "readme")).toBe("readme");
});

test("dot-prefixed names are not listed, but can still be read", () => {
	const root = scratch();
	writeFileSync(join(root, ".boot.bin"), "boot");
	writeFileSync(join(root, ".DS_Store"), "junk");
	const store = openHostDirectory(root);

	// As a shell glob passes over them - which is what keeps pack from
	// mistaking its own .boot.bin, or the host's metadata, for content.
	expect([...store.entries()].map((entry) => entry.name)).toEqual([
		"a.txt",
		"b.bin",
		"sub",
	]);
	expect(
		[...store.entries("*", { recursive: true })].map((e) => e.name),
	).not.toContain(".boot.bin");
	// Naming one outright still works, which is how pack picks it up.
	expect(text(store.readFile(".boot.bin")?.bytes)).toBe("boot");
});
