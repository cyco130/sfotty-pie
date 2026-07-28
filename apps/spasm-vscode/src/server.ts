import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { assemble, type Host, type Message } from "@sfotty-pie/spasm";
import { parse as parseJsonc } from "jsonc-parser";
import {
	createConnection,
	DiagnosticSeverity,
	ProposedFeatures,
	TextDocuments,
	TextDocumentSyncKind,
	type Diagnostic,
	type Range,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceRoots: string[] = [];

connection.onInitialize((params) => {
	workspaceRoots =
		params.workspaceFolders?.map((folder) => URI.parse(folder.uri).fsPath) ??
		[];

	return {
		capabilities: { textDocumentSync: TextDocumentSyncKind.Incremental },
	};
});

documents.onDidOpen(scheduleValidation);
documents.onDidChangeContent(scheduleValidation);
documents.onDidClose(scheduleValidation);
// spasm.jsonc edits and on-disk changes to closed .s files (git checkout,
// external editors) arrive here rather than through the documents manager.
connection.onDidChangeWatchedFiles(scheduleValidation);

let timer: ReturnType<typeof setTimeout> | undefined;
let queue = Promise.resolve();

function scheduleValidation(): void {
	clearTimeout(timer);
	timer = setTimeout(() => {
		queue = queue.then(validateAll).catch((error: unknown) => {
			connection.console.error(
				error instanceof Error ? (error.stack ?? error.message) : String(error),
			);
		});
	}, 250);
}

/** URIs we published diagnostics for last run, so stale ones get cleared. */
let lastPublished = new Set<string>();

/**
 * Validate everything reachable from the open spasm documents: group them
 * into projects by their nearest spasm.jsonc, assemble each configured entry
 * (any open buffer shadows its on-disk file), and assemble standalone any
 * open document no entry's import closure reached.
 */
async function validateAll(): Promise<void> {
	const openByPath = new Map<string, TextDocument>();
	for (const doc of documents.all()) {
		if (doc.languageId === "spasm") {
			openByPath.set(URI.parse(doc.uri).fsPath, doc);
		}
	}

	/** Module id -> source text, for every module read this run. */
	const texts = new Map<string, string>();
	/** Synthesized documents for position mapping in non-open files. */
	const posDocs = new Map<string, TextDocument>();
	const fileDiags = new Map<string, Diagnostic[]>();
	/** Dedupes identical diagnostics reached through multiple entries. */
	const seen = new Set<string>();

	const host: Host = {
		resolve: (specifier, fromId) => resolve(dirname(fromId), specifier),
		read: async (id) => {
			const text =
				openByPath.get(id)?.getText() ?? (await readFile(id, "utf8"));
			texts.set(id, text);
			return text;
		},
	};

	function docFor(path: string): TextDocument | undefined {
		const open = openByPath.get(path);
		if (open) return open;

		let doc = posDocs.get(path);
		if (!doc) {
			const text = texts.get(path);
			if (text === undefined) return undefined;
			doc = TextDocument.create(URI.file(path).toString(), "spasm", 0, text);
			posDocs.set(path, doc);
		}

		return doc;
	}

	function rangeIn(path: string, start: number, end: number): Range {
		const doc = docFor(path);
		if (!doc) {
			return {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 0 },
			};
		}

		return { start: doc.positionAt(start), end: doc.positionAt(end) };
	}

	function uriFor(path: string): string {
		return openByPath.get(path)?.uri ?? URI.file(path).toString();
	}

	function addMessage(message: Message, entryPath: string): void {
		const file = message.file ?? entryPath;
		const key = [
			file,
			message.code,
			message.start,
			message.end,
			message.message,
		].join("\0");
		if (seen.has(key)) return;
		seen.add(key);

		const diagnostic: Diagnostic = {
			range: rangeIn(file, message.start, message.end),
			severity:
				message.type === "error"
					? DiagnosticSeverity.Error
					: message.type === "warning"
						? DiagnosticSeverity.Warning
						: DiagnosticSeverity.Information,
			code: message.code,
			source: "spasm",
			message: message.message,
		};

		if (message.notes?.length) {
			diagnostic.relatedInformation = message.notes.map((note) => {
				const noteFile = note.file ?? file;
				return {
					location: {
						uri: uriFor(noteFile),
						range: rangeIn(noteFile, note.start, note.end),
					},
					message: note.message,
				};
			});
		}

		const list = fileDiags.get(file);
		if (list) {
			list.push(diagnostic);
		} else {
			fileDiags.set(file, [diagnostic]);
		}
	}

	async function runEntry(entryPath: string): Promise<void> {
		const result = await assemble(entryPath, host);
		for (const message of result.diagnostics) addMessage(message, entryPath);
	}

	// Group open documents into projects by their nearest spasm.jsonc.
	const projects = new Map<string, string[]>();
	for (const path of openByPath.keys()) {
		const configPath = await findConfig(dirname(path));
		if (configPath !== undefined && !projects.has(configPath)) {
			projects.set(configPath, await readEntries(configPath));
		}
	}

	const entries = [...projects.values()].flat();
	for (const entry of entries) await runEntry(entry);

	// Anything the configured entries didn't reach assembles standalone. This
	// can produce whole-program noise (e.g. "segment never consumed") for a
	// library module not yet wired into an entry - listing it in spasm.jsonc
	// is the fix.
	for (const path of openByPath.keys()) {
		if (!texts.has(path)) await runEntry(path);
	}

	// Publish for everything touched this run (empty array clears old
	// squiggles), then explicitly clear files published before but untouched
	// now (closed documents, removed imports).
	const touched = new Set([...texts.keys(), ...entries, ...openByPath.keys()]);
	const published = new Set<string>();
	for (const path of touched) {
		const uri = uriFor(path);
		published.add(uri);
		await connection.sendDiagnostics({
			uri,
			diagnostics: fileDiags.get(path) ?? [],
		});
	}

	for (const uri of lastPublished) {
		if (!published.has(uri)) {
			await connection.sendDiagnostics({ uri, diagnostics: [] });
		}
	}

	lastPublished = published;
}

/**
 * Walk up from `dir` looking for a spasm.jsonc, stopping at the containing
 * workspace folder (or the filesystem root for out-of-workspace files).
 */
async function findConfig(dir: string): Promise<string | undefined> {
	const stopAt = workspaceRoots.find(
		(root) => dir === root || dir.startsWith(root + sep),
	);

	for (let current = dir; ; current = dirname(current)) {
		const candidate = join(current, "spasm.jsonc");
		if (await exists(candidate)) return candidate;
		if (current === stopAt || dirname(current) === current) return undefined;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/** Read a spasm.jsonc's `entries`, resolved relative to the config file. */
async function readEntries(configPath: string): Promise<string[]> {
	try {
		const parsed: unknown = parseJsonc(await readFile(configPath, "utf8"));
		const entries = (parsed as { entries?: unknown } | null | undefined)
			?.entries;
		if (!Array.isArray(entries)) return [];

		return entries
			.filter((entry): entry is string => typeof entry === "string")
			.map((entry) => resolve(dirname(configPath), entry));
	} catch (error) {
		connection.console.warn(`Failed to read ${configPath}: ${String(error)}`);
		return [];
	}
}

documents.listen(connection);
connection.listen();
