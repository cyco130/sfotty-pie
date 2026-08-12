import { expect, test } from "vitest";
import { parseConvertArgs } from "./convert.ts";

test("parses the image, the output, and the type", () => {
	const parsed = parseConvertArgs(["-i", "in.dcm", "out.atr"]);
	expect(parsed.image).toBe("in.dcm");
	expect(parsed.output).toBe("out.atr");
	expect(parsed.type).toBe(undefined); // taken from the output name
	expect(parsed.force).toBe(false);
	expect(parseConvertArgs(["-i", "a", "b", "-t", "atr"]).type?.name).toBe(
		"atr",
	);
	expect(parseConvertArgs(["-i", "a", "b", "-f"]).force).toBe(true);
});

test("validates the argument list", () => {
	expect(() => parseConvertArgs(["out.atr"])).toThrow(/missing --image/);
	expect(() => parseConvertArgs(["-i", "in.dcm"])).toThrow(/missing the file/);
	expect(() => parseConvertArgs(["-i", "a", "b", "c"])).toThrow(
		/unexpected argument/,
	);
	expect(() => parseConvertArgs(["-i", "a", "b", "-t", "xfd"])).toThrow(
		/unknown image type "xfd"/,
	);
});
