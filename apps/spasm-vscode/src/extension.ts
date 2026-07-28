import { workspace, type ExtensionContext } from "vscode";
import {
	LanguageClient,
	TransportKind,
	type LanguageClientOptions,
	type ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
	const serverModule = context.asAbsolutePath("dist/server.cjs");
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: { execArgv: ["--inspect=6009"] },
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ language: "spasm" }],
		synchronize: {
			// The server revalidates on config edits and on-disk changes to
			// closed modules of an open project.
			fileEvents: [
				workspace.createFileSystemWatcher("**/spasm.jsonc"),
				workspace.createFileSystemWatcher("**/*.s"),
			],
		},
	};

	client = new LanguageClient("spasm", "spasm", serverOptions, clientOptions);
	void client.start();
}

export function deactivate(): Thenable<void> | undefined {
	return client?.stop();
}
