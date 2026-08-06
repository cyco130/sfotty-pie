import { ATARI_DOS_VARIANTS, type AtariDosVariant } from "../atari-dos.ts";
import { UsageError } from "../cli-error.ts";

export interface FsSelection {
	family: "atari" | "sparta";
	/** Undefined means "detect it" (or, for mkfs, "pick by geometry"). */
	variant: AtariDosVariant | undefined;
}

/**
 * Parses a --fs value: a family ("atari"), a family and variant
 * ("atari/dos25"), or a bare variant ("dos25") since only one family has
 * any. Case-insensitive.
 */
export function parseFsOption(text: string, flag: string): FsSelection {
	const lowered = text.toLowerCase();
	const slash = lowered.indexOf("/");
	if (slash === -1) {
		if (lowered === "atari" || lowered === "sparta") {
			return { family: lowered, variant: undefined };
		}
		if ((ATARI_DOS_VARIANTS as readonly string[]).includes(lowered)) {
			return { family: "atari", variant: lowered as AtariDosVariant };
		}
		throw new UsageError(
			`unknown filesystem "${text}" in ${flag} ` +
				`(families: atari, sparta; atari variants: ` +
				`${ATARI_DOS_VARIANTS.join(", ")})`,
		);
	}
	const family = lowered.slice(0, slash);
	const variant = lowered.slice(slash + 1);
	if (family !== "atari") {
		throw new UsageError(
			`unsupported filesystem family "${family}" in ${flag} (valid: atari)`,
		);
	}
	if (!(ATARI_DOS_VARIANTS as readonly string[]).includes(variant)) {
		throw new UsageError(
			`unknown atari filesystem "${variant}" in ${flag} ` +
				`(valid: ${ATARI_DOS_VARIANTS.join(", ")})`,
		);
	}
	return { family: "atari", variant: variant as AtariDosVariant };
}
