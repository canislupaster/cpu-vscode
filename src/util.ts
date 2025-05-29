import { readdir, stat } from "node:fs/promises";
import { WebviewViewProvider, Event, WebviewView, CancellationToken, Uri, WebviewPanel, CancellationError, ExtensionContext } from "vscode";
import { InitState, MessageFromExt, MessageToExt, SetStateMessage } from "./shared";
import App from "./main";
import { parse } from "shell-quote";
import { createServer } from "node:net";
import { join } from "node:path";

declare const PROD: boolean;
export const outDir = PROD ? "dist" : "out";

export const getChunks = async (ctx: ExtensionContext) =>
	(await readdir(join(ctx.extensionPath, outDir)))
		.filter(x=>x.startsWith("chunk-") && x.endsWith(".js"));

export const delay = (x: number) => new Promise<void>((res)=>setTimeout(res, x));
export const exists = (path: string) => stat(path).then(()=>true, ()=>false);
export const cancelPromise = (x: CancellationToken) => new Promise<never>((res,rej) => {
	x.onCancellationRequested(()=>rej(new CancellationError()));
});

export function argsToArr(args: string): string[] {
	return parse(args).map(x=>{
		if (typeof x=="object") {
			if ("comment" in x) return x.comment;
			if (x.op=="glob") return x.pattern;
			else return x.op;
		} else {
			return x;
		}
	});
}

// https://stackoverflow.com/a/79001890
export const portInUse = (port: number) => new Promise<boolean>((res,rej)=>{
	const server = createServer().listen(port, "localhost", ()=>{
		server.close();
		res(false);
	}).once("error", err=>{
		if ("code" in err && err.code=="EADDRINUSE") res(true);
		else rej(err);
	});
});

export class CPUWebviewProvider implements WebviewViewProvider {
	msgFilter: Partial<Record<MessageFromExt["type"], boolean>> ={};
	app?: App;

	constructor(private src: "panel"|"activitybar"|"testeditor",
		private onMessage: Event<MessageFromExt>, exclude: MessageFromExt["type"][]=[]) {
		for (const v of exclude) this.msgFilter[v]=false;
	}

	dispose() {}

	resolveWebviewView({webview, onDidDispose}: WebviewView|WebviewPanel) {
		if (this.app==undefined) throw new Error("application uninitialized");

		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				Uri.joinPath(this.app.ctx.extensionUri, outDir),
				Uri.joinPath(this.app.ctx.extensionUri, "resources")
			]
		};

		const sendSub = this.onMessage((msg)=>{
			if (!(msg.type in this.msgFilter) || this.msgFilter[msg.type])
				webview.postMessage(msg)
		});

		const init: InitState = this.app.getInitState();

		const uri = (x: string,resource=false)=>
			webview.asWebviewUri(Uri.joinPath(
				this.app!.ctx.extensionUri, resource ? "resources" : outDir, x
			)).toString();

		const importMap = {imports: Object.fromEntries(this.app.chunks.map(c=>[`./${c}`, uri(c)]))};

		const uiStateKey = `${this.src}-webviewState`;

		webview.html = `<!DOCTYPE html>
<html lang="en" >
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />

	<style>
		@font-face {
			font-family: 'Chivo';
			src: url('${uri("../resources/Chivo.ttf",true)}') format('truetype');
		}

		@font-face {
			font-family: 'Inter';
			src: url('${uri("../resources/Inter.ttf",true)}') format('truetype');
		}
	</style>

	<link rel="stylesheet" href="${uri(`${this.src}.css`)}" />
	<link rel="stylesheet" href="${uri("output.css")}" />

	<script>
		const init = ${JSON.stringify(init)};
		let uiState=${JSON.stringify(this.app.ctx.globalState.get(uiStateKey))};
	</script>
	
	<script type="importmap" >
		${JSON.stringify(importMap)}
	</script>
	<script type="module" src="${uri(`${this.src}.js`)}" ></script>
</head>
<body>
	<div id="root" >
	</div>
</body>
</html>`;
		
		const recvSub = webview.onDidReceiveMessage((x: MessageToExt|SetStateMessage)=>{
			if (x.type=="setUIState") this.app!.ctx.globalState.update(uiStateKey, x.newState);
			else this.app!.handleMsg(x);
		});

		onDidDispose(()=>{
			sendSub.dispose(); recvSub.dispose()
		});
	}
}