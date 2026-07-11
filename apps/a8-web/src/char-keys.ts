import type { Command } from "./commands.ts";

// The character channel (Character mode): the Atari keystroke that types a
// produced character. Covers every printable ASCII except ` { } ~, which have no
// ATASCII equivalent.
//
// Symbols and digits map directly - the host's layout and Shift are already
// baked into the produced character (e.g. "!" is the Atari Shift+1). Letters and
// space are the exception: the produced character can't carry their Shift (letter
// case is unreliable under CapsLock; a space is a space either way), so it comes
// from the Shift MODIFIER - Shift+A -> Atari Shift+A, Shift+Space -> Shift+Space.

/**
 * The Atari keystroke that types `char` in Character mode, or undefined if it has
 * no ATASCII equivalent (` { } ~). For a letter the result's case follows the
 * Shift modifier (`shift`), not the produced case - so the host's CapsLock state
 * never adds a phantom Shift (`a` and a CapsLock `A` both yield plain `A`).
 */
export function charCommand(char: string, shift: boolean): Command | undefined {
	if (/^[a-z]$/i.test(char)) {
		const letter = char.toUpperCase() as Letter;
		return shift ? `PRESS_SHIFT_${letter}` : `PRESS_${letter}`;
	}
	if (char === " ") return shift ? "PRESS_SHIFT_SPACE" : "PRESS_SPACE";
	return SYMBOLS[char];
}

type Letter =
	| "A"
	| "B"
	| "C"
	| "D"
	| "E"
	| "F"
	| "G"
	| "H"
	| "I"
	| "J"
	| "K"
	| "L"
	| "M"
	| "N"
	| "O"
	| "P"
	| "Q"
	| "R"
	| "S"
	| "T"
	| "U"
	| "V"
	| "W"
	| "X"
	| "Y"
	| "Z";

// Non-letter printable characters -> their Atari keystroke. Space is handled like
// a letter (folds by the Shift modifier), so it isn't here.
const SYMBOLS: Record<string, Command> = {
	"!": "PRESS_SHIFT_1",
	'"': "PRESS_SHIFT_2",
	"#": "PRESS_SHIFT_3",
	$: "PRESS_SHIFT_4",
	"%": "PRESS_SHIFT_5",
	"&": "PRESS_SHIFT_6",
	"'": "PRESS_SHIFT_7",
	"(": "PRESS_SHIFT_9",
	")": "PRESS_SHIFT_0",
	"*": "PRESS_ASTERISK",
	"+": "PRESS_PLUS",
	",": "PRESS_COMMA",
	"-": "PRESS_MINUS",
	".": "PRESS_PERIOD",
	"/": "PRESS_SLASH",
	"0": "PRESS_0",
	"1": "PRESS_1",
	"2": "PRESS_2",
	"3": "PRESS_3",
	"4": "PRESS_4",
	"5": "PRESS_5",
	"6": "PRESS_6",
	"7": "PRESS_7",
	"8": "PRESS_8",
	"9": "PRESS_9",
	":": "PRESS_SHIFT_SEMICOLON",
	";": "PRESS_SEMICOLON",
	"<": "PRESS_LESS_THAN",
	"=": "PRESS_EQUALS",
	">": "PRESS_GREATER_THAN",
	"?": "PRESS_SHIFT_SLASH",
	"@": "PRESS_SHIFT_8",
	"[": "PRESS_SHIFT_COMMA",
	"\\": "PRESS_SHIFT_PLUS",
	"]": "PRESS_SHIFT_PERIOD",
	"^": "PRESS_SHIFT_ASTERISK",
	_: "PRESS_SHIFT_MINUS",
	"|": "PRESS_SHIFT_EQUALS",
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") as Letter[];

/**
 * The inverse of the character channel: each Atari character command -> the host
 * character that types it in Character mode, for showing shortcuts. Symbols carry
 * their own Shift in the glyph ("!" not "Shift+1"); letters fold by the Shift
 * modifier, so Shift is shown explicitly (`PRESS_SHIFT_A` -> "Shift+A").
 */
export const characterChords: ReadonlyMap<Command, string> = new Map<
	Command,
	string
>([
	...Object.entries(SYMBOLS).map(([char, command]): [Command, string] => [
		command,
		char,
	]),
	// Space folds by the Shift modifier, like letters.
	["PRESS_SPACE", "Space"],
	["PRESS_SHIFT_SPACE", "Shift+Space"],
	...LETTERS.flatMap((l): [Command, string][] => [
		[`PRESS_${l}`, l],
		[`PRESS_SHIFT_${l}`, `Shift+${l}`],
	]),
]);
