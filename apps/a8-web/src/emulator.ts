import {
	Atari,
	CYCLES_PER_LINE,
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	NTSC_CYCLES_PER_SECOND,
	type MachineConfig,
} from "@sfotty-pie/a8";
import { DECODE, ReadOptions, Sfotty } from "@sfotty-pie/sfotty";

const MS_PER_SCANLINE = (1000 * CYCLES_PER_LINE) / NTSC_CYCLES_PER_SECOND;

// Yield cadence in scanlines. Coprime to both frame lengths (262 and 312) so
// the yield point drifts across the frame instead of aliasing to a fixed line.
const YIELD_INTERVAL = 257;

// When we fall further behind than this (tab jank, a debugger pause), rebase
// the clock and drop the lost time instead of replaying it — avoids the
// spiral of death.
const MAX_LAG_MS = 100;

const SIOV = 0xe459;
const SIO_TIMEOUT = 0x8a; // "device timeout" — no peripheral responded

/**
 * Drives an {@link Atari} machine in real time, paced against
 * `performance.now()` (the audio clock will be promoted to master once there
 * is audio). Renders into a double buffer: `frame` is the latest completed
 * frame, `frameCount` ticks on every flip.
 */
export class Emulator {
	readonly machine: Atari;
	readonly #cpu: Sfotty;

	#frames = [
		new Uint8Array(FRAME_BUFFER_WIDTH * FRAME_BUFFER_HEIGHT),
		new Uint8Array(FRAME_BUFFER_WIDTH * FRAME_BUFFER_HEIGHT),
	] as const;
	#back = 0;

	/** The latest completed frame (one Atari color byte per pixel). */
	frame: Uint8Array = this.#frames[1];
	/** Increments on every completed frame. */
	frameCount = 0;

	#running = false;
	#scanlines = 0;
	#epoch = 0;

	constructor(config: MachineConfig) {
		this.machine = new Atari(config);
		this.#cpu = new Sfotty(this.machine, { withoutUndocumented: false });
		this.#cpu.reset(true);
	}

	start(): void {
		if (this.#running) return;
		this.#running = true;
		void this.#loop();
	}

	stop(): void {
		this.#running = false;
	}

	/** Power cycle: cold-reset the machine and the CPU. */
	coldStart(): void {
		this.machine.reset(true);
		this.#cpu.reset(true);
	}

	async #loop(): Promise<void> {
		const yieldMacrotask = makeMacrotaskYield();
		this.#epoch = performance.now() - this.#scanlines * MS_PER_SCANLINE;

		while (this.#running) {
			if (document.hidden) {
				await waitForVisible();
				// The hidden interval is lost time, not work to replay.
				this.#epoch = performance.now() - this.#scanlines * MS_PER_SCANLINE;
			}

			this.#runScanline();
			this.#scanlines++;

			const ahead =
				this.#epoch + this.#scanlines * MS_PER_SCANLINE - performance.now();

			if (ahead > 5) {
				// setTimeout overshoots; re-reading the clock next iteration
				// self-corrects.
				await sleep(ahead - 2);
			} else if (ahead < -MAX_LAG_MS) {
				this.#epoch = performance.now() - this.#scanlines * MS_PER_SCANLINE;
			} else if (this.#scanlines % YIELD_INTERVAL === 0) {
				// A macrotask yield — `await void 0` would only drain microtasks
				// and starve rendering, input, and requestAnimationFrame.
				await yieldMacrotask();
			}
		}
	}

	#runScanline(): void {
		const ag = this.machine.anticGtia;
		const cpu = this.#cpu;
		const back = this.#frames[this.#back === 0 ? 0 : 1];

		for (let cycle = 0; cycle < CYCLES_PER_LINE; cycle++) {
			ag.beforeCpu();
			cpu.NMI = ag.nmi;
			cpu.IRQ = this.machine.irq;
			cpu.RDY = ag.rdy;

			if (this.machine.resetAsserted) {
				// The XL Reset button holds the system reset line; restarting
				// the CPU's reset sequence every cycle models the held RES
				// line — the sequence completes once the button is released.
				cpu.reset(false);
			} else if (!ag.halt) {
				// SIOV trap: no peripherals — report a device timeout so the OS
				// abandons the disk boot. Only on a real opcode fetch (not while
				// a WSYNC stall repeats it).
				if (cpu.RDY && cpu.state === DECODE && cpu.PC === SIOV) {
					this.#sioTimeout();
				} else {
					cpu.run();
				}
			}

			ag.afterCpu(back, this.machine.busData);
		}

		// vcount wraps to 0 while the last line of the frame is run: flip.
		if (ag.vcount === 0) {
			this.frame = back;
			this.#back ^= 1;
			this.frameCount++;
		}
	}

	#sioTimeout(): void {
		const cpu = this.#cpu;
		this.machine.write(0x0303, SIO_TIMEOUT); // DSTATS
		cpu.Y = SIO_TIMEOUT;
		cpu.nFlag = true;
		cpu.zFlag = false;
		this.#rts();
	}

	#rts(): void {
		const cpu = this.#cpu;
		const lo = this.machine.read(
			0x0100 | ((cpu.S + 1) & 0xff),
			ReadOptions.NONE,
		);
		const hi = this.machine.read(
			0x0100 | ((cpu.S + 2) & 0xff),
			ReadOptions.NONE,
		);
		cpu.S = (cpu.S + 2) & 0xff;
		cpu.PC = (((hi << 8) | lo) + 1) & 0xffff;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForVisible(): Promise<void> {
	return new Promise((resolve) => {
		document.addEventListener("visibilitychange", function handler() {
			if (!document.hidden) {
				document.removeEventListener("visibilitychange", handler);
				resolve();
			}
		});
	});
}

function makeMacrotaskYield(): () => Promise<void> {
	const channel = new MessageChannel();
	let pending: (() => void) | null = null;
	channel.port1.onmessage = () => {
		const resolve = pending;
		pending = null;
		resolve?.();
	};
	return () =>
		new Promise((resolve) => {
			pending = resolve;
			channel.port2.postMessage(null);
		});
}
