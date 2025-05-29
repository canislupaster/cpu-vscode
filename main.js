import { ExtensionMode } from "vscode";
import { join } from "node:path";
export async function activate(ctx) {
	const path = ctx.extensionMode==ExtensionMode.Production ? "dist/extension.js" : "out/extension.js";
	import(join(ctx.extensionUri.fsPath, path)).then(mod=>mod.activate(ctx));
}