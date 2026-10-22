import {
	DECODE,
	ReadOptions,
	Sfotty,
	type Memory,
	type SfottyOptions,
} from "@sfotty-pie/sfotty";

/**
 * Upper bound on the cycles one instruction may take. The longest real
 * instruction is 7 cycles (8 for an interrupt sequence), so anything past
 * this means the CPU is not making progress - an RDY stall, which `step`
 * does not support, since it has no way to raise the line mid-instruction.
 */
const MAX_CYCLES_PER_INSTRUCTION = 32;

const DEFAULT_HISTORY_SIZE = 1024;

/** An inclusive range of addresses. */
export interface AddressRange {
	start: number;
	end: number;
}

export interface RewindOptions extends SfottyOptions {
	/**
	 * How many instructions of history to keep. Older instructions fall off
	 * the end and can no longer be undone. 0 records nothing, for a run that
	 * will never be rewound.
	 *
	 * @default 1024
	 */
	historySize?: number;
	/**
	 * Ranges the journal leaves alone. A write here is not recorded and undo
	 * does not replay it, because replaying a store into a memory-mapped
	 * register would make the device act a second time - print the character
	 * again, draw the shape again. A device rolls its own state back.
	 */
	devices?: readonly AddressRange[];
}

/**
 * One recorded instruction: the CPU state before it ran, and the bytes it
 * overwrote. Entries are allocated once and reused as the ring wraps, so a
 * long run allocates nothing.
 */
interface Entry {
	a: number;
	x: number;
	y: number;
	s: number;
	p: number;
	pc: number;
	/** Addresses written during the instruction, in the order written. */
	addresses: number[];
	/** The byte each of those addresses held before its write. */
	oldValues: number[];
}

function makeEntry(): Entry {
	return { a: 0, x: 0, y: 0, s: 0, p: 0, pc: 0, addresses: [], oldValues: [] };
}

/**
 * A 6502 that can be stepped backwards.
 *
 * It drives a {@link Sfotty} one whole instruction at a time and journals
 * what each instruction changed: six bytes of register state, plus the
 * previous contents of every address it wrote. Undoing replays those writes
 * backwards and restores the registers, which is cheap because almost every
 * 6502 instruction writes at most one byte.
 *
 * The host's bus is wrapped, not replaced: reads pass straight through, so
 * memory-mapped I/O and the trap-by-throwing protocol keep working.
 */
export class RewindMachine {
	constructor(memory: Memory, options: RewindOptions = {}) {
		const {
			historySize = DEFAULT_HISTORY_SIZE,
			devices = [],
			...cpuOptions
		} = options;

		this.#memory = memory;
		this.#devices = devices;
		this.#capacity = Math.max(0, Math.trunc(historySize));
		this.#entries = Array.from({ length: this.#capacity }, makeEntry);

		this.#cpu = new Sfotty(
			{
				read: (address, readOptions) => memory.read(address, readOptions),
				write: (address, value, writeOptions) => {
					if (this.#isDevice(address)) {
						memory.write(address, value, writeOptions);
						return;
					}
					// Peek first so a throwing write journals nothing and the
					// retried cycle does not record the address twice.
					const old = memory.read(address, ReadOptions.PEEK);
					memory.write(address, value, writeOptions);
					this.#journal(address, old);
				},
			},
			cpuOptions,
		);
	}

	/** The CPU itself, for reading and poking registers and flags. */
	get cpu(): Sfotty {
		return this.#cpu;
	}

	/** How many instructions can still be undone. */
	get depth(): number {
		return this.#count;
	}

	/** Instructions completed since construction, less those undone. */
	get instructionsExecuted(): number {
		return this.#executed;
	}

	/**
	 * Run one whole instruction, from the opcode fetch to the next instruction
	 * boundary, recording what it changed.
	 *
	 * Does nothing once the CPU has jammed on a CIM, which repeats its last
	 * cycle forever. A bus that throws to suspend the CPU throws through here
	 * with nothing recorded, so the retried cycle starts the instruction over.
	 */
	step(): void {
		const cpu = this.#cpu;
		if (cpu.crashed) return;

		this.#beginEntry();

		let cycles = 0;
		try {
			do {
				cpu.cycle();
				cycles++;
				if (cycles > MAX_CYCLES_PER_INSTRUCTION) {
					throw new Error(
						`instruction at $${this.#current?.pc.toString(16)} did not ` +
							`finish in ${MAX_CYCLES_PER_INSTRUCTION} cycles`,
					);
				}
			} while (cpu.state !== DECODE && !cpu.crashed);
		} catch (error) {
			this.#current = undefined;
			throw error;
		}

		this.#commitEntry();
		this.#executed++;
	}

	/** Whether {@link undo} would do anything. */
	canUndo(): boolean {
		return this.#count > 0;
	}

	/**
	 * Put the machine back the way it was before the last {@link step}, and
	 * report whether there was one to undo.
	 *
	 * A jam is not undone: `crashed` is set by the CPU and only a reset clears
	 * it, so a run that reached a CIM cannot be rewound past it.
	 */
	undo(): boolean {
		if (this.#count === 0) return false;

		this.#head = (this.#head + this.#capacity - 1) % this.#capacity;
		this.#count--;
		const entry = this.#entries[this.#head]!;

		// Newest first, so an address written twice ends on its oldest value.
		for (let i = entry.addresses.length - 1; i >= 0; i--) {
			this.#memory.write(
				entry.addresses[i]!,
				entry.oldValues[i]!,
				ReadOptions.NONE,
			);
		}

		const cpu = this.#cpu;
		cpu.A = entry.a;
		cpu.X = entry.x;
		cpu.Y = entry.y;
		cpu.S = entry.s;
		cpu.setP(entry.p);
		cpu.PC = entry.pc;
		cpu.state = DECODE;

		this.#executed--;
		return true;
	}

	/** Forget the recorded history, keeping the current machine state. */
	clearHistory(): void {
		this.#count = 0;
		this.#head = 0;
		this.#current = undefined;
	}

	#beginEntry(): void {
		if (this.#capacity === 0) return;

		const cpu = this.#cpu;
		const entry = this.#entries[this.#head]!;
		entry.a = cpu.A;
		entry.x = cpu.X;
		entry.y = cpu.Y;
		entry.s = cpu.S;
		entry.p = cpu.getP();
		entry.pc = cpu.PC;
		entry.addresses.length = 0;
		entry.oldValues.length = 0;
		this.#current = entry;
	}

	#commitEntry(): void {
		if (this.#current === undefined) return;

		this.#head = (this.#head + 1) % this.#capacity;
		if (this.#count < this.#capacity) this.#count++;
		this.#current = undefined;
	}

	#journal(address: number, oldValue: number): void {
		const entry = this.#current;
		if (entry === undefined) return;

		entry.addresses.push(address);
		entry.oldValues.push(oldValue);
	}

	#isDevice(address: number): boolean {
		for (const range of this.#devices) {
			if (address >= range.start && address <= range.end) return true;
		}
		return false;
	}

	readonly #memory: Memory;
	readonly #devices: readonly AddressRange[];
	readonly #cpu: Sfotty;
	readonly #capacity: number;
	readonly #entries: Entry[];
	#head = 0;
	#count = 0;
	#executed = 0;
	#current: Entry | undefined;
}
