import { AtrImage } from "@sfotty-pie/a8";
import { expect, test } from "vitest";
import {
	buildDos,
	buildNoDosDisk,
	buildNoDosLoader,
	buildOneDosDisk,
} from "./build.ts";
import {
	DIRECTORY_FIRST,
	DIRECTORY_SECTORS,
	SECTOR_COUNT,
	SECTOR_LINK_OFFSET,
	SECTOR_SIZE,
	VTOC_SECTOR,
} from "./disk.ts";

const word = (bytes: Uint8Array, i: number) => bytes[i]! | (bytes[i + 1]! << 8);

async function noDosImage(): Promise<AtrImage> {
	// Round-tripping through AtrImage is the check that the header is
	// well-formed: it refuses anything it can't parse.
	return new AtrImage(await buildNoDosDisk());
}

test("the No DOS disk is a single-density ATR of 720 sectors", async () => {
	const image = await noDosImage();
	expect(image.sectorSize).toBe(SECTOR_SIZE);
	expect(image.sectorCount).toBe(SECTOR_COUNT);
});

test("the boot sectors carry the loader, with the sector link offset patched", async () => {
	const image = await noDosImage();
	const loader = await buildNoDosLoader();
	expect(loader.length).toBe(3 * SECTOR_SIZE);

	// Sectors 1-3 are the loader, byte for byte.
	const onDisk = new Uint8Array(
		[1, 2, 3].flatMap((s) => [...image.readSector(s)!]),
	);
	expect(onDisk).toEqual(loader);

	// The disk boot header: flags, sector count, load address, init address.
	// Where the loader lands is the program's business, so this checks the
	// header is self-consistent rather than pinning an address: the count has
	// to match the image the format pads out, or the OS reads too little, and
	// init has to point inside what gets loaded.
	expect(onDisk[0]).toBe(0);
	expect(onDisk[1]).toBe(loader.length / SECTOR_SIZE);
	const load = word(onDisk, 2);
	expect(load).toBeGreaterThan(0);
	const init = word(onDisk, 4);
	expect(init).toBeGreaterThanOrEqual(load);
	expect(init).toBeLessThan(load + loader.length);

	// The loader learns the sector size by reading this back, so it has to
	// describe the disk it shipped on: 125 for 128-byte sectors.
	expect(SECTOR_LINK_OFFSET).toBe(125);
	expect(onDisk).toContain(SECTOR_LINK_OFFSET);
});

test("the VTOC reports 708 free sectors, counting sector 720", async () => {
	const image = await noDosImage();
	const vtoc = image.readSector(VTOC_SECTOR)!;

	expect(vtoc[0]).toBe(2); // DOS 2.0, one VTOC sector
	// DOS 2.0S would say 707 here: it leaves the last sector out of the
	// bitmap. This disk uses it, the way MyDOS does.
	expect(word(vtoc, 1)).toBe(708);
	expect(word(vtoc, 3)).toBe(708);
	expect([...vtoc.subarray(5, 10)]).toEqual([0, 0, 0, 0, 0]);

	const isFree = (sector: number) =>
		!!(vtoc[10 + (sector >> 3)]! & (0x80 >> (sector & 7)));

	expect(isFree(0)).toBe(false); // no such sector
	expect([1, 2, 3].every(isFree)).toBe(false); // boot
	expect(isFree(VTOC_SECTOR)).toBe(false);
	for (let i = 0; i < DIRECTORY_SECTORS; i++) {
		expect(isFree(DIRECTORY_FIRST + i)).toBe(false);
	}
	expect(isFree(4)).toBe(true);
	expect(isFree(359)).toBe(true);
	expect(isFree(369)).toBe(true);
	expect(isFree(719)).toBe(true);
	expect(isFree(720)).toBe(true);

	// The bitmap and the counts have to agree.
	let free = 0;
	for (let sector = 0; sector <= SECTOR_COUNT; sector++) {
		if (isFree(sector)) free++;
	}
	expect(free).toBe(708);
});

test("the directory is empty", async () => {
	const image = await noDosImage();
	for (let i = 0; i < DIRECTORY_SECTORS; i++) {
		const sector = image.readSector(DIRECTORY_FIRST + i)!;
		// A zero flag byte ends the directory scan, so all-zero is "empty".
		expect([...sector]).toEqual(Array<number>(SECTOR_SIZE).fill(0));
	}
});

test("the DOS assembles to a well-formed single-chunk XEX at $0700", async () => {
	const xex = await buildDos();

	expect(word(xex, 0)).toBe(0xffff);
	const chunkStart = word(xex, 2);
	const chunkEnd = word(xex, 4); // inclusive
	expect(chunkStart).toBe(0x0700);
	const chunkLength = chunkEnd - chunkStart + 1;
	// signature+range (6) + chunk + RUNAD range (4) + RUNAD value (2)
	expect(xex.length).toBe(6 + chunkLength + 6);

	const trailer = 6 + chunkLength;
	expect(word(xex, trailer)).toBe(0x02e0);
	expect(word(xex, trailer + 2)).toBe(0x02e1);
	const run = word(xex, trailer + 4);
	expect(run).toBeGreaterThanOrEqual(chunkStart);
	expect(run).toBeLessThanOrEqual(chunkEnd);
});

async function oneDosImage() {
	const { image, files } = await buildOneDosDisk();
	return { image: new AtrImage(image), files };
}

test("the OneDOS disk boots ADFS with the boot params patched for the disk", async () => {
	const { image, files } = await oneDosImage();
	const onDisk = new Uint8Array(
		[1, 2, 3].flatMap((s) => [...image.readSector(s)!]),
	);

	// The DOS-compatible boot params at their fixed offsets: drive, link
	// mask, sector size code, DOS file start, sector link offset.
	expect(onDisk[12]).toBe(0x31);
	expect(onDisk[13]).toBe(0x03);
	expect(onDisk[14]).toBe(1);
	expect(word(onDisk, 15)).toBe(files[0]!.sectors[0]);
	expect(onDisk[17]).toBe(SECTOR_LINK_OFFSET);
});

test("ONEDOS.DOS is a well-formed DOS 2.0 file", async () => {
	const { image, files } = await oneDosImage();
	const dos = await buildDos();
	const planned = files[0]!;
	expect(planned.sectors[0]).toBe(4); // first data sector, first-fit

	// The directory entry: in use, created by DOS 2, sized and named.
	const dir = image.readSector(DIRECTORY_FIRST)!;
	expect(dir[0]).toBe(0x42);
	expect(word(dir, 1)).toBe(planned.sectors.length);
	expect(word(dir, 3)).toBe(planned.sectors[0]);
	expect(new TextDecoder().decode(dir.subarray(5, 16))).toBe("ONEDOS  DOS");
	expect(dir[16]).toBe(0); // the next entry ends the scan

	// Walk the chain: file number 0 in every link, lengths full except the
	// tail, and the reassembled bytes are exactly the DOS image.
	const bytes: number[] = [];
	let sector = planned.sectors[0]!;
	while (sector !== 0) {
		const raw = image.readSector(sector)!;
		const fileNumber = raw[125]! >> 2;
		expect(fileNumber).toBe(0);
		const next = ((raw[125]! & 0x03) << 8) | raw[126]!;
		const length = raw[127]!;
		expect(length).toBe(next === 0 ? dos.length % 125 || 125 : 125);
		bytes.push(...raw.subarray(0, length));
		sector = next;
	}
	expect(new Uint8Array(bytes)).toEqual(dos);

	// The VTOC accounts for the file: capacity stays fresh, free shrinks.
	const vtoc = image.readSector(VTOC_SECTOR)!;
	expect(word(vtoc, 1)).toBe(708);
	expect(word(vtoc, 3)).toBe(708 - planned.sectors.length);
	const isFree = (s: number) => !!(vtoc[10 + (s >> 3)]! & (0x80 >> (s & 7)));
	for (const s of planned.sectors) expect(isFree(s)).toBe(false);
	expect(isFree(planned.sectors.at(-1)! + 1)).toBe(true);
});
