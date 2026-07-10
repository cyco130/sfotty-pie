import { ReadOptions, Sfotty, type Memory } from "@sfotty-pie/sfotty";
import { AnticGtia, type TvAdapter } from "./antic-gtia.ts";
import type { AtrImage } from "./atr.ts";
import {
	Mmu,
	type ExecuteInterceptor,
	type ExecuteObserver,
	type ReadInterceptor,
	type ReadObserver,
	type TrapHandle,
	type TrapOptions,
	type WriteInterceptor,
	type WriteObserver,
} from "./mmu.ts";
import {
	builtinSlotRom,
	createCartridge,
	type Cartridge,
} from "./cartridge.ts";
import { ConsoleConnector } from "./console-connector.ts";
import { JoystickConnector } from "./joystick-connector.ts";
import { Pbi } from "./pbi.ts";
import { Pia } from "./pia.ts";
import { Pokey } from "./pokey.ts";
import { createSioHandler, SIOV } from "./sio.ts";
import { FRAME_BUFFER_HEIGHT, FRAME_BUFFER_WIDTH } from "./timing-constants.ts";

/**
 * The Atari 8-bit model class - what the firmware ranking and the UI key off.
 * The machine itself only cares about `xl` (everything but the 400/800) plus
 * the bus options; these classes map onto that.
 */
export type AtariModel = "400/800" | "1200xl" | "xl/xe" | "xegs";

// Where cycle()/resumeCycle() are within one machine cycle. A
// throw from a bus phase (ANTIC's DMA read in BUS, the CPU's access in CPU)
// leaves the marker on that phase, so resumeCycle() re-enters there
// without re-running the committed beforeCpu. A const object, not an enum
// (enums emit runtime code, which this repo's strip-only TS execution rejects).
const PHASE = { IDLE: 0, BUS: 1, CPU: 2 } as const;

export interface MachineConfig {
	/**
	 * XL/XE architecture: PORTB banking and built-in (banked) ROM slots.
	 * Default false - the 400/800, where BASIC/cartridges share the $A000 slot.
	 */
	xl?: boolean;
	/** TV standard: line count, the GTIA PAL flag, and timing. Default NTSC. */
	tvSystem?: "ntsc" | "pal";
	/**
	 * Video output chip. A CTIA (early 400/800s) ignores PRIOR bits 6-7, so
	 * the GTIA special modes 9/10/11 display as their base ANTIC mode.
	 * Default "gtia".
	 */
	tvAdapter?: TvAdapter;
	/**
	 * Conventional RAM in KB: 16/48 on the 400/800, 64 on XL/XE. Defaults from
	 * `xl` (48 / 64).
	 */
	conventionalRamSize?: number;
	/** 16K PORTB-banked extended-RAM banks (0/4/8/16/32/64). Default 0. */
	xeBankCount?: number;
	/** Separate CPU/ANTIC extended-RAM access (needs <=32 banks). Default false. */
	separateAnticAccess?: boolean;
	/** OS ROM: 10K (400/800) or 16K (XL/XE). */
	os: Uint8Array;
	/**
	 * BASIC ROM (8K). Built-in (PORTB-banked) on XL/XE; on the 400/800 a passed
	 * `basic` is wrapped as an $A000 cartridge (omit to leave the slot empty).
	 * The 1200XL has no built-in BASIC - omit it and supply BASIC as a cart.
	 */
	basic?: Uint8Array;
	/** Built-in game ROM (8K), PORTB-banked - the XEGS. Requires `xl`. */
	game?: Uint8Array;
	/**
	 * Cartridge in the (left) slot. On the 400/800 it takes the slot otherwise
	 * occupied by the BASIC cartridge; on XL/XE it shadows built-in BASIC.
	 */
	cartridge?: Cartridge;
	/** Debug log sink (used by ANTIC's display list disassembler). */
	log?: (message: string) => void;
}

/**
 * An Atari 8-bit machine (NTSC or PAL) built on the {@link Mmu}, the
 * combined {@link AnticGtia} video chip pair, POKEY, and the PIA. Classic
 * machines as {@link MachineConfig} recipes:
 *
 * - an 800 - OS-B, 48K, no PORTB banking; BASIC is a standard $A000 8K cart.
 * - an 800XL - `xl`, XL OS, 64K, PORTB banking; BASIC is built in and banked
 *   via PORTB (the OS enables it unless OPTION is held).
 * - a 130XE - the XL plus `xeBankCount: 4` (four 16K banks at $4000-$7FFF via
 *   PORTB bits 2-3) and `separateAnticAccess` (bits 4/5).
 *
 * The host drives the machine one cycle at a time via {@link cycle}, which
 * runs ANTIC scheduling, the bus phase (ANTIC DMA or the CPU), and the
 * render. A bus phase may throw to suspend; the host catches it, resolves
 * it, and calls {@link resumeCycle}:
 *
 * ```ts
 * try {
 * 	machine.cycle();
 * } catch (signal) {
 * 	// resolve the suspend (await input, clear a breakpoint, ...)
 * 	machine.resumeCycle();
 * }
 * // read machine.frame for video and machine.audio for sound
 * ```
 *
 * Keyboard input goes through the `pokeyKeyDown`/`pokeyKeyUp` family of
 * methods. Joystick input goes through the {@link joysticks} connectors -
 * plug a {@link Joystick} device into one and drive the device. The machine
 * knows nothing about host key assignments - mapping host keys to matrix
 * codes or joystick lines (layouts, special key bindings) is entirely the
 * host's business.
 */
export class Atari implements Memory {
	// Connectors - the supported host surface; devices plug in here.
	readonly joysticks: readonly JoystickConnector[];
	readonly console: ConsoleConnector;

	// Internal components
	readonly cpu: Sfotty;
	readonly anticGtia: AnticGtia;
	readonly pia: Pia;
	readonly pokey: Pokey;
	readonly mmu: Mmu;

	readonly #xl: boolean;
	#resetHeld = false;
	// The D1: disk image served by the built-in trap-based SIO; undefined = no
	// disk (SIO times out and the OS moves on). Set via insertDisk.
	#disk: AtrImage | undefined;
	/**
	 * The framebuffer the machine renders into (376x240 Atari color bytes),
	 * updated by each cycle's render phase. Reassign only at a frame
	 * boundary (e.g. swapping targets for tear-free double-buffering), or
	 * the in-progress frame tears.
	 */
	frame: Uint8Array = new Uint8Array(FRAME_BUFFER_WIDTH * FRAME_BUFFER_HEIGHT);

	// Continuation marker for the cycle phase machine; see PHASE.
	#phase: number = PHASE.IDLE;

	constructor(config: MachineConfig) {
		const { os, basic, game, cartridge, log } = config;
		const xl = config.xl ?? false;
		this.#xl = xl;

		const tvSystem = config.tvSystem ?? "ntsc";

		// The dmaRead closure reads #bus lazily, resolving the chip/bus
		// construction cycle.
		this.anticGtia = new AnticGtia(
			{
				dmaRead: (address) => this.mmu.read(address, ReadOptions.DMA),
				log: log ?? (() => {}),
			},
			{
				anticTvSystem: tvSystem,
				gtiaTvSystem: tvSystem,
				tvAdapter: config.tvAdapter ?? "gtia",
			},
		);

		this.pia = new Pia();
		this.pokey = new Pokey();

		this.mmu = new Mmu({
			portbBanking: xl,
			conventionalRamSize: config.conventionalRamSize ?? (xl ? 64 : 48),
			xeBankCount: config.xeBankCount ?? 0,
			separateAnticAccess: config.separateAnticAccess ?? false,
			osRom: os,
			// XL/XE: built-in BASIC and game, banked in via PORTB - each accepts a
			// raw 8K ROM or a standard-8K `.car` (unwrapped here). 400/800: BASIC is
			// an $A000 cart (Cartridge parses raw or `.car`) - displaced when a game
			// cartridge is in the slot.
			basicRom: xl && basic ? builtinSlotRom(basic) : undefined,
			gameRom: game ? builtinSlotRom(game) : undefined,
			cartridge:
				cartridge ?? (!xl && basic ? createCartridge(basic) : undefined),
			gtia: this.anticGtia,
			pokey: this.pokey,
			pia: this.pia,
			antic: this.anticGtia,
			pbi: new Pbi(),
		});

		this.joysticks = this.#connectJoystickConnectors();
		this.console = this.#connectConsoleConnector();

		// On XL/XE, TRIG3 ($D013) senses the cartridge line (RD5): 1 = a
		// cartridge is in the slot, 0 = empty. The OS reads it (against the
		// stored GINTLK) to cold-start on a hot swap, and to skip the
		// cartridge checksum entirely when the slot is empty - without this
		// (TRIG3 stuck at 1) every Reset runs that checksum, which then fails
		// on the BASIC/RAM banking and forces a cold start. On the 800 TRIG3
		// is joystick 4's trigger and stays as-is.
		if (xl) {
			this.anticGtia.trig3 = cartridge ? 1 : 0;
		}

		// The machine is its own bus (it implements Memory), so the CPU reads and
		// writes through the trap-aware Mmu. Constructed last, once the MMU is
		// wired. Powers on into the reset sequence like real hardware.
		this.cpu = new Sfotty(this);

		// Built-in SIO high-level emulation: a JSR through SIOV is trapped and
		// served from the inserted D1: image (no serial hardware emulated). Wired
		// once; insertDisk swaps the image the handler reads. Only fires while
		// the OS ROM is mapped: with RAM banked in under the OS, $E459 is the
		// running program's own code (Turbo Basic XL keeps its interpreter
		// there), so the fetch must fall through to it.
		const sioHandler = createSioHandler({
			machine: this,
			cpu: this.cpu,
			getDisk: (unit) => (unit === 1 ? this.#disk : undefined),
		});
		this.interceptExecute(SIOV, (address) =>
			this.mmu.isOsRomMapped ? sioHandler(address) : undefined,
		);
	}

	// Create and wire the joystick connectors: two jacks on the XL/XE, four
	// on the 400/800 (ports 2/3 live on PIA port B). Connector signals are
	// wire levels; this is the only place that knows which chip pins a port
	// lands on. potAIn/potBIn are not wired: POKEY does not scan pots yet.
	#connectJoystickConnectors(): JoystickConnector[] {
		const pia = this.pia;
		const gtia = this.anticGtia;

		const joystick0 = new JoystickConnector();
		joystick0.directionIn.watch((source) => {
			pia.portaIn.value = (pia.portaIn.value & 0xf0) | (source.value & 0x0f);
		});
		pia.portaOut.watch((source) => {
			joystick0.directionOut.value = source.value & 0x0f;
		});
		joystick0.triggerIn.watch((source) => {
			gtia.trig0 = source.value ? 1 : 0;
		});

		const joystick1 = new JoystickConnector();
		joystick1.directionIn.watch((source) => {
			pia.portaIn.value =
				(pia.portaIn.value & 0x0f) | ((source.value & 0x0f) << 4);
		});
		pia.portaOut.watch((source) => {
			joystick1.directionOut.value = (source.value >> 4) & 0x0f;
		});
		joystick1.triggerIn.watch((source) => {
			gtia.trig1 = source.value ? 1 : 0;
		});

		if (this.#xl) {
			return [joystick0, joystick1];
		}

		const joystick2 = new JoystickConnector();
		joystick2.directionIn.watch((source) => {
			pia.portbIn.value = (pia.portbIn.value & 0xf0) | (source.value & 0x0f);
		});
		pia.portbOut.watch((source) => {
			joystick2.directionOut.value = source.value & 0x0f;
		});
		joystick2.triggerIn.watch((source) => {
			gtia.trig2 = source.value ? 1 : 0;
		});

		const joystick3 = new JoystickConnector();
		joystick3.directionIn.watch((source) => {
			pia.portbIn.value =
				(pia.portbIn.value & 0x0f) | ((source.value & 0x0f) << 4);
		});
		pia.portbOut.watch((source) => {
			joystick3.directionOut.value = (source.value >> 4) & 0x0f;
		});
		joystick3.triggerIn.watch((source) => {
			gtia.trig3 = source.value ? 1 : 0;
		});

		return [joystick0, joystick1, joystick2, joystick3];
	}

	// Create and wire the console connector - the wires between the console
	// shell and the components. Connector signals are wire levels; this is
	// the only place that knows which chip pins the console wires land on.
	#connectConsoleConnector(): ConsoleConnector {
		const connector = new ConsoleConnector();
		const gtia = this.anticGtia;
		const pia = this.pia;

		// The power switch cold-resets every component, the CPU included.
		connector.power.watch(() => {
			this.#reset(true);
			this.cpu.reset(true);
		});

		// The Reset key. XL/XE: the system reset line soft-resets the
		// components immediately and holds the CPU's RES until released (see
		// resetAsserted). 400/800: it drives ANTIC's RNMI instead - a
		// software warmstart, nothing is hardware-reset.
		connector.reset.watch((source) => {
			if (this.#xl) {
				if (source.value) {
					this.#reset(false);
					this.#resetHeld = true;
				} else {
					this.#resetHeld = false;
				}
			} else {
				gtia.rnmi = source.value;
			}
		});

		// Start/Select/Option buttons and the speaker drive GTIA's switch
		// lines S0-S3; the resolved levels come back out.
		connector.startIn.watch((source) => {
			gtia.switchesIn.value =
				(gtia.switchesIn.value & ~0x01) | (source.value ? 0x01 : 0);
		});
		connector.selectIn.watch((source) => {
			gtia.switchesIn.value =
				(gtia.switchesIn.value & ~0x02) | (source.value ? 0x02 : 0);
		});
		connector.optionIn.watch((source) => {
			gtia.switchesIn.value =
				(gtia.switchesIn.value & ~0x04) | (source.value ? 0x04 : 0);
		});
		connector.speakerIn.watch((source) => {
			gtia.switchesIn.value =
				(gtia.switchesIn.value & ~0x08) | (source.value ? 0x08 : 0);
		});
		gtia.switchesOut.watch((source) => {
			connector.startOut.value = !!(source.value & 0x01);
			connector.selectOut.value = !!(source.value & 0x02);
			connector.optionOut.value = !!(source.value & 0x04);
			connector.speakerOut.value = !!(source.value & 0x08);
		});

		// The LED lines sit on PIA PB2/PB3 (low = lit). Physically a 1200XL
		// feature, but the wires are ordinary port pins, so every XL/XE gets
		// them; on the 400/800 port B belongs to joysticks 2/3 instead.
		if (this.#xl) {
			connector.led1In.watch((source) => {
				pia.portbIn.value = source.value
					? pia.portbIn.value | 0x04
					: pia.portbIn.value & ~0x04;
			});
			connector.led2In.watch((source) => {
				pia.portbIn.value = source.value
					? pia.portbIn.value | 0x08
					: pia.portbIn.value & ~0x08;
			});
			pia.portbOut.watch((source) => {
				connector.led1Out.value = !!(source.value & 0x04);
				connector.led2Out.value = !!(source.value & 0x08);
			});
		}

		return connector;
	}

	/** The last value driven on the data bus (see {@link Mmu.busData}). */
	get busData(): number {
		return this.mmu.busData;
	}

	read(address: number, options: ReadOptions): number {
		return this.mmu.read(address, options);
	}

	write(address: number, value: number, options: ReadOptions): void {
		this.mmu.write(address, value, options);
	}

	// Reset the components. Reached only through the console connector: the
	// power switch resets cold, the XL/XE Reset key warm.
	#reset(cold: boolean): void {
		this.mmu.reset(cold);
		this.anticGtia.reset(cold);
		this.pia.reset(cold);
		this.pokey.reset(cold);
	}

	/**
	 * POKEY's audio output level (0-60) as of the last cycle - a re-export of
	 * {@link Pokey.audio} for the host's per-cycle sampling.
	 */
	get audio(): number {
		return this.pokey.audio;
	}

	/**
	 * Optional hook fired at each committed opcode fetch, with the opcode's
	 * address - for tracing / instruction-level debugging. Forwarded to the
	 * CPU's `onFetch`; see {@link Sfotty.onFetch} for the exact semantics.
	 */
	get onInstruction(): ((pc: number) => void) | undefined {
		return this.cpu.onFetch;
	}
	set onInstruction(fn: ((pc: number) => void) | undefined) {
		this.cpu.onFetch = fn;
	}

	/**
	 * Run one whole machine cycle: ANTIC scheduling (`beforeCpu`, commits) + the
	 * POKEY tick, then the bus phase (ANTIC's DMA fetch or the CPU's access) and
	 * the render. Sample {@link audio} afterwards for POKEY's output level.
	 *
	 * A bus phase may **throw** - an interceptor suspending on a read/write/fetch,
	 * or a host's own breakpoint signal. This method does not catch it: the throw
	 * propagates with the cycle frozen at that phase. The host catches whatever it
	 * threw, resolves it (await input, clear a breakpoint, ...), and calls
	 * {@link resumeCycle} to finish the *same* cycle - never `cycle`,
	 * which would re-run the committed scheduling. Idempotent by construction:
	 * each bus phase does its access before any commit, so a throw unwinds clean
	 * and the retried access repeats nothing.
	 */
	cycle(): void {
		if (this.#phase !== PHASE.IDLE) {
			throw new Error("cycle() called mid-cycle - use resumeCycle()");
		}
		this.anticGtia.beforeCpu();
		this.pokey.cycle();
		this.#phase = PHASE.BUS;
		this.#runCycle();
	}

	/** Finish a cycle that a bus phase suspended; see {@link cycle}. */
	resumeCycle(): void {
		this.#runCycle();
	}

	// The phase machine shared by cycle/resumeCycle: a fall-through
	// switch that enters at the saved #phase and runs forward to the end of the
	// cycle. The marker is set to the current phase *before* each throwable call,
	// so a throw leaves it pointing where to resume.
	#runCycle(): void {
		switch (this.#phase) {
			case PHASE.BUS:
				this.anticGtia.busCycle(); // ANTIC DMA read - may throw
				this.cpu.NMI = this.anticGtia.nmi;
				// The CPU sees the wire-ORed /IRQ line as of the end of the
				// previous cycle: the open-collector line settles across a
				// phase boundary, one cycle of propagation the 6502 never
				// sees around (Acid800 pokey_irqtiming pins the total
				// IRQST-to-acknowledge latency this produces).
				this.cpu.IRQ = this.#irqLine;
				this.cpu.RDY = this.anticGtia.rdy;
				this.#phase = PHASE.CPU;
			// falls through
			case PHASE.CPU:
				if (this.resetAsserted) this.cpu.reset(false);
				else if (!this.anticGtia.halt) this.cpu.run(); // may throw
				this.anticGtia.afterCpu(this.frame, this.busData);
				this.#irqLine = this.irq;
				this.#phase = PHASE.IDLE;
		}
	}

	// The /IRQ line as sampled at the end of the last completed cycle.
	#irqLine = false;

	/**
	 * The IRQ output line: POKEY and the PIA's two IRQ outputs, wire-ORed
	 * like the hardware. Copy to the CPU's IRQ input every cycle.
	 */
	get irq(): boolean {
		return this.pokey.irq || this.pia.irqA || this.pia.irqB;
	}

	/**
	 * True while the Reset key holds the XL/XE system reset line (the
	 * {@link console} connector's reset signal). The host must keep the CPU
	 * in reset - `cpu.reset(false)` instead of `run()` - every cycle while
	 * this is set. Always false on the 800, whose Reset key is an NMI
	 * instead.
	 */
	get resetAsserted(): boolean {
		return this.#resetHeld;
	}

	/**
	 * Press a keyboard matrix key. `code` is the full KBCODE byte: the 6-bit
	 * matrix scan code with bit 6 (Shift) and bit 7 (Ctrl) composed by the
	 * host. The key registers update and the keyboard IRQ fires immediately -
	 * there is no scan timing yet.
	 */
	pokeyKeyDown(code: number): void {
		this.pokey.keyDown(code);
	}

	/**
	 * Release the keyboard matrix key. POKEY only tracks one key, so with
	 * several host keys held, call this when the last one is released.
	 */
	pokeyKeyUp(): void {
		this.pokey.keyUp();
	}

	/**
	 * Press the Shift key. Drives the SKSTAT shift sense only - the Shift bit
	 * inside KBCODE comes from {@link pokeyKeyDown}'s `code`, and the two may
	 * disagree, just like on real hardware mid-scan.
	 */
	shiftKeyDown(): void {
		this.pokey.shiftKeyDown();
	}

	/** Release the Shift key. */
	shiftKeyUp(): void {
		this.pokey.shiftKeyUp();
	}

	/**
	 * Press the Break key. There is no key-up: a Break release is not
	 * observable by software.
	 */
	breakKeyDown(): void {
		this.pokey.breakKeyDown();
	}

	/**
	 * Trap a memory access. Interceptors run before the access and may
	 * short-circuit it (return a substitute read value / true to suppress a
	 * write); observers run after and only watch. Both phases are additive and
	 * run last-registered-first; the first interceptor to return a value wins.
	 * An optional `mask` filters by access flags (default `{ dummy: false }`);
	 * `interceptExecute`/`observeExecute` are sugar for a read masked to a
	 * committed opcode fetch. Each returns a handle to unregister. A committed
	 * opcode fetch can't repeat under a WSYNC stall (the stall re-fetch is
	 * DUMMY), so execute traps fire once. See [traps](../../notes.local/traps.md).
	 */
	interceptExecute(
		address: number,
		fn: ExecuteInterceptor,
		opts?: { once?: boolean },
	): TrapHandle {
		return this.mmu.interceptExecute(address, fn, opts);
	}

	observeExecute(
		address: number,
		fn: ExecuteObserver,
		opts?: { once?: boolean },
	): TrapHandle {
		return this.mmu.observeExecute(address, fn, opts);
	}

	interceptRead(
		address: number,
		fn: ReadInterceptor,
		opts?: TrapOptions,
	): TrapHandle {
		return this.mmu.interceptRead(address, fn, opts);
	}

	observeRead(
		address: number,
		fn: ReadObserver,
		opts?: TrapOptions,
	): TrapHandle {
		return this.mmu.observeRead(address, fn, opts);
	}

	interceptWrite(
		address: number,
		fn: WriteInterceptor,
		opts?: TrapOptions,
	): TrapHandle {
		return this.mmu.interceptWrite(address, fn, opts);
	}

	observeWrite(
		address: number,
		fn: WriteObserver,
		opts?: TrapOptions,
	): TrapHandle {
		return this.mmu.observeWrite(address, fn, opts);
	}

	/**
	 * Insert (or replace) the D1: disk image the built-in SIO serves. Pass it
	 * before booting a disk; with none inserted, SIO requests time out and the
	 * OS falls through to its other boot sources.
	 */
	insertDisk(disk: AtrImage): void {
		this.#disk = disk;
	}

	/**
	 * Eject the D1: disk. Safe to call on a running machine: SIO requests then
	 * time out and the OS falls through to its other boot sources.
	 */
	ejectDisk(): void {
		this.#disk = undefined;
	}
}
