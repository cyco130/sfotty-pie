import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { AtariDosVariant } from "../atari-dos.ts";
import { CliError, UsageError } from "../cli-error.ts";
import type { DirEntry, DirEntryAttribute, FileStore } from "../filesystem.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";

/**
 * What each attribute is called on the command line. These are the labels
 * ls -l prints, so a listing reads back as something chattr accepts.
 */
const ATTRIBUTE_NAMES: Record<string, DirEntryAttribute> = {
	"read-only": "ReadOnly",
	locked: "ReadOnly",
	protected: "ReadOnly",
	dos1: "AtariDos10",
};

/**
 * The rest of the vocabulary, each with the reason it is not something to
 * set. Better than "unknown name" for a word ls -l just printed.
 */
const NOT_SETTABLE: Record<string, string> = {
	"dos2.5":
		"says a file reaches past sector 719 on a DOS 2.5 disk, which is where " +
		"its sectors are, not a flag",
	mydos:
		"says a file's links need all 16 bits, which is where its sectors are, " +
		"not a flag",
	"dos-file": "lives in the boot record - set-dos-file points it at a file",
	deleted: "is what rm leaves behind; undeleting is its own operation",
	"open-output": "marks a half-written file, which is damage to repair",
};

export interface ChattrArgs {
	image: string;
	settings: { attribute: DirEntryAttribute; on: boolean }[];
	specs: string[];
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	recursive: boolean;
	force: boolean;
}

export function parseChattrArgs(args: string[]): ChattrArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				recursive: { type: "boolean", short: "R" },
				r: { type: "boolean" },
				force: { type: "boolean", short: "f" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}

	// Leading name=value positionals are settings and the rest are specs, as
	// "env FOO=1 cmd" splits them. No native name can hold an "=", so the
	// first positional without one ends the settings for good - which also
	// means a spec that happens to contain one is still safe there.
	const settings: ChattrArgs["settings"] = [];
	let index = 0;
	for (; index < positionals.length; index++) {
		const argument = positionals[index] as string;
		if (!argument.includes("=")) {
			break;
		}
		settings.push(parseSetting(argument));
	}
	const specs = positionals.slice(index);

	if (settings.length === 0) {
		throw new UsageError(
			`missing a setting like read-only=on (settable: ` +
				`${settableNames().join(", ")}); ls -l shows what an entry carries`,
		);
	}
	if (specs.length === 0) {
		throw new UsageError("missing SPEC to change");
	}

	// The same attribute twice, once each way, is a contradiction rather than
	// a last-one-wins.
	for (const setting of settings) {
		const others = settings.filter((s) => s.attribute === setting.attribute);
		if (others.some((s) => s.on !== setting.on)) {
			throw new UsageError(
				`${nameOf(setting.attribute)} is set both on and off in the ` +
					`same command`,
			);
		}
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		settings,
		specs,
		fs: selection?.family,
		variant: selection?.variant,
		recursive: values.recursive === true || values.r === true,
		force: values.force ?? false,
	};
}

function settableNames(): string[] {
	return [...new Set(Object.keys(ATTRIBUTE_NAMES))];
}

function parseSetting(argument: string): {
	attribute: DirEntryAttribute;
	on: boolean;
} {
	const equals = argument.indexOf("=");
	const name = argument.slice(0, equals).toLowerCase();
	const value = argument.slice(equals + 1).toLowerCase();

	const attribute = ATTRIBUTE_NAMES[name];
	if (attribute === undefined) {
		const why = NOT_SETTABLE[name];
		throw new UsageError(
			why === undefined
				? `unknown attribute "${name}" (settable: ${settableNames().join(", ")})`
				: `${name} cannot be set: it ${why}`,
		);
	}
	if (value !== "on" && value !== "off") {
		throw new UsageError(
			`${name} takes "on" or "off", not "${argument.slice(equals + 1)}"`,
		);
	}
	return { attribute, on: value === "on" };
}

/** The attributes an entry should end up with, given what it has now. */
function wanted(
	store: FileStore,
	current: readonly DirEntryAttribute[],
	settings: ChattrArgs["settings"],
): DirEntryAttribute[] {
	const result = new Set(
		current.filter((attribute) => store.writableAttributes.includes(attribute)),
	);
	for (const setting of settings) {
		if (!store.writableAttributes.includes(setting.attribute)) {
			throw new Error(
				`${store.family} cannot set ${setting.attribute} on its files`,
			);
		}
		if (setting.on) {
			result.add(setting.attribute);
		} else {
			result.delete(setting.attribute);
		}
	}
	return [...result];
}

export async function chattrCommand(args: string[]): Promise<void> {
	const parsed = parseChattrArgs(args);
	const { filesystem, medium } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);

	const fail = (error: unknown): never => {
		if (error instanceof CliError) {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	};

	const matched: DirEntry[] = [];
	try {
		for (const spec of parsed.specs) {
			const found = [
				...filesystem.entries(spec, {
					recursive: parsed.recursive,
					listContents: false,
				}),
			];
			if (found.length === 0 && !parsed.force) {
				throw new CliError(`no entries match "${spec}"`);
			}
			for (const entry of found) {
				if (!matched.some((seen) => seen.path === entry.path)) {
					matched.push(entry);
				}
			}
		}
	} catch (error) {
		fail(error);
		return;
	}

	let damaged = false;
	for (const entry of matched) {
		const before = [...entry.attributes];
		let after;
		try {
			after = wanted(filesystem, before, parsed.settings);
		} catch (error) {
			fail(error);
			return;
		}
		// A locked file is protected from being rewritten, as it is from being
		// removed - but unlocking it is exactly what chattr is for, so the
		// guard only covers changes that touch the data.
		const rewriting =
			before.includes("AtariDos10") !== after.includes("AtariDos10");
		if (rewriting && before.includes("ReadOnly") && !parsed.force) {
			throw new CliError(
				`${entry.path} is read-only and this rewrites it (use --force)`,
			);
		}

		let diagnostics: string[];
		try {
			diagnostics = filesystem.setAttributes(entry.path, after);
		} catch (error) {
			fail(error);
			return;
		}
		for (const diagnostic of diagnostics) {
			process.stderr.write(`spift: ${entry.path}: ${diagnostic}\n`);
		}
		damaged ||= diagnostics.length > 0;

		const changed = parsed.settings
			.filter(
				(s) => before.includes(s.attribute) !== after.includes(s.attribute),
			)
			.map((s) => `${nameOf(s.attribute)}=${s.on ? "on" : "off"}`);
		const how = rewriting ? " (rewritten)" : "";
		process.stdout.write(
			changed.length === 0
				? `${entry.path}  unchanged\n`
				: `${entry.path}  ${changed.join(" ")}${how}\n`,
		);
	}

	// Nothing touched the disk until here.
	await writeFile(parsed.image, medium.bytes);
	if (damaged) {
		process.exitCode = 1;
	}
}

/** The canonical spelling, for reporting back what changed. */
function nameOf(attribute: DirEntryAttribute): string {
	return (
		Object.entries(ATTRIBUTE_NAMES).find(
			([, value]) => value === attribute,
		)?.[0] ?? attribute
	);
}
