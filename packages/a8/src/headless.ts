import { ReadOptions } from "@sfotty-pie/sfotty";
import type { AtrImage } from "./atr.ts";
import type { Atari } from "./machine.ts";
import { createSioHandler, SIOV } from "./sio.ts";

// A headless Atari session: a machine driven to completion with the console and
// disk I/O served by high-level emulation of the OS ROM (E: PUTBYT/GETBYT, SIO,
// CIOV, BLKBDV) instead of a real display/keyboard. The host injects only I/O
// policy — where output goes, where input comes from, optional CH key
// automation, an optional trace hook — so both the boot CLI and the Acid800
// conformance runner share this exact run loop and trap wiring.

const RTS = 0x60; // the substitute opcode an execute interceptor returns
const CH = 0x02fc; // POKEY keyboard code, polled by key-input routines
const CIOV = 0xe456; // CIO entry — HATABS is set up by the first call
const BLKBDV = 0xe471; // Memo Pad ("blackboard") entry: nothing left to run

// Thrown by the GETBYT trap when no input is buffered: the run loop awaits the
// input source and resumes the same (un-advanced) cycle.
const NEED_INPUT = Symbol("need-input");

/**
 * A source of console input for E: GETBYT. `read` returns the next raw input
 * byte (ATASCII-ish; a `0x0A` newline is mapped to the Atari EOL) or `undefined`
 * when nothing is buffered; `wait` resolves `true` when more input may have
 * arrived, or `false` when input is closed for good (the session then ends).
 */
export interface InputSource {
	read(): number | undefined;
	wait(): Promise<boolean>;
}

export interface HeadlessConfig {
	/** The machine to drive. Its CPU powers on into the reset sequence. */
	machine: Atari;
	/** Disk served as D1: via trap-based SIO; everything else times out. */
	disk?: AtrImage;
	/** E: PUTBYT sink — each output byte, with the Atari EOL mapped to `0x0A`. */
	output: (byte: number) => void;
	/** E: GETBYT source. Omit for a session that never reads console input. */
	input?: InputSource;
	/**
	 * CH key automation (KBCODE values). Each time a program clears CH ($02FC)
	 * and then polls it, the next code is fed; once the script is exhausted the
	 * session ends. Used to script past interactive menus (e.g. Acid800).
	 */
	keys?: number[];
	/** Committed-fetch trace hook, wired to the CPU's `onFetch`. */
	onInstruction?: (pc: number) => void;
	/** Hard cap on emulated cycles; reaching it ends the run. */
	limit?: number;
}

export interface RunResult {
	/** Machine cycles emulated. */
	cycles: number;
	/** True if the run stopped because it hit the cycle cap (likely stuck). */
	reachedLimit: boolean;
}

export class Headless {
	readonly #machine: Atari;
	readonly #disk: AtrImage | undefined;
	readonly #output: (byte: number) => void;
	readonly #input: InputSource | undefined;
	readonly #keys: number[];
	readonly #limit: number;

	#done = false;
	#editorTrapped = false;

	constructor(config: HeadlessConfig) {
		this.#machine = config.machine;
		this.#disk = config.disk;
		this.#output = config.output;
		this.#input = config.input;
		this.#keys = config.keys ?? [];
		this.#limit = config.limit ?? 1_000_000_000;
		if (config.onInstruction)
			this.#machine.onInstruction = config.onInstruction;
		this.#installTraps();
	}

	/** The machine being driven (for the host to inspect on exit). */
	get machine(): Atari {
		return this.#machine;
	}

	/**
	 * Drive the machine until the session ends — BLKBDV reached, the key script
	 * exhausted, the input source closed, the CPU crashed, or the cycle cap hit.
	 * Mostly synchronous; it only awaits when E: GETBYT has no buffered input.
	 */
	async run(): Promise<RunResult> {
		const cpu = this.#machine.cpu;
		let cycles = 0;
		while (cycles < this.#limit) {
			if (!(await this.#advanceCycle())) break; // input closed → session over
			cycles++;
			if (this.#done || cpu.crashed) break;
		}
		return { cycles, reachedLimit: cycles >= this.#limit };
	}

	// Advance one machine cycle, awaiting input across a GETBYT suspend and
	// resuming the same cycle (retrying through a spurious wakeup). Returns false
	// only when input is closed while a cycle is suspended.
	async #advanceCycle(): Promise<boolean> {
		let step = (): number => this.#machine.machineCycle();
		for (;;) {
			try {
				step();
				return true;
			} catch (signal) {
				if (signal !== NEED_INPUT) throw signal;
				if (!this.#input || !(await this.#input.wait())) return false;
				step = () => this.#machine.resumeMachineCycle();
			}
		}
	}

	#installTraps(): void {
		// CIOV: on the first call HATABS is initialized, so discover and trap E:'s
		// byte routines. Observe-only — the real OS routine still runs.
		this.#machine.observeExecute(CIOV, () => this.#installEditorTraps());

		// SIOV: serve D1: from the attached image; everything else times out, so
		// without a disk the OS abandons the disk boot.
		this.#machine.interceptExecute(
			SIOV,
			createSioHandler({
				machine: this.#machine,
				cpu: this.#machine.cpu,
				getDisk: (unit) => (unit === 1 ? this.#disk : undefined),
			}),
		);

		// BLKBDV: the OS jumps here when there is nothing left to run. Session over.
		this.#machine.observeExecute(BLKBDV, () => {
			this.#done = true;
		});

		if (this.#keys.length) this.#installKeys();
	}

	// CH key automation: arm on a write of 0 to CH (the program clearing it before
	// polling), then substitute the next scripted code on the following CH read.
	#installKeys(): void {
		let index = 0;
		let armed = false;
		this.#machine.observeWrite(CH, (_address, value) => {
			if (value === 0) armed = true;
		});
		this.#machine.interceptRead(CH, () => {
			if (!armed) return undefined;
			armed = false;
			if (index >= this.#keys.length) {
				this.#done = true; // script exhausted → end the session
				return undefined;
			}
			return this.#keys[index++];
		});
	}

	// E: PUTBYT — copy the ATASCII character in A to the output sink (mapping the
	// Atari EOL to a newline), then fall through so the real ROM routine still
	// runs and the text also lands in screen RAM.
	#editorPutByte(): void {
		const c = this.#machine.cpu.A & 0xff;
		this.#output(c === 0x9b ? 0x0a : c);
	}

	// E: GETBYT — put the next input byte in A (as ATASCII) and RTS back to the
	// caller. Throws to suspend when no input is buffered; the run loop awaits the
	// input source and retries the fetch.
	#editorGetByte(): number {
		const byte = this.#input?.read();
		if (byte === undefined) throw NEED_INPUT;
		const cpu = this.#machine.cpu;
		cpu.A = byte === 0x0a ? 0x9b : byte; // newline → ATASCII EOL
		cpu.Y = 0x01; // IOCB status: success
		cpu.nFlag = false;
		cpu.zFlag = false;
		return RTS;
	}

	// On the first CIOV call HATABS is set up, so discover E:'s GETBYT/PUTBYT
	// routines (each stored as address-1) and trap them — OS-version independent.
	#installEditorTraps(): void {
		if (this.#editorTrapped) return;
		this.#editorTrapped = true;
		const table = this.#findHandler(0x45); // 'E'
		if (table === 0) return;
		const word = (off: number) =>
			this.#machine.read(table + off, ReadOptions.NONE) |
			(this.#machine.read(table + off + 1, ReadOptions.NONE) << 8);
		const getByte = (word(4) + 1) & 0xffff;
		const putByte = (word(6) + 1) & 0xffff;
		this.#machine.interceptExecute(getByte, () => this.#editorGetByte());
		this.#machine.observeExecute(putByte, () => this.#editorPutByte());
	}

	// Find a device's handler-vector table via HATABS ($031A): 3-byte entries
	// [name, table-lo, table-hi], terminated by a zero name.
	#findHandler(device: number): number {
		for (let addr = 0x031a; addr < 0x033f; addr += 3) {
			const name = this.#machine.read(addr, ReadOptions.NONE);
			if (name === 0) break;
			if (name === device) {
				return (
					this.#machine.read(addr + 1, ReadOptions.NONE) |
					(this.#machine.read(addr + 2, ReadOptions.NONE) << 8)
				);
			}
		}
		return 0;
	}
}
