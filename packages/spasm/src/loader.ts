import { parse, type Message, type Statement } from "./parser.ts";
import { SourceFile } from "./source-file.ts";
import { decodeStringLiteral } from "./value.ts";

/**
 * How the assembler reaches modules. `resolve` turns an `.import` specifier
 * into a canonical id (relative to the importing module); `read` returns a
 * module's source. Both may throw - the loader turns that into a diagnostic.
 */
export interface Host {
	resolve(specifier: string, fromId: string): string | Promise<string>;
	read(id: string): string | Promise<string>;
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
	const order: LoadedModule[] = [];

	const load = async (
		id: string,
		importedAt?: readonly [number, number],
	): Promise<void> => {
		if (loaded.has(id)) return; // already loaded (dedup)
		if (onStack.has(id)) {
			report(diagnostics, importedAt, `Import cycle through "${id}"`);
			return;
		}
		onStack.add(id);

		let source: string | undefined;
		try {
			source = await host.read(id);
		} catch {
			report(diagnostics, importedAt, `Cannot read module "${id}"`);
		}

		if (source !== undefined) {
			const sourceFile = new SourceFile(id, source);
			const { module, errors } = parse(sourceFile);
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
						report(diagnostics, span, `Cannot resolve module "${specifier}"`);
					}
					if (depId !== undefined) {
						imports.push({ id: depId, binding: binding?.text ?? null });
						await load(depId, span);
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
	};

	await load(entryId);
	return order;
}

function report(
	diagnostics: Message[],
	span: readonly [number, number] | undefined,
	message: string,
): void {
	const [start, end] = span ?? [0, 0];
	diagnostics.push({ type: "error", start, end, message });
}
