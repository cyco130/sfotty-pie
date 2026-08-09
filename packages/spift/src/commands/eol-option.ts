import { UsageError } from "../cli-error.ts";
import type { EolStyle } from "../text.ts";

const EOL_STYLES = ["lf", "crlf", "native"] as const;

/**
 * Parses --eol. The default is lf on every platform rather than the host's
 * own, so one disk gives one answer everywhere and a pack/unpack round trip
 * compares across machines.
 */
export function parseEol(text: string | undefined): EolStyle {
	if (text === undefined) {
		return "lf";
	}
	const lowered = text.toLowerCase();
	if (!(EOL_STYLES as readonly string[]).includes(lowered)) {
		throw new UsageError(
			`unknown --eol "${text}" (valid: ${EOL_STYLES.join(", ")})`,
		);
	}
	return lowered as EolStyle;
}
