import crc32 from "crc-32";

export interface FirmwareInfo {
	name: string;
	origin: string;
	notes?: string;
	type: "ntsc" | "pal" | "ntsc/pal" | "xl/xe" | "basic" | "game" | "combined";
}

interface FirmwareDetectionInfo {
	size: number;
	check: number | ((rom: Uint8Array) => boolean);
	name: string | ((rom: Uint8Array) => string);
	origin: string;
	notes?: string;
	type: "ntsc" | "pal" | "ntsc/pal" | "xl/xe" | "basic" | "game" | "combined";
}

const ALTIRRA_OS_BANNER = "AltirraOS ";
const ALTIRRA_OS_XL_BANNER = "!ltirra"; // ! is ANTIC code for A
const ALTIRRA_BASIC_BANNER = "Altirra 8K BASIC ";

const ATARI_PP_DOS_BANNER = "Thor Dos 2.++ V ";
const ATARI_PP_BASIC_BANNER = "Basic++ ";

function getAltirraBasicVersion(rom: Uint8Array): string | undefined {
	const firstPage = String.fromCharCode(...rom.subarray(0, 256));
	const bannerPos = firstPage.indexOf(ALTIRRA_BASIC_BANNER);
	if (bannerPos < 0) {
		return undefined;
	}

	return firstPage.slice(
		bannerPos + ALTIRRA_BASIC_BANNER.length,
		bannerPos + ALTIRRA_BASIC_BANNER.length + 4,
	);
}

function getAtariPpOsVersion(rom: Uint8Array): string | undefined {
	const dupRom = String.fromCharCode(...rom.subarray(0x1000, 0x1800));
	const bannerPos = dupRom.indexOf(ATARI_PP_DOS_BANNER);
	if (bannerPos < 0) {
		return undefined;
	}

	const start = bannerPos + ATARI_PP_DOS_BANNER.length;
	let end = start;
	while (end < dupRom.length && dupRom.charCodeAt(end) !== 0x20) {
		end++;
	}

	return dupRom.slice(start, end);
}

function getAtariPpBasicVersion(rom: Uint8Array): string | undefined {
	const lastPage = String.fromCharCode(...rom.subarray(0x1f00, 0x2000));
	const bannerPos = lastPage.indexOf(ATARI_PP_BASIC_BANNER);
	if (bannerPos < 0) {
		return undefined;
	}

	const start = bannerPos + ATARI_PP_BASIC_BANNER.length;
	let end = start;
	while (end < lastPage.length && lastPage.charCodeAt(end) !== 0x20) {
		end++;
	}

	return lastPage.slice(start, end);
}

const KNOWN_FIRMWARE: FirmwareDetectionInfo[] = [
	{
		name: (rom) =>
			`AltirraOS for 400/800 v${String.fromCharCode(
				...rom.subarray(
					0xca6 + ALTIRRA_OS_BANNER.length,
					0xca6 + ALTIRRA_OS_BANNER.length + 4,
				),
			)}`,
		size: 10240,
		check: (rom) =>
			ALTIRRA_OS_BANNER ===
			String.fromCharCode(
				...rom.subarray(0xca6, 0xca6 + ALTIRRA_OS_BANNER.length),
			),
		origin: "Bundled with the Altirra emulator.",
		notes: "A GPLv2-licensed 400/800 OS replacement.",
		type: "ntsc/pal",
	},
	{
		name: (rom) =>
			`AltirraOS for XL/XE/XEGS v${String.fromCharCode(
				...rom.subarray(0x17f8, 0x17f8 + 4),
			)}`,
		size: 16384,
		check: (rom) =>
			String.fromCharCode(...rom.subarray(0x1000, 0x17ff)).includes(
				ALTIRRA_OS_XL_BANNER,
			),
		origin: "Bundled with the Altirra emulator.",
		notes: "A GPLv2-licensed XL/XE OS replacement.",
		type: "xl/xe",
	},
	{
		name: (rom) => `Altirra BASIC v${getAltirraBasicVersion(rom)}`,
		size: 8192,
		check: (rom) => !!getAltirraBasicVersion(rom),
		origin: "Bundled with the Altirra emulator.",
		notes: "A GPLv2-licensed Atari BASIC replacement.",
		type: "basic",
	},
	{
		name: (rom) => `Atari++ OS v${getAtariPpOsVersion(rom)}`,
		size: 16384,
		check: (rom) => getAtariPpOsVersion(rom) !== undefined,
		origin: "Bundled with the Atari++ emulator.",
		notes: `A "Thor"-licensed (similar to MPL) XL/XE OS replacement.`,
		type: "xl/xe",
	},
	{
		name: (rom) => `Atari++ BASIC v${getAtariPpBasicVersion(rom)}`,
		size: 8192,
		check: (rom) => getAtariPpBasicVersion(rom) !== undefined,
		origin: "Bundled with the Atari++ emulator.",
		notes: `A "Thor"-licensed (similar to MPL) Atari BASIC replacement.`,
		type: "basic",
	},
	{
		name: "400/800 OS-A NTSC",
		size: 10240,
		check: 0xc1b3bb02,
		origin: "Installed on earlier NTSC 400/800 units.",
		type: "ntsc",
	},
	{
		name: "400/800 OS-A PAL",
		size: 10240,
		check: 0x72b3fed4,
		origin: "Installed on all known PAL 400/800 units.",
		type: "pal",
	},
	{
		name: "400/800 OS-B NTSC",
		size: 10240,
		check: 0xe86d61d,
		origin: "Installed on later NTSC 400/800 units.",
		notes:
			"Unless a game specifically requires OS-A, this should be preferred over OS-A NTSC as it fixes a few performance bugs.",
		type: "ntsc",
	},
	{
		name: "400/800 OS-B NTSC (Xformer patch)",
		size: 10240,
		check: 0x3e28a1fe,
		origin: "Found in the PC Xformer Classic emulator distribution.",
		notes:
			"400/800 OS-B NTSC patched to work on the PC Xformer Classic emulator and XL/XE machines.",
		type: "ntsc",
	},
	{
		name: "400/800 OS-B PAL",
		size: 10240,
		check: 0xc913dfc,
		origin:
			"Never discovered in an actual machine, it was reconstructed from sources.",
		notes:
			"Despite fixing some performance bugs, OS-A PAL should be preferred over this for authenticity.",
		type: "pal",
	},
	{
		name: "1200XL OS revision 10",
		size: 16384,
		check: 0xc5c11546,
		origin: "Factory-installed on most -maybe all- 1200XL units.",
		type: "xl/xe",
	},
	{
		name: "1200XL OS revision 11",
		size: 16384,
		check: 0x1a1d7b1b,
		origin: "Installed on some 1200XL units during repair.",
		notes:
			"It fixes some issues related to the Reset key handling and improves compatibility with 400/800 OSes.",
		type: "xl/xe",
	},
	{
		name: "XL/XE OS revision 1",
		size: 16384,
		check: 0x643bcc98,
		origin: "Installed on most 600XL and early 800XL units.",
		type: "xl/xe",
	},
	{
		name: "XL/XE OS revision 2",
		size: 16384,
		check: 0x1f9cd270,
		origin: "Installed on most 800XL, 65XE, 130XE, and some 600XL units.",
		type: "xl/xe",
	},
	{
		name: "XL/XE OS revision 3",
		size: 16384,
		check: 0x29f133f7,
		origin: "Installed on later 65XE, 130XE and most -maybe all- 800XE units.",
		type: "xl/xe",
	},
	{
		name: "XL/XE OS revision 4 for XEGS",
		size: 16384,
		check: 0x1eaf4002,
		origin: "Installed on XEGS units.",
		type: "xl/xe",
	},
	{
		name: "XL/XE OS Arabic revision 1987",
		size: 16384,
		check: 0x45f47988,
		origin: "Installed on earlier Arabic 65XE units.",
		type: "xl/xe",
	},
	{
		name: "XL/XE OS Arabic revision 1988",
		size: 16384,
		check: 0xf0a236d3,
		origin: "Installed on later Arabic 65XE units.",
		type: "xl/xe",
	},
	{
		name: "BASIC revision A",
		size: 8192,
		check: 0x4bec4de2,
		origin: "Released as a cartridge for 400/800.",
		notes: "It contains a bug causing occasional lockups.",
		type: "basic",
	},
	{
		name: "BASIC revision B",
		size: 8192,
		check: 0xf0202fb3,
		origin: "Installed on most XL units.",
		notes: "It fixes a bug in revision A but introduces worse ones.",
		type: "basic",
	},
	{
		name: "BASIC revision C",
		size: 8192,
		check: 0x7d684184,
		origin:
			"Installed on later XL and all XE units, also available on cartridge.",
		notes: "It fixes the bugs in revision B.",
		type: "basic",
	},
	{
		name: "XEGS Missile Command",
		size: 8192,
		check: 0xbdca01fb,
		origin: "Installed on XEGS units.",
		type: "game",
	},
	{
		name: "XEGS combined ROM",
		size: 32768,
		check: 0xd50260d1,
		origin: "The internal ROM of the XEGS.",
		notes:
			"A 32K dump combining XEGS Missile Command ($0000), BASIC revision C ($2000), and XL/XE OS revision 4 ($4000).",
		type: "combined",
	},
];

function computeCrc32(rom: Uint8Array): number {
	// crc32.buf returns a signed int32; `>>> 0` reinterprets it as the unsigned
	// 32-bit value the constants below are written as.
	return crc32.buf(rom) >>> 0;
}

export function detectFirmware(rom: Uint8Array): FirmwareInfo | null {
	let crc: number | undefined;

	const found = KNOWN_FIRMWARE.find((f) => {
		if (f.size !== rom.length) {
			return false;
		}

		if (typeof f.check === "function") {
			return f.check(rom);
		}

		if (crc === undefined) {
			crc = computeCrc32(rom);
		}

		return crc === f.check;
	});

	if (!found) {
		return null;
	}

	return {
		name: typeof found.name === "function" ? found.name(rom) : found.name,
		origin: found.origin,
		notes: found.notes,
		type: found.type,
	};
}
