import { Codes } from "./codes.ts";
import {
	parse,
	type Message,
	type MessageNote,
	type Statement,
} from "./parser.ts";
import { SourceFile } from "./source-file.ts";
import { decodeStringLiteral } from "./value.ts";

/**
 * How the assembler reaches modules. `resolve` turns an `.import` specifier
 * into a canonical id (relative to the importing module); `read` returns a
 * module's source. Both may throw - the loader turns that into a diagnostic.
 * `shortName`, when provided, gives a module's display name for formatted
 * diagnostics (e.g. a cwd-relative path); ids stay canonical everywhere else.
 */
export interface Host {
	resolve(specifier: string, fromId: string): string | Promise<string>;
	read(id: string): string | Promise<string>;
	shortName?(id: string): string;
}

/** One resolved `.import`: `binding` is the namespace name, or null for a
 * splat import. */
export interface ImportRecord {
	id: string;
	binding: string | null;
}

export interface LoadedModule {
	id: string;
	sourceFile: SourceFile;
	statements: Statement[];
	/** This module's resolved imports, in source order. */
	imports: ImportRecord[];
}

/**
 * Load the entry module and its `.import` closure, deduped by canonical id
 * (each module loads once, even in diamonds), returned in dependency order -
 * imports before importers. Import cycles are reported, not followed.
 */
export async function loadModules(
	entryId: string,
	host: Host,
	diagnostics: Message[],
): Promise<LoadedModule[]> {
	const loaded = new Map<string, LoadedModule>();
	const onStack = new Set<string>();
	// The in-progress import chain, for cycle notes: where each module on the
	// stack was imported from (the entry module has no import site).
	const stack: Array<{
		id: string;
		span?: readonly [number, number];
		importerId?: string;
	}> = [];
	const order: LoadedModule[] = [];

	const load = async (
		id: string,
		importedAt?: readonly [number, number],
		importerId?: string,
	): Promise<void> => {
		if (loaded.has(id)) return; // already loaded (dedup)
		if (onStack.has(id)) {
			const cycle = stack.slice(stack.findIndex((entry) => entry.id === id));
			const notes: MessageNote[] = [];
			for (const entry of cycle) {
				if (entry.span && entry.importerId !== undefined) {
					notes.push({
						message: `While importing "${entry.id}"`,
						start: entry.span[0],
						end: entry.span[1],
						file: entry.importerId,
					});
				}
			}
			report(
				diagnostics,
				Codes.ImportCycle,
				importedAt,
				`Import cycle through "${id}"`,
				importerId,
				notes,
			);
			return;
		}
		onStack.add(id);
		stack.push({ id, span: importedAt, importerId });

		let source: string | undefined;
		try {
			source = await host.read(id);
		} catch {
			report(
				diagnostics,
				Codes.ModuleReadFailed,
				importedAt,
				`Cannot read module "${id}"`,
				importerId,
			);
		}

		if (source !== undefined) {
			const sourceFile = new SourceFile(id, source, host.shortName?.(id) ?? id);
			const { module, errors } = parse(sourceFile);
			for (const error of errors) error.file = id;
			diagnostics.push(...errors);

			const imports: ImportRecord[] = [];
			for (const statement of module.statements) {
				if (statement.content?.type === "import") {
					const { specToken, binding } = statement.content;
					const span: readonly [number, number] = [
						specToken.start,
						specToken.end,
					];
					const specifier = decodeStringLiteral(specToken.text, () => {});
					let depId: string | undefined;
					try {
						depId = await host.resolve(specifier, id);
					} catch {
						report(
							diagnostics,
							Codes.ModuleResolveFailed,
							span,
							`Cannot resolve module "${specifier}"`,
							id,
						);
					}
					if (depId !== undefined) {
						imports.push({ id: depId, binding: binding?.text ?? null });
						await load(depId, span, id);
					}
				}
			}

			loaded.set(id, {
				id,
				sourceFile,
				statements: module.statements,
				imports,
			});
			order.push(loaded.get(id)!);
		}

		onStack.delete(id);
		stack.pop();
	};

	await load(entryId);
	return order;
}

function report(
	diagnostics: Message[],
	code: string,
	span: readonly [number, number] | undefined,
	message: string,
	file?: string,
	notes?: MessageNote[],
): void {
	const [start, end] = span ?? [0, 0];
	diagnostics.push({ type: "error", code, start, end, message, file, notes });
}
