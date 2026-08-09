import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { formatAtariDos, openAtariDos } from "./atari-dos.ts";
import { createBlankAtr, openAtr } from "./atr.ts";
import { copyEntries, destinationIsDirectory } from "./copy.ts";
import type { AtariDosVariant } from "./atari-dos.ts";
import { openHostDirectory } from "./host-dir.ts";

function image(variant: AtariDosVariant = "mydos") {
	const medium = openAtr(createBlankAtr({ sectorSize: 128, sectorCount: 720 }));
	formatAtariDos(medium, variant);
	return openAtariDos(medium, variant);
}

function host() {
	return openHostDirectory(mkdtempSync(join(tmpdir(), "spift-copy-")));
}

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (raw: Uint8Array | undefined) =>
	raw === undefined ? undefined : new TextDecoder().decode(raw);

test("copies host files onto an image, which is what add does", () => {
	const from = host();
	writeFileSync(join(from.root, "game.xex"), "payload");
	const to = image();

	const result = copyEntries(from, to, {
		sources: ["*"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		move: false,
	});

	expect(result.files.map((file) => file.to)).toEqual(["game.xex"]);
	expect(text(to.readFile("game.xex")?.bytes)).toBe("payload");
});

test("copies off an image into a host directory, which is what extract does", async () => {
	const from = image();
	from.writeFile("a.txt", bytes("alpha"));
	const to = host();

	copyEntries(from, to, {
		sources: ["*.txt"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		move: false,
	});
	await to.commit();

	expect(readFileSync(join(to.root, "a.txt"), "utf8")).toBe("alpha");
});

test("copies between two images, keeping what both sides can represent", () => {
	const from = image("dos20s");
	// A DOS 1.0 format file that is also locked: both are real attributes the
	// Atari family can write, so both make the trip.
	from.writeFile("old.dat", bytes("one"), {
		attributes: ["AtariDos10", "ReadOnly"],
	});
	const to = image("mydos");

	// "*" alone would match only names with no extension, as it does on a
	// real DOS - a whole-disk spec is "*.*".
	copyEntries(from, to, {
		sources: ["*.*"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		move: false,
	});

	const landed = [...to.entries("old.dat")][0];
	expect(landed?.attributes).toContain("AtariDos10");
	expect(landed?.attributes).toContain("ReadOnly");
	expect(text(to.readFile("old.dat")?.bytes)).toBe("one");
});

test("a target that cannot represent an attribute drops it", async () => {
	const from = image();
	from.writeFile("old.dat", bytes("one"), { attributes: ["AtariDos10"] });
	const to = host();

	copyEntries(from, to, {
		sources: ["old.dat"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		move: false,
	});
	await to.commit();

	// DOS 1.0-ness has no host analogue, so it is simply gone - the bytes are
	// what matters here.
	expect([...to.entries("old.dat")][0]?.attributes).toEqual([]);
});

test("--no-attributes drops even what would travel", () => {
	const from = image();
	from.writeFile("old.dat", bytes("one"), {
		attributes: ["AtariDos10", "ReadOnly"],
	});
	const to = image();

	copyEntries(from, to, {
		sources: ["old.dat"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: true,
		move: false,
	});

	expect([...to.entries("old.dat")][0]?.attributes).toEqual([]);
});

test("a name template applies the target family's rename rule", () => {
	const from = image();
	from.writeFile("one.lst", bytes("1"));
	from.writeFile("two.lst", bytes("2"));
	const to = image();

	copyEntries(from, to, {
		sources: ["*.lst"],
		destination: "*.txt",
		recursive: false,
		force: false,
		noAttributes: false,
		move: false,
	});

	expect([...to.entries()].map((entry) => entry.name)).toEqual([
		"one.txt",
		"two.txt",
	]);
});

test("a template works against a host target too", async () => {
	const from = image();
	from.writeFile("one.lst", bytes("1"));
	from.writeFile("two.lst", bytes("2"));
	const to = host();

	copyEntries(from, to, {
		sources: ["*.lst"],
		destination: "*.txt",
		recursive: false,
		force: false,
		noAttributes: false,
		move: false,
	});
	await to.commit();

	expect([...to.entries()].map((entry) => entry.name)).toEqual([
		"one.txt",
		"two.txt",
	]);
});

test("a plain name renames on any target, template rule or not", async () => {
	const from = image();
	from.writeFile("one.lst", bytes("1"));
	const to = host();

	copyEntries(from, to, {
		sources: ["one.lst"],
		destination: "renamed.txt",
		recursive: false,
		force: false,
		noAttributes: false,
		move: false,
	});
	await to.commit();

	expect(readFileSync(join(to.root, "renamed.txt"), "utf8")).toBe("1");
});

test("directories need --recursive, and the tree keeps its shape", () => {
	const from = image();
	from.makeDirectory("games");
	from.makeDirectory("games/arcade", { parents: true });
	from.writeFile("games/arcade/a.com", bytes("deep"));
	const to = image();

	const request = {
		sources: ["games"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		move: false,
	};
	expect(() => copyEntries(from, to, request)).toThrow(/use --recursive/);

	copyEntries(from, to, { ...request, recursive: true });
	expect(text(to.readFile("games/arcade/a.com")?.bytes)).toBe("deep");
});

test("nothing is written when any conflict is found", () => {
	const from = image();
	from.writeFile("a.txt", bytes("one"));
	from.writeFile("b.txt", bytes("two"));
	const to = image();
	to.writeFile("b.txt", bytes("already there"));

	expect(() =>
		copyEntries(from, to, {
			sources: ["*.txt"],
			destination: "/",
			recursive: false,
			force: false,
			noAttributes: false,
			move: false,
		}),
	).toThrow(/already exists/);

	// a.txt sorts first and would have been written had the check not come
	// before every write.
	expect(to.readFile("a.txt")).toBe(null);
	expect(text(to.readFile("b.txt")?.bytes)).toBe("already there");
});

test("two sources landing on one name is refused", () => {
	const from = image();
	from.writeFile("a.lst", bytes("one"));
	from.writeFile("b.lst", bytes("two"));
	expect(() =>
		copyEntries(from, image(), {
			sources: ["*.lst"],
			destination: "same.txt",
			recursive: false,
			force: false,
			noAttributes: false,
			move: false,
		}),
	).toThrow(/names one file but 2 match/);
});

test("a move removes the source only after the copy has landed", () => {
	const from = image();
	from.writeFile("a.txt", bytes("one"));
	const to = image();

	copyEntries(from, to, {
		sources: ["a.txt"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		move: true,
	});

	expect(text(to.readFile("a.txt")?.bytes)).toBe("one");
	expect(from.readFile("a.txt")).toBe(null);
});

test("a moved directory is emptied from the deepest level up", () => {
	const from = image();
	from.makeDirectory("games/arcade", { parents: true });
	from.writeFile("games/arcade/a.com", bytes("deep"));
	const to = image();

	copyEntries(from, to, {
		sources: ["games"],
		destination: "/",
		recursive: true,
		force: false,
		noAttributes: false,
		move: true,
	});

	expect(text(to.readFile("games/arcade/a.com")?.bytes)).toBe("deep");
	expect([...from.entries()].map((entry) => entry.name)).toEqual([]);
});

test("what counts as a directory destination", () => {
	const store = image();
	store.makeDirectory("games");
	expect(destinationIsDirectory(store, "games")).toBe(true);
	expect(destinationIsDirectory(store, "games/")).toBe(true);
	expect(destinationIsDirectory(store, "games>")).toBe(true);
	expect(destinationIsDirectory(store, "/")).toBe(true);
	expect(destinationIsDirectory(store, "*.txt")).toBe(false);
	expect(destinationIsDirectory(store, "nothing.yet")).toBe(false);
});

test("--text recodes between the two ends, in whichever direction", async () => {
	const from = image();
	// An ATASCII file, as a real Atari would have written it: EOL, and a run
	// of inverse video.
	from.writeFile(
		"notes.txt",
		Uint8Array.from([0x48, 0x49, 0x9b, 0xc1, 0xc2, 0x9b]),
	);
	const to = host();

	copyEntries(from, to, {
		sources: ["notes.txt"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		text: true,
		move: false,
	});
	await to.commit();
	expect(readFileSync(join(to.root, "notes.txt"), "utf8")).toBe("HI\n~AB~\n");

	// And back, to the same bytes.
	const back = image();
	copyEntries(to, back, {
		sources: ["notes.txt"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		text: true,
		move: false,
	});
	expect(back.readFile("notes.txt")?.bytes).toEqual(
		Uint8Array.from([0x48, 0x49, 0x9b, 0xc1, 0xc2, 0x9b]),
	);
});

test("without --text the bytes go across untouched", async () => {
	const from = image();
	const raw = Uint8Array.from([0x48, 0x9b, 0xc1]);
	from.writeFile("notes.txt", raw);
	const to = host();
	copyEntries(from, to, {
		sources: ["notes.txt"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		move: false,
	});
	await to.commit();
	expect(new Uint8Array(readFileSync(join(to.root, "notes.txt")))).toEqual(raw);
});

test("image to image is a no-op, both ends speaking the same set", () => {
	const from = image();
	const raw = Uint8Array.from([0x48, 0x9b, 0xc1, 0x00]);
	from.writeFile("a.txt", raw);
	const to = image();
	copyEntries(from, to, {
		sources: ["a.txt"],
		destination: "/",
		recursive: false,
		force: false,
		noAttributes: false,
		text: true,
		move: false,
	});
	expect(to.readFile("a.txt")?.bytes).toEqual(raw);
});
