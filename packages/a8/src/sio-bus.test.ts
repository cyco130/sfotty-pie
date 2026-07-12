import { expect, test } from "vitest";
import { makeAtr } from "./atr-fixture.ts";
import { AtrImage } from "./atr.ts";
import { DiskDrive } from "./disk-drive.ts";
import { Pokey } from "./pokey.ts";
import { SioBus } from "./sio-bus.ts";
import { SioConnector, sioChecksum } from "./sio-connector.ts";

const AUDF3 = 0x04;
const AUDF4 = 0x06;
const AUDCTL = 0x08;
const STIMER = 0x09;
const SEROUT = 0x0d;
const SERIN = 0x0d;
const IRQEN_IRQST = 0x0e;
const SKCTL = 0x0f;

const IRQ_SERIN = 0x20;

// A full wire rig, driven the way the OS drives the hardware: timers 3+4
// linked at the standard disk divisor, SKCTL $23 to talk (output clock =
// timer 4, clock line driven), SKCTL $13 to listen (async receive).
function rig(disk?: AtrImage) {
	const pokey = new Pokey();
	const connector = new SioConnector();
	const bus = new SioBus({ pokey, connector });
	const drive = new DiskDrive(1);
	drive.disk = disk;
	connector.attach(drive);

	pokey.write(AUDCTL, 0x28); // link 3+4, channel 3 at 1.79MHz
	pokey.write(AUDF3, 0x28); // divisor $0028: 19040 baud
	pokey.write(AUDF4, 0x00);
	pokey.write(SKCTL, 0x23);
	pokey.write(STIMER, 0);

	const step = (cycles: number) => {
		for (let i = 0; i < cycles; i++) {
			pokey.cycle();
			bus.cycle();
		}
	};

	// Transmit one byte and wait out its frame (10 bits of 94 cycles,
	// plus up to a bit cell of load latency).
	const sendByte = (byte: number) => {
		pokey.write(SEROUT, byte);
		step(1100);
	};

	// A command frame, bracketed by the command line like the OS does it.
	const sendCommand = (
		device: number,
		command: number,
		aux1: number,
		aux2: number,
		{ corruptChecksum = false } = {},
	) => {
		pokey.write(SKCTL, 0x23);
		connector.command.value = false;
		step(1500);
		const frame = [device, command, aux1, aux2];
		for (const byte of frame) sendByte(byte);
		sendByte(sioChecksum(frame) + (corruptChecksum ? 1 : 0));
		step(1200);
		connector.command.value = true;
	};

	// Listen (async receive) until `count` bytes arrive, acknowledging
	// each by cycling the input-ready IRQ enable.
	const receive = (count: number, budget = 400_000) => {
		pokey.write(SKCTL, 0x13);
		pokey.write(IRQEN_IRQST, IRQ_SERIN);
		const bytes: number[] = [];
		for (let i = 0; i < budget && bytes.length < count; i++) {
			step(1);
			if ((pokey.read(IRQEN_IRQST) & IRQ_SERIN) === 0) {
				bytes.push(pokey.read(SERIN));
				pokey.write(IRQEN_IRQST, 0);
				pokey.write(IRQEN_IRQST, IRQ_SERIN);
			}
		}
		return bytes;
	};

	return { pokey, connector, bus, drive, step, sendByte, sendCommand, receive };
}

test("read sector over the wire: ACK, Complete, data frame, checksum", () => {
	const { sendCommand, receive } = rig(new AtrImage(makeAtr(128, 4)));

	sendCommand(0x31, 0x52, 2, 0);
	const bytes = receive(2 + 128 + 1);

	expect(bytes.length).toBe(131);
	expect(bytes[0]).toBe(0x41); // ACK
	expect(bytes[1]).toBe(0x43); // Complete
	const data = bytes.slice(2, 130);
	expect(new Set(data)).toEqual(new Set([2])); // sector 2's fill byte
	expect(bytes[130]).toBe(sioChecksum(data));
});

test("write sector over the wire: data frame in, sector stored", () => {
	const disk = new AtrImage(makeAtr(128, 4));
	const { sendCommand, sendByte, receive, pokey } = rig(disk);

	sendCommand(0x31, 0x57, 3, 0);
	expect(receive(1)).toEqual([0x41]); // command ACKed

	// The data frame: 128 bytes plus checksum, at 19200 like the OS.
	pokey.write(SKCTL, 0x23);
	const data = Array.from({ length: 128 }, (_, i) => (i * 7) & 0xff);
	for (const byte of data) sendByte(byte);
	sendByte(sioChecksum(data));

	expect(receive(2)).toEqual([0x41, 0x43]); // data ACK, then Complete
	expect(Array.from(disk.readSector(3)!)).toEqual(data);
});

test("a corrupted data frame is NAKed and nothing is written", () => {
	const disk = new AtrImage(makeAtr(128, 4));
	const { sendCommand, sendByte, receive, pokey } = rig(disk);

	sendCommand(0x31, 0x57, 3, 0);
	expect(receive(1)).toEqual([0x41]);

	pokey.write(SKCTL, 0x23);
	for (let i = 0; i < 128; i++) sendByte(0x99);
	sendByte(0x00); // wrong checksum

	expect(receive(1)).toEqual([0x4e]); // NAK, no Complete follows
	expect(receive(1, 30_000)).toEqual([]);
	expect(disk.readSector(3)![0]).toBe(3); // untouched fill byte
});

test("status over the wire reports density and protection", () => {
	const { sendCommand, receive } = rig(
		new AtrImage(makeAtr(256, 4), { writeProtected: true }),
	);

	sendCommand(0x31, 0x53, 0, 0);
	const bytes = receive(2 + 4 + 1);
	expect(bytes[0]).toBe(0x41);
	expect(bytes[1]).toBe(0x43);
	expect(bytes[2]).toBe(0x28); // write-protected + double density
	expect(bytes[6]).toBe(sioChecksum(bytes.slice(2, 6)));
});

test("an unknown command is NAKed; an unclaimed ID gets silence", () => {
	const { drive, sendCommand, receive } = rig(new AtrImage(makeAtr(128, 4)));

	sendCommand(0x31, 0x20, 0, 0); // no such command
	expect(receive(1)).toEqual([0x4e]);

	drive.highSpeedIndex = undefined; // stock drive: NAK the $3F poll too
	sendCommand(0x31, 0x3f, 0, 0);
	expect(receive(1)).toEqual([0x4e]);

	sendCommand(0x32, 0x52, 2, 0); // D2:, not attached
	expect(receive(1, 60_000)).toEqual([]);
});

test("US Doubler high speed: the $3F poll, then a whole read at the rate", () => {
	const { pokey, sendCommand, receive } = rig(new AtrImage(makeAtr(128, 4)));

	// Poll at standard speed: Complete plus the divisor as a data frame.
	sendCommand(0x31, 0x3f, 0, 0);
	expect(receive(2 + 1 + 1)).toEqual([0x41, 0x43, 9, sioChecksum([9])]);

	// Reprogram the computer to the polled divisor (9: ~56 kbaud, 2.9x
	// the standard rate) and run a full read: the drive follows the
	// command frame's clock, US Doubler style, so every response byte
	// comes back at the new rate.
	pokey.write(AUDF3, 9);
	sendCommand(0x31, 0x52, 2, 0);
	const bytes = receive(2 + 128 + 1);
	expect(bytes[0]).toBe(0x41);
	expect(bytes[1]).toBe(0x43);
	const data = bytes.slice(2, 130);
	expect(new Set(data)).toEqual(new Set([2]));
	expect(bytes[130]).toBe(sioChecksum(data));
});

test("a corrupted command frame gets silence", () => {
	const { sendCommand, receive } = rig(new AtrImage(makeAtr(128, 4)));
	sendCommand(0x31, 0x52, 2, 0, { corruptChecksum: true });
	expect(receive(1, 60_000)).toEqual([]);
});

test("an empty drive claims nothing and times out", () => {
	const { sendCommand, receive } = rig();
	sendCommand(0x31, 0x53, 0, 0);
	expect(receive(1, 60_000)).toEqual([]);
});

test("a read error still sends the Error byte and a data frame", () => {
	const { sendCommand, receive } = rig(new AtrImage(makeAtr(128, 4)));
	sendCommand(0x31, 0x52, 99, 0); // out of range
	const bytes = receive(2 + 128 + 1);
	expect(bytes[0]).toBe(0x41); // the command itself is valid: ACK
	expect(bytes[1]).toBe(0x45); // Error
	expect(bytes.length).toBe(131); // the data frame still arrives
});
