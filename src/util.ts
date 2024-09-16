import { stat } from "node:fs/promises";
import { WebviewViewProvider, workspace, Event, WebviewView, CancellationToken, Uri, WebviewPanel, CancellationError } from "vscode";
import { InitState, MessageFromExt, MessageToExt } from "./shared";
import App from "./main";

export const delay = (x: number) => new Promise<void>((res)=>setTimeout(res, x));
export const exists = (path: string) => stat(path).then(()=>true, ()=>false);
export const cfg = () => workspace.getConfiguration("cpu");
export const cancelPromise = (x: CancellationToken) => new Promise<never>((res,rej) => {
	x.onCancellationRequested(()=>rej(new CancellationError()));
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
			localResourceRoots: [Uri.joinPath(this.app.ctx.extensionUri, "out")]
		};

		const sendSub = this.onMessage((msg)=>{
			if (!(msg.type in this.msgFilter) || this.msgFilter[msg.type])
				webview.postMessage(msg)
		});

		const init: InitState = this.app.getInitState();

		webview.html = `<!DOCTYPE html>
<html lang="en" class="dark" >
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="stylesheet" href="${webview.asWebviewUri(Uri.joinPath(this.app.ctx.extensionUri, `out/${this.src}.css`)).toString()}" />
	<script>
		const init = ${JSON.stringify(init)};
	</script>
	<script src="${webview.asWebviewUri(Uri.joinPath(this.app.ctx.extensionUri, `out/${this.src}.js`)).toString()}" ></script>
</head>
<body>
	<div id="root" ></div>
</body>
</html>`;
		
		const recvSub = webview.onDidReceiveMessage((x)=>this.app!.handleMsg(x as MessageToExt));
		onDidDispose(()=>{
			sendSub.dispose(); recvSub.dispose()
		});
	}
}