// Errors the CLI reports as clean one-liners (no stack trace). UsageError is
// for bad invocations and exits 2; plain CliError is for runtime failures
// (file exists, I/O trouble) and exits 1.

export class CliError extends Error {
	readonly exitCode: number;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.exitCode = exitCode;
	}
}

export class UsageError extends CliError {
	constructor(message: string) {
		super(message, 2);
	}
}
