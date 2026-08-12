import { describe, expect, test } from "vitest";
import { traceBitmap, type GridPoint } from "./trace.ts";

// Shoelace formula; sign reveals orientation.
function signedArea(contour: GridPoint[]): number {
	let sum = 0;
	for (let i = 0; i < contour.length; i++) {
		const a = contour[i]!;
		const b = contour[(i + 1) % contour.length]!;
		sum += a.x * b.y - b.x * a.y;
	}
	return sum / 2;
}

describe("traceBitmap", () => {
	test("empty bitmap has no contours", () => {
		expect(traceBitmap(new Uint8Array(8))).toEqual([]);
	});

	test("single pixel is one square", () => {
		const bitmap = new Uint8Array(8);
		bitmap[0] = 0x80;
		const contours = traceBitmap(bitmap);
		expect(contours).toHaveLength(1);
		expect(contours[0]).toHaveLength(4);
		expect(Math.abs(signedArea(contours[0]!))).toBe(1);
	});

	test("full row merges into one rectangle", () => {
		const bitmap = new Uint8Array(8);
		bitmap[3] = 0xff;
		const contours = traceBitmap(bitmap);
		expect(contours).toHaveLength(1);
		expect(contours[0]).toHaveLength(4);
		expect(Math.abs(signedArea(contours[0]!))).toBe(8);
	});

	test("ring produces a hole with opposite orientation", () => {
		// 3x3 hollow square in the top-left corner.
		const bitmap = new Uint8Array(8);
		bitmap[0] = 0xe0;
		bitmap[1] = 0xa0;
		bitmap[2] = 0xe0;
		const contours = traceBitmap(bitmap);
		expect(contours).toHaveLength(2);
		const areas = contours.map(signedArea).sort((a, b) => a - b);
		// Outer is 9 units, hole is 1; orientations must be opposite.
		expect(areas.map(Math.abs).sort((a, b) => a - b)).toEqual([1, 9]);
		expect(areas[0]! * areas[1]!).toBeLessThan(0);
	});

	test("diagonally touching pixels stay separate contours", () => {
		const bitmap = new Uint8Array(8);
		bitmap[0] = 0x80;
		bitmap[1] = 0x40;
		const contours = traceBitmap(bitmap);
		expect(contours).toHaveLength(2);
		expect(contours[0]).toHaveLength(4);
		expect(contours[1]).toHaveLength(4);
	});
});
