import { ReadOptions, type Memory } from "@sfotty-pie/sfotty";
import { AnticGtia } from "./antic-gtia.ts";
import { AtariBus } from "./bus-manager.ts";
import { Cartridge } from "./cartridge.ts";
import { Pbi } from "./pbi.ts";
import { Pia } from "./pia.ts";
import { Pokey } from "./pokey.ts";

export type AtariModel = "800" | "800XL";

export interface MachineConfig {
	/** Which machine to emulate. */
	model: AtariModel;
	/** OS ROM: OS-B (10K) for the 800, XL OS (16K) for the 800XL. */
	os: Uint8Array;
	/**
	 * BASIC ROM (8K): an $A000 cartridge on the 800 — omit it to leave the
	 * slot empty — and built-in (so required) on the 800XL.
	 */
	basic?: Uint8Array;
	/**
	 * Cartridge in the (left) slot. On the 800 it takes the slot otherwise
	 * occupied by the BASIC cartridge; on the XL it shadows the built-in
	 * BASIC at $A000.
	 */
	cartridge?: Cartridge;
	/** Debug log sink (used by ANTIC's display list disassembler). */
	log?: (message: string) => void;
}

/**
 * An Atari 8-bit machine (NTSC) built on the {@link AtariBus}, the combined
 * {@link AnticGtia} video chip pair, and stubs for the rest (POKEY/PIA/PBI).
 *
 * - `"800"` — OS-B, 48K, no PORTB banking; BASIC is a standard $A000 8K cart.
 * - `"800XL"` — XL OS, 64K, PORTB banking; BASIC is built in and banked via
 *   PORTB (the OS enables it unless OPTION is held).
 *
 * The host drives the machine one cycle at a time:
 *
 * ```ts
 * machine.anticGtia.beforeCpu();
 * cpu.NMI = machine.anticGtia.nmi;
 * cpu.IRQ = machine.irq;
 * cpu.RDY = machine.anticGtia.rdy;
 * if (machine.resetAsserted) cpu.reset(false);
 * else if (!machine.anticGtia.halt) cpu.run();
 * machine.anticGtia.afterCpu(frame, machine.busData);
 * ```
 *
 * Keyboard input goes through the `pokeyKeyDown`/`pokeyKeyUp` family of
 * methods, joystick input through the `joystick*` family. The machine knows
 * nothing about host key assignments — mapping host keys to matrix codes or
 * joystick lines (layouts, special key bindings) is entirely the host's
 * business.
 */
export class Atari implements Memory {
	readonly anticGtia: AnticGtia;

	readonly #bus: AtariBus;
	readonly #pia: Pia;
	readonly #pokey: Pokey;
	readonly #xl: boolean;
	#resetHeld = false;

	constructor(config: MachineConfig) {
		const { model, os, basic, cartridge, log } = config;
		const xl = model === "800XL";
		this.#xl = xl;

		if (xl && !basic) {
			throw new Error("The 800XL requires a BASIC ROM — it's built in");
		}

		// The dmaRead closure reads #bus lazily, resolving the chip/bus
		// construction cycle.
		this.anticGtia = new AnticGtia(
			{
				dmaRead: (address) => this.#bus.read(address, ReadOptions.DMA),
				log: log ?? (() => {}),
			},
			{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
		);

		this.#pia = new Pia();
		this.#pokey = new Pokey();

		this.#bus = new AtariBus({
			portbBanking: xl,
			conventionalRamSize: xl ? 64 : 48,
			xeBankCount: 0,
			separateAnticAccess: false,
			osRom: os,
			// 800XL: built-in BASIC, banked in via PORTB. 800: BASIC as a cart —
			// displaced when a game cartridge is in the slot.
			basicRom: xl ? basic : undefined,
			cartridge: cartridge ?? (!xl && basic ? new Cartridge(basic) : undefined),
			gtia: this.anticGtia,
			pokey: this.#pokey,
			pia: this.#pia,
			antic: this.anticGtia,
			pbi: new Pbi(),
		});
	}

	/** The last value driven on the data bus (see {@link AtariBus.busData}). */
	get busData(): number {
		return this.#bus.busData;
	}

	read(address: number, options: ReadOptions): number {
		return this.#bus.read(address, options);
	}

	write(address: number, value: number): void {
		this.#bus.write(address, value);
	}

	reset(cold: boolean): void {
		this.#bus.reset(cold);
		this.anticGtia.reset(cold);
		this.#pia.reset(cold);
		this.#pokey.reset(cold);
	}

	/**
	 * The IRQ output line: POKEY and the PIA's two IRQ outputs, wire-ORed
	 * like the hardware. Copy to the CPU's IRQ input every cycle.
	 */
	get irq(): boolean {
		return this.#pokey.irq || this.#pia.irqA || this.#pia.irqB;
	}

	/**
	 * True while the Reset button holds the XL/XE system reset line. The host
	 * must keep the CPU in reset — `cpu.reset(false)` instead of `run()` —
	 * every cycle while this is set. Always false on the 800, whose Reset key
	 * is an NMI instead (see {@link resetButtonDown}).
	 */
	get resetAsserted(): boolean {
		return this.#resetHeld;
	}

	/**
	 * Press a keyboard matrix key. `code` is the full KBCODE byte: the 6-bit
	 * matrix scan code with bit 6 (Shift) and bit 7 (Ctrl) composed by the
	 * host. The key registers update and the keyboard IRQ fires immediately —
	 * there is no scan timing yet.
	 */
	pokeyKeyDown(code: number): void {
		this.#pokey.keyDown(code);
	}

	/**
	 * Release the keyboard matrix key. POKEY only tracks one key, so with
	 * several host keys held, call this when the last one is released.
	 */
	pokeyKeyUp(): void {
		this.#pokey.keyUp();
	}

	/**
	 * Press the Shift key. Drives the SKSTAT shift sense only — the Shift bit
	 * inside KBCODE comes from {@link pokeyKeyDown}'s `code`, and the two may
	 * disagree, just like on real hardware mid-scan.
	 */
	shiftKeyDown(): void {
		this.#pokey.shiftKeyDown();
	}

	/** Release the Shift key. */
	shiftKeyUp(): void {
		this.#pokey.shiftKeyUp();
	}

	/**
	 * Press the Break key. There is no key-up: a Break release is not
	 * observable by software.
	 */
	breakKeyDown(): void {
		this.#pokey.breakKeyDown();
	}

	/**
	 * Press console keys. `mask` is a set of CONSOL bits: 1 = Start,
	 * 2 = Select, 4 = Option. Several can be pressed at once (CONSOL itself
	 * is active low; the mask here is "1 = press").
	 */
	consoleKeyDown(mask: number): void {
		this.anticGtia.console &= ~mask;
	}

	/** Release console keys. Takes the same mask as {@link consoleKeyDown}. */
	consoleKeyUp(mask: number): void {
		this.anticGtia.console |= mask & 0x07;
	}

	/**
	 * Register an execute trap: when the CPU fetches an opcode from
	 * `address`, `callback` runs first. It may perform host-side work and
	 * return a substitute opcode (typically $60, RTS) — or `undefined` to
	 * fall through to the real memory. One trap per address; used for OS
	 * entry points like SIOV (see `createSioHandler`). A WSYNC stall can
	 * repeat the trapped fetch, so callbacks must be idempotent.
	 */
	addExecuteTrap(
		address: number,
		callback: (address: number) => number | undefined,
	): void {
		this.#bus.addTrap(address, callback);
	}

	/**
	 * Press joystick directions. `port` is 0-1 on the XL (two jacks) and 0-3
	 * on the 800, whose ports 2/3 live on PIA port B; presses on ports the
	 * machine doesn't have are ignored. `mask` is a set of direction bits:
	 * 1 = up, 2 = down, 4 = left, 8 = right. The PIA lines are active low;
	 * the mask here is "1 = press". The hardware can't stop opposite
	 * directions being pressed at once; avoiding them is the host's call.
	 */
	joystickDown(port: number, mask: number): void {
		if (!this.#hasJoystickPort(port)) return;
		this.#moveStick(port, this.#sticks[port]! | (mask & 0x0f));
	}

	/** Release joystick directions. Takes the same mask as
	 * {@link joystickDown}. */
	joystickUp(port: number, mask: number): void {
		if (!this.#hasJoystickPort(port)) return;
		this.#moveStick(port, this.#sticks[port]! & ~mask);
	}

	/** Press the joystick trigger on `port` (drives the GTIA TRIG line low). */
	joystickTriggerDown(port: number): void {
		this.#setTrigger(port, 0);
	}

	/** Release the joystick trigger on `port`. */
	joystickTriggerUp(port: number): void {
		this.#setTrigger(port, 1);
	}

	// Pressed-direction masks per port; the inverse of the PIA nibbles.
	readonly #sticks = [0, 0, 0, 0];

	#hasJoystickPort(port: number): boolean {
		return port >= 0 && port < (this.#xl ? 2 : 4);
	}

	#moveStick(port: number, mask: number): void {
		this.#sticks[port] = mask;
		if (port < 2) {
			this.#pia.portaIn.value =
				~((this.#sticks[1]! << 4) | this.#sticks[0]!) & 0xff;
		} else {
			this.#pia.portbIn.value =
				~((this.#sticks[3]! << 4) | this.#sticks[2]!) & 0xff;
		}
	}

	#setTrigger(port: number, value: number): void {
		if (!this.#hasJoystickPort(port)) return;
		switch (port) {
			case 0:
				this.anticGtia.trig0 = value;
				break;
			case 1:
				this.anticGtia.trig1 = value;
				break;
			case 2:
				this.anticGtia.trig2 = value;
				break;
			default:
				this.anticGtia.trig3 = value;
		}
	}

	/**
	 * Press the Reset key/button.
	 *
	 * On the 800 it drives ANTIC's RNMI line: a non-maskable NMI fires at the
	 * next VBLANK with NMIST bit 5 set, the OS warmstarts in software, and
	 * nothing is hardware-reset.
	 *
	 * On the XL it pulses the system reset line: the soft-resettable
	 * components reset immediately (notably the PIA, which banks the OS ROM
	 * and BASIC back in) and {@link resetAsserted} stays true until
	 * {@link resetButtonUp} so the host holds the CPU's RES line.
	 */
	resetButtonDown(): void {
		if (this.#xl) {
			this.reset(false);
			this.#resetHeld = true;
		} else {
			this.anticGtia.rnmi = true;
		}
	}

	/** Release the Reset key/button. */
	resetButtonUp(): void {
		this.#resetHeld = false;
		this.anticGtia.rnmi = false;
	}
}
