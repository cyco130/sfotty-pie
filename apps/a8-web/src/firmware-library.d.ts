declare module "virtual:firmware-library" {
	import type {
		AtariFileFormat,
		FirmwareKey,
		FirmwareType,
		ImageKind,
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
		/** Byte length of the raw bytes the URL serves (the slice, for slices). */
		size: number;
		format: AtariFileFormat | null;
		firmwareKey: FirmwareKey | null;
		firmwareType: FirmwareType | null;
		/**
		 * SHA-256 (hex) of the image's canonical form — the content id a user
		 * upload dedups against. Note built-ins serve raw, so these bytes don't
		 * re-hash to this for cartridges (the `.car` does); nothing relies on that.
		 */
		hash: string;
		/** Content-derived facts (from canonicalize), or null if unrecognized. */
		kind: ImageKind | null;
	}

	export const builtinFirmware: FirmwareLibraryEntry[];
}
