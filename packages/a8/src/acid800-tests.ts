/* eslint-disable no-console -- conformance-test runner reports to the console */
// Runs the Altirra Acid800 test suite (test/acid800/acid800.atr) on a 130XE
// with the committed Altirra OS/BASIC ROMs and compares every test's result to
// the recorded baseline (test/acid800/baseline.json). Any change — a pass
// becoming a fail, a fail becoming a pass, or a new/missing test — fails, so an
// intentional change must be recorded with `pnpm acid800-tests --update`.
//
// The suite is driven through boot.ts: `--keys 21,16` feeds Space then X to skip
// the boot menu into "exit and run tests", then exits the process once done.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname; // packages/a8/src
const REPO = join(HERE, "..", "..", "..");
const FIRMWARE = join(REPO, "apps", "a8-web", "library", "firmware");
const ACID_DIR = join(HERE, "..", "test", "acid800");
const BASELINE = join(ACID_DIR, "baseline.json");

type Status = "pass" | "fail" | "skip";

function runSuite(): Record<string, Status> {
	const output = execFileSync(
		"node",
		[
			join(HERE, "boot.ts"),
			"--xe",
			"--os",
			join(FIRMWARE, "AltirraOS XL-XE.rom"),
			"--basic",
			join(FIRMWARE, "Altirra BASIC.rom"),
			join(ACID_DIR, "acid800.atr"),
			"--keys",
			"21,16",
		],
		{ encoding: "latin1", input: "", maxBuffer: 64 << 20 },
	);

	// Each result reads "Loading test N<ctl><name>...<Pass|FAIL.|Skipped>", where
	// <ctl> is an ATASCII control byte (and is sometimes already a real newline).
	// Turn every non-printable byte into a line break, then the name is just the
	// text before "...".
	const lines = Array.from(output, (ch) => {
		const code = ch.charCodeAt(0);
		return code < 0x20 || code >= 0x7f ? "\n" : ch;
	}).join("");

	const results: Record<string, Status> = {};
	for (const line of lines.split("\n")) {
		const match = /^(.+?)\.\.\.(Pass|FAIL|Skipped)/.exec(line);
		if (!match) continue;
		const status: Status =
			match[2] === "Pass" ? "pass" : match[2] === "FAIL" ? "fail" : "skip";
		results[match[1]!.trim()] = status;
	}
	return results;
}

const results = runSuite();
const total = Object.keys(results).length;
const tally = Object.values(results).reduce<Record<Status, number>>(
	(counts, status) => ({ ...counts, [status]: counts[status] + 1 }),
	{ pass: 0, fail: 0, skip: 0 },
);

if (total === 0) {
	console.error("Acid800: no test results parsed — the suite did not run.");
	process.exit(1);
}

if (process.argv.includes("--update")) {
	const sorted = Object.fromEntries(
		Object.keys(results)
			.sort()
			.map((name) => [name, results[name]]),
	);
	writeFileSync(BASELINE, JSON.stringify(sorted, null, "\t") + "\n");
	console.log(
		`Wrote baseline: ${total} tests (${tally.pass} pass, ${tally.fail} fail, ${tally.skip} skip).`,
	);
	process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<
	string,
	Status
>;

const problems: string[] = [];
for (const [name, status] of Object.entries(results)) {
	if (!(name in baseline)) problems.push(`new test "${name}" → ${status}`);
	else if (baseline[name] !== status)
		problems.push(`"${name}": ${baseline[name]} → ${status}`);
}
for (const name of Object.keys(baseline)) {
	if (!(name in results))
		problems.push(`missing test "${name}" (was ${baseline[name]})`);
}

console.log(
	`Acid800 (130XE): ${tally.pass} pass, ${tally.fail} fail, ${tally.skip} skip, ${total} total.`,
);

if (problems.length > 0) {
	console.error(
		`\n${problems.length} result(s) changed — if intentional, run \`pnpm acid800-tests --update\`:`,
	);
	for (const problem of problems) console.error(`  ${problem}`);
	process.exit(1);
}

console.log("Matches baseline.");
