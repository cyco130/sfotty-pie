import type { Memory } from "@sfotty-pie/sfotty";

/**
 * Parallel Bus Interface stub: no PBI device connected. The decoded PBI windows
 * ($D100-$D1FF, $D600-$D6FF, and the $D800-$DFFF firmware area) read back $FF.
 *
 * TODO(floating-bus): with no device this is undriven; $FF is the XL/XE pull-up,
 * but the 400/800 floats. TODO: real PBI device support (math box, hard disk,
 * etc.).
 */
export class Pbi implements Memory {
	read(): number {
		return 0xff;
	}

	write(): void {}
}
