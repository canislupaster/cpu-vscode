module.exports.activate=(ctx)=>{
	const vscode = require("vscode");
	const path = ctx.extensionMode==vscode.ExtensionMode.Production ? "dist/extension.js" : "out/extension.js";
	return require(require("path").join(ctx.extensionUri.fsPath,path)).activate(ctx);
}