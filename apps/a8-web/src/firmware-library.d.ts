declare module "virtual:firmware-library" {
	import type {
		AtariFileFormat,
		FirmwareKey,
		FirmwareType,
	} from "@sfotty-pie/a8";

	/** A built-in library image: a whole file, or a `#range` slice of one. */
	export interface FirmwareLibraryEntry {
		/** Unique id — the library-relative path, plus `#range` for a slice. */
		id: string;
		/** Display name (the detected identity, else the file name). */
		name: string;
		/** Hashed asset URL the bytes are fetched from; `…#start-end` for a slice. */
		url: string;
		origin: "committed" | "local";
		/** Byte length (of the slice, for slices). */
		size: number;
		format: AtariFileFormat | null;
		firmwareKey: FirmwareKey | null;
		firmwareType: FirmwareType | null;
	}

	export const builtinFirmware: FirmwareLibraryEntry[];
}
