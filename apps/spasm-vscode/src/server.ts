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
	DiagnosticTag,
	ErrorCodes,
	ProposedFeatures,
	ResponseError,
	TextDocuments,
	TextDocumentSyncKind,
	type Diagnostic,
	type Hover,
	type Location,
	type Range,
	type TextEdit,
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
			renameProvider: { prepareProvider: true },
			referencesProvider: true,
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
	valueVariants: new Map<
		string,
		{ entry: string; value: Definition["value"] }[]
	>(),
};

/** Values equal as far as display cares: numbers and strings compare; dicts
 * and functions (rebuilt per assemble) and unresolved values never conflict. */
function displayValuesEqual(
	a: Definition["value"],
	b: Definition["value"],
): boolean {
	if (a === undefined || b === undefined) return true;
	if (typeof a === "bigint" || typeof a === "string") return a === b;
	return true;
}

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
	/** Which entry's assemble set a definition first, and, for symbols whose
	 * converged values differ between entries (layout is per-program), the
	 * per-entry values in entry order. Structure is entry-invariant; values
	 * are not. */
	const firstEntry = new Map<string, string>();
	const valueVariants = new Map<
		string,
		{ entry: string; value: Definition["value"] }[]
	>();

	async function runEntry(entry: EntrySpec): Promise<void> {
		const result = await assemble(entry.module, host);
		for (const message of result.diagnostics) {
			addMessage(message, entry.module);
		}
		for (const [key, definition] of result.definitions) {
			const existing = definitions.get(key);
			if (!existing) {
				definitions.set(key, definition);
				firstEntry.set(key, entry.name);
				continue;
			}
			if (!displayValuesEqual(existing.value, definition.value)) {
				let variants = valueVariants.get(key);
				if (!variants) {
					variants = [{ entry: firstEntry.get(key)!, value: existing.value }];
					valueVariants.set(key, variants);
				}
				if (!variants.some((v) => v.entry === entry.name)) {
					variants.push({ entry: entry.name, value: definition.value });
				}
			}
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
	const projects = new Map<string, EntrySpec[]>();
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
		if (!texts.has(path)) {
			await runEntry({ module: path, name: defaultEntryName(path) });
		}
	}

	// Unreferenced definitions dim (hint severity + the Unnecessary tag).
	// Exported symbols are API and stay lit even when this closure doesn't
	// use them; hygiene gensyms share one source span across expansions, so
	// a span is "used" if any symbol defined at it is referenced.
	{
		const used = new Set<string>();
		for (const list of references.values()) {
			for (const reference of list) used.add(reference.symbol);
		}
		const usedSpans = new Set<string>();
		const spanKey = (d: Definition): string => d.file + "\0" + d.start;
		for (const [symbol, definition] of definitions) {
			if (used.has(symbol)) usedSpans.add(spanKey(definition));
		}

		for (const [symbol, definition] of definitions) {
			if (definition.kind === "module") continue;
			if (usedSpans.has(spanKey(definition))) continue;

			const sep = symbol.indexOf("\0");
			const module = symbol.slice(0, sep);
			const rest = symbol.slice(sep + 1);
			const scope = moduleScopes.get(module);
			if (definition.kind === "parameter") {
				// Param uses (both macro kinds) are recorded statically from
				// the body, so unused is meaningful whether or not the macro
				// is called or exported: unused is unused.
			} else if (rest.startsWith("\0")) {
				// Macro namespace: exported macros are API.
				const name = rest.slice(1).split("\0")[0]!;
				if (scope?.macroExports.has(name)) continue;
			} else if (scope?.exports.has(rest.split("\0")[0]!)) {
				// Symbols (and dict entries) reachable through an export.
				continue;
			}

			const name = rest.startsWith("\0")
				? rest.slice(1).replaceAll("\0", " ")
				: rest.replaceAll("\0", "::");
			const list = fileDiags.get(definition.file) ?? [];
			if (!fileDiags.has(definition.file)) {
				fileDiags.set(definition.file, list);
			}
			list.push({
				range: rangeIn(definition.file, definition.start, definition.end),
				severity: DiagnosticSeverity.Hint,
				tags: [DiagnosticTag.Unnecessary],
				source: "spasm",
				message: `"${name}" is never referenced`,
			});
		}
	}

	// Publish for everything touched this run (empty array clears old
	// squiggles), then explicitly clear files published before but untouched
	// now (closed documents, removed imports).
	const touched = new Set([
		...texts.keys(),
		...entries.map((entry) => entry.module),
		...openByPath.keys(),
	]);
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
	analysis = { definitions, references, moduleScopes, texts, valueVariants };
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
	// Layout is per-program: when entries converge this symbol to different
	// values, show each with its entry's name.
	const variants = analysis.valueVariants.get(hit.symbol);
	const value = variants
		? variants
				.map((v) => `${formatValue(v.value) ?? "?"} (${v.entry})`)
				.join(" | ")
		: formatValue(definition.value);
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

connection.onReferences((params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;
	const path = URI.parse(doc.uri).fsPath;
	const hit = symbolAt(path, doc.offsetAt(params.position));
	if (!hit) return null;

	const seen = new Set<string>();
	const locations: Location[] = [];
	const add = (file: string, start: number, end: number): void => {
		const key = file + "\0" + start;
		if (seen.has(key)) return;
		seen.add(key);
		const fileDoc = mappingDocFor(file);
		if (!fileDoc) return;
		locations.push({
			uri: fileDoc.uri,
			range: {
				start: fileDoc.positionAt(start),
				end: fileDoc.positionAt(end),
			},
		});
	};

	for (const [file, references] of analysis.references) {
		for (const reference of references) {
			if (reference.symbol === hit.symbol) {
				add(file, reference.start, reference.end);
			}
		}
	}
	if (params.context.includeDeclaration) {
		const definition = analysis.definitions.get(hit.symbol);
		if (definition) add(definition.file, definition.start, definition.end);
	}
	return locations;
});

/** Whether `symbol` is renameable, and its current spelling in source. */
function renameTarget(
	path: string,
	offset: number,
): { symbol: string; span: [number, number]; spelling: string } | undefined {
	const hit = symbolAt(path, offset);
	if (!hit) return undefined;
	const definition = analysis.definitions.get(hit.symbol);
	if (!definition || definition.kind === "module") return undefined;
	const name = hit.symbol.slice(hit.symbol.indexOf("\0") + 1);
	if (name.startsWith(":")) return undefined; // anonymous label
	const spelling =
		analysis.texts.get(path)?.slice(hit.span[0], hit.span[1]) ?? "";
	return { symbol: hit.symbol, span: hit.span, spelling };
}

connection.onPrepareRename((params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;
	const path = URI.parse(doc.uri).fsPath;
	const target = renameTarget(path, doc.offsetAt(params.position));
	if (!target) return null;
	return {
		range: {
			start: doc.positionAt(target.span[0]),
			end: doc.positionAt(target.span[1]),
		},
		placeholder: doc.getText().slice(target.span[0], target.span[1]),
	};
});

connection.onRenameRequest((params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;
	const path = URI.parse(doc.uri).fsPath;
	const target = renameTarget(path, doc.offsetAt(params.position));
	if (!target) return null;

	const local = target.spelling.startsWith("@");
	const newName = params.newName;
	if (local && !newName.startsWith("@")) {
		throw new ResponseError(
			ErrorCodes.InvalidParams,
			"Local label names start with `@`",
		);
	}
	if (!/^@?[A-Za-z_]\w*$/.test(newName) || local !== newName.startsWith("@")) {
		throw new ResponseError(ErrorCodes.InvalidParams, "Not a valid name");
	}
	if (/^[axy]$/i.test(newName)) {
		throw new ResponseError(
			ErrorCodes.InvalidParams,
			"Register names are reserved",
		);
	}

	// Every recorded reference plus the definition token, deduped by span
	// (multi-entry closures can record a file twice).
	const editsByPath = new Map<string, Map<number, number>>();
	const addEdit = (file: string, start: number, end: number): void => {
		const spans = editsByPath.get(file) ?? new Map<number, number>();
		if (!editsByPath.has(file)) editsByPath.set(file, spans);
		if (!spans.has(start)) spans.set(start, end);
	};

	for (const [file, references] of analysis.references) {
		for (const reference of references) {
			if (reference.symbol === target.symbol) {
				addEdit(file, reference.start, reference.end);
			}
		}
	}
	const definition = analysis.definitions.get(target.symbol)!;
	addEdit(definition.file, definition.start, definition.end);

	const changes: Record<string, TextEdit[]> = {};
	for (const [file, spans] of editsByPath) {
		const fileDoc = mappingDocFor(file);
		if (!fileDoc) continue;
		changes[fileDoc.uri] = [...spans].map(([start, end]) => ({
			range: {
				start: fileDoc.positionAt(start),
				end: fileDoc.positionAt(end),
			},
			newText: newName,
		}));
	}
	return { changes };
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

	const lines = [...comments, definitionLine];

	// A label alone on its line says nothing - show what it labels: the next
	// non-empty line (the routine's first instruction, a `.res`, ...).
	const labelOnly = /^\s*(?:@?[A-Za-z_]\w*\s*:\s*)+(?:;.*)?$/;
	if (labelOnly.test(definitionLine) && endIndex !== -1) {
		let from = endIndex + 1;
		while (from < text.length) {
			const nextEnd = text.indexOf("\n", from);
			const line = text
				.slice(from, nextEnd === -1 ? text.length : nextEnd)
				.trimEnd();
			if (line.trim() !== "") {
				lines.push(line);
				break;
			}
			if (nextEnd === -1) break;
			from = nextEnd + 1;
		}
	}

	return lines;
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
/**
 * An entry from spasm.jsonc: a plain module path, or an object
 * (`{ "module": "src/dos.s", "name": "dos" }`) whose future members will
 * grow build context (injected defines, target, CPU type). The name labels
 * the entry in multi-entry displays; it defaults to the module's basename.
 */
interface EntrySpec {
	module: string;
	name: string;
}

async function readEntries(configPath: string): Promise<EntrySpec[]> {
	try {
		const parsed: unknown = parseJsonc(await readFile(configPath, "utf8"));
		const entries = (parsed as { entries?: unknown } | null | undefined)
			?.entries;
		if (!Array.isArray(entries)) return [];

		const out: EntrySpec[] = [];
		for (const entry of entries) {
			const spec =
				typeof entry === "string"
					? { module: entry, name: undefined }
					: (entry as { module?: unknown; name?: unknown } | null);
			if (typeof spec?.module !== "string") continue;
			const module = resolve(dirname(configPath), spec.module);
			out.push({
				module,
				name:
					typeof spec.name === "string" ? spec.name : defaultEntryName(module),
			});
		}
		return out;
	} catch (error) {
		connection.console.warn(`Failed to read ${configPath}: ${String(error)}`);
		return [];
	}
}

function defaultEntryName(module: string): string {
	return basename(module).replace(/\.s$/, "");
}

documents.listen(connection);
connection.listen();
