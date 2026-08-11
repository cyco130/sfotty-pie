// Resolves the --image/--from/--to trio into a source and a target store.
//
// A container is a disk image or a host directory; each side falls back to
// the host working directory when its flag is absent, and --image (-i) means
// "both sides are this image". That leaves one rule to enforce: at least one
// side has to be an image, since host-to-host copying is what cp(1) is for.

import { statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { FsVariant } from "./fs-option.ts";
import { CliError, UsageError } from "./../cli-error.ts";
import type { FileStore } from "../filesystem.ts";
import { openHostDirectory } from "../host-dir.ts";
import {
	openImageFilesystem,
	saveImage,
	type OpenedImage,
} from "./open-image.ts";

export interface ContainerOptions {
	image: string | undefined;
	from: string | undefined;
	to: string | undefined;
	fs: "atari" | "sparta" | undefined;
	variant: FsVariant | undefined;
	fromFs: "atari" | "sparta" | undefined;
	fromVariant: FsVariant | undefined;
	toFs: "atari" | "sparta" | undefined;
	toVariant: FsVariant | undefined;
}

export interface ResolvedContainers {
	source: FileStore;
	target: FileStore;
	/** How to name each side in a message ("disk.atr", "./out"). */
	sourceName: string;
	targetName: string;
	/** True when both sides are the same open container. */
	sameContainer: boolean;
	/**
	 * Writes out what changed: the target always, the source as well when
	 * asked - which only a move needs, since a copy leaves it alone. Target
	 * first, so a crash in between leaves a duplicate rather than a hole.
	 */
	commit(options?: { source?: boolean }): Promise<void>;
}

/**
 * Parses the container flags shared by cp and mv. Kept apart from the
 * resolution below so argument parsing stays synchronous and testable.
 */
export function parseContainerOptions(
	values: Record<string, unknown>,
	parseFs: (
		text: string,
		flag: string,
	) => {
		family: "atari" | "sparta" | undefined;
		variant: FsVariant | undefined;
	},
): ContainerOptions {
	const image = values["image"] as string | undefined;
	const from = values["from"] as string | undefined;
	const to = values["to"] as string | undefined;
	if (image !== undefined && (from !== undefined || to !== undefined)) {
		throw new UsageError(
			"--image (-i) already means both sides; use --from and --to instead",
		);
	}
	const select = (text: unknown, flag: string) =>
		text === undefined
			? { family: undefined, variant: undefined }
			: parseFs(text as string, flag);
	const both = select(values["fs"], "--fs");
	const fromSide = select(values["from-fs"], "--from-fs");
	const toSide = select(values["to-fs"], "--to-fs");
	return {
		image,
		from,
		to,
		fs: both.family,
		variant: both.variant,
		fromFs: fromSide.family ?? both.family,
		fromVariant: fromSide.variant ?? both.variant,
		toFs: toSide.family ?? both.family,
		toVariant: toSide.variant ?? both.variant,
	};
}

/** The options every command with containers accepts, for parseArgs. */
export const CONTAINER_ARG_OPTIONS = {
	image: { type: "string", short: "i" },
	from: { type: "string" },
	to: { type: "string" },
	fs: { type: "string" },
	"from-fs": { type: "string" },
	"to-fs": { type: "string" },
} as const;

function isDirectory(path: string): boolean {
	const stat = statSync(path, { throwIfNoEntry: false });
	if (stat === undefined) {
		throw new CliError(`${path}: no such file or directory`);
	}
	return stat.isDirectory();
}

export async function resolveContainers(
	options: ContainerOptions,
): Promise<ResolvedContainers> {
	const sourceName = options.image ?? options.from ?? ".";
	const targetName = options.image ?? options.to ?? ".";
	const sourceIsImage = !isDirectory(sourceName);
	const targetIsImage = !isDirectory(targetName);
	if (!sourceIsImage && !targetIsImage) {
		throw new UsageError(
			"at least one side must be an image: name it with --image (-i), " +
				"--from, or --to (host-to-host copying is what cp(1) is for)",
		);
	}

	// Both sides naming the same file must share one open image, or the
	// second write-back would throw away the first.
	const same =
		sourceIsImage &&
		targetIsImage &&
		resolvePath(sourceName) === resolvePath(targetName);

	// A side knows how to write itself out, whichever kind of container it is.
	interface Side {
		store: FileStore;
		write(): Promise<void>;
	}
	const openImageSide = async (
		name: string,
		fs: "atari" | "sparta" | undefined,
		variant: FsVariant | undefined,
	): Promise<Side> => {
		const image: OpenedImage = await openImageFilesystem(name, fs, variant);
		return {
			store: image.filesystem,
			write: () => saveImage(name, image),
		};
	};
	// A directory named outright is a container and confines what goes in it;
	// the side that falls back to the working directory is the host itself,
	// where a path means what it means in the shell.
	const openHostSide = (name: string, named: boolean): Side => {
		const store = openHostDirectory(name, { confine: named });
		return { store, write: () => store.commit() };
	};

	const sourceSide: Side = sourceIsImage
		? await openImageSide(sourceName, options.fromFs, options.fromVariant)
		: openHostSide(sourceName, options.from !== undefined);
	const targetSide: Side = same
		? sourceSide
		: targetIsImage
			? await openImageSide(targetName, options.toFs, options.toVariant)
			: openHostSide(targetName, options.to !== undefined);

	return {
		source: sourceSide.store,
		target: targetSide.store,
		sourceName,
		targetName,
		sameContainer: same,
		async commit(commitOptions?: { source?: boolean }): Promise<void> {
			await targetSide.write();
			if (commitOptions?.source === true && !same) {
				await sourceSide.write();
			}
		},
	};
}
