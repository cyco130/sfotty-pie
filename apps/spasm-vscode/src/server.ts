import { access, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import {
	assemble,
	type Definition,
	type Host,
	type Message,
	type ModuleScope,
	type Reference,
} from "@sfotty-pie/spasm";

import { buildCompletions } from "./completion.ts";
import { buildOutline, formatValue } from "./outline.ts";
import {
	buildSemanticTokens,
	TOKEN_MODIFIERS,
	TOKEN_TYPES,
} from "./semantic-tokens.ts";
import { parse as parseJsonc } from "jsonc-parser";
import {
	createConnection,
	DiagnosticSeverity,
	ProposedFeatures,
	TextDocuments,
	TextDocumentSyncKind,
	type Diagnostic,
	type Hover,
	type Location,
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
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			definitionProvider: true,
			hoverProvider: true,
			documentSymbolProvider: true,
			completionProvider: { triggerCharacters: [":", "."] },
			semanticTokensProvider: {
				legend: {
					tokenTypes: [...TOKEN_TYPES],
					tokenModifiers: [...TOKEN_MODIFIERS],
				},
				full: true,
			},
		},
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
 * The last validation's merged analysis, for the definition and hover
 * providers. Module ids are absolute paths; spans are offsets into `texts`.
 */
let analysis = {
	definitions: new Map<string, Definition>(),
	references: new Map<string, Reference[]>(),
	moduleScopes: new Map<string, ModuleScope>(),
	texts: new Map<string, string>(),
};

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

	const definitions = new Map<string, Definition>();
	const references = new Map<string, Reference[]>();
	const moduleScopes = new Map<string, ModuleScope>();

	async function runEntry(entryPath: string): Promise<void> {
		const result = await assemble(entryPath, host);
		for (const message of result.diagnostics) addMessage(message, entryPath);
		for (const [key, definition] of result.definitions) {
			definitions.set(key, definition);
		}
		for (const [file, list] of result.references) {
			const merged = references.get(file);
			if (merged) merged.push(...list);
			else references.set(file, [...list]);
		}
		for (const [id, scope] of result.moduleScopes) {
			moduleScopes.set(id, scope);
		}
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
	analysis = { definitions, references, moduleScopes, texts };
	// Analysis changed under the client's highlighted tokens - have it
	// re-request them.
	void connection.languages.semanticTokens.refresh().catch(() => {});
}

connection.onCompletion(async (params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;
	const path = URI.parse(doc.uri).fsPath;
	const offset = doc.offsetAt(params.position);
	const lineStart = doc.offsetAt({ line: params.position.line, character: 0 });
	const text = doc.getText();
	const linePrefix = text.slice(lineStart, offset);

	// Inside an `.import` string, complete filesystem paths.
	const importString = /\.import[ \t]+"([^"]*)$/i.exec(linePrefix);
	if (importString) {
		return importPathItems(doc, offset, dirname(path), importString[1]!);
	}

	const candidates = buildCompletions({
		path,
		offset,
		linePrefix,
		text,
		definitions: analysis.definitions,
		moduleScopes: analysis.moduleScopes,
	});

	// Explicit replace range covering the word plus a leading `.`, which the
	// word pattern excludes - without this, accepting `.import` over `.im`
	// would produce `..import`.
	let wordStart = offset;
	while (wordStart > lineStart && /[\w@]/.test(text[wordStart - 1]!)) {
		wordStart--;
	}
	if (wordStart > lineStart && text[wordStart - 1] === ".") wordStart--;
	const range = {
		start: doc.positionAt(wordStart),
		end: doc.positionAt(offset),
	};
	return candidates.map((candidate) => ({
		...candidate,
		textEdit: { range, newText: candidate.label },
	}));
});

/** Directory listing completions for a partial `.import` specifier. */
async function importPathItems(
	doc: TextDocument,
	offset: number,
	fromDir: string,
	partial: string,
) {
	const lastSlash = partial.lastIndexOf("/");
	const base = resolve(
		fromDir,
		lastSlash === -1 ? "." : partial.slice(0, lastSlash),
	);
	const range = {
		start: doc.positionAt(offset - (partial.length - (lastSlash + 1))),
		end: doc.positionAt(offset),
	};
	try {
		const entries = await readdir(base, { withFileTypes: true });
		return entries
			.filter(
				(entry) =>
					!entry.name.startsWith(".") &&
					(entry.isDirectory() || entry.name.endsWith(".s")),
			)
			.map((entry) => ({
				label: entry.isDirectory() ? entry.name + "/" : entry.name,
				// LSP CompletionItemKind: 19 = Folder, 17 = File.
				kind: entry.isDirectory() ? (19 as const) : (17 as const),
				textEdit: {
					range,
					newText: entry.isDirectory() ? entry.name + "/" : entry.name,
				},
			}));
	} catch {
		return [];
	}
}

/** The qualified symbol under `offset` in `path` - a reference, or the
 * definition itself when the cursor sits on a defining occurrence. */
function symbolAt(
	path: string,
	offset: number,
): { symbol: string; span: [number, number] } | undefined {
	const reference = analysis.references
		.get(path)
		?.find((r) => r.start <= offset && offset <= r.end);
	if (reference) {
		return {
			symbol: reference.symbol,
			span: [reference.start, reference.end],
		};
	}

	for (const [symbol, definition] of analysis.definitions) {
		if (
			definition.file === path &&
			definition.start <= offset &&
			offset <= definition.end
		) {
			return { symbol, span: [definition.start, definition.end] };
		}
	}

	return undefined;
}

/** A document for offset/position mapping: the live buffer, or one built
 * from the text the last validation read. */
function mappingDocFor(path: string): TextDocument | undefined {
	for (const doc of documents.all()) {
		if (URI.parse(doc.uri).fsPath === path) return doc;
	}
	const text = analysis.texts.get(path);
	if (text === undefined) return undefined;
	return TextDocument.create(URI.file(path).toString(), "spasm", 0, text);
}

function definitionLocation(definition: Definition): Location | undefined {
	const doc = mappingDocFor(definition.file);
	if (!doc) return undefined;
	return {
		uri: doc.uri,
		range: {
			start: doc.positionAt(definition.start),
			end: doc.positionAt(definition.end),
		},
	};
}

connection.onDefinition((params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;
	const path = URI.parse(doc.uri).fsPath;
	const hit = symbolAt(path, doc.offsetAt(params.position));
	if (!hit) return null;
	const definition = analysis.definitions.get(hit.symbol);
	return definition ? (definitionLocation(definition) ?? null) : null;
});

connection.onHover((params): Hover | null => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;
	const path = URI.parse(doc.uri).fsPath;
	const hit = symbolAt(path, doc.offsetAt(params.position));
	if (!hit) return null;
	const definition = analysis.definitions.get(hit.symbol);
	if (!definition) return null;

	const text = analysis.texts.get(definition.file);
	const lines: string[] = [];
	if (text !== undefined) {
		lines.push(...definitionExcerpt(text, definition.start));
	}

	const parts = ["```spasm", ...lines, "```"];
	const value = formatValue(definition.value);
	if (value !== undefined) parts.push("", `= ${value}`);
	if (definition.file !== path) {
		parts.push("", `*${basename(definition.file)}*`);
	}

	return {
		contents: { kind: "markdown", value: parts.join("\n") },
		range: {
			start: doc.positionAt(hit.span[0]),
			end: doc.positionAt(hit.span[1]),
		},
	};
});

connection.languages.semanticTokens.on((params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return { data: [] };
	const path = URI.parse(doc.uri).fsPath;
	return {
		data: buildSemanticTokens(
			path,
			analysis.definitions,
			analysis.references,
			doc,
		),
	};
});

connection.onDocumentSymbol((params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;
	const path = URI.parse(doc.uri).fsPath;
	const text = analysis.texts.get(path) ?? doc.getText();
	return buildOutline(path, analysis.definitions, text, doc);
});

/**
 * The line containing `offset` plus the contiguous run of whole-line comments
 * directly above it (capped, for pathological comment walls).
 */
function definitionExcerpt(text: string, offset: number): string[] {
	const lineStart = (from: number): number =>
		text.lastIndexOf("\n", from - 1) + 1;

	let start = lineStart(offset);
	const endIndex = text.indexOf("\n", offset);
	const definitionLine = text
		.slice(start, endIndex === -1 ? text.length : endIndex)
		.trimEnd();

	const comments: string[] = [];
	while (start > 0 && comments.length < 16) {
		const previousStart = lineStart(start - 1);
		const line = text.slice(previousStart, start - 1).trim();
		if (!line.startsWith(";")) break;
		comments.unshift(line);
		start = previousStart;
	}

	return [...comments, definitionLine];
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
