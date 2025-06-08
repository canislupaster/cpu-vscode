import App from "./main";
import { commands, ExtensionContext, window, Disposable, EventEmitter, CancellationTokenSource, CancellationError } from "vscode";
import { join } from "path";
import { FileChangeInfo, watch } from "fs/promises";
import { MessageFromExt } from "./shared";
import { cancelPromise, CPUWebviewProvider, exists, getChunks, outDir } from "./util";

declare const WATCH: boolean;

export async function activate(ctx: ExtensionContext) {
	const chunks = await getChunks(ctx);
	ctx.globalState.update("chunks", chunks);

	const log = window.createOutputChannel("Competitive Programmers Union", {log: true});
	ctx.subscriptions.push(log);

	const onMessage = new EventEmitter<MessageFromExt>();
	ctx.subscriptions.push(onMessage);

	const activity = new CPUWebviewProvider("activitybar", onMessage.event, ["testCaseStream"]);
	const panel = new CPUWebviewProvider("panel", onMessage.event);

	let old: Disposable[]=[];
	const initApp = (x: typeof App) => {
		if (old.length) {
			old.forEach(x=>void x.dispose());
			old=[]; // in case of failure
		}

		log.info("(re)loading app");
		const app = new x(ctx, chunks, log);
		activity.app=app; panel.app=app;

		old=[app.onMessage((x)=>onMessage.fire(x)), app];
	};

	if (WATCH) {
		log.info("hot reloading enabled");
		
		(async () => {
			const mainName = "main.js";
			const files = [
				...["activitybar","panel","testeditor"].flatMap(x=>[
					`${outDir}/${x}.js`, `${outDir}/${x}.css`
				]),
				...chunks.map(p=>join(outDir,p)),
				join(outDir, mainName),
				`${outDir}/output.css`
			].map(x=>join(ctx.extensionPath, x));

			const watchers = (await Promise.all(files
					.map(async (x):Promise<[string,boolean]> => [x,await exists(x)])))
					.filter(v=>v[1]).map(v=>watch(v[0])[Symbol.asyncIterator]());
			const unresolved = watchers.map(async (x,i): Promise<[FileChangeInfo<string>, number]> =>
				[(await x.next()).value as FileChangeInfo<string>, i]
			);
			
			let unseen: null|Disposable=null;
			let tm: NodeJS.Timeout|null=null;
			ctx.subscriptions.push({dispose() {
				unseen?.dispose();
				if (tm!=null) clearTimeout(tm);
			}});

			const cancel = new CancellationTokenSource();

			let mainChanged = false;
			const act = () => {
				if (tm) clearTimeout(tm);

				tm=setTimeout(()=>{
					if (mainChanged) {
						log.info("reloading window");
						commands.executeCommand("workbench.action.reloadWindow");
					} else {
						log.info("reloading webviews");
						commands.executeCommand("workbench.action.webview.reloadWebviewAction");
					}
				}, 500);
			};

			log.info(`Starting watch for ${watchers.length} files`);
			while (!cancel.token.isCancellationRequested) {
				const [x,i] = await Promise.race([
					...unresolved, cancelPromise(cancel.token)
				]);

				unresolved[i] = watchers[i].next().then(v=>[v.value, i]);

				log.info(`${x.filename} changed`);
				mainChanged ||= x.filename==mainName;
				if (window.state.focused) {
					act();
				} else if (unseen==null) {
					unseen=window.onDidChangeWindowState((e)=>{
						if (e.focused) {
							unseen!.dispose();
							unseen=null;
							act();
						}
					});
				}
			}
		})().catch(e=>{
			if (e instanceof CancellationError) return;
			if (e instanceof Error) log.error(e);
			window.showErrorMessage(`Watcher failed with ${e}`);
		});
	}

	initApp(App);

	ctx.subscriptions.push(
		window.registerWebviewViewProvider("cpu.activitybar", activity,
			{webviewOptions: {retainContextWhenHidden: true}}),
		window.registerWebviewViewProvider("cpu.panel", panel,
			{webviewOptions: {retainContextWhenHidden: true}}),
		activity, panel,
		{ dispose() { old.forEach(x=>void x.dispose()); } }
	);
}