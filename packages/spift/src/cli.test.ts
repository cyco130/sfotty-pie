import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

const CLI = new URL("./cli.ts", import.meta.url).pathname;
function spift(...args: string[]): { out: string; code: number } {
	try {
		return {
			out: execFileSync(
				process.execPath,
				["--experimental-strip-types", CLI, ...args],
				{
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				},
			),
			code: 0,
		};
	} catch (error) {
		const failure = error as {
			stdout?: string;
			stderr?: string;
			status?: number;
		};
		return {
			out: (failure.stdout ?? "") + (failure.stderr ?? ""),
			code: failure.status ?? 1,
		};
	}
}

test("help alone lists every command", () => {
	const { out } = spift("help");
	for (const name of ["create", "ls", "cp", "chattr", "hexdump", "recode"]) {
		expect(out).toContain(`  ${name} `);
	}
});

test("help NAME shows one command, not the rest", () => {
	const { out } = spift("help", "ls");
	expect(out).toContain("List a directory of the filesystem");
	expect(out).not.toContain("Create a blank image");
});

test("--help and -h on a command do the same", () => {
	const viaHelp = spift("help", "mkfs").out;
	expect(spift("mkfs", "--help").out).toBe(viaHelp);
	expect(spift("mkfs", "-h").out).toBe(viaHelp);
});

test("asking for help works even when the rest of the line is wrong", () => {
	// cp needs a source and a destination; asking for help should not first
	// complain about their absence.
	const { out, code } = spift("cp", "--help");
	expect(code).toBe(0);
	expect(out).toContain("Copy entries");
	expect(out).not.toContain("missing SOURCE");
});

test("cp and mv carry the container flags with them", () => {
	expect(spift("help", "cp").out).toContain("--from CONTAINER");
	expect(spift("help", "mv").out).toContain("--from CONTAINER");
	// Nothing else needs them.
	expect(spift("help", "ls").out).not.toContain("--from CONTAINER");
});

test("an unknown name lists what there is", () => {
	const { out, code } = spift("help", "bogus");
	expect(code).toBe(2);
	expect(out).toMatch(/unknown command "bogus"/);
	expect(out).toContain("hexdump");
});
