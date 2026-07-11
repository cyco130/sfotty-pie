import type { Pokey } from "./pokey.ts";
import {
	type SioCommandResult,
	type SioConnector,
	sioChecksum,
} from "./sio-connector.ts";

/**
 * The serial-wire front of the SIO bus: the standard-protocol engine
 * servicing the {@link SioConnector}'s attached devices (AHRM chapter 9).
 * Deserializes command frames off POKEY's transmitter (bytes arrive via
 * {@link Pokey.serialOutByte}, gated by the command line), dispatches to
 * the addressed device, and serializes ACK/NAK/Complete/Error and data
 * frames back onto the {@link Pokey.serialIn} line bit by bit - POKEY's
 * own receive logic does the sampling, so framing, async alignment, and
 * error behavior emerge from the chip, not from this engine.
 *
 * Devices are clock followers: the engine measures the bit-cell time from
 * the SIO clock-out line (driven with the transmit clock during command
 * and data frames) and mirrors that rate when sending, so any programmed
 * baud works - standard 19200, high-speed divisors, all of it.
 *
 * The engine is a peripheral, not a chip: its delays are protocol-legal
 * mid-range picks, not cycle-exact hardware behavior. Rotational timing
 * (for .atx) would live in the device, behind longer per-command delays.
 */
export class SioBus {
	constructor(options: { pokey: Pokey; connector: SioConnector }) {
		this.#pokey = options.pokey;
		this.#connector = options.connector;
		this.#pokey.serialOutByte = (byte) => this.#onByte(byte);
		this.#connector.command.watch((line) => {
			if (line.value) this.#onCommandRaised();
			else this.#onCommandLowered();
		});
	}

	/** Advance one machine cycle: clock measurement and the transmitter. */
	cycle(): void {
		this.#cycles++;

		// Idle fast path: with no transaction and nothing transmitting
		// there is nothing to do - clock measurement can lapse, since the
		// stability lock below re-acquires the rate within a few toggles
		// of the next command frame's own pre-delay.
		if (
			this.#state === "idle" &&
			this.#txBitsLeft === 0 &&
			this.#txQueue.length === 0
		) {
			return;
		}

		// Follow the SIO clock-out line: a toggle interval is the transmit
		// timer's period, half a bit cell. Lock on like a real follower
		// would - only a stable clock counts, so a rate needs two
		// consecutive agreeing intervals. That rejects the stray edges of
		// mode switches (the line snapping to its pulled-up level) and
		// idle gaps, which would otherwise read as bogus periods.
		const clock = this.#pokey.serialClockOut;
		if (clock !== this.#lastClock) {
			this.#lastClock = clock;
			const interval = this.#cycles - this.#lastClockToggle;
			this.#lastClockToggle = this.#cycles;
			if (
				interval >= 4 &&
				interval <= 4096 &&
				Math.abs(interval - this.#lastClockInterval) <= 1
			) {
				this.#bitCell = interval * 2;
			}
			this.#lastClockInterval = interval;
		}

		// The transmitter: shift the in-flight byte at the latched rate,
		// else start the next queued byte once its leading gap elapses.
		if (this.#txBitsLeft > 0) {
			if (--this.#txCountdown <= 0) {
				this.#txBitsLeft--;
				if (this.#txBitsLeft > 0) {
					this.#pokey.serialIn = this.#txShift & 1;
					this.#txShift >>= 1;
					this.#txCountdown = this.#txCell;
				}
				// The stop bit leaves the line at mark; nothing to restore.
			}
		} else {
			const head = this.#txQueue[0];
			if (head) {
				if (head.gap > 0) {
					head.gap--;
				} else {
					this.#txQueue.shift();
					this.#txCell = this.#bitCell;
					// Start + 8 data bits LSB-first + stop, start bit out now.
					this.#txShift = ((head.byte & 0xff) << 1) | 0x200;
					this.#txBitsLeft = 10;
					this.#pokey.serialIn = this.#txShift & 1;
					this.#txShift >>= 1;
					this.#txCountdown = this.#txCell;
				}
			}
		}
	}

	/** Power-cycle: abort any transaction and release the line. */
	reset(): void {
		this.#state = "idle";
		this.#frame.length = 0;
		this.#data.length = 0;
		this.#resolveData = null;
		this.#txQueue.length = 0;
		this.#txBitsLeft = 0;
		this.#pokey.serialIn = 1;
	}

	// A byte fully shifted out of POKEY's transmitter.
	#onByte(byte: number): void {
		if (this.#state === "command") {
			if (this.#frame.length < 6) this.#frame.push(byte);
		} else if (this.#state === "data") {
			this.#data.push(byte);
			if (this.#data.length === this.#dataExpected) this.#resolveDataFrame();
		}
		// Idle: devices ignore non-command traffic addressed to nobody.
	}

	// The command line dropped: a command frame is starting. This aborts
	// whatever was in progress - a mid-response device stops talking.
	#onCommandLowered(): void {
		this.#state = "command";
		this.#frame.length = 0;
		this.#resolveData = null;
		this.#txQueue.length = 0;
	}

	// The command line rose: the frame is complete. A malformed or
	// misaddressed frame gets silence (the computer times out).
	#onCommandRaised(): void {
		if (this.#state !== "command") return;
		this.#state = "idle";
		const frame = this.#frame;
		if (frame.length !== 5) return;
		if (sioChecksum(frame.slice(0, 4)) !== frame[4]) return;
		const device = this.#connector.devices.find((d) => d.respondsTo(frame[0]!));
		if (!device) return;

		const response = device.command({
			device: frame[0]!,
			command: frame[1]!,
			aux1: frame[2]!,
			aux2: frame[3]!,
		});
		if (response.kind === "nak") {
			this.#send(ACK_DELAY, NAK);
			return;
		}
		this.#send(ACK_DELAY, ACK);
		if (response.kind === "receive") {
			this.#state = "data";
			this.#data.length = 0;
			this.#dataExpected = response.length + 1; // + the checksum byte
			this.#resolveData = response.then;
		} else {
			this.#sendResult(response);
		}
	}

	// The computer's data frame is fully in: checksum it, let the device
	// execute, and answer - or NAK and abort the command.
	#resolveDataFrame(): void {
		const resolve = this.#resolveData!;
		this.#state = "idle";
		this.#resolveData = null;
		const data = Uint8Array.from(this.#data.slice(0, -1));
		const good = this.#data[this.#data.length - 1] === sioChecksum(data);
		this.#data.length = 0;
		if (!good) {
			this.#send(DATA_ACK_DELAY, NAK);
			return;
		}
		this.#send(DATA_ACK_DELAY, ACK);
		this.#sendResult(resolve(data));
	}

	// Queue the Complete/Error byte and any returned data frame (sent
	// back-to-back with C/E, like real drives - AHRM warns receivers).
	#sendResult(result: SioCommandResult): void {
		if (result.kind === "nak") return; // protocol-illegal here; silence
		this.#send(COMPLETE_DELAY, result.kind === "complete" ? COMPLETE : ERROR);
		if (result.data) {
			for (const byte of result.data) this.#send(0, byte);
			this.#send(0, sioChecksum(result.data));
		}
	}

	#send(gap: number, byte: number): void {
		this.#txQueue.push({ gap, byte });
	}

	readonly #pokey: Pokey;
	readonly #connector: SioConnector;

	#state: "idle" | "command" | "data" = "idle";
	#frame: number[] = [];
	#data: number[] = [];
	#dataExpected = 0;
	#resolveData: ((data: Uint8Array) => SioCommandResult) | null = null;

	// The transmitter: queued bytes each with a leading gap of idle-line
	// cycles, and the byte in flight as a shift register.
	#txQueue: { gap: number; byte: number }[] = [];
	#txShift = 0;
	#txBitsLeft = 0;
	#txCountdown = 0;
	#txCell = DEFAULT_BIT_CELL;

	// Clock-out measurement.
	#cycles = 0;
	#lastClock = 1;
	#lastClockToggle = 0;
	#lastClockInterval = 0;
	#bitCell = DEFAULT_BIT_CELL;
}

const ACK = 0x41;
const NAK = 0x4e;
const COMPLETE = 0x43;
const ERROR = 0x45;

// The standard rate until a clock is measured: divisor $0028 through the
// linked-timer pipeline = 47-cycle periods, 94 cycles per bit (19040
// baud, what real drives run).
const DEFAULT_BIT_CELL = 94;

// Peripheral-side delays, in machine cycles (~1790/ms). Protocol bounds
// per AHRM figure 18: ACK within 0-16ms of the command line rising, the
// data-frame ACK within 850us-16ms, and at least 250us of dead time
// before the Complete/Error byte. Mid-range-ish picks, honest but quick.
const ACK_DELAY = 900; // ~0.5ms
const DATA_ACK_DELAY = 1790; // ~1ms
const COMPLETE_DELAY = 1790; // ~1ms (execution time included)
