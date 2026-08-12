import type { AtariDosVariant } from "../atari-dos.ts";
import type { SpartaDosVariant } from "../sparta-dos.ts";
import { UsageError } from "../cli-error.ts";

/** Any family's variant, as the driver names it internally. */
export type FsVariant = AtariDosVariant | SpartaDosVariant;

export type FsSelection =
	/** Undefined variants mean "detect it" (or, for mkfs, "pick one"). */
	| { family: "atari"; variant: AtariDosVariant | undefined }
	| { family: "sparta"; variant: SpartaDosVariant | undefined };

/**
 * What a user types after the family. DOS versions go by their number;
 * MyDOS keeps its name, since it is a distinct format rather than a version
 * of DOS 2 (it frees the last sector on a 720-sector disk and reaches past
 * sector 943 where plain DOS 2 cannot). "20" alone would be a DOS 2.0 disk
 * and an SDFS 2.0 disk both, so the family is always required.
 */
const ATARI_SUFFIXES: Record<string, AtariDosVariant> = {
	"10": "dos10",
	"20": "dos20",
	"25": "dos25",
	mydos: "mydos",
};
const SPARTA_SUFFIXES: Record<string, SpartaDosVariant> = {
	"11": "sdfs11",
	"20": "sdfs20",
	"21": "sdfs21",
};

/** The suffix shown for a variant - the inverse of the tables above. */
const ATARI_SUFFIX_OF: Record<AtariDosVariant, string> = {
	dos10: "10",
	dos20: "20",
	dos25: "25",
	mydos: "mydos",
};
const SPARTA_SUFFIX_OF: Record<SpartaDosVariant, string> = {
	sdfs11: "11",
	sdfs20: "20",
	sdfs21: "21",
};

/** The user-facing id for a mounted filesystem, like "atari/20". */
export function fsId(family: "atari" | "sparta", variant: FsVariant): string {
	const suffix =
		family === "atari"
			? ATARI_SUFFIX_OF[variant as AtariDosVariant]
			: SPARTA_SUFFIX_OF[variant as SpartaDosVariant];
	return `${family}/${suffix}`;
}

const ATARI_LIST = Object.keys(ATARI_SUFFIXES)
	.map((s) => `atari/${s}`)
	.join(", ");
const SPARTA_LIST = Object.keys(SPARTA_SUFFIXES)
	.map((s) => `sparta/${s}`)
	.join(", ");

/**
 * Parses a --fs value: a bare family ("atari", "sparta") to pick by
 * geometry, or a family and specific filesystem ("atari/20", "atari/mydos",
 * "sparta/21"). The suffix always carries its family, since a bare "20"
 * belongs to both. Case-insensitive.
 */
export function parseFsOption(text: string, flag: string): FsSelection {
	const lowered = text.toLowerCase();
	const slash = lowered.indexOf("/");
	if (slash === -1) {
		if (lowered === "atari") {
			return { family: "atari", variant: undefined };
		}
		if (lowered === "sparta") {
			return { family: "sparta", variant: undefined };
		}
		throw new UsageError(
			`${flag} wants a filesystem (${ATARI_LIST}, ${SPARTA_LIST}) or a ` +
				`bare family (atari, sparta) to pick by geometry; got "${text}"`,
		);
	}
	const family = lowered.slice(0, slash);
	const suffix = lowered.slice(slash + 1);
	if (family === "atari") {
		const variant = ATARI_SUFFIXES[suffix];
		if (variant !== undefined) {
			return { family: "atari", variant };
		}
		throw new UsageError(
			`unknown atari filesystem "${text}" in ${flag} (valid: ${ATARI_LIST})`,
		);
	}
	if (family === "sparta") {
		const variant = SPARTA_SUFFIXES[suffix];
		if (variant !== undefined) {
			return { family: "sparta", variant };
		}
		throw new UsageError(
			`unknown sparta filesystem "${text}" in ${flag} (valid: ${SPARTA_LIST})`,
		);
	}
	throw new UsageError(
		`unsupported filesystem family "${family}" in ${flag} (valid: atari, sparta)`,
	);
}
