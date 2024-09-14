import { stat } from "node:fs/promises";
import { WebviewViewProvider, workspace, Event, Disposable, WebviewView, CancellationToken, WebviewViewResolveContext, Uri, WebviewPanel } from "vscode";
import { InitState, MessageFromExt } from "./shared";
import App from "./main";

export const delay = (x: number) => new Promise<void>((res)=>setTimeout(res, x));
export const exists = (path: string) => stat(path).then((_)=>true, (_)=>false);
export const cfg = () => workspace.getConfiguration("cpu");

export class CPUWebviewProvider implements WebviewViewProvider {
	msgSet?: Set<MessageFromExt["type"]>;
	app?: App;

	constructor(private src: "panel"|"activitybar"|"testeditor",
		private onMessage: Event<MessageFromExt>, msgFilter?: MessageFromExt["type"][]) {

		if (msgFilter) this.msgSet=new Set(msgFilter);
	}

	dispose() {}

	resolveWebviewView({webview, onDidDispose}: WebviewView|WebviewPanel) {
		if (this.app==undefined) throw new Error("application uninitialized");

		webview.options = {
			enableScripts: true,
			localResourceRoots: [Uri.joinPath(this.app.ctx.extensionUri, "out")]
		};

		const sendSub = this.onMessage((msg)=>{
			if (this.msgSet==undefined || this.msgSet.has(msg.type))
				webview.postMessage(msg)
		});

		const init: InitState = this.app.getInitState();

		webview.html = `<!DOCTYPE html>
<html lang="en" class="dark" >
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="stylesheet" href="${webview.asWebviewUri(Uri.joinPath(this.app.ctx.extensionUri, `out/${this.src}.css`))}" />
	<script>
		const init = ${JSON.stringify(init)};
	</script>
	<script src="${webview.asWebviewUri(Uri.joinPath(this.app.ctx.extensionUri, `out/${this.src}.js`))}" ></script>
</head>
<body>
	<div id="root" ></div>
</body>
</html>`;
		
		const recvSub = webview.onDidReceiveMessage((x)=>this.app!.handleMsg(x));
		onDidDispose(()=>{
			sendSub.dispose(), recvSub.dispose()
		});
	}
}