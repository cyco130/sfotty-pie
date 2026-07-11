import { Sfotty } from "@sfotty-pie/sfotty";
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
import { builtinSlotRom, type Cartridge } from "./cartridge.ts";
import { ConsolePanel } from "./console-panel.ts";
import { JoystickConnector } from "./joystick-connector.ts";
import { Keyboard } from "./keyboard.ts";
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

/**
 * Where {@link Atari.cycle} is within one machine cycle. A throw from a bus
 * phase (ANTIC's DMA read in BUS, the CPU's access in CPU) leaves the marker
 * on that phase, so the next cycle() call re-enters there without re-running
 * the committed beforeCpu. A const object, not an enum (enums emit runtime
 * code, which this repo's strip-only TS execution rejects).
 */
export const PHASE = { IDLE: 0, BUS: 1, CPU: 2 } as const;

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
	 * Built-in BASIC ROM (8K), PORTB-banked - XL/XE only (the 1200XL has
	 * none). Ignored on the 400/800, where BASIC is an ordinary $A000
	 * cartridge: attach it via the {@link Atari.cartridge} accessor like any
	 * cart. Disabling built-in BASIC (holding OPTION through boot) is the
	 * host's business.
	 */
	basic?: Uint8Array;
	/** Built-in game ROM (8K), PORTB-banked - the XEGS. Requires `xl`. */
	game?: Uint8Array;
	/**
	 * Wire the keyboard's presence sense to GTIA TRIG2, like the XEGS does
	 * for its detachable keyboard: TRIG2 reads 1 with the keyboard attached,
	 * 0 without (see {@link Keyboard.attached}). Only honored with `xl`; the
	 * other XL/XE leave T2 disconnected (reads 1), and on the 400/800 it is
	 * joystick 2's trigger.
	 */
	keyboardSense?: boolean;
	/** Debug log sink (used by ANTIC's display list disassembler). */
	log?: (message: string) => void;
}

/**
 * An Atari 8-bit machine (NTSC or PAL) built on the {@link Mmu}, the
 * combined {@link AnticGtia} video chip pair, POKEY, and the PIA. Classic
 * machines as {@link MachineConfig} recipes:
 *
 * - an 800 - OS-B, 48K, no PORTB banking; BASIC is a standard $A000 8K cart
 *   the host attaches via {@link cartridge}.
 * - an 800XL - `xl`, XL OS, 64K, PORTB banking; BASIC is built in and banked
 *   via PORTB (the OS enables it unless OPTION is held).
 * - a 130XE - the XL plus `xeBankCount: 4` (four 16K banks at $4000-$7FFF via
 *   PORTB bits 2-3) and `separateAnticAccess` (bits 4/5).
 *
 * The host drives the machine one cycle at a time via {@link cycle}, which
 * runs ANTIC scheduling, the bus phase (ANTIC DMA or the CPU), and the
 * render. A bus phase may throw to suspend; the host catches it, resolves
 * it, and calls {@link cycle} again, which picks up the same cycle where it
 * left off:
 *
 * ```ts
 * try {
 * 	machine.cycle();
 * } catch (signal) {
 * 	// resolve the suspend (await input, clear a breakpoint, ...)
 * 	machine.cycle();
 * }
 * // read machine.frame for video and machine.audio for sound
 * ```
 *
 * Keyboard input goes through the {@link keyboard} matrix device: press
 * and release 6-bit scan codes and meta lines (Shift/Control/Break). POKEY
 * scans the matrix at 15KHz like the real chip, so KBCODE, the senses, the
 * IRQs, and debounce all follow from the scan - a debounced press registers
 * within ~8ms, and only while the OS has the scan enabled (SKCTL bit 1). Joystick input goes through the
 * {@link joysticks} connectors - plug a {@link Joystick} device into one and
 * drive the device. The machine knows nothing about host key assignments -
 * mapping host keys to matrix codes or joystick lines (layouts, special key
 * bindings) is entirely the host's business.
 */
export class Atari {
	// The host surface: connectors (devices plug in) and the built-in
	// controls (the console panel; the cartridge accessor below).
	readonly joysticks: readonly JoystickConnector[];
	readonly console: ConsolePanel;
	readonly keyboard: Keyboard;

	get cartridge(): Cartridge | undefined {
		return this.#cartridge;
	}
	set cartridge(cart: Cartridge | undefined) {
		this.#setCartridge(cart);
	}

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

	/**
	 * The cycle phase machine's continuation marker - one of {@link PHASE}.
	 * IDLE between cycles, BUS/CPU while a cycle is suspended mid-phase.
	 * Public for debug consumers; treat as read-only.
	 */
	phase: number = PHASE.IDLE;

	constructor(config: MachineConfig) {
		const { os, basic, game, log } = config;
		const xl = config.xl ?? false;
		this.#xl = xl;

		const tvSystem = config.tvSystem ?? "ntsc";

		// The Mmu is built first - bare geometry, no chips - so ANTIC and the
		// CPU can take it as their bus; connect() below wires the ROMs and
		// chip select routing once the chips exist.
		this.mmu = new Mmu({
			portbBanking: xl,
			conventionalRamSize: config.conventionalRamSize ?? (xl ? 64 : 48),
			xeBankCount: config.xeBankCount ?? 0,
			separateAnticAccess: config.separateAnticAccess ?? false,
		});

		this.anticGtia = new AnticGtia(
			{
				bus: this.mmu,
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

		this.mmu.connect({
			osRom: os,
			// XL/XE: built-in BASIC and game, banked in via PORTB - each accepts a
			// raw 8K ROM or a standard-8K `.car` (unwrapped here).
			basicRom: xl && basic ? builtinSlotRom(basic) : undefined,
			gameRom: game ? builtinSlotRom(game) : undefined,
			gtia: this.anticGtia,
			pokey: this.pokey,
			pia: this.pia,
			antic: this.anticGtia,
			pbi: new Pbi(),
		});

		this.joysticks = this.#connectJoystickConnectors();
		this.console = this.#connectConsolePanel();
		// The keyboard plugs straight into POKEY's scanner seam: the chip
		// addresses the matrix at 15KHz and everything (KBCODE, the senses,
		// debounce, Break) follows from the scan.
		this.keyboard = new Keyboard();
		this.pokey.keyboard = this.keyboard;
		if (xl && config.keyboardSense) {
			// XEGS: the keyboard-presence sense line lands on GTIA TRIG2.
			this.anticGtia.trig2 = this.keyboard.attached.value ? 1 : 0;
			this.keyboard.attached.watch((source) => {
				this.anticGtia.trig2 = source.value ? 1 : 0;
			});
		}

		// The slot starts empty, via the accessor: on XL/XE that drives the
		// cartridge sense (TRIG3) low, which GTIA's own power-on default
		// leaves high. Hosts attach cartridges - BASIC included, on the
		// 400/800 - through the same accessor.
		this.#setCartridge(undefined);

		// The CPU reads and writes through the trap-aware Mmu directly.
		// Constructed last, once the bus is wired. Powers on into the reset
		// sequence like real hardware.
		this.cpu = new Sfotty(this.mmu);

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

	// The console shell's controls are part of the machine, not a socketed
	// device - no connector layer. This is the only place that knows which
	// chip ends the panel's wires land on.
	#connectConsolePanel(): ConsolePanel {
		return new ConsolePanel({
			gtia: this.anticGtia,
			// The LED lines sit on PIA PB2/PB3. Physically a 1200XL feature,
			// but the wires are ordinary port pins, so every XL/XE gets
			// them; on the 400/800 port B belongs to joysticks 2/3.
			pia: this.#xl ? this.pia : undefined,
			// The power switch cold-resets every component, the CPU included.
			powerCycle: () => {
				this.#reset(true);
				this.cpu.reset(true);
			},
			// The Reset key. XL/XE: the system reset line soft-resets the
			// components immediately and holds the CPU's RES until released
			// (see resetAsserted). 400/800: it drives ANTIC's RNMI instead -
			// a software warmstart, nothing is hardware-reset.
			setReset: (pressed) => {
				if (this.#xl) {
					if (pressed) {
						this.#reset(false);
						this.#resetHeld = true;
					} else {
						this.#resetHeld = false;
					}
				} else {
					this.anticGtia.rnmi = pressed;
				}
			},
		});
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
	 * The audio level as summed on the board, as of the last cycle: POKEY's
	 * output ({@link Pokey.audio}, normalized to 0-1) plus the console
	 * speaker line (0 or 1), so the range is 0-2 with one unit per source.
	 * The host samples this after each cycle and applies its own gain. Equal
	 * source weighting is provisional until the analog audio path (amplifier
	 * stages, saturation) is modeled.
	 */
	get audio(): number {
		return this.pokey.audio / 60 + this.anticGtia.consoleSpeaker;
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
	 * propagates with the cycle frozen at that phase. The host catches whatever
	 * it threw, resolves it (await input, clear a breakpoint, ...), and calls
	 * cycle() again - the call picks up the *same* suspended cycle where it left
	 * off rather than starting a new one. Idempotent by construction: each bus
	 * phase does its access before any commit, so a throw unwinds clean and the
	 * retried access repeats nothing.
	 */
	cycle(): void {
		// The phase machine: a fall-through switch entered at the saved
		// phase - IDLE starts a fresh cycle, BUS/CPU resume a suspended one.
		// The marker is set to the current phase *before* each throwable
		// call, so a throw leaves it pointing where to resume.
		switch (this.phase) {
			case PHASE.IDLE:
				this.anticGtia.beforeCpu();
				this.pokey.cycle();
				this.pia.cycle();
				this.phase = PHASE.BUS;

			// falls through
			case PHASE.BUS:
				this.anticGtia.busPhase(); // ANTIC DMA read - may throw
				this.cpu.NMI = this.anticGtia.nmi;
				// The CPU sees the wire-ORed /IRQ line as of the end of the
				// previous cycle: the open-collector line settles across a
				// phase boundary, one cycle of propagation the 6502 never
				// sees around (Acid800 pokey_irqtiming pins the total
				// IRQST-to-acknowledge latency this produces).
				this.cpu.IRQ = this.#irqLine;
				this.cpu.RDY = this.anticGtia.rdy;
				this.phase = PHASE.CPU;

			// falls through
			case PHASE.CPU:
				if (this.resetAsserted) this.cpu.reset(false);
				else if (!this.anticGtia.halt) this.cpu.cycle(); // may throw
				this.anticGtia.afterCpu(this.frame, this.mmu.busData);
				this.#irqLine = this.irq;
				this.phase = PHASE.IDLE;
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

	#cartridge: Cartridge | undefined;
	#unwatchCartMapping: (() => void) | undefined;

	/**
	 * Insert, remove, or replace the cartridge - the electrical swap only,
	 * exactly like pushing a cart into a running machine: nothing is reset.
	 * Hosts should power-cycle after swapping for now; the OS's own hot-swap
	 * reaction (the GINTLK interlock forcing a cold start) is what a real
	 * machine does, but a8 hosts don't rely on it yet.
	 */
	#setCartridge(cartridge: Cartridge | undefined) {
		this.#unwatchCartMapping?.();
		this.#unwatchCartMapping = undefined;
		this.#cartridge = cartridge;
		this.mmu.setCartridge(cartridge ?? null);

		// On XL/XE, TRIG3 ($D013) senses the cartridge line (RD5) live: 1 =
		// cartridge ROM present at $A000-$BFFF, 0 = absent - including a
		// cartridge that banks itself out via CCTL. The OS reads it (against
		// the stored GINTLK) to cold-start on a hot swap, and to skip the
		// cartridge checksum entirely when the slot is empty - without this
		// (TRIG3 stuck at 1) every Reset runs that checksum, which then fails
		// on the BASIC/RAM banking and forces a cold start. On the 800 TRIG3
		// is joystick 4's trigger and stays as-is.
		if (this.#xl) {
			this.#updateCartridgeSense();
			this.#unwatchCartMapping = cartridge?.mappingChanged.watch(() =>
				this.#updateCartridgeSense(),
			);
		}
	}

	#updateCartridgeSense(): void {
		this.anticGtia.trig3 = this.#cartridge?.hasA000ToBfff ? 1 : 0;
	}
}
