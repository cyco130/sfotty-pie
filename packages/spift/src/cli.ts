#!/usr/bin/env node
import { CliError, UsageError } from "./cli-error.ts";
import { createCommand } from "./commands/create.ts";
import { lsCommand } from "./commands/ls.ts";

const USAGE = `usage: spift <command> [options]

commands:
  create FILENAME [-t TYPE] [-f] [--sd | --ed | --dd]
                  [--sector-size N] [--sector-count N]
    Create a blank image (all zeroes, no filesystem). TYPE is inferred from
    the file name when omitted; supported types: atr. Defaults to --sd
    (720 x 128-byte sectors); --ed is 1040 x 128 and --dd is 720 x 256.
    Refuses to overwrite an existing file unless --force (-f) is given.

  ls IMAGE_FILE [SPEC] [--fs atari|sparta] [-l]
    List the root directory of the filesystem on an image. SPEC filters
    with native wildcards (* and ?; name and extension match separately;
    quote it to keep the shell from expanding it). The filesystem is
    autodetected; --fs overrides. --long (-l) adds sector counts, start
    sectors, and attributes.
`;

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	switch (command) {
		case "create":
			await createCommand(args);
			break;
		case "ls":
			await lsCommand(args);
			break;
		case undefined:
		case "help":
		case "--help":
		case "-h":
			process.stdout.write(USAGE);
			if (command === undefined) {
				process.exit(2);
			}
			break;
		default:
			throw new UsageError(`unknown command "${command}"`);
	}
}

main().catch((error: unknown) => {
	if (error instanceof CliError) {
		process.stderr.write(`spift: ${error.message}\n`);
		process.exit(error.exitCode);
	}
	const detail =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`${detail}\n`);
	process.exit(1);
});
