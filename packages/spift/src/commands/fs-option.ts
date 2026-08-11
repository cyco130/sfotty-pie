import { ATARI_DOS_VARIANTS, type AtariDosVariant } from "../atari-dos.ts";
import { SPARTA_DOS_VARIANTS, type SpartaDosVariant } from "../sparta-dos.ts";
import { UsageError } from "../cli-error.ts";

/** Any family's variant name, as --fs speaks them. */
export type FsVariant = AtariDosVariant | SpartaDosVariant;

export type FsSelection =
	/** Undefined variants mean "detect it" (or, for mkfs, "pick one"). */
	| { family: "atari"; variant: AtariDosVariant | undefined }
	| { family: "sparta"; variant: SpartaDosVariant | undefined };

/**
 * The names people type that are not variants of their own. DOS 2.0S and
 * DOS 2.0D are one filesystem at two sector sizes - their VTOCs are
 * identical - so both spell the same variant. The Sparta revisions go by
 * their on-disk numbers too ("sparta/2.0" for sdfs20).
 */
const ALIASES: Record<string, string> = {
	dos20s: "dos20",
	dos20d: "dos20",
	dos2: "dos20",
	"1.1": "sdfs11",
	"2.0": "sdfs20",
	"2.1": "sdfs21",
	bwdos: "sdfs20",
};

function isAtari(variant: string): variant is AtariDosVariant {
	return (ATARI_DOS_VARIANTS as readonly string[]).includes(variant);
}

function isSparta(variant: string): variant is SpartaDosVariant {
	return (SPARTA_DOS_VARIANTS as readonly string[]).includes(variant);
}

const VALID =
	`atari variants: ${ATARI_DOS_VARIANTS.join(", ")}; ` +
	`sparta variants: ${SPARTA_DOS_VARIANTS.join(", ")}`;

/**
 * Parses a --fs value: a family ("atari", "sparta"), a family and variant
 * ("atari/dos25", "sparta/sdfs20"), or a bare variant ("dos25", "sdfs20")
 * since no variant name repeats across families. Case-insensitive.
 */
export function parseFsOption(text: string, flag: string): FsSelection {
	const lowered = ALIASES[text.toLowerCase()] ?? text.toLowerCase();
	const slash = lowered.indexOf("/");
	if (slash === -1) {
		if (lowered === "atari" || lowered === "sparta") {
			return { family: lowered, variant: undefined };
		}
		if (isAtari(lowered)) {
			return { family: "atari", variant: lowered };
		}
		if (isSparta(lowered)) {
			return { family: "sparta", variant: lowered };
		}
		throw new UsageError(
			`unknown filesystem "${text}" in ${flag} ` +
				`(families: atari, sparta; ${VALID})`,
		);
	}
	const family = lowered.slice(0, slash);
	const variant = ALIASES[lowered.slice(slash + 1)] ?? lowered.slice(slash + 1);
	if (family === "atari" && isAtari(variant)) {
		return { family, variant };
	}
	if (family === "sparta" && isSparta(variant)) {
		return { family, variant };
	}
	if (family !== "atari" && family !== "sparta") {
		throw new UsageError(
			`unsupported filesystem family "${family}" in ${flag} ` +
				`(valid: atari, sparta)`,
		);
	}
	throw new UsageError(
		`unknown ${family} filesystem "${lowered.slice(slash + 1)}" in ${flag} ` +
			`(${VALID})`,
	);
}
