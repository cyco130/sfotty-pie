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

/**
 * The video output chip variant. The CTIA (in early 400/800s) predates the
 * GTIA's special modes: PRIOR bits 6-7 are ignored and a "GTIA mode" screen
 * displays as its base ANTIC mode — the collision difference is the
 * documented way software detects which chip it runs on (AHRM 6.9). "fgtia"
 * (the SECAM variant, with its trigger-sampling quirk) is a future value.
 */
export type TvAdapter = "ctia" | "gtia";

interface AnticGtiaOptions {
	anticTvSystem: "ntsc" | "pal";
	gtiaTvSystem: "ntsc" | "pal";
	/** Default "gtia". */
	tvAdapter?: TvAdapter;
}

// What the GTIA color registers hold at power-on: a dark brown (hue $F,
// minimum luminance). Observed behavior, not documented.
const POWER_ON_COLOR = 0xf0;

// The paint pipeline. afterCpu for machine cycle i paints color clocks 2i
// and 2i+1 — the exact color clocks the beam covers during that cycle — so
// "the beam" below just means the color clock being painted.
//
// Playfield bytes reach the GTIA paint through the ANx bus with a fixed
// lag, but the fetch slots differ by mode family (pinned by Acid800
// antic_dmapattern's cycle tables): bitmap-mode data fetches sit at cycles
// 12/20/28 (wide/normal/narrow) and take 8 color clocks to the screen
// (AHRM: 7 to cross the ANx bus + 1 through GTIA's output stage; also the
// cycle-65 / positions $8C-$8F mode E anchor in AHRM 6.10), while
// character glyph fetches sit one cycle later — three cycles after their
// name fetches at 10/18/26 — and take 6. Both land the first pixel exactly
// at the playfield start (HPOS 32/48/64). The delays below cover the trip
// to the ANx bus (as a DelayLine delay scheduled from busCycle time,
// before the cycle's own two ticks, that is bus-lag + 1); GTIA's output
// register (#anxHold) adds the final color clock.
const ANX_BITMAP_DELAY = 8;
const ANX_CHAR_DELAY = 6;

// GTIA register writes reach the paint logic a few color clocks after the
// bus write (AHRM 6.10 table 18). A write during machine cycle w scheduled
// with delay N applies just before color clock 2w+N-1 paints. The anchor is
// HPOS at delay 7 — effective from color clock 2w+6, pinned by Acid800
// gtia_retrigger and equal to Atari++'s -playerpositiondelay default (12
// half color clocks). AHRM's table supplies the spacings between classes
// (color = HPOS-4, PRIOR = HPOS-3, GRAF = HPOS-2; its absolute
// $81/$82/$83/$85 column sits a uniform 3 color clocks earlier — a
// write-phase origin difference, the ladder is what's reliable). SIZE is
// faster than HPOS — Atari++'s -playerresizedelay (3 color clocks, i.e.
// HPOS-3) where AHRM's prose lumps them; Acid800 pmresize arbitrates in
// Atari++'s favor. Open refinement: PRIOR bits 6-7 are really 3-5 color
// clocks with per-transition artifacts (GTIA modes work).
const POS_WRITE_DELAY = 7;
const SIZE_WRITE_DELAY = 4;
const GRAF_WRITE_DELAY = 5;
const COLOR_WRITE_DELAY = 3;
const PRIOR_WRITE_DELAY = 4;

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

	// Vertical scrolling (VSCROL + the display list's bit 5). The first
	// line of a VS region starts the row counter at VSCROL; the first
	// instruction after the region (its bit 5 clear) is the exit line and
	// ends when the row counter reaches VSCROL — shorter *or longer* than
	// the mode's natural height (the 4-bit counter wraps through 15).
	// Acid800 antic_vscroll pins all of it, including the wrap.
	vscrol = 0;
	#vsRegion = false; // the previous mode line carried the VS bit
	#vsExit = false; // the current instruction ends at VSCROL

	// The current scanline is an instruction's first: display list and
	// character-name DMA happen here. Distinct from modeLineNo === 0 — a
	// VS entry starts the row counter at VSCROL on its first line.
	#newInstruction = true;

	// Armed at cycle 6: this scanline is its instruction's last. The DLI
	// latch at cycle 7 uses this — a VSCROL write by cycle 5 still
	// changes the decision, a cycle later doesn't (antic_vscroldli).
	#lastLineArmed = false;

	// CHBASE
	chbase = 0;

	// CHACTL: bit 0 blanks inverse-video chars, bit 1 inverts them, bit 2
	// reflects character rows vertically.
	chactl = 0;

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

	/**
	 * The color registers in address order — COLPM0-3, COLPF0-3, COLBK
	 * ($D012-$D01A). The indices double as the priority table's selector
	 * bits (see the COLPM0..COLBK constants).
	 */
	readonly colorRegisters = new Uint8Array(9).fill(POWER_ON_COLOR);

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

	// Triggers (inputs, pulled up). On XL/XE the machine drives trig3 from the
	// cartridge sense line (RD5): 1 = cartridge present, 0 = empty slot.
	trig0 = 1;
	trig1 = 1;
	trig2 = 1;
	trig3 = 1;

	anticLineCount: number;
	#gtiaPal: number;
	// False on a CTIA: PRIOR bits 6-7 are ignored — no special modes.
	#gtiaModes = true;

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
		this.#gtiaModes = initialOptions.tvAdapter !== "ctia";
	}

	setOptions(options: AnticGtiaOptions) {
		this.anticLineCount =
			options.anticTvSystem === "pal"
				? PAL_LINES_PER_FRAME
				: NTSC_LINES_PER_FRAME;
		this.#gtiaPal = options.gtiaTvSystem === "pal" ? 0x1 : 0xf;
		this.#gtiaModes = options.tvAdapter !== "ctia";
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
		this.vscrol = 0;
		this.#vsRegion = false;
		this.#vsExit = false;
		this.#newInstruction = true;
		this.#lastLineArmed = false;
		this.#pfFineDelay = 0;
		this.chbase = 0;
		this.chactl = 0;
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
		this.#anxLine.reset();
		this.#anxDrain = 0;

		// Output lines
		this.nmi = false;
		this.#nmiDelay.reset();
		this.halt = false;
		this.rdy = true;

		this.#dmaVisibleLine = false;
		this.#lineFetchWidth = 0;
		this.#virtualLoad = 0;
		this.#rebuildDmaPattern();
	}

	// Keep the assignments in sync with the field initializers. Inputs (console
	// keys, triggers) reflect physical switches and are left alone.
	#resetGtia(): void {
		this.colorRegisters.fill(POWER_ON_COLOR);

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

		this.#pmFetchCycle = -1;

		this.#posWrites.reset();
		this.#sizeWrites.reset();
		this.#grafWrites.reset();
		this.#colorWrites.reset();
		this.#priorWrites.reset();
		this.#pendingGtiaWrites = 0;

		this.#anxHold = 0;
		this.#gtiaPixel = 0;
		this.#gtiaPixelPrev = 0;
		this.#gtiaBkMuted = false;
		this.#gtiaPrevBkMuted = false;
		this.#lineGtiaMode = 0;
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
				case 0x1c:
					// VDELAY — consumed at the bus-time GRAF latch, not in the
					// paint pipeline: immediate.
					this.vdelay = value;
					break;
				case 0x1d:
					// GRACTL — gates the bus-time GRAF latch (and trigger
					// latching): immediate.
					this.enablePlayers = !!(value & 0x02);
					this.enableMissiles = !!(value & 0x01);
					break;
				case 0x1e:
					// HITCLR clears the collision latches immediately; the
					// beam-anchored painter re-latches whatever it paints
					// next, so nothing else is needed (Acid800-pinned).
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
					break;
				default:
					// Every other register feeds the paint logic and takes
					// effect a few color clocks after the write — see the
					// write-delay constants.
					this.#queueGtiaWrite(address, value);
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
					this.#rebuildDmaPattern();
					break;

				case 0x01:
					// CHACTL
					this.chactl = value & 0x07;
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
					this.hscrol = value & 0x0f;
					this.#rebuildDmaPattern();
					break;

				case 0x05:
					// VSCROL
					this.vscrol = value & 0x0f;
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

	// Per-fetch scratch: one byte's playfield codes, right to left;
	// #fetchPlayfield ships the batch into #anxLine.
	// 00: BK; 8..B: PF0..PF3; C..F: Hires 00..11
	pfPixels = new Uint8Array(16);
	pfCounter = 0;

	// Playfield codes in flight from the ANTIC fetch to the GTIA paint (the
	// ANx bus plus GTIA's output stage). Ticked once per color clock by
	// #drawPlayfield; an empty slot paints background. See ANX_BITMAP_DELAY
	// and ANX_CHAR_DELAY.
	#anxLine = new DelayLine(32);

	// Color clocks until the ANx pipe is provably empty (the furthest
	// scheduled slot at the last push). While zero, #drawPlayfield skips
	// ticking the pipe and paints background.
	#anxDrain = 0;

	// GTIA register writes in flight to the paint logic, one DelayLine per
	// latency class so two writes can never fall due on the same color clock
	// (the CPU issues at most one write per machine cycle = two color
	// clocks). Slot payload: bit 16 marks presence, bits 8-15 the register,
	// bits 0-7 the value. Ticked once per color clock in #generateColor.
	#posWrites = new DelayLine(8); // HPOSPx/HPOSMx
	#sizeWrites = new DelayLine(8); // SIZEPx/SIZEM
	#grafWrites = new DelayLine(8); // GRAFPx/GRAFM
	#colorWrites = new DelayLine(8); // COLPMx/COLPFx/COLBK
	#priorWrites = new DelayLine(8); // PRIOR

	// Writes queued but not yet applied, across all five lines. While zero,
	// #applyPendingWrites skips ticking entirely — that freezes the lines'
	// cursors, which is sound: schedules are cursor-relative and an empty
	// line carries no time-sensitive state, so its clock only has to run
	// while something is in flight.
	#pendingGtiaWrites = 0;

	#queueGtiaWrite(address: number, value: number): void {
		const line =
			address < 0x08
				? this.#posWrites
				: address < 0x0d
					? this.#sizeWrites
					: address < 0x12
						? this.#grafWrites
						: address < 0x1b
							? this.#colorWrites
							: this.#priorWrites;
		const delay =
			address < 0x08
				? POS_WRITE_DELAY
				: address < 0x0d
					? SIZE_WRITE_DELAY
					: address < 0x12
						? GRAF_WRITE_DELAY
						: address < 0x1b
							? COLOR_WRITE_DELAY
							: PRIOR_WRITE_DELAY;
		line.scheduleValue(delay, 0x10000 | (address << 8) | value);
		this.#pendingGtiaWrites++;
	}

	// Tick the five write lines and apply whatever is due, just before the
	// current color clock paints. The common case — nothing in flight —
	// is one comparison.
	#applyPendingWrites(): void {
		if (this.#pendingGtiaWrites === 0) return;
		let w = this.#posWrites.tick();
		if (w) {
			this.#applyGtiaWrite((w >> 8) & 0xff, w & 0xff);
			this.#pendingGtiaWrites--;
		}
		w = this.#sizeWrites.tick();
		if (w) {
			this.#applyGtiaWrite((w >> 8) & 0xff, w & 0xff);
			this.#pendingGtiaWrites--;
		}
		w = this.#grafWrites.tick();
		if (w) {
			this.#applyGtiaWrite((w >> 8) & 0xff, w & 0xff);
			this.#pendingGtiaWrites--;
		}
		w = this.#colorWrites.tick();
		if (w) {
			this.#applyGtiaWrite((w >> 8) & 0xff, w & 0xff);
			this.#pendingGtiaWrites--;
		}
		w = this.#priorWrites.tick();
		if (w) {
			this.#applyGtiaWrite((w >> 8) & 0xff, w & 0xff);
			this.#pendingGtiaWrites--;
		}
	}

	#applyGtiaWrite(address: number, value: number): void {
		if (address >= 0x12 && address <= 0x1a) {
			// COLPM0-COLPM3, COLPF0-COLPF3, COLBK — in register order.
			this.colorRegisters[address - 0x12] = value;
			return;
		}
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

			// The size bits feed the shift state machine directly as its
			// counter mask: state' = (state + 1) & size (AHRM 6.5). %00 and
			// %10 both render normal width, but %10 is not remapped — from
			// state %01 the counter sticks at %10 and never reaches the
			// shift-on-%00 transition, the documented lockup anomaly
			// (Acid800 pmresize).
			case 0x08:
				// SIZEP0
				this.#sizeP0 = value & 0x3;
				break;
			case 0x09:
				// SIZEP1
				this.#sizeP1 = value & 0x3;
				break;
			case 0x0a:
				// SIZEP2
				this.#sizeP2 = value & 0x3;
				break;
			case 0x0b:
				// SIZEP3
				this.#sizeP3 = value & 0x3;
				break;
			case 0x0c:
				// SIZEM
				this.#sizeM0 = value & 0x3;
				this.#sizeM1 = (value >> 2) & 0x3;
				this.#sizeM2 = (value >> 4) & 0x3;
				this.#sizeM3 = (value >> 6) & 0x3;
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

			case 0x1b:
				// PRIOR
				this.prior = value;
				break;
		}
	}

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

	// Carried from beforeCpu to busCycle: the cycle's hpos slot (captured
	// before beforeCpu advances hpos), so busCycle needn't re-derive it off
	// the already-advanced counter.
	#dmaHpos = 0;

	// Whether the current line is a visible display line (no vertical blank,
	// not waiting on a JVB) — a per-line input to the DMA pattern.
	#dmaVisibleLine = false;

	// The current line's DMA pattern (see buildDmaPattern) and the cache of
	// built patterns by state key. Rebuilt — usually a cache-hit pointer swap
	// — at line start, after the cycle-1 instruction decode, and on
	// DMACTL/HSCROL writes.
	#dmaPattern: Uint16Array = new Uint16Array(114);
	#dmaPatternCache = new Map<number, Uint16Array>();

	// The (widened) fetch width the line's playfield started with, 0 before
	// it starts. Disabling playfield DMA after the start leaves the load
	// slots running as bus-free MSC advances (see buildDmaPattern); a
	// disable before the start means the playfield never starts at all.
	#lineFetchWidth = 0;

	#rebuildDmaPattern(): void {
		const scrolled =
			(this.instruction & 0x0f) > 1 && (this.instruction & 0x10) !== 0;
		if (this.playfieldWidth) {
			let fetchWidth: number = this.playfieldWidth;
			if (scrolled && fetchWidth < 3) fetchWidth++;
			this.#lineFetchWidth = fetchWidth;
		} else if (this.#lineFetchWidth) {
			const start =
				(this.charFetchRate
					? NAME_FETCH_START[this.#lineFetchWidth as 1 | 2 | 3]
					: BITMAP_FETCH_START[this.#lineFetchWidth as 1 | 2 | 3]) +
				(scrolled ? this.hscrol >> 1 : 0);
			if (this.hpos - 1 <= start) this.#lineFetchWidth = 0;
		}
		const key =
			(this.missileDmaEnabled ? 0b1 : 0) |
			(this.playerDmaEnabled ? 0b10 : 0) |
			(this.#dmaVisibleLine ? 0b100 : 0) |
			(this.#newInstruction ? 0b1000 : 0) |
			(this.displayListDmaEnabled ? 0b10000 : 0) |
			((this.instruction & 0x0f) << 5) |
			(this.instruction & 0x40 ? 0x200 : 0) |
			(scrolled ? 0x400 : 0) |
			((this.hscrol >> 1) << 11) |
			(this.playfieldWidth << 14) |
			(this.#lineFetchWidth << 16);
		let pattern = this.#dmaPatternCache.get(key);
		if (!pattern) {
			pattern = buildDmaPattern(key);
			this.#dmaPatternCache.set(key, pattern);
		}
		this.#dmaPattern = pattern;
	}

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

		if (i === 6) {
			// The "is this the instruction's last scanline" decision is made
			// here, one cycle before the NMIST latch — a VSCROL write
			// completing by cycle 5 still changes it, a cycle later
			// doesn't (antic_vscroldli pins both sides).
			this.#lastLineArmed =
				this.modeLineNo ===
				(this.#vsExit ? this.vscrol : this.modeLineHeight - 1);
		} else if (i === 7) {
			// The NMIST status bits latch at cycle 7 — one cycle before the
			// NMI line pull — whenever their event occurs; NMIEN only gates
			// the pull, so software can poll NMIST with NMIs disabled. The
			// DLI and VBI bits report the most recent event: each clears the
			// other; NMIRES clears everything (but loses a same-cycle race).
			// The cycle is pinned by Acid800's cycle-counted NMIST samples.
			if (this.instruction & 0x80 && this.#lastLineArmed) {
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

			// The row counter: an instruction ends when the counter reaches
			// the line end — VSCROL (live) on a vertical-scroll exit line,
			// height-1 otherwise. A non-match keeps counting through the
			// 4-bit wrap (antic_vscroll's VSCROL-9-on-height-8 case). The
			// counter only runs for display-region lines; the vertical
			// blank closes any open instruction and the next one starts at
			// the top of the next frame (a VS region spanning the blank
			// continues there — antic_vscroll's last check).
			if (this.vcount > 8 && this.vcount < 248) {
				const lineEnd = this.#vsExit ? this.vscrol : this.modeLineHeight - 1;
				if (this.modeLineNo === lineEnd) {
					this.modeLineNo = 0;
					this.#newInstruction = true;
				} else {
					this.modeLineNo = (this.modeLineNo + 1) & 15;
					this.#newInstruction = false;
				}
			} else if (this.vcount === 248) {
				this.modeLineNo = 0;
				this.#newInstruction = true;
				this.#vsExit = false;
			}
		}

		if (this.waitingForVbi && this.vcount === 0) {
			this.waitingForVbi = false;
		}

		if (i === 0) {
			// The line's DMA pattern: visibility and the instruction state are
			// per-line inputs (mid-line register writes rebuild it too).
			this.#dmaVisibleLine =
				!this.waitingForVbi && this.vcount >= 8 && this.vcount < 248;
			this.#lineFetchWidth = 0;
			this.#rebuildDmaPattern();
		}

		// Request 9 refresh cycles every 4 cycles starting from 25
		if (REFRESH_REQUEST[i]) {
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

		// The DMA fetch itself — a bus access — is busCycle's job; beforeCpu
		// commits the cycle's scheduling without touching the bus.
		this.#dmaHpos = i;
	}

	/**
	 * The ANTIC bus phase: perform this cycle's DMA action (display list,
	 * P/M, character, or playfield fetch) or DRAM refresh, and set
	 * {@link halt} for it. The per-cycle decision is one lookup in the line's
	 * precomputed DMA pattern (see {@link buildDmaPattern}). Split out from
	 * {@link beforeCpu} — which commits the cycle's scheduling without
	 * touching the bus — so the read can be retried after a suspend without
	 * re-advancing ANTIC's counters. Call once per cycle, between beforeCpu
	 * and running the CPU.
	 */
	busCycle(): void {
		const entry = this.#dmaPattern[this.#dmaHpos]!;
		const action = entry & 0xff;

		if (action === DMA_NONE) {
			if (this.refreshPending) {
				// DRAM refresh cycle
				this.refreshPending = false;
				this.halt = true;
			} else {
				this.halt = false;
			}
			return;
		}

		this.halt = true;
		switch (action) {
			case DMA_MISSILE:
				this.#fetchMissiles();
				break;
			case DMA_PLAYER:
				this.#fetchPlayer(entry >> 8);
				break;
			case DMA_DL_FETCH:
				this.instruction = this.#dmaRead(this.displayListAddress);
				this.#incrementDisplayListAddress();
				this.#decodeInstruction();
				this.#rebuildDmaPattern();
				break;
			case DMA_DL_DECODE:
				// A new instruction with display-list DMA off: the stale
				// instruction re-decodes, but the bus is free.
				this.#decodeInstruction();
				this.#rebuildDmaPattern();
				if (this.refreshPending) {
					this.refreshPending = false;
				} else {
					this.halt = false;
				}
				break;
			case DMA_DL_LO:
				this.#fetchDlArgLo();
				break;
			case DMA_DL_HI:
				this.#fetchDlArgHi();
				break;
			case DMA_NAME:
				this.#fetchName(entry >> 8);
				break;
			case DMA_GLYPH:
				this.#fetchGlyph(entry >> 8);
				break;
			case DMA_BITMAP:
				this.#fetchBitmap(entry >> 8);
				break;
			case DMA_REPLAY:
				// Line-buffer replay: pixels flow but the bus is free — a
				// pending refresh may use the cycle.
				this.#replayBitmap(entry >> 8);
				if (this.refreshPending) {
					this.refreshPending = false;
				} else {
					this.halt = false;
				}
				break;
			case DMA_PF_SKIP:
				// A masked load slot (playfield DMA disabled mid-line): MSC
				// advances, the bus stays free, and the load takes the bus
				// value (completed in afterCpu once the CPU has driven it).
				this.#virtualLoad = entry;
				this.msc = ((this.msc + 1) & 0x0fff) | (this.msc & 0xf000);
				if (this.refreshPending) {
					this.refreshPending = false;
				} else {
					this.halt = false;
				}
				break;
			case DMA_GLYPH_VIRT:
				// A dropped fetch past the DMA cutoff: the load still runs,
				// from the bus (afterCpu completes it, like the phantom
				// GRAF latch).
				this.#virtualLoad = entry;
				if (this.refreshPending) {
					this.refreshPending = false;
				} else {
					this.halt = false;
				}
				break;
			case DMA_BITMAP_VIRT:
				this.#virtualLoad = entry;
				this.msc = ((this.msc + 1) & 0x0fff) | (this.msc & 0xf000);
				if (this.refreshPending) {
					this.refreshPending = false;
				} else {
					this.halt = false;
				}
				break;
		}
	}

	// The cycle GTIA took for this line's missile fetch: the first halted
	// cycle within horizontal blank, or -1 while none has occurred yet.
	#pmFetchCycle = -1;

	// A virtual/masked load slot from busCycle awaiting the bus value the
	// CPU drives during the slot cycle (Acid800 virtdma pins the capture
	// point via a timed LDA's operand byte).
	#virtualLoad = 0;

	afterCpu(frame: Uint8Array, busData: number) {
		if (this.#virtualLoad) {
			const entry = this.#virtualLoad;
			this.#virtualLoad = 0;
			const index = entry >> 8;
			const action = entry & 0xff;
			if (action === DMA_GLYPH_VIRT) {
				this.#emitGlyph(this.#buffer[index]!, busData);
			} else if (action === DMA_BITMAP_VIRT) {
				this.#buffer[index] = busData;
				this.#emitBitmapPixels(busData);
			} else {
				// DMA_PF_SKIP: capture the bus into the line buffer (MSC
				// already advanced in busCycle); the display stays off.
				this.#buffer[index] = busData;
			}
		}

		const pixels0 = this.#generateColor(0);

		const pixels1 = this.#generateColor(1);

		const left0 = pixels0 >> 8;
		const right0 = pixels0 & 0xff;

		const left1 = pixels1 >> 8;
		const right1 = pixels1 & 0xff;

		const i = this.hpos - 1;

		const x = i - 17;
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

			// GTIA has no window into ANTIC's DMA schedule: it takes the
			// first halted cycle within horizontal blank to be the missile
			// fetch, and the four cycles starting two later to be the player
			// fetches. With P/M DMA on that reproduces the real slots
			// (missile 0, players 2-5); with it off, a halted display-list
			// fetch is mistaken for the missile slot and the loads shift —
			// and a line with no halted HBLANK cycle loads nothing (AHRM;
			// Acid800 phantomdma).
			if (i === 0) {
				this.#pmFetchCycle = -1;
			}
			if (this.#pmFetchCycle < 0 && this.halt && i < 17) {
				this.#pmFetchCycle = i;
			}
			const pmSlot = this.#pmFetchCycle < 0 ? -1 : i - this.#pmFetchCycle;

			// The GRAF registers latch the bus during the P/M fetch slots only
			// when GRACTL enables it — with GRACTL off, direct GRAF writes
			// persist (the GTIA collision tests rely on that). The latch runs for
			// the whole visible region (scan lines 8-247 — the enclosing y < 240):
			// an earlier cut at y < 224 froze player graphics over the bottom 16
			// lines, which is invisible on NTSC but corrupts the lower HUD on PAL
			// (its taller frame puts content there) — River Raid's bug.
			if (pmSlot === 0 && this.enableMissiles) {
				// VDELAY bits 0-3 delay each missile independently, but
				// grafM packs all four (M0=bits 0-1 .. M3=bits 6-7), so
				// latch each pair on its own: a delayed missile updates only
				// on odd scanlines, exactly like the per-player logic below.
				let m = this.grafM;
				if (isOddScanline || !(this.vdelay & 0x01)) {
					m = (m & ~0x03) | (busData & 0x03);
				}
				if (isOddScanline || !(this.vdelay & 0x02)) {
					m = (m & ~0x0c) | (busData & 0x0c);
				}
				if (isOddScanline || !(this.vdelay & 0x04)) {
					m = (m & ~0x30) | (busData & 0x30);
				}
				if (isOddScanline || !(this.vdelay & 0x08)) {
					m = (m & ~0xc0) | (busData & 0xc0);
				}
				this.grafM = m;
			}

			if (this.enablePlayers) {
				if (pmSlot === 2 && (isOddScanline || !(this.vdelay & 0x10))) {
					this.grafP0 = busData;
				}

				if (pmSlot === 3 && (isOddScanline || !(this.vdelay & 0x20))) {
					this.grafP1 = busData;
				}

				if (pmSlot === 4 && (isOddScanline || !(this.vdelay & 0x40))) {
					this.grafP2 = busData;
				}

				if (pmSlot === 5 && (isOddScanline || !(this.vdelay & 0x80))) {
					this.grafP3 = busData;
				}
			}
		}
	}

	#generateColor(pos: 0 | 1): number {
		this.#applyPendingWrites();

		// The ANx value arriving this color clock; what paints now is the
		// previous one, sitting in GTIA's output register. The special
		// modes' pixel former pairs the two: on even color clocks it has
		// both halves of a fat pixel in hand.
		const incoming = this.#drawPlayfield(pos);
		const pf = this.#anxHold;
		this.#anxHold = incoming;

		if (pos === 0) {
			this.#gtiaPixelPrev = this.#gtiaPixel;
			this.#gtiaPrevBkMuted = this.#gtiaBkMuted;
			// AN2 is ignored: background and a %00 pair both contribute %00
			// — which is why borders read as pixel data in the special
			// modes.
			this.#gtiaPixel = ((pf & 0x3) << 2) | (incoming & 0x3);
			// The mode 10 lores anomaly: a true background code as the
			// second half mutes the playfield for the whole fat pixel
			// (AHRM 6.9; Acid800 psuedomodee).
			this.#gtiaBkMuted = !this.hires && incoming === 0;
		}

		const pm = this.#drawPlayerMissile(pos);
		const gtiaMode = this.#gtiaModes ? this.prior & 0xc0 : 0;

		// Latch the line's special-mode state at color clock 33 (the
		// boundary is pinned from both sides by psuedomodee's
		// one-cycle-apart PRIOR writes).
		if (pos === 1 && this.hpos - 1 === 16) {
			this.#lineGtiaMode = gtiaMode;
		}

		if (gtiaMode === 0) {
			if (this.#lineGtiaMode !== 0) {
				// Pseudo mode E: the special mode was still on at the line
				// latch, so each AN0-1 pair decodes as PF0-PF3 — one pair
				// per color clock, background included.
				const code = 0x8 | (pf & 0x3);
				this.#detectCollisions(code, pm);
				const color = this.#resolvePriority(code, pm, 0);
				return (color << 8) | color;
			}
			this.#detectCollisions(pf, pm);
			const color = this.#resolvePriority(pf, pm, 0);
			if (pf & 0x4) {
				// Apply hires luminance
				const left =
					pf & 0x2
						? (color & 0xf0) | (this.colorRegisters[COLPF1]! & 0xf)
						: color;
				const right =
					pf & 0x1
						? (color & 0xf0) | (this.colorRegisters[COLPF1]! & 0xf)
						: color;
				return (left << 8) | right;
			}
			return (color << 8) | color;
		}

		// GTIA special modes. Hires (the PF1-luma splice) is forced off.
		let color: number;
		if (gtiaMode === 0x80) {
			// Mode 10 (9-color) runs one color clock behind the other modes
			// (its extra delay line), so even color clocks replay the
			// previous fat pixel. Pixel codes select color registers: 0-3
			// act as that player for priority but trigger no player
			// collisions, x100-x111 are PF0-PF3 with real playfield
			// collisions, 10xx is background.
			const px = pos === 0 ? this.#gtiaPixelPrev : this.#gtiaPixel;
			const muted = pos === 0 ? this.#gtiaPrevBkMuted : this.#gtiaBkMuted;
			if (muted || (px & 0xc) === 0x8) {
				this.#detectCollisions(0, pm);
				color = this.#resolvePriority(0, pm, 0);
			} else if (px & 0x4) {
				const code = 0x8 | (px & 0x3);
				this.#detectCollisions(code, pm);
				color = this.#resolvePriority(code, pm, 0);
			} else {
				this.#detectCollisions(0, pm);
				color = this.#resolvePriority(0, pm, 1 << px);
			}
		} else {
			// Modes 9 and 11: the playfield is background for priority and
			// collisions — P/M always win and no playfield collision
			// latches.
			this.#detectCollisions(0, pm);
			color =
				gtiaMode === 0x40
					? this.#resolveGtia9(this.#gtiaPixel, pm)
					: this.#resolveGtia11(this.#gtiaPixel, pm);
		}
		return (color << 8) | color;
	}

	// P/M-above-playfield resolution shared by modes 9 and 11: any player
	// (or non-fifth missile) wins outright and the playfield drops out.
	// Returns -1 when no P/M is active — the caller supplies the playfield
	// color and the fifth-player mix.
	#resolveGtiaPm(pm: number): number {
		const regs = this.colorRegisters;
		let p = pm >> 4;
		if (!(this.prior & 0x10)) {
			p |= pm & 0xf;
		}
		if (p & 0x3) {
			return this.prior & 0x20 && (p & 0x3) === 0x3
				? regs[COLPM0]! | regs[COLPM1]!
				: p & 0x1
					? regs[COLPM0]!
					: regs[COLPM1]!;
		}
		if (p & 0xc) {
			return this.prior & 0x20 && (p & 0xc) === 0xc
				? regs[COLPM2]! | regs[COLPM3]!
				: p & 0x4
					? regs[COLPM2]!
					: regs[COLPM3]!;
		}
		return -1;
	}

	// Mode 9 (PRIOR %01): 16 luminances of COLBK's hue. The pixel bypasses
	// the color registers (the only path to an odd luminance bit) and ORs
	// with COLBK; a fifth-player missile mixes as PF3 OR the luminance.
	#resolveGtia9(px: number, pm: number): number {
		const winner = this.#resolveGtiaPm(pm);
		if (winner >= 0) return winner;
		if (this.prior & 0x10 && pm & 0xf) {
			return this.colorRegisters[COLPF3]! | px;
		}
		return this.colorRegisters[COLBK]! | px;
	}

	// Mode 11 (PRIOR %11): 16 hues at COLBK's luminance, except pixel %0000
	// is forced to luminance 0. A fifth-player missile replaces COLBK with
	// PF3 (the luma-0 rule still wins).
	#resolveGtia11(px: number, pm: number): number {
		const winner = this.#resolveGtiaPm(pm);
		if (winner >= 0) return winner;
		const base =
			this.prior & 0x10 && pm & 0xf
				? this.colorRegisters[COLPF3]!
				: this.colorRegisters[COLBK]!;
		const color = base | (px << 4);
		return px === 0 ? color & 0xf0 : color;
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

	// HSCROL's odd bit: the fetch start shifts in whole cycles (2 color
	// clocks); the remaining color clock is a one-pixel delay here.
	#pfFineDelay = 0;

	// GTIA's output register: the ANx value painting this color clock (the
	// final color clock of the fetch-to-screen pipe).
	#anxHold = 0;

	// The special modes' pixel former: two consecutive AN0-1 payloads make
	// one 4-bit fat pixel, paired on even color clocks (fixed screen
	// alignment — odd HSCROL regroups bits rather than shifting pixels,
	// AHRM 6.9). #gtiaPixelPrev serves mode 10's one-color-clock delay;
	// the muted flags carry the lores background anomaly.
	#gtiaPixel = 0;
	#gtiaPixelPrev = 0;
	#gtiaBkMuted = false;
	#gtiaPrevBkMuted = false;

	// The line's special-mode state, latched near the end of horizontal
	// blank (color clock 32). Turning PRIOR bits 6-7 off after the latch
	// leaves the pair-decode machinery engaged for the rest of the line:
	// "pseudo mode E", where each AN0-1 pair paints and collides as
	// PF0-PF3 (Acid800 psuedomodee pins the one-cycle window).
	#lineGtiaMode = 0;

	// The ANx bus value for this color clock.
	// 00: BK; 8..B: PF0..PF3; C..F: Hires 00..11
	#drawPlayfield(pos: 0 | 1): number {
		// Tick the pipe only while codes are in flight (the drain window set
		// at push time) — an idle pipe paints background with its cursor
		// frozen, which is sound for the same reason as the write lines.
		let pixel: number;
		if (this.#anxDrain === 0) {
			pixel = 0;
		} else {
			this.#anxDrain--;
			pixel = this.#anxLine.tick();
		}
		const scrolled =
			(this.instruction & 0x0f) > 1 && (this.instruction & 0x10) !== 0;
		if (scrolled && this.hscrol & 1) {
			const delayed = this.#pfFineDelay;
			this.#pfFineDelay = pixel;
			pixel = delayed;
		} else {
			this.#pfFineDelay = pixel;
		}
		if (scrolled) {
			// The widened fetch's margin pixels are never displayed: the
			// window stays at the unwidened width, and ANTIC masks its
			// output outside it (the pipe is still consumed above). Without
			// this, memory just left of the LMS window — typically the
			// previous row's right edge — bleeds into the left border. The
			// bounds are the display starts (HPOS 64/48/32) minus the one
			// color clock this stream still spends in GTIA's output
			// register.
			const t = (this.hpos - 1) * 2 + pos;
			const start = PF_WINDOW_START[this.playfieldWidth];
			const width = PF_WINDOW_WIDTH[this.playfieldWidth];
			if (t < start || t >= start + width) {
				return 0;
			}
		}
		return pixel;
	}

	// 1 bit for each player or missile. 1 means active, 0 means inactive
	#drawPlayerMissile(pos: 0 | 1): number {
		const i = this.hpos - 1;

		const x = i - 17;
		const y = this.vcount - 8;

		if (y < 0 || y >= 240) {
			return 0;
		}

		// A sprite triggered in the left horizontal blank still shifts its
		// pixels into the visible region and collides there, so the shift
		// registers must load and advance regardless of the horizontal window —
		// only the output is blanked outside it. Gating the load on x (as a
		// single early return did) dropped the whole sprite when it triggered
		// in HBLANK, losing the pixels that spill into the visible area.
		const visible = x >= 0 && x < 94;

		// Beam-anchored: afterCpu for machine cycle i paints color clocks 2i
		// and 2i+1, so the comparator matches when the beam reaches the
		// register position (HPOS write latency comes from the write pipe).
		const start = (this.hpos - 1) * 2 + pos;

		// A comparator match forces the shift state machine into %00 — a
		// transition that itself shifts the register once — and then ORs
		// the graphics latch in. On a bit-cell boundary the natural shift
		// already made that transition (counter 0 here), so no extra shift
		// happens. An empty register makes all of this invisible (the
		// normal case); an image still in flight comes out shifted a step
		// and merged with the new one (AHRM 6.5 "Overlapping object
		// images"; the shift-then-OR order and the coincident-boundary case
		// are pinned by Acid800 pmoverlap's pixel tables).
		if (start === this.hposp0) {
			if (this.#sizeP0Counter) this.#shiftP0 = (this.#shiftP0 << 1) & 0xff;
			this.#shiftP0 |= this.grafP0;
			this.#sizeP0Counter = 0;
		}
		if (start === this.hposp1) {
			if (this.#sizeP1Counter) this.#shiftP1 = (this.#shiftP1 << 1) & 0xff;
			this.#shiftP1 |= this.grafP1;
			this.#sizeP1Counter = 0;
		}
		if (start === this.hposp2) {
			if (this.#sizeP2Counter) this.#shiftP2 = (this.#shiftP2 << 1) & 0xff;
			this.#shiftP2 |= this.grafP2;
			this.#sizeP2Counter = 0;
		}
		if (start === this.hposp3) {
			if (this.#sizeP3Counter) this.#shiftP3 = (this.#shiftP3 << 1) & 0xff;
			this.#shiftP3 |= this.grafP3;
			this.#sizeP3Counter = 0;
		}
		if (start === this.hposm0) {
			if (this.#sizeM0Counter) this.#shiftM0 = (this.#shiftM0 << 1) & 0xff;
			this.#shiftM0 |= (this.grafM << 6) & 0xc0;
			this.#sizeM0Counter = 0;
		}
		if (start === this.hposm1) {
			if (this.#sizeM1Counter) this.#shiftM1 = (this.#shiftM1 << 1) & 0xff;
			this.#shiftM1 |= (this.grafM << 4) & 0xc0;
			this.#sizeM1Counter = 0;
		}
		if (start === this.hposm2) {
			if (this.#sizeM2Counter) this.#shiftM2 = (this.#shiftM2 << 1) & 0xff;
			this.#shiftM2 |= (this.grafM << 2) & 0xc0;
			this.#sizeM2Counter = 0;
		}
		if (start === this.hposm3) {
			if (this.#sizeM3Counter) this.#shiftM3 = (this.#shiftM3 << 1) & 0xff;
			this.#shiftM3 |= this.grafM & 0xc0;
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

		return visible ? result : 0;
	}

	// Get playfield and P/M outputs and detect collisions
	#detectCollisions(pf: number, pm: number): void {
		// Convert PF output into individual bits
		let f: number;
		if (!pf) {
			// BK
			f = 0;
		} else if (pf & 0x4) {
			// Hires. A lit pixel is a PF2 pixel (with PF1 luma — but the
			// luma line doesn't drive collisions); an unlit one is
			// background, no collision.
			if (pf & 0x3) {
				f = 0b0100;
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

	// Resolve playfield and P/M priority to a palette index: a PRIORITY_TABLE
	// lookup (which handles all sixteen PRIOR[3:0] values, conflicts
	// included) selects the surviving color sources, whose registers OR
	// together — an empty selection is a conflict and paints black.
	#resolvePriority(pf: number, pm: number, extraPlayers: number): number {
		const prior = this.prior;

		// The playfield class: 0 BAK, 1-4 PF0-PF3. A hires pixel is PF2 for
		// priority purposes, lit or not (the playfield covers the window).
		const pfClass = pf & 0x4 ? 3 : pf ? (pf & 0x3) + 1 : 0;

		let p = pm >> 4;
		let p5 = 0;
		if (prior & 0x10 && pm & 0xf) {
			// Fifth player
			p5 = 1 << 13;
		} else {
			// Treat missiles like players
			p |= pm & 0xf;
		}

		// Mode 10 pixel codes 0-3 act as that player for priority only —
		// they trigger no collisions (the caller keeps them out of pm).
		p |= extraPlayers;

		let mask = PRIORITY_TABLE[(prior & 0x3f) | (pfClass << 6) | (p << 9) | p5]!;
		let color = 0;
		while (mask) {
			color |= this.colorRegisters[31 - Math.clz32(mask & -mask)]!;
			mask &= mask - 1;
		}
		return color;
	}

	// Decode the current instruction's mode fields and vertical-scroll state.
	// Runs at cycle 1 of a new instruction's first scan line — right after
	// the display-list fetch, or on the stale instruction when display-list
	// DMA is off.
	#decodeInstruction(): void {
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
			this.modeLineHeight = LINES_PER_MODE[mode]!;
			this.charFetchRate = CHAR_FETCH_RATE[mode]!;
			this.playfieldFetchRate = PLAYFIELD_FETCH_RATE[mode]!;
			this.hires = PLAYFIELD_HI_RES[mode]!;
		}

		// Vertical scrolling: only real modes carry the VS bit (it's a
		// height bit on blanks and unused on jumps), but the *exit* applies
		// to whatever instruction follows the region — antic_vscroldli
		// exits into a blank line.
		const vs = mode > 1 && (this.instruction & 0x20) !== 0;
		this.#vsExit = this.#vsRegion && !vs;
		if (vs && !this.#vsRegion) {
			// The entry line starts the row counter at VSCROL.
			this.modeLineNo = this.vscrol;
		}
		this.#vsRegion = vs;
	}

	// Jump/LMS operand fetches (cycles 6 and 7 — the pattern emits them only
	// when the instruction has operands).
	#fetchDlArgLo(): void {
		if ((this.instruction & 0x0f) === 0x01) {
			// Jump
			this.#temp = this.#dmaRead(this.displayListAddress);
			this.#incrementDisplayListAddress();
		} else {
			// LMS
			const byte = this.#dmaRead(this.displayListAddress);
			this.msc = byte | (this.msc & 0xff00);
			this.#incrementDisplayListAddress();
		}
	}

	#fetchDlArgHi(): void {
		if ((this.instruction & 0x0f) === 0x01) {
			// Jump
			this.displayListAddress =
				(this.#dmaRead(this.displayListAddress) << 8) | this.#temp;
			if (this.instruction & 0x40) {
				this.waitingForVbi = true;
			}
		} else {
			// LMS
			const byte = this.#dmaRead(this.displayListAddress);
			this.msc = (byte << 8) | (this.msc & 0xff);
			this.#incrementDisplayListAddress();
		}
	}

	#fetchMissiles(): void {
		let base: number;
		let offset: number;
		if (this.verticalPmResolution === 1) {
			// One-line resolution: PMBASE is 2K-aligned (bits 0-2 ignored).
			base = (this.pmbase & 0xf8) * 256;
			offset = 768;
		} else {
			// Two-line resolution: PMBASE is 1K-aligned (bits 0-1 ignored).
			base = (this.pmbase & 0xfc) * 256;
			offset = 384;
		}

		this.#dmaRead(
			base + offset + Math.floor(this.vcount / this.verticalPmResolution),
		);
	}

	#fetchPlayer(n: number): void {
		let base: number;
		let offset: number;
		if (this.verticalPmResolution === 1) {
			// One-line resolution: PMBASE is 2K-aligned (bits 0-2 ignored).
			base = (this.pmbase & 0xf8) * 256;
			offset = 1024 + n * 256;
		} else {
			// Two-line resolution: PMBASE is 1K-aligned (bits 0-1 ignored).
			base = (this.pmbase & 0xfc) * 256;
			offset = 512 + n * 128;
		}

		this.#dmaRead(
			base + offset + Math.floor(this.vcount / this.verticalPmResolution),
		);
	}

	// Read a character name from MSC into the line buffer.
	#fetchName(bufferIndex: number): void {
		this.#buffer[bufferIndex] = this.#dmaRead(this.msc);
		this.msc = ((this.msc + 1) & 0x0fff) | (this.msc & 0xf000); // Cannot cross 4K without reload
	}

	// Character glyph data fetch: read the buffered name's glyph row from
	// CHBASE and ship it into the ANx pipe.
	#fetchGlyph(bufferIndex: number): void {
		const charNo = this.#buffer[bufferIndex]!;
		this.#emitGlyph(charNo, this.#dmaRead(this.#glyphAddress(charNo)));
	}

	// The glyph row address for a character name under the current mode. The
	// two-line-resolution modes (5 and 7) halve the row; mode 3 wraps its
	// 10-line counter into the 3-bit row (its out-of-quadrant blanking lives
	// in #emitGlyph).
	#glyphAddress(charNo: number): number {
		const mode = this.instruction & 0x0f;
		const base =
			mode < 6
				? // 1024-byte char set
					(this.chbase & 0xfe) * 256 + (charNo & 0x7f) * 8
				: // 512-byte char set
					this.chbase * 256 + (charNo & 0x3f) * 8;
		const line = this.modeLineNo;
		const row =
			mode === 3 ? line & 7 : mode === 5 || mode === 7 ? line >> 1 : line;
		return base + this.#charRow(row);
	}

	// Decode a glyph row into pfPixels and ship it. `data` is the raw byte —
	// fetched, or straight off the bus for a virtual load; the CHACTL
	// transforms and mode 3's blanking apply here, downstream of the fetch.
	#emitGlyph(charNo: number, data: number): void {
		const mode = this.instruction & 0x0f;
		switch (mode) {
			case 2:
				{
					// 8 hires pixels (4 color clocks)
					const bits = this.#charTransform(data, charNo);

					this.pfPixels[0] = hires(bits);
					this.pfPixels[1] = hires(bits >> 2);
					this.pfPixels[2] = hires(bits >> 4);
					this.pfPixels[3] = hires(bits >> 6);
					this.pfCounter = 4;
				}
				break;

			case 3:
				{
					// Like mode 2 but 10 scanlines tall: one quadrant of the
					// char set — $60-$7F, the "descenders" — blanks rows 0-1
					// and shows the wrapped fetch at rows 8-9, while the rest
					// blank rows 8-9 (Acid800 antic_charcontrol).
					const line = this.modeLineNo;
					const descender = (charNo & 0x60) === 0x60;
					const bits = this.#charTransform(
						data,
						charNo,
						descender ? line < 2 : line >= 8,
					);

					this.pfPixels[0] = hires(bits);
					this.pfPixels[1] = hires(bits >> 2);
					this.pfPixels[2] = hires(bits >> 4);
					this.pfPixels[3] = hires(bits >> 6);
					this.pfCounter = 4;
				}
				break;

			case 4:
			case 5:
				{
					// 4 lores pixels with 5 colors
					const useColPf3 = !!(charNo & 0x80);

					this.pfPixels[0] = loresPixel(data, useColPf3);
					this.pfPixels[1] = loresPixel(data >> 2, useColPf3);
					this.pfPixels[2] = loresPixel(data >> 4, useColPf3);
					this.pfPixels[3] = loresPixel(data >> 6, useColPf3);
					this.pfCounter = 4;
				}
				break;

			case 6:
			case 7:
				{
					// 8 lores pixels, all same color
					const color = lores(charNo >> 6);

					this.pfPixels.fill(0);
					this.pfCounter = 8;
					let i = 0;
					while (data) {
						const bit = data & 1;
						data >>= 1;
						const out = bit ? color : BG;
						this.pfPixels[i++] = out;
					}
				}
				break;

			default:
				break;
		}

		this.#pushPfBatch(ANX_CHAR_DELAY);
	}

	// Bitmap data fetch: read from MSC into the line buffer and ship the
	// pixels into the ANx pipe. The pattern emits this on the instruction's
	// first scan line — not row-counter zero: a vertical-scroll entry starts
	// the row counter at VSCROL, but the load happens regardless (Acid800
	// psuedomodee stretches a mode F line with VSCROL=1 and expects its data
	// fetched).
	#fetchBitmap(bufferIndex: number): void {
		const data = this.#dmaRead(this.msc);
		this.#buffer[bufferIndex] = data;
		this.msc = ((this.msc + 1) & 0x0fff) | (this.msc & 0xf000); // Cannot cross 4K without reload
		this.#emitBitmapPixels(data);
	}

	// Replay a later scan line from the line buffer: the pixels flow into
	// the pipe with no bus access.
	#replayBitmap(bufferIndex: number): void {
		this.#emitBitmapPixels(this.#buffer[bufferIndex]!);
	}

	#emitBitmapPixels(data: number): void {
		const mode = this.instruction & 0x0f;
		{
			switch (mode) {
				case 0x8:
					{
						this.pfPixels[0] = loresPixel(data, false);
						this.pfPixels[1] = this.pfPixels[0];
						this.pfPixels[2] = this.pfPixels[0];
						this.pfPixels[3] = this.pfPixels[0];

						this.pfPixels[4] = loresPixel(data >> 2, false);
						this.pfPixels[5] = this.pfPixels[4];
						this.pfPixels[6] = this.pfPixels[4];
						this.pfPixels[7] = this.pfPixels[4];

						this.pfPixels[8] = loresPixel(data >> 4, false);
						this.pfPixels[9] = this.pfPixels[8];
						this.pfPixels[10] = this.pfPixels[8];
						this.pfPixels[11] = this.pfPixels[8];

						this.pfPixels[12] = loresPixel(data >> 6, false);
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
						const out = bit ? 0x8 : BG;
						this.pfPixels[i++] = out;
						this.pfPixels[i++] = out;
						this.pfPixels[i++] = out;
						this.pfPixels[i++] = out;
					}
					break;
				}

				case 0xa:
					{
						this.pfPixels[0] = loresPixel(data, false);
						this.pfPixels[1] = this.pfPixels[0];
						this.pfPixels[2] = loresPixel(data >> 2, false);
						this.pfPixels[3] = this.pfPixels[2];
						this.pfPixels[4] = loresPixel(data >> 4, false);
						this.pfPixels[5] = this.pfPixels[4];
						this.pfPixels[6] = loresPixel(data >> 6, false);
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
						const out = bit ? 0x8 : BG;
						this.pfPixels[i++] = out;
					}
					break;
				}

				case 0xd:
				case 0xe:
					{
						this.pfPixels[0] = loresPixel(data, false);
						this.pfPixels[1] = loresPixel(data >> 2, false);
						this.pfPixels[2] = loresPixel(data >> 4, false);
						this.pfPixels[3] = loresPixel(data >> 6, false);
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

		this.#pushPfBatch(ANX_BITMAP_DELAY);
	}

	// Ship the pending byte into the ANx pipe, leftmost pixel first
	// (pfPixels holds it right to left).
	#pushPfBatch(delay: number): void {
		const horizon = delay + this.pfCounter;
		if (horizon > this.#anxDrain) this.#anxDrain = horizon;
		for (let k = this.pfCounter - 1; k >= 0; k--, delay++) {
			this.#anxLine.scheduleValue(delay, this.pfPixels[k]!);
		}
		this.pfCounter = 0;
	}

	// CHACTL bit 2 (vertical reflect) flips the glyph row within the 8-row
	// character cell. The row fed to the address adder is 3 bits wide either
	// way — a counter past 7 (VSCROL abuse, mode 3's rows 8-9) wraps rather
	// than reading into the next glyph.
	#charRow(row: number): number {
		return (this.chactl & 0x04 ? row ^ 7 : row) & 7;
	}

	// CHACTL transforms for the hires char modes (2 and 3). `blankRow` is
	// mode 3's out-of-quadrant blanking; it lands before the inverse-video
	// handling, so an inverted blank row renders solid — and the fetch still
	// happens either way. For inverse-video chars, blank (bit 0) wins over
	// invert (bit 1): both set renders solid.
	#charTransform(data: number, charNo: number, blankRow = false): number {
		if (blankRow) data = 0;
		if (charNo & 0x80) {
			if (this.chactl & 0x01) data = 0;
			if (this.chactl & 0x02) data ^= 0xff;
		}
		return data;
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
				line += "BLANK " + String(((instruction & 0x70) >> 4) + 1);
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

// Per-playfield-width tables, indexed by DMACTL width bits (0 = off,
// 1/2/3 = narrow/normal/wide).

// The unwidened display window on the ANx stream, in color clocks: the
// display starts (HPOS 64/48/32) minus the one color clock the stream still
// spends in GTIA's output register; widths in color clocks.
const PF_WINDOW_START = [0, 63, 47, 31] as const;
const PF_WINDOW_WIDTH = [0, 128, 160, 192] as const;

// Playfield fetch-slot start cycles (see the ANX delay comment at the top):
// character names, character glyph data (names + 3), and bitmap data (the
// true playfield DMA slots); the fetch window width in cycles.
const NAME_FETCH_START = [0, 26, 18, 10] as const;
const GLYPH_FETCH_START = [0, 29, 21, 13] as const;
const BITMAP_FETCH_START = [0, 28, 20, 12] as const;
const FETCH_WIDTH = [0, 64, 80, 96] as const;

// DRAM refresh requests: 9 slots every 4 cycles starting from 25.
const REFRESH_REQUEST = new Uint8Array(114);
for (let c = 25; c <= 57; c += 4) REFRESH_REQUEST[c] = 1;

// DMA action codes for the per-line pattern table: busCycle dispatches on
// `pattern[cycle] & 0xff`, with the action's argument (player number or
// line-buffer index) in the high byte.
const DMA_NONE = 0;
const DMA_MISSILE = 1;
const DMA_PLAYER = 2;
const DMA_DL_FETCH = 3; // fetch + decode the instruction (halts)
const DMA_DL_DECODE = 4; // decode only — display-list DMA off (bus free)
const DMA_DL_LO = 5; // jump/LMS operand low byte
const DMA_DL_HI = 6; // jump/LMS operand high byte
const DMA_NAME = 7; // character name into the line buffer
const DMA_GLYPH = 8; // character glyph data
const DMA_BITMAP = 9; // bitmap data into the line buffer (first scan line)
const DMA_REPLAY = 10; // line-buffer replay: pixels flow, bus free
const DMA_PF_SKIP = 11; // masked load slot: MSC advances, bus free
const DMA_GLYPH_VIRT = 12; // dropped glyph fetch: loads from the bus
const DMA_BITMAP_VIRT = 13; // dropped bitmap fetch: loads from the bus

// Playfield DMA may occupy cycles only through 105; a fetch slot pushed
// past that by HSCROL on a wide (or widened) playfield is dropped as a bus
// request, but the load machinery still runs and takes whatever is on the
// bus — "virtual DMA" (AHRM's dropped-cycles note; Acid800 antic_virtdma).
const VIRTUAL_DMA_CUTOFF = 106;

/**
 * Build a scanline's DMA pattern from a state key. A line's whole pattern is
 * a pure function of rarely-changing state, so patterns are computed once
 * and cached (see #rebuildDmaPattern for the key layout); busCycle then
 * reduces to one table lookup per cycle. DRAM refresh is deliberately NOT in
 * the table — the pending-refresh flag is live, sequential state (a blocked
 * request slides to the next free cycle), and stays in busCycle.
 */
function buildDmaPattern(key: number): Uint16Array {
	const pattern = new Uint16Array(114);
	if (key & 0b1) pattern[0] = DMA_MISSILE;
	if (key & 0b10) {
		for (let n = 0; n < 4; n++) pattern[2 + n] = DMA_PLAYER | (n << 8);
	}
	if (!(key & 0b100)) return pattern; // not a visible line: P/M only

	const newInstruction = (key & 0b1000) !== 0;
	const dlDma = (key & 0b10000) !== 0;
	const mode = (key >> 5) & 0x0f;
	const lms = (key & 0x200) !== 0;
	const scrolled = (key & 0x400) !== 0;
	const hscrolHalf = (key >> 11) & 0x7;
	const width = (key >> 14) & 0x3;

	if (newInstruction) {
		pattern[1] = dlDma ? DMA_DL_FETCH : DMA_DL_DECODE;
		if (dlDma && (mode === 1 || (mode > 1 && lms))) {
			pattern[6] = DMA_DL_LO;
			pattern[7] = DMA_DL_HI;
		}
	}

	const charRate = CHAR_FETCH_RATE[mode]!;
	const pfRate = PLAYFIELD_FETCH_RATE[mode]!;
	if (!pfRate) return pattern;

	if (!width) {
		// Playfield DMA disabled after the line's playfield started: the
		// load machinery keeps running without the bus, so MSC keeps
		// advancing at the name/bitmap load slots (AHRM "loading the line
		// buffer"; Acid800 linebuffering's mid-interrupted mode 8). The
		// buffer keeps stale content where hardware loads bus noise
		// (deliberately untested by the suite); glyph and replay slots do
		// nothing.
		const lineWidth = (key >> 16) & 0x3;
		if (!lineWidth || !newInstruction) return pattern;
		const shift = scrolled ? hscrolHalf : 0;
		const span = FETCH_WIDTH[lineWidth as 1 | 2 | 3];
		const start =
			(charRate
				? NAME_FETCH_START[lineWidth as 1 | 2 | 3]
				: BITMAP_FETCH_START[lineWidth as 1 | 2 | 3]) + shift;
		const rate = charRate || pfRate;
		for (let c = start, n = 0; c < start + span && c < 114; c += rate, n++) {
			pattern[c] = DMA_PF_SKIP | (n << 8);
		}
		return pattern;
	}

	// Widen if HSCROL is enabled; the fetch start also shifts by the whole
	// cycles of the scroll value.
	let fetchWidth = width;
	if (scrolled && (fetchWidth === 1 || fetchWidth === 2)) fetchWidth++;
	const shift = scrolled ? hscrolHalf : 0;
	const span = FETCH_WIDTH[fetchWidth as 1 | 2 | 3];

	if (charRate && newInstruction) {
		// Name fetches can't reach the virtual-DMA cutoff (their latest
		// possible slot is 105).
		const start = NAME_FETCH_START[fetchWidth as 1 | 2 | 3] + shift;
		for (
			let c = start, n = 0;
			c < start + span && c < 114;
			c += charRate, n++
		) {
			pattern[c] = DMA_NAME | (n << 8);
		}
	}

	const start =
		(charRate
			? GLYPH_FETCH_START[fetchWidth as 1 | 2 | 3]
			: BITMAP_FETCH_START[fetchWidth as 1 | 2 | 3]) + shift;
	const action = charRate
		? DMA_GLYPH
		: newInstruction
			? DMA_BITMAP
			: DMA_REPLAY;
	// Slots pushed past the DMA cutoff still load — from the bus (replay
	// never touches the bus and is unaffected).
	const virtualAction = charRate
		? DMA_GLYPH_VIRT
		: newInstruction
			? DMA_BITMAP_VIRT
			: DMA_REPLAY;
	for (let c = start, n = 0; c < start + span && c < 114; c += pfRate, n++) {
		pattern[c] = (c >= VIRTUAL_DMA_CUTOFF ? virtualAction : action) | (n << 8);
	}

	return pattern;
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

const BG = 0x0;

// C D E F (bit 2 and 3)
function hires(bits: number): number {
	return 0xc | (bits & 0x3);
}

// 8 9 A B (bit 3)
function lores(index: number): number {
	return 0x8 | (index & 0x3);
}

// 0 8 9 A B
function loresPixel(index: number, pf3: boolean): number {
	index = index & 3;

	if (!index) return BG;

	index--;
	if (index === 2 && pf3) {
		index = 3;
	}

	return lores(index);
}

// colorRegisters indices, doubling as the priority table's selector bits.
const COLPM0 = 0;
const COLPM1 = 1;
const COLPM2 = 2;
const COLPM3 = 3;
const COLPF0 = 4;
const COLPF1 = 5;
const COLPF2 = 6;
const COLPF3 = 7;
const COLBK = 8;

/**
 * GTIA's priority gate network (AHRM 6.7). Each PRIOR bit activates
 * cross-disable signals between the player and playfield layers; the output
 * is the OR of the surviving sources, and a conflict that suppresses every
 * source paints black. The fifth player asserts the PF3 input — winning over
 * the other playfields through the /SF3 terms — while its missiles keep
 * their own collision identities.
 *
 * These are AHRM's stated "exact logic" equations, with two refinements
 * pinned by the complete table 16 (unit-tested cell by cell):
 *
 * - The published /SF3 term in SF0-SF2 is really the PF3 *input* (fifth
 *   player included) — indistinguishable for real playfields, whose classes
 *   are exclusive, but with the fifth player it implements "always wins
 *   against all other playfields" unconditionally.
 * - Three cells where a player-suppressed SF3 should stop suppressing
 *   players (P5-as-only-playfield conflicts), plus the %1000
 *   P5-over-PF01-over-players cascade from the prose, don't follow from any
 *   static reading of the equations: those are explicit measured overrides.
 */
function resolvePriorityGates(
	prior: number,
	pfClass: number,
	p: number,
	p5: boolean,
): number {
	const pri0 = (prior & 1) !== 0;
	const pri1 = (prior & 2) !== 0;
	const pri2 = (prior & 4) !== 0;
	const pri3 = (prior & 8) !== 0;
	const multi = (prior & 0x20) !== 0;

	const p0 = (p & 1) !== 0;
	const p1 = (p & 2) !== 0;
	const p2 = (p & 4) !== 0;
	const p3 = (p & 8) !== 0;
	const pf0 = pfClass === 1;
	const pf1 = pfClass === 2;
	const pf2 = pfClass === 3;
	const pf3 = pfClass === 4 || p5;

	const p01 = p0 || p1;
	const p23 = p2 || p3;
	const pf01 = pf0 || pf1;
	const pf23 = pf2 || pf3;

	// Measured overrides — see the doc comment.
	if (p5) {
		const pri = prior & 0x0f;
		const pair01 =
			(p0 ? 1 << COLPM0 : 0) | (p1 && (!p0 || multi) ? 1 << COLPM1 : 0);
		const pair23 =
			(p2 ? 1 << COLPM2 : 0) | (p3 && (!p2 || multi) ? 1 << COLPM3 : 0);
		if (pfClass === 0 && p23 && (pri === 0b0101 || pri === 0b1100)) {
			return p01 && pri === 0b0101 ? 0 : p01 ? pair01 : pair23;
		}
		if (pf01 && (p01 || p23) && pri === 0b1000) {
			return 1 << COLPF3;
		}
	}

	const pri01 = pri0 || pri1;
	const pri12 = pri1 || pri2;
	const pri23 = pri2 || pri3;
	const pri03 = pri0 || pri3;

	const sp0 = p0 && !(pf01 && pri23) && !(pri2 && pf23);
	const sp1 = p1 && !(pf01 && pri23) && !(pri2 && pf23) && (!p0 || multi);
	const sp2 = p2 && !p01 && !(pf23 && pri12) && !(pf01 && !pri0);
	const sp3 =
		p3 && !p01 && !(pf23 && pri12) && !(pf01 && !pri0) && (!p2 || multi);
	const sf3 = pf3 && !(p23 && pri03) && !(p01 && !pri2);
	const sf0 = pf0 && !(p23 && pri0) && !(p01 && pri01) && !pf3;
	const sf1 = pf1 && !(p23 && pri0) && !(p01 && pri01) && !pf3;
	const sf2 = pf2 && !(p23 && pri03) && !(p01 && !pri2) && !pf3;
	const sb = !p01 && !p23 && !pf01 && !pf23;

	return (
		(sp0 ? 1 << COLPM0 : 0) |
		(sp1 ? 1 << COLPM1 : 0) |
		(sp2 ? 1 << COLPM2 : 0) |
		(sp3 ? 1 << COLPM3 : 0) |
		(sf0 ? 1 << COLPF0 : 0) |
		(sf1 ? 1 << COLPF1 : 0) |
		(sf2 ? 1 << COLPF2 : 0) |
		(sf3 ? 1 << COLPF3 : 0) |
		(sb ? 1 << COLBK : 0)
	);
}

// The gates, precomputed: selector masks over colorRegisters (bit 8 =
// COLBK), indexed by PRIOR's low 6 bits, the playfield class (0 BAK,
// 1-4 PF0-PF3), the player bits, and the fifth-player flag.
const PRIORITY_TABLE = new Uint16Array(1 << 14);
for (let prior = 0; prior < 64; prior++) {
	for (let pfClass = 0; pfClass < 5; pfClass++) {
		for (let p = 0; p < 16; p++) {
			for (let p5 = 0; p5 < 2; p5++) {
				PRIORITY_TABLE[prior | (pfClass << 6) | (p << 9) | (p5 << 13)] =
					resolvePriorityGates(prior, pfClass, p, p5 === 1);
			}
		}
	}
}

/** The priority selector mask for a source combination. Exported for tests. */
export function prioritySelector(
	prior: number,
	pfClass: number,
	p: number,
	p5: boolean,
): number {
	return PRIORITY_TABLE[
		(prior & 0x3f) | (pfClass << 6) | (p << 9) | (p5 ? 1 << 13 : 0)
	]!;
}
