import type { Memory } from "@sfotty-pie/sfotty";
import { DelayLine } from "./delay-line.ts";
import {
	NTSC_LINES_PER_FRAME,
	PAL_LINES_PER_FRAME,
} from "./timing-constants.ts";

// NMI delay-line ops: the line drop two cycles after a rise, and the
// delayed rise from a late NMIEN enable.
const OP_NMI_DROP = 0x01;
const OP_NMI_RISE = 0x02;

interface AnticGtiaConfig {
	dmaRead: (address: number) => number;
	log: (message: string) => void;
}

interface AnticGtiaOptions {
	anticTvSystem: "ntsc" | "pal";
	gtiaTvSystem: "ntsc" | "pal";
}

// What the GTIA color registers hold at power-on: a dark brown (hue $F,
// minimum luminance). Observed behavior, not documented.
const POWER_ON_COLOR = 0xf0;

export class AnticGtia implements Memory {
	// NMIEN bits
	vbiEnabled = false;
	dliEnabled = false;

	// NMIST bits
	res = true;
	vbi = false;
	dli = false;

	// VCOUNT
	vcount = 0;

	// DMACTL bits
	playfieldWidth: 0 | 1 | 2 | 3 = 0;
	displayListDmaEnabled = false;
	playerDmaEnabled = false;
	missileDmaEnabled = false;
	verticalPmResolution: 1 | 2 = 1;

	// DLIST address
	displayListAddress = 0;
	lastDisplayListAddress = 0;
	#temp = 0;

	hscrol = 0;

	// CHBASE
	chbase = 0;

	// PMBASE
	pmbase = 0;

	// Memory scan counter
	msc = 0;

	// wsync
	wsync = false;
	// A WSYNC write landing while the stall is already armed (an RMW
	// instruction's double write) pushes the release one cycle later.
	wsyncLate = false;

	// Internal
	instruction: number = 0;
	hires = false;
	modeLineNo = 0;
	modeLineHeight = 1;
	charFetchRate = 0;
	playfieldFetchRate = 0;

	hpos: number = 0;
	refreshPending = false;

	// Color registers
	colpm0 = POWER_ON_COLOR;
	colpm1 = POWER_ON_COLOR;
	colpm2 = POWER_ON_COLOR;
	colpm3 = POWER_ON_COLOR;
	colpf0 = POWER_ON_COLOR;
	colpf1 = POWER_ON_COLOR;
	colpf2 = POWER_ON_COLOR;
	colpf3 = POWER_ON_COLOR;
	colbk = POWER_ON_COLOR;

	// P/M Horizontal positions
	hposp0 = 0;
	hposp1 = 0;
	hposp2 = 0;
	hposp3 = 0;
	hposm0 = 0;
	hposm1 = 0;
	hposm2 = 0;
	hposm3 = 0;

	// P/M data
	grafP0 = 0;
	grafP1 = 0;
	grafP2 = 0;
	grafP3 = 0;
	grafM = 0;

	// Collision registers
	m0pf = 0;
	m1pf = 0;
	m2pf = 0;
	m3pf = 0;

	p0pf = 0;
	p1pf = 0;
	p2pf = 0;
	p3pf = 0;

	// The player collision latches power on all-set (minus the self bits);
	// the playfield ones power on clear. Observed behavior (Altirra).
	m0pl = 0x0f;
	m1pl = 0x0f;
	m2pl = 0x0f;
	m3pl = 0x0f;

	p0pl = 0x0e;
	p1pl = 0x0d;
	p2pl = 0x0b;
	p3pl = 0x07;

	prior = 0x0f;

	vdelay = 0x0f;

	// GRACTL bits
	enablePlayers = false;
	enableMissiles = false;

	// Console keys
	console = 7;
	forceConsole: number | null = null; // Option
	consoleSpeaker = 0;
	// The written CONSOL latch: bits 0-2 actively pull the (open-collector)
	// switch lines low. It powers on all-set, so CONSOL reads 0 until the OS
	// writes CONSOL.
	consolWritten = 0x07;

	// Triggers (inputs, pulled up). TODO: trig3 should track the cartridge
	// sense line (RD5) on XL/XE instead of staying constant.
	trig0 = 1;
	trig1 = 1;
	trig2 = 1;
	trig3 = 1;

	anticLineCount: number;
	#gtiaPal: number;

	constructor(
		{ dmaRead, log }: AnticGtiaConfig,
		initialOptions: AnticGtiaOptions,
	) {
		this.#dmaRead = dmaRead;
		this.#log = log;

		this.anticLineCount =
			initialOptions.anticTvSystem === "pal"
				? PAL_LINES_PER_FRAME
				: NTSC_LINES_PER_FRAME;
		this.#gtiaPal = initialOptions.gtiaTvSystem === "pal" ? 0x1 : 0xf;
	}

	setOptions(options: AnticGtiaOptions) {
		this.anticLineCount =
			options.anticTvSystem === "pal"
				? PAL_LINES_PER_FRAME
				: NTSC_LINES_PER_FRAME;
		this.#gtiaPal = options.gtiaTvSystem === "pal" ? 0x1 : 0xf;
	}

	reset(cold: boolean): void {
		// ANTIC has a reset line, so it reinitializes on warm resets too. GTIA
		// has no reset line; only a power cycle clears it.
		this.#resetAntic();
		if (cold) {
			this.#resetGtia();
		}
	}

	// Keep the assignments in sync with the field initializers.
	#resetAntic(): void {
		// NMIEN
		this.vbiEnabled = false;
		this.dliEnabled = false;

		// NMIST
		this.res = true;
		this.vbi = false;
		this.dli = false;

		this.vcount = 0;

		// DMACTL
		this.playfieldWidth = 0;
		this.displayListDmaEnabled = false;
		this.playerDmaEnabled = false;
		this.missileDmaEnabled = false;
		this.verticalPmResolution = 1;

		this.displayListAddress = 0;
		this.lastDisplayListAddress = 0;
		this.#temp = 0;

		this.hscrol = 0;
		this.chbase = 0;
		this.pmbase = 0;
		this.msc = 0;

		this.wsync = false;
		this.wsyncLate = false;

		this.instruction = 0;
		this.hires = false;
		this.modeLineNo = 0;
		this.modeLineHeight = 1;
		this.charFetchRate = 0;
		this.playfieldFetchRate = 0;

		this.hpos = 0;
		this.refreshPending = false;
		this.waitingForVbi = false;

		this.pfPixels.fill(0);
		this.pfCounter = 0;

		// Output lines
		this.nmi = false;
		this.#nmiDelay.reset();
		this.halt = false;
		this.rdy = true;
	}

	// Keep the assignments in sync with the field initializers. Inputs (console
	// keys, triggers) reflect physical switches and are left alone.
	#resetGtia(): void {
		this.colpm0 = POWER_ON_COLOR;
		this.colpm1 = POWER_ON_COLOR;
		this.colpm2 = POWER_ON_COLOR;
		this.colpm3 = POWER_ON_COLOR;
		this.colpf0 = POWER_ON_COLOR;
		this.colpf1 = POWER_ON_COLOR;
		this.colpf2 = POWER_ON_COLOR;
		this.colpf3 = POWER_ON_COLOR;
		this.colbk = POWER_ON_COLOR;

		this.hposp0 = 0;
		this.hposp1 = 0;
		this.hposp2 = 0;
		this.hposp3 = 0;
		this.hposm0 = 0;
		this.hposm1 = 0;
		this.hposm2 = 0;
		this.hposm3 = 0;

		this.grafP0 = 0;
		this.grafP1 = 0;
		this.grafP2 = 0;
		this.grafP3 = 0;
		this.grafM = 0;

		this.m0pf = 0;
		this.m1pf = 0;
		this.m2pf = 0;
		this.m3pf = 0;
		this.p0pf = 0;
		this.p1pf = 0;
		this.p2pf = 0;
		this.p3pf = 0;
		this.m0pl = 0x0f;
		this.m1pl = 0x0f;
		this.m2pl = 0x0f;
		this.m3pl = 0x0f;
		this.p0pl = 0x0e;
		this.p1pl = 0x0d;
		this.p2pl = 0x0b;
		this.p3pl = 0x07;

		this.prior = 0x0f;
		this.vdelay = 0x0f;

		// GRACTL
		this.enablePlayers = false;
		this.enableMissiles = false;

		this.consoleSpeaker = 0;
		this.consolWritten = 0x07;

		this.#sizeP0 = 1;
		this.#sizeP0Counter = 0;
		this.#shiftP0 = 0;
		this.#sizeP1 = 1;
		this.#sizeP1Counter = 0;
		this.#shiftP1 = 0;
		this.#sizeP2 = 1;
		this.#sizeP2Counter = 0;
		this.#shiftP2 = 0;
		this.#sizeP3 = 1;
		this.#sizeP3Counter = 0;
		this.#shiftP3 = 0;
		this.#sizeM0 = 1;
		this.#sizeM0Counter = 0;
		this.#shiftM0 = 0;
		this.#sizeM1 = 1;
		this.#sizeM1Counter = 0;
		this.#shiftM1 = 0;
		this.#sizeM2 = 1;
		this.#sizeM2Counter = 0;
		this.#shiftM2 = 0;
		this.#sizeM3 = 1;
		this.#sizeM3Counter = 0;
		this.#shiftM3 = 0;
	}

	#log: (message: string) => void;

	read(address: number): number {
		const high = address >> 8;

		if (high === 0xd0) {
			// GTIA
			address &= 0x1f;
			switch (address) {
				case 0x00:
					return this.m0pf;

				case 0x01:
					return this.m1pf;

				case 0x02:
					return this.m2pf;

				case 0x03:
					return this.m3pf;

				case 0x04:
					return this.p0pf;

				case 0x05:
					return this.p1pf;

				case 0x06:
					return this.p2pf;

				case 0x07:
					return this.p3pf;

				case 0x08:
					return this.m0pl;

				case 0x09:
					return this.m1pl;

				case 0x0a:
					return this.m2pl;

				case 0x0b:
					return this.m3pl;

				case 0x0c:
					return this.p0pl;

				case 0x0d:
					return this.p1pl;

				case 0x0e:
					return this.p2pl;

				case 0x0f:
					return this.p3pl;

				case 0x10:
					return this.trig0;
				case 0x11:
					return this.trig1;
				case 0x12:
					return this.trig2;
				case 0x13:
					return this.trig3;
				case 0x14:
					// PAL
					return this.#gtiaPal;
				case 0x1f:
					// CONSOL: the written latch pulls switch lines low.
					if (this.forceConsole !== null) {
						return this.forceConsole;
					}

					return this.console & ~this.consolWritten & 0x07;
				default:
					// $D015-$D01E have no read register and return $0F.
					return 0x0f;
			}
		} else {
			// ANTIC
			address &= 0xf;

			switch (address) {
				case 0x0b:
					// VCOUNT Vertical count Vertical counter bits 8-1
					return this.#vcountRead();
				case 0x0f:
					// NMIST NMI status
					return (
						(this.dli ? 0x80 : 0) |
						(this.vbi ? 0x40 : 0) |
						(this.res ? 0x20 : 0) |
						0x1f
					);
				default:
					return 0xff;
			}
		}
	}

	write(address: number, value: number): void {
		const high = address >> 8;

		if (high === 0xd0) {
			// GTIA
			address &= 0x1f;
			switch (address) {
				case 0x00:
					this.hposp0 = value;
					break;
				case 0x01:
					this.hposp1 = value;
					break;
				case 0x02:
					this.hposp2 = value;
					break;
				case 0x03:
					this.hposp3 = value;
					break;
				case 0x04:
					this.hposm0 = value;
					break;
				case 0x05:
					this.hposm1 = value;
					break;
				case 0x06:
					this.hposm2 = value;
					break;
				case 0x07:
					this.hposm3 = value;
					break;

				case 0x08:
					// SIZEP0
					this.#sizeP0 = PM_SIZES[value & 0x3]!;
					break;
				case 0x09:
					// SIZEP1
					this.#sizeP1 = PM_SIZES[value & 0x3]!;
					break;
				case 0x0a:
					// SIZEP2
					this.#sizeP2 = PM_SIZES[value & 0x3]!;
					break;
				case 0x0b:
					// SIZEP3
					this.#sizeP3 = PM_SIZES[value & 0x3]!;
					break;
				case 0x0c:
					// SIZEM
					this.#sizeM0 = PM_SIZES[value & 0x3]!;
					this.#sizeM1 = PM_SIZES[(value >> 2) & 0x3]!;
					this.#sizeM2 = PM_SIZES[(value >> 4) & 0x3]!;
					this.#sizeM3 = PM_SIZES[(value >> 6) & 0x3]!;
					break;
				case 0x0d:
					this.grafP0 = value;
					break;
				case 0x0e:
					this.grafP1 = value;
					break;
				case 0x0f:
					this.grafP2 = value;
					break;
				case 0x10:
					this.grafP3 = value;
					break;
				case 0x11:
					this.grafM = value;
					break;

				case 0x12:
					// COLPM0
					this.colpm0 = value;
					break;
				case 0x13:
					// COLPM1
					this.colpm1 = value;
					break;
				case 0x14:
					// COLPM2
					this.colpm2 = value;
					break;
				case 0x15:
					// COLPM3
					this.colpm3 = value;
					break;
				case 0x16:
					// COLPF0
					this.colpf0 = value;
					break;
				case 0x17:
					// COLPF1
					this.colpf1 = value;
					break;
				case 0x18:
					// COLPF2
					this.colpf2 = value;
					break;
				case 0x19:
					// COLPF3
					this.colpf3 = value;
					break;
				case 0x1a:
					// COLBK
					this.colbk = value;
					break;
				case 0x1b:
					// PRIOR
					this.prior = value;
					break;
				case 0x1c:
					// VDELAY
					this.vdelay = value;
					break;
				case 0x1d:
					// GRACTL
					this.enableMissiles = !!(value & 0x01);
					this.enablePlayers = !!(value & 0x02);
					break;
				case 0x1e:
					// HITCLR
					this.m0pf = 0;
					this.m1pf = 0;
					this.m2pf = 0;
					this.m3pf = 0;
					this.p0pf = 0;
					this.p1pf = 0;
					this.p2pf = 0;
					this.p3pf = 0;
					this.m0pl = 0;
					this.m1pl = 0;
					this.m2pl = 0;
					this.m3pl = 0;
					this.p0pl = 0;
					this.p1pl = 0;
					this.p2pl = 0;
					this.p3pl = 0;
					break;
				case 0x1f:
					this.consolWritten = value & 0x07;
					if (value & 0x8) {
						this.consoleSpeaker = 0;
					} else {
						this.consoleSpeaker = 1;
					}
			}
		} else {
			// ANTIC
			address &= 0xf;

			switch (address) {
				case 0x00:
					// DMACTL
					this.playfieldWidth = (value & 0x03) as 0 | 1 | 2 | 3;
					this.displayListDmaEnabled = !!(value & 0x20);
					this.verticalPmResolution = value & 0x10 ? 1 : 2;
					this.missileDmaEnabled = !!(value & 0xc);
					this.playerDmaEnabled = !!(value & 0x8);
					break;

				case 0x02:
					// DLISTL
					this.displayListAddress = (this.displayListAddress & 0xff00) | value;
					break;

				case 0x03:
					// DLISTH
					this.displayListAddress =
						(this.displayListAddress & 0xff) | (value << 8);
					break;

				case 0x04:
					// HSCROL
					this.hscrol = value;
					break;

				case 0x07:
					// PMBASE
					this.pmbase = value;
					break;

				case 0x09:
					// CHBASE
					this.chbase = value;
					break;

				case 0x0a:
					// WSYNC. A second write while the stall is already
					// armed (an RMW instruction's double write) delays the
					// release a cycle — Acid800 antic_wsync's INC check.
					if (this.wsync) this.wsyncLate = true;
					this.wsync = true;
					break;

				case 0x0e: {
					// NMIEN Enable NMI (the reset NMI is not maskable). The
					// cycle-7 arm samples it before any same-cycle write
					// lands, so a write must complete by cycle 6 to make the
					// line's normal cycle-8 pull. An enable landing exactly
					// at cycle 7 — too late for the arm but catching the
					// just-latched status — still fires, as a delayed NMI
					// two cycles after the write; writes from cycle 8 on are
					// too late entirely, and a stale NMIST bit from an
					// earlier line never retriggers (Acid800 dlitiming's
					// delay tests, nmist's cycle-7 check, and blockednmi
					// pin all three).
					const hadDli = this.dliEnabled;
					const hadVbi = this.vbiEnabled;
					this.dliEnabled = !!(value & 0x80);
					this.vbiEnabled = !!(value & 0x40);
					// hpos has already advanced past the write cycle.
					const writeCycle = this.hpos === 0 ? 113 : this.hpos - 1;
					if (
						writeCycle === 7 &&
						((!hadDli && this.dliEnabled && this.#lineLatched & 0x80) ||
							(!hadVbi && this.vbiEnabled && this.#lineLatched & 0x40))
					) {
						this.#nmiDelay.schedule(2, OP_NMI_RISE);
					}
					break;
				}

				case 0x0f:
					// NMIRES Reset NMI status. A status bit that latched on
					// this very cycle survives the reset — on the hardware
					// the set wins the race (Acid800 checks this).
					this.res = !!(this.#justLatched & 0x20);
					this.vbi = !!(this.#justLatched & 0x40);
					this.dli = !!(this.#justLatched & 0x80);
					break;
			}
		}
	}

	waitingForVbi = false;

	// Playfield data, right to left
	// 00: BK; 8..B: PF0..PF3; C..F: Hires 00..11
	pfPixels = new Uint8Array(16);
	pfCounter = 0;

	/** ANTIC's NMI output line. Copy to the CPU's NMI input every cycle. */
	nmi = false;

	// NMIST bits that latched during the current cycle's beforeCpu — a
	// same-cycle NMIRES write must not clear them.
	#justLatched = 0;

	// This line's latched bits and the NMI pull decision, armed at the latch
	// cycle (7) and acted on at the pull cycle (8).
	#lineLatched = 0;
	#armedNmi = false;

	// NMI line events: every rise schedules its drop two cycles later
	// (ANTIC holds the line for two cycles), and a late NMIEN enable
	// schedules a delayed rise.
	#nmiDelay = new DelayLine(8);

	/**
	 * The RNMI input line: the 400/800 Reset key (not wired up on XL/XE,
	 * where the Reset button pulses the system reset line instead). Sampled
	 * at the VBLANK NMI point — the reset NMI fires alongside the VBI, never
	 * mid-frame — and cannot be masked through NMIEN; NMIST bit 5 reports it.
	 */
	rnmi = false;

	/**
	 * True when ANTIC owns the bus this cycle (DMA fetch or DRAM refresh): the
	 * CPU is halted and `run()` must not be called. A WSYNC stall is different —
	 * it pulls `rdy` low instead, and the CPU still runs, repeating its stalled
	 * read on the bus every cycle.
	 */
	halt = false;

	/** The RDY output line: false while a WSYNC stall is in effect. */
	rdy = true;

	/**
	 * The VCOUNT register value as the CPU sees it mid-cycle. The hardware
	 * line counter increments at the end of cycle 110 but only rolls over at
	 * the end of cycle 111 — so on the last line of the frame there is a
	 * one-cycle window (cycle 111) where it reads the full line count
	 * (262 NTSC / 312 PAL, i.e. $83/$9C after the >> 1).
	 */
	#vcountRead(): number {
		// Reconstruct the cycle index and its line: during a CPU cycle, hpos
		// has already advanced past the index — and at the line boundary
		// (cycle 113), vcount has advanced too.
		let line = this.vcount;
		let cycle = this.hpos - 1;
		if (cycle < 0) {
			cycle = 113;
			line = line === 0 ? this.anticLineCount - 1 : line - 1;
		}

		if (cycle >= 111) {
			line++;
			if (line === this.anticLineCount && cycle >= 112) {
				line = 0;
			}
		}

		return (line >> 1) & 0xff;
	}

	beforeCpu(): void {
		const i = this.hpos;

		this.#justLatched = 0;

		// NMI line events. The rise is processed after the drop so that a
		// same-cycle race keeps the line up.
		const nmiOps = this.#nmiDelay.tick();
		if (nmiOps & OP_NMI_DROP) {
			this.nmi = false;
		}
		if (nmiOps & OP_NMI_RISE) {
			this.nmi = true;
			this.#nmiDelay.schedule(2, OP_NMI_DROP);
		}

		if (i === 7) {
			// The NMIST status bits latch at cycle 7 — one cycle before the
			// NMI line pull — whenever their event occurs; NMIEN only gates
			// the pull, so software can poll NMIST with NMIs disabled. The
			// DLI and VBI bits report the most recent event: each clears the
			// other; NMIRES clears everything (but loses a same-cycle race).
			// The cycle is pinned by Acid800's cycle-counted NMIST samples.
			if (
				this.instruction & 0x80 &&
				this.modeLineNo === this.modeLineHeight - 1
			) {
				this.dli = true;
				this.vbi = false;
				this.#justLatched |= 0x80;
			}

			if (this.vcount === 248) {
				this.vbi = true;
				// The VBI displaces a stale DLI latch entirely.
				this.#justLatched = (this.#justLatched & ~0x80) | 0x40;
				if (this.rnmi) {
					this.res = true;
					this.#justLatched |= 0x20;
				}
				this.dli = false;
			}

			// Arm the cycle-8 pull with NMIEN as of now: a disable landing
			// after this cycle is too late to block (set-dominant), while an
			// enable landing before the pull still fires — both per Acid800.
			this.#lineLatched = this.#justLatched;
			this.#armedNmi =
				(this.dliEnabled && !!(this.#lineLatched & 0x80)) ||
				(this.vbiEnabled && !!(this.#lineLatched & 0x40)) ||
				!!(this.#lineLatched & 0x20);
		} else if (i === 8) {
			// ANTIC pulls NMI at cycle 8, right after the display list and P/M
			// DMA slots, and holds it for two cycles (8 and 9). Both cycles are
			// free of DMA contention by design, so the CPU — whose edge
			// detector samples inside run() — is always running (or
			// WSYNC-stalled, which still ticks the detector) while the line is
			// up. That's what makes the skip-run()-on-halt model safe.
			if (this.#armedNmi) {
				this.nmi = true;
				this.#nmiDelay.schedule(2, OP_NMI_DROP);
			}
		}

		this.hpos++;
		if (this.hpos === 114) {
			this.hpos = 0;

			this.vcount++;
			if (this.vcount === 248) {
				this.dli = false;
			}

			if (this.vcount === this.anticLineCount) {
				this.vcount = 0;
			}

			this.modeLineNo++;
			if (this.modeLineNo >= this.modeLineHeight) {
				this.modeLineNo = 0;
			}
		}

		if (this.waitingForVbi && this.vcount === 0) {
			this.waitingForVbi = false;
		}

		const visibleLine =
			!this.waitingForVbi && this.vcount >= 8 && this.vcount < 248;

		// Request 9 refresh cycles every 4 cycles starting from 25
		if (i >= 25 && i <= 57 && !((i - 25) & 0x3)) {
			this.refreshPending = true;
		}

		// The stalled fetch completes at cycle 104 (the next instruction's
		// remaining cycles run from 105) — verified against Acid800's
		// cycle-counted VCOUNT samples. A double-armed WSYNC completes one
		// cycle later.
		if (this.wsync && i === (this.wsyncLate ? 105 : 104)) {
			this.wsync = false;
			this.wsyncLate = false;
		}

		this.rdy = !this.wsync;

		if (this.vcount === 8 && i === 1) {
			this.lastDisplayListAddress = this.displayListAddress;
		}

		if (
			(i === 0 && this.#fetchMissiles()) ||
			(i >= 2 && i <= 5 && this.#fetchPlayer(i - 2)) ||
			(visibleLine &&
				((i === 1 && this.#fetchFirstByte()) ||
					(i === 6 && this.#fetchSecondByte()) ||
					(i === 7 && this.#fetchThirdByte()) ||
					this.#fetchCharacter(i) ||
					this.#fetchPlayfield(i)))
		) {
			// P/M or display list DMA, already handled by fetchXxx methods
			this.halt = true;
		} else if (this.refreshPending) {
			// DRAM refresh cycle
			this.refreshPending = false;
			this.halt = true;
		} else {
			this.halt = false;
		}
	}

	afterCpu(frame: Uint8Array, busData: number) {
		const pixels0 = this.#generateColor(0);

		const pixels1 = this.#generateColor(1);

		const left0 = pixels0 >> 8;
		const right0 = pixels0 & 0xff;

		const left1 = pixels1 >> 8;
		const right1 = pixels1 & 0xff;

		const i = this.hpos - 1;

		const x = i - 17 + 3;
		const y = this.vcount - 8;

		if (y >= 0 && y < 240) {
			if (x >= 0 && x < 94) {
				const base = (x + y * 94) * 4;
				frame[base] = left0;
				frame[base + 1] = right0;
				frame[base + 2] = left1;
				frame[base + 3] = right1;
			}

			const isOddScanline = y & 1;

			// The GRAF registers latch the bus during the P/M DMA slots only
			// when GRACTL enables it — with GRACTL off, direct GRAF writes
			// persist (the GTIA collision tests rely on that).
			if (y < 224) {
				if (i === 0 && this.enableMissiles) {
					// TODO: VDELAY for missiles (bits 0-3)
					this.grafM = busData;
				}

				if (this.enablePlayers) {
					if (i === 2 && (isOddScanline || !(this.vdelay & 0x10))) {
						this.grafP0 = busData;
					}

					if (i === 3 && (isOddScanline || !(this.vdelay & 0x20))) {
						this.grafP1 = busData;
					}

					if (i === 4 && (isOddScanline || !(this.vdelay & 0x40))) {
						this.grafP2 = busData;
					}

					if (i === 5 && (isOddScanline || !(this.vdelay & 0x80))) {
						this.grafP3 = busData;
					}
				}
			}
		}
	}

	#generateColor(pos: 0 | 1): number {
		const pf = this.#drawPlayfield2();
		const pm = this.#drawPlayerMissile2(pos);
		this.#detectCollisions(pf, pm);
		const color = this.#resolvePriority(pf, pm);

		if (pf & 0x4) {
			// Apply hires luminance
			const left = pf & 0x2 ? (color & 0xf0) | (this.colpf1 & 0xf) : color;
			const right = pf & 0x1 ? (color & 0xf0) | (this.colpf1 & 0xf) : color;
			return (left << 8) | right;
		} else {
			return (color << 8) | color;
		}
	}

	#sizeP0 = 1;
	#sizeP0Counter = 0;
	#shiftP0 = 0;

	#sizeP1 = 1;
	#sizeP1Counter = 0;
	#shiftP1 = 0;

	#sizeP2 = 1;
	#sizeP2Counter = 0;
	#shiftP2 = 0;

	#sizeP3 = 1;
	#sizeP3Counter = 0;
	#shiftP3 = 0;

	#sizeM0 = 1;
	#sizeM0Counter = 0;
	#shiftM0 = 0;

	#sizeM1 = 1;
	#sizeM1Counter = 0;
	#shiftM1 = 0;

	#sizeM2 = 1;
	#sizeM2Counter = 0;
	#shiftM2 = 0;

	#sizeM3 = 1;
	#sizeM3Counter = 0;
	#shiftM3 = 0;

	// 00: BK; 8..B: PF0..PF3; C..F: Hires 00..11
	#drawPlayfield2(): number {
		return this.pfCounter ? this.pfPixels[--this.pfCounter]! : 0;
	}

	// 1 bit for each player or missile. 1 means active, 0 means inactive
	#drawPlayerMissile2(pos: 0 | 1): number {
		const i = this.hpos - 1;

		const x = i - 17 + 3;
		const y = this.vcount - 8;

		if (y < 0 || y >= 240 || x < 0 || x >= 94) {
			return 0;
		}

		const start = (this.hpos + 2) * 2 + pos;

		if (start === this.hposp0) {
			this.#shiftP0 = this.grafP0;
			this.#sizeP0Counter = 0;
		}
		if (start === this.hposp1) {
			this.#shiftP1 = this.grafP1;
			this.#sizeP1Counter = 0;
		}
		if (start === this.hposp2) {
			this.#shiftP2 = this.grafP2;
			this.#sizeP2Counter = 0;
		}
		if (start === this.hposp3) {
			this.#shiftP3 = this.grafP3;
			this.#sizeP3Counter = 0;
		}
		if (start === this.hposm0) {
			this.#shiftM0 = (this.grafM << 6) & 0xc0;
			this.#sizeM0Counter = 0;
		}
		if (start === this.hposm1) {
			this.#shiftM1 = (this.grafM << 4) & 0xc0;
			this.#sizeM1Counter = 0;
		}
		if (start === this.hposm2) {
			this.#shiftM2 = (this.grafM << 2) & 0xc0;
			this.#sizeM2Counter = 0;
		}
		if (start === this.hposm3) {
			this.#shiftM3 = this.grafM & 0xc0;
			this.#sizeM3Counter = 0;
		}

		let result = 0;

		if (this.#shiftP0) {
			if (this.#shiftP0 & 0x80) {
				result |= 0x10;
			}

			this.#sizeP0Counter = (this.#sizeP0Counter + 1) & this.#sizeP0;
			if (this.#sizeP0Counter === 0) {
				this.#shiftP0 = (this.#shiftP0 << 1) & 0xff;
			}
		}

		if (this.#shiftP1) {
			if (this.#shiftP1 & 0x80) {
				result |= 0x20;
			}

			this.#sizeP1Counter = (this.#sizeP1Counter + 1) & this.#sizeP1;
			if (this.#sizeP1Counter === 0) {
				this.#shiftP1 = (this.#shiftP1 << 1) & 0xff;
			}
		}

		if (this.#shiftP2) {
			if (this.#shiftP2 & 0x80) {
				result |= 0x40;
			}

			this.#sizeP2Counter = (this.#sizeP2Counter + 1) & this.#sizeP2;
			if (this.#sizeP2Counter === 0) {
				this.#shiftP2 = (this.#shiftP2 << 1) & 0xff;
			}
		}

		if (this.#shiftP3) {
			if (this.#shiftP3 & 0x80) {
				result |= 0x80;
			}

			this.#sizeP3Counter = (this.#sizeP3Counter + 1) & this.#sizeP3;
			if (this.#sizeP3Counter === 0) {
				this.#shiftP3 = (this.#shiftP3 << 1) & 0xff;
			}
		}

		if (this.#shiftM0) {
			if (this.#shiftM0 & 0x80) {
				result |= 0x01;
			}

			this.#sizeM0Counter = (this.#sizeM0Counter + 1) & this.#sizeM0;
			if (this.#sizeM0Counter === 0) {
				this.#shiftM0 = (this.#shiftM0 << 1) & 0xff;
			}
		}

		if (this.#shiftM1) {
			if (this.#shiftM1 & 0x80) {
				result |= 0x02;
			}

			this.#sizeM1Counter = (this.#sizeM1Counter + 1) & this.#sizeM1;
			if (this.#sizeM1Counter === 0) {
				this.#shiftM1 = (this.#shiftM1 << 1) & 0xff;
			}
		}

		if (this.#shiftM2) {
			if (this.#shiftM2 & 0x80) {
				result |= 0x04;
			}

			this.#sizeM2Counter = (this.#sizeM2Counter + 1) & this.#sizeM2;
			if (this.#sizeM2Counter === 0) {
				this.#shiftM2 = (this.#shiftM2 << 1) & 0xff;
			}
		}

		if (this.#shiftM3) {
			if (this.#shiftM3 & 0x80) {
				result |= 0x08;
			}

			this.#sizeM3Counter = (this.#sizeM3Counter + 1) & this.#sizeM3;
			if (this.#sizeM3Counter === 0) {
				this.#shiftM3 = (this.#shiftM3 << 1) & 0xff;
			}
		}

		return result;
	}

	// Get playfield and P/M outputs and detect collisions
	#detectCollisions(pf: number, pm: number): void {
		// Convert PF output into individual bits
		let f: number;
		if (!pf) {
			// BK
			f = 0;
		} else if (pf & 0x4) {
			// Hires. PF1 if any bit is set
			if (pf & 0x3) {
				f = 0b0010;
			} else {
				f = 0;
			}
		} else {
			// Lores
			f = 1 << (pf & 0x3);
		}

		const p = pm >> 4;
		const m = pm & 0xf;

		// Player to player. A player never collides with itself — the self
		// bits stay clear (matching the $0E/$0D/$0B/$07 power-on pattern).
		if (p & 1) this.p0pl |= p & 0x0e;
		if (p & 2) this.p1pl |= p & 0x0d;
		if (p & 4) this.p2pl |= p & 0x0b;
		if (p & 8) this.p3pl |= p & 0x07;

		// Missile to player
		if (m & 1) this.m0pl |= p;
		if (m & 2) this.m1pl |= p;
		if (m & 4) this.m2pl |= p;
		if (m & 8) this.m3pl |= p;

		// Player to playfield
		if (p & 1) this.p0pf |= f;
		if (p & 2) this.p1pf |= f;
		if (p & 4) this.p2pf |= f;
		if (p & 8) this.p3pf |= f;

		// Missile to playfield
		if (m & 1) this.m0pf |= f;
		if (m & 2) this.m1pf |= f;
		if (m & 4) this.m2pf |= f;
		if (m & 8) this.m3pf |= f;
	}

	// Gets playfield and pm data, resolves the priority and returns a palette index
	#resolvePriority(pf: number, pm: number): number {
		const prior = this.prior;

		if (pf & 0x4) {
			// Hires. Use PF2 for priority purposes
			pf = 3;
		} else if (pf) {
			// Map PF0 to 1 .. PF3 to 4
			pf = (pf & 0x3) + 1;
		}

		let p = pm >> 4;

		const multicolor = prior & 0x20;

		let p5 = false;

		if (prior & 0x10 && pm & 0xf) {
			// Fifth player
			p5 = true;
			if (pf === 0) {
				pf = 4;
			}
		} else {
			// Treat missiles like players
			p |= pm & 0xf;
		}

		const pl01active = (p & 0x3) !== 0;
		const pl23active = !pl01active && (p & 0xc) !== 0;

		if (!pl01active && !pl23active && !pf) {
			return this.colbk;
		}

		const pl01 = !pl01active
			? 0
			: multicolor && (p & 0x3) === 0x3
				? this.colpm0 | this.colpm1
				: p & 0x1
					? this.colpm0
					: this.colpm1;

		const pl23 = !pl23active
			? 0
			: multicolor && (p & 0xc) === 0xc
				? this.colpm2 | this.colpm3
				: p & 0x4
					? this.colpm2
					: this.colpm3;

		const pf01active = pf === 1 || pf === 2;
		const pf01 = !pf01active
			? 0
			: p5
				? this.colpf3
				: pf === 1
					? this.colpf0
					: this.colpf1;

		const pf23active = pf === 3 || pf === 4;
		const pf23 = !pf23active
			? 0
			: p5
				? this.colpf3
				: pf === 3
					? this.colpf2
					: this.colpf3;

		switch (prior & 0xf) {
			// TODO: Priority conflicts
			case 0b0000:
				if (pl01active || pf01active) {
					return pl01 | pf01;
				} else {
					return pl23 | pf23;
				}
			case 0b0001:
				if (pl01active) return pl01;
				if (pl23active) return pl23;
				return pf01 | pf23;
			case 0b0010:
				if (pl01active) return pl01;
				if (pf) return pf01 | pf23;
				return pl23;
			case 0b0100:
				if (pf) return pf01 | pf23;
				return pl01 | pl23;
			case 0b1000:
				if (pf01active) return pf01;
				if (pl01active) return pl01;
				if (pl23active) return pl23;
				return pf23;
		}

		return pf01;
	}

	#fetchFirstByte(): boolean {
		if (this.modeLineNo !== 0) {
			return false;
		}

		if (this.displayListDmaEnabled) {
			this.instruction = this.#dmaRead(this.displayListAddress);
			this.#incrementDisplayListAddress();
		}

		const mode = this.instruction & 0x0f;
		if (mode === 0x00) {
			// Blank
			this.modeLineHeight = ((this.instruction & 0x70) >> 4) + 1;
			this.charFetchRate = 0;
			this.playfieldFetchRate = 0;
			this.hires = false;
		} else if (mode === 0x01) {
			// Jump. Bit 6 (wait for VBI) is acted on in #fetchThirdByte once
			// the jump target has been fetched — setting it here would stop
			// this line's remaining display list DMA and lose the target.
			this.modeLineHeight = 1;
			this.charFetchRate = 0;
			this.playfieldFetchRate = 0;
			this.hires = false;
		} else {
			// Actual mode
			this.hires = false;
			this.modeLineHeight = LINES_PER_MODE[mode]!;
			this.charFetchRate = CHAR_FETCH_RATE[mode]!;
			this.playfieldFetchRate = PLAYFIELD_FETCH_RATE[mode]!;
			this.hires = PLAYFIELD_HI_RES[mode]!;
		}

		return this.displayListDmaEnabled;
	}

	#fetchSecondByte(): boolean {
		if (!this.displayListDmaEnabled || this.modeLineNo !== 0) return false;

		if ((this.instruction & 0x0f) === 0x01) {
			// Jump
			this.#temp = this.#dmaRead(this.displayListAddress);
			this.#incrementDisplayListAddress();
			return true;
		} else if ((this.instruction & 0x0f) > 0x01 && this.instruction & 0x40) {
			// LMS
			const byte = this.#dmaRead(this.displayListAddress);
			this.msc = byte | (this.msc & 0xff00);
			this.#incrementDisplayListAddress();
			return true;
		} else {
			// No read
			return false;
		}
	}

	#fetchThirdByte(): boolean {
		if (!this.displayListDmaEnabled || this.modeLineNo !== 0) return false;

		if ((this.instruction & 0x0f) === 0x01) {
			// Jump
			this.displayListAddress =
				(this.#dmaRead(this.displayListAddress) << 8) | this.#temp;
			if (this.instruction & 0x40) {
				this.waitingForVbi = true;
			}
			return true;
		} else if ((this.instruction & 0x0f) > 0x01 && this.instruction & 0x40) {
			// LMS
			const byte = this.#dmaRead(this.displayListAddress);
			this.msc = (byte << 8) | (this.msc & 0xff);
			this.#incrementDisplayListAddress();
			return true;
		} else {
			// No read
			return false;
		}
	}

	#fetchMissiles() {
		if (!this.missileDmaEnabled) {
			return false;
		}

		let offset: number;
		if (this.verticalPmResolution === 1) {
			offset = 768;
		} else {
			offset = 384;
		}

		const addr = this.pmbase * 256 + offset;
		this.#dmaRead(addr + Math.floor(this.vcount / this.verticalPmResolution));

		return true;
	}

	#fetchPlayer(n: number) {
		if (!this.playerDmaEnabled) {
			return false;
		}

		let offset: number;
		if (this.verticalPmResolution === 1) {
			offset = 1024 + n * 256;
		} else {
			offset = 512 + n * 128;
		}

		switch (n) {
			case 0:
				{
					const addr = this.pmbase * 256 + offset;
					this.#dmaRead(
						addr + Math.floor(this.vcount / this.verticalPmResolution),
					);
				}
				break;
			case 1:
				{
					const addr = this.pmbase * 256 + offset;
					this.#dmaRead(
						addr + Math.floor(this.vcount / this.verticalPmResolution),
					);
				}
				break;
			case 2:
				{
					const addr = this.pmbase * 256 + offset;
					this.#dmaRead(
						addr + Math.floor(this.vcount / this.verticalPmResolution),
					);
				}
				break;
			case 3:
				{
					const addr = this.pmbase * 256 + offset;
					this.#dmaRead(
						addr + Math.floor(this.vcount / this.verticalPmResolution),
					);
				}
				break;
		}

		return true;
	}

	#fetchCharacter(cycle: number) {
		if (!this.playfieldWidth || !this.charFetchRate || this.modeLineNo !== 0) {
			return false;
		}

		let playfieldWidth = this.playfieldWidth;
		// Widen if HSCROL is enabled
		if (
			(this.instruction & 0x0f) > 1 &&
			this.instruction & 0x10 &&
			(playfieldWidth === 1 || playfieldWidth === 2)
		) {
			playfieldWidth = (playfieldWidth + 1) as 2 | 3;
		}

		let start = ([0, 26, 18, 10] as const)[playfieldWidth];
		if ((this.instruction & 0x0f) > 1 && this.instruction & 0x10) {
			start += Math.floor(this.hscrol / 2);
		}
		const width = ([0, 64, 80, 96] as const)[playfieldWidth];

		if (
			cycle < start ||
			cycle >= start + width ||
			(cycle - start) & (this.charFetchRate - 1)
		) {
			return false;
		}

		// Read char no from MSC into line buffer
		const bufferIndex = (cycle - start) / this.charFetchRate;
		const char = this.#dmaRead(this.msc);

		this.#buffer[bufferIndex] = char;

		this.msc = ((this.msc + 1) & 0x0fff) | (this.msc & 0xf000); // Cannot cross 4K without reload
	}

	printed = 0;

	#fetchPlayfield(cycle: number): boolean {
		if (!this.playfieldWidth || !this.playfieldFetchRate) {
			return false;
		}

		let playfieldWidth = this.playfieldWidth;

		// Widen if HSCROL is enabled
		if (
			(this.instruction & 0x0f) > 1 &&
			this.instruction & 0x10 &&
			(playfieldWidth === 1 || playfieldWidth === 2)
		) {
			playfieldWidth = (playfieldWidth + 1) as 2 | 3;
		}

		let start = ([0, 29, 21, 13] as const)[playfieldWidth];
		if ((this.instruction & 0x0f) > 1 && this.instruction & 0x10) {
			start += Math.floor(this.hscrol / 2);
		}
		const width = ([0, 64, 80, 96] as const)[playfieldWidth];

		if (
			cycle < start ||
			cycle >= start + width ||
			(cycle - start) & (this.playfieldFetchRate - 1)
		) {
			return false;
		}

		const bufferIndex = Math.floor((cycle - start) / this.playfieldFetchRate);
		const mode = this.instruction & 0x0f;

		if (this.charFetchRate) {
			// Fetch from CHBASE
			const charNo = this.#buffer[bufferIndex]!;
			const base =
				mode < 6
					? // 1024-byte char set
						(this.chbase & 0xfe) * 256 + (charNo & 0x7f) * 8
					: // 512-byte char set
						this.chbase * 256 + (charNo & 0x3f) * 8;

			switch (mode) {
				case 2:
					{
						// 8 hires pixels (4 color clocks)
						// TODO: Blink, upside down, inverse
						const data = this.#dmaRead(base + this.modeLineNo);
						const bits = charNo < 0x80 ? data : data ^ 0xff;

						this.pfPixels[0] = hires(bits);
						this.pfPixels[1] = hires(bits >> 2);
						this.pfPixels[2] = hires(bits >> 4);
						this.pfPixels[3] = hires(bits >> 6);
						this.pfCounter = 4;
					}
					break;

				case 3:
					// TODO: ANTIC mode 3
					break;

				case 4:
					{
						// 4 lores pixels with 5 colors
						const data = this.#dmaRead(base + this.modeLineNo);
						const useColPf3 = charNo > 0x80;

						this.pfPixels[0] = lores2(data, useColPf3);
						this.pfPixels[1] = lores2(data >> 2, useColPf3);
						this.pfPixels[2] = lores2(data >> 4, useColPf3);
						this.pfPixels[3] = lores2(data >> 6, useColPf3);
						this.pfCounter = 4;
					}
					break;

				case 5:
					{
						// 4 lores pixels with 5 colors
						const data = this.#dmaRead(base + (this.modeLineNo >> 1));
						const useColPf3 = charNo > 0x80;

						this.pfPixels[0] = lores2(data, useColPf3);
						this.pfPixels[1] = lores2(data >> 2, useColPf3);
						this.pfPixels[2] = lores2(data >> 4, useColPf3);
						this.pfPixels[3] = lores2(data >> 6, useColPf3);
						this.pfCounter = 4;
					}
					break;

				case 6:
					{
						// 8 lores pixels, all same color
						let data = this.#dmaRead(base + this.modeLineNo);
						const color = lores(charNo >> 6);

						this.pfPixels.fill(0);
						this.pfCounter = 8;
						let i = 0;
						while (data) {
							const bit = data & 1;
							data >>= 1;
							const out = bit ? color : bg;
							this.pfPixels[i++] = out;
						}
					}
					break;

				case 7:
					{
						// 8 lores pixels, all same color
						let data = this.#dmaRead(base + (this.modeLineNo >> 1));
						const color = lores(charNo >> 6);

						this.pfPixels.fill(0);
						this.pfCounter = 8;
						let i = 0;
						while (data) {
							const bit = data & 1;
							data >>= 1;
							const out = bit ? color : bg;
							this.pfPixels[i++] = out;
						}
					}
					break;

				default:
					break;
			}
		} else {
			// Fetch from MSC into line buffer
			let data: number;

			if (this.modeLineNo === 0) {
				data = this.#dmaRead(this.msc);
				this.#buffer[bufferIndex] = data;
				this.msc = ((this.msc + 1) & 0x0fff) | (this.msc & 0xf000); // Cannot cross 4K without reload
			} else {
				data = this.#buffer[bufferIndex]!;
			}

			switch (mode) {
				case 0x8:
					{
						this.pfPixels[0] = lores2(data, false);
						this.pfPixels[1] = this.pfPixels[0];
						this.pfPixels[2] = this.pfPixels[0];
						this.pfPixels[3] = this.pfPixels[0];

						this.pfPixels[4] = lores2(data >> 2, false);
						this.pfPixels[5] = this.pfPixels[4];
						this.pfPixels[6] = this.pfPixels[4];
						this.pfPixels[7] = this.pfPixels[4];

						this.pfPixels[8] = lores2(data >> 4, false);
						this.pfPixels[9] = this.pfPixels[8];
						this.pfPixels[10] = this.pfPixels[8];
						this.pfPixels[11] = this.pfPixels[8];

						this.pfPixels[12] = lores2(data >> 6, false);
						this.pfPixels[13] = this.pfPixels[12];
						this.pfPixels[14] = this.pfPixels[12];
						this.pfPixels[15] = this.pfPixels[12];
						this.pfCounter = 16;
					}
					break;

				case 0x9: {
					this.pfPixels.fill(0);
					this.pfCounter = 16;

					let i = 0;
					while (data) {
						const bit = data & 1;
						data >>= 1;
						const out = bit ? 0x8 : bg;
						this.pfPixels[i++] = out;
						this.pfPixels[i++] = out;
						this.pfPixels[i++] = out;
						this.pfPixels[i++] = out;
					}
					break;
				}

				case 0xa:
					{
						this.pfPixels[0] = lores2(data, false);
						this.pfPixels[1] = this.pfPixels[0];
						this.pfPixels[2] = lores2(data >> 2, false);
						this.pfPixels[3] = this.pfPixels[2];
						this.pfPixels[4] = lores2(data >> 4, false);
						this.pfPixels[5] = this.pfPixels[4];
						this.pfPixels[6] = lores2(data >> 6, false);
						this.pfPixels[7] = this.pfPixels[6];
						this.pfCounter = 8;
					}
					break;

				case 0xb:
				case 0xc: {
					this.pfPixels.fill(0);
					this.pfCounter = 8;

					let i = 0;
					while (data) {
						const bit = data & 1;
						data >>= 1;
						const out = bit ? 0x8 : bg;
						this.pfPixels[i++] = out;
					}
					break;
				}

				case 0xd:
				case 0xe:
					{
						this.pfPixels[0] = lores2(data, false);
						this.pfPixels[1] = lores2(data >> 2, false);
						this.pfPixels[2] = lores2(data >> 4, false);
						this.pfPixels[3] = lores2(data >> 6, false);
						this.pfCounter = 4;
					}
					break;

				case 0xf: {
					// 8 hires pixels
					this.pfPixels[0] = hires(data);
					this.pfPixels[1] = hires(data >> 2);
					this.pfPixels[2] = hires(data >> 4);
					this.pfPixels[3] = hires(data >> 6);
					this.pfCounter = 4;
					break;
				}
			}
		}

		return true;
	}

	#incrementDisplayListAddress() {
		const hi = this.displayListAddress & 0xfc00; // High 6 bits
		const lo = (this.displayListAddress + 1) & 0x03ff; // Low 10 bits
		this.displayListAddress = hi | lo;
	}

	#dmaRead: (address: number) => number;

	#buffer = new Uint8Array(48);

	disassemble() {
		let pc = this.lastDisplayListAddress;
		for (let i = 0; i < 240; i++) {
			const instruction = this.#dmaRead(pc++);
			const mode = instruction & 0xf;
			let line =
				(pc - 1).toString(16).padStart(4, "0") +
				" " +
				instruction.toString(16).padStart(2, "0") +
				" " +
				(instruction & 0x80 ? "DLI " : "    ");

			if (mode === 0) {
				// Blank
				line += "BLANK " + String(((this.instruction & 0x70) >> 4) + 1);
			} else if (mode === 1) {
				// Jump
				const address = this.#dmaRead(pc) + this.#dmaRead(pc + 1) * 256;
				const addressStr = "$" + address.toString(16).padStart(4, "0");
				if (instruction & 0x40) {
					line += "JVB   " + addressStr;
					this.#log(line);
					break;
				} else {
					line += "JMP   " + addressStr;
					pc = address;
				}
			} else {
				// Normal mode
				line += "MODE  " + mode.toString(16);
				if (instruction & 0x40) {
					const address =
						"$" +
						(this.#dmaRead(pc++) + this.#dmaRead(pc++) * 256)
							.toString(16)
							.padStart(4, "0");
					line += " LMS " + address;
				}
			}

			this.#log(line);
		}
	}
}

const LINES_PER_MODE = [
	0,
	0,

	8, // 2
	10, // 3
	8, // 4
	16, // 5
	8, // 6
	16, // 7

	8, // 8
	4, // 9
	4, // A
	2, // B
	1, // C
	2, // D
	1, // E
	1, // F
];

const CHAR_FETCH_RATE = [
	0,
	0,

	2, // 2
	2, // 3
	2, // 4
	2, // 5
	4, // 6
	4, // 7

	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
];

const PLAYFIELD_FETCH_RATE = [
	0,
	0,

	2, // 2
	2, // 3
	2, // 4
	2, // 5
	4, // 6
	4, // 7

	8, // 8
	8, // 9
	4, // A
	4, // B
	4, // C
	2, // D
	2, // E
	2, // F
];

const PLAYFIELD_HI_RES = [
	false,
	false,

	true, // 2
	true, // 3
	false, // 4
	false, // 5
	false, // 6
	false, // 7

	false, // 8
	false, // 9
	false, // A
	false, // B
	false, // C
	false, // D
	false, // E
	true, // F
];

const bg = 0x0;

// C D E F (bit 2 and 3)
function hires(bits: number): number {
	return 0xc | (bits & 0x3);
}

// 8 9 A B (bit 3)
function lores(index: number): number {
	return 0x8 | (index & 0x3);
}

// 0 8 9 A B
function lores2(index: number, pf3: boolean): number {
	index = index & 3;

	if (!index) return bg;

	index--;
	if (index === 2 && pf3) {
		index = 3;
	}

	return lores(index);
}

const PM_SIZES = [
	0b00, // Normal
	0b01, // Double
	0b00, // Normal
	0b11, // Quadruple
];
