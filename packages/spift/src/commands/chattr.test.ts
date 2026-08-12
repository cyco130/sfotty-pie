import { expect, test } from "vitest";
import { parseChattrArgs } from "./chattr.ts";

test("leading name=value positionals are settings, the rest are specs", () => {
	expect(parseChattrArgs(["-i", "d.atr", "read-only=on", "*.com"])).toEqual({
		image: "d.atr",
		settings: [{ attribute: "ReadOnly", on: true }],
		specs: ["*.com"],
		fs: undefined,
		variant: undefined,
		recursive: false,
		force: false,
	});
	expect(
		parseChattrArgs(["-i", "d.atr", "read-only=off", "dos1=on", "a", "b"]),
	).toMatchObject({
		settings: [
			{ attribute: "ReadOnly", on: false },
			{ attribute: "AtariDos10", on: true },
		],
		specs: ["a", "b"],
	});
});

test("locked and protected spell the same attribute as read-only", () => {
	const of = (name: string) =>
		parseChattrArgs(["-i", "d.atr", `${name}=on`, "a"]).settings[0]?.attribute;
	expect(of("read-only")).toBe("ReadOnly");
	expect(of("locked")).toBe("ReadOnly");
	expect(of("protected")).toBe("ReadOnly");
	expect(of("PROTECTED")).toBe("ReadOnly");
});

test("attributes that are not flags say why rather than 'unknown'", () => {
	const fails = (name: string) => () =>
		parseChattrArgs(["-i", "d.atr", `${name}=on`, "a"]);
	expect(fails("dos2.5")).toThrow(/where its sectors are/);
	expect(fails("mydos")).toThrow(/where its sectors are/);
	expect(fails("dos-file")).toThrow(/boot record/);
	expect(fails("deleted")).toThrow(/rm leaves behind/);
	expect(fails("open-output")).toThrow(/damage to repair/);
	expect(fails("bogus")).toThrow(/unknown attribute "bogus"/);
});

test("validates the argument list", () => {
	expect(() => parseChattrArgs(["read-only=on", "a"])).toThrow(
		/missing --image/,
	);
	expect(() => parseChattrArgs(["-i", "d.atr", "a.com"])).toThrow(
		/missing a setting/,
	);
	expect(() => parseChattrArgs(["-i", "d.atr", "read-only=on"])).toThrow(
		/missing SPEC/,
	);
	expect(() =>
		parseChattrArgs(["-i", "d.atr", "read-only=maybe", "a"]),
	).toThrow(/takes "on" or "off"/);
	// Spelled two ways, meaning opposite things.
	expect(() =>
		parseChattrArgs(["-i", "d.atr", "locked=on", "protected=off", "a"]),
	).toThrow(/read-only is set both on and off/);
});

test("a spec holding an = is safe once the settings have ended", () => {
	// The first positional without an "=" ends the settings for good.
	const parsed = parseChattrArgs(["-i", "d.atr", "read-only=on", "a", "b=c"]);
	expect(parsed.specs).toEqual(["a", "b=c"]);
});
