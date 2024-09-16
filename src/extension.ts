import { commands, ExtensionContext, window, Disposable, EventEmitter } from "vscode";
import { enableHotReload, hotRequire } from "@hediet/node-reload";
import App from "./main";
import { join } from "path";
import { FileChangeInfo, watch } from "fs/promises";
import { MessageFromExt } from "./shared";
import { CPUWebviewProvider, exists } from "./util";

declare const WATCH: boolean;

export function activate(ctx: ExtensionContext) {
	const log = window.createOutputChannel("Competitive Programmers Union", {log: true});
	ctx.subscriptions.push(log);

	const onMessage = new EventEmitter<MessageFromExt>();
	ctx.subscriptions.push(onMessage);

	const activity = new CPUWebviewProvider("activitybar", onMessage.event, ["testCaseStream"]);
	const panel = new CPUWebviewProvider("panel", onMessage.event);

	ctx.subscriptions.push(
		window.registerWebviewViewProvider("cpu.activitybar", activity,
			{webviewOptions: {retainContextWhenHidden: true}}),
		window.registerWebviewViewProvider("cpu.panel", panel,
			{webviewOptions: {retainContextWhenHidden: true}}),
		activity, panel
	);

	const initApp = (x: typeof App) => {
		const app = new x(ctx, log);
		activity.app=app; panel.app=app;
		return [app.onMessage((x)=>onMessage.fire(x)), app];
	};

	if (WATCH) {
		enableHotReload({entryModule: module});
		log.info("hot reloading enabled");
		
		(async () => {
			const watchers = (await Promise.all(["activitybar","panel","testeditor"]
				.flatMap(x=>[`out/${x}.js`, `out/${x}.css`]).map(x=>join(ctx.extensionPath, x))
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

			const act = () => {
				log.info("reloading webviews");
				if (tm) clearTimeout(tm);
				tm=setTimeout(()=>{
					commands.executeCommand("workbench.action.webview.reloadWebviewAction");
				}, 500);
			};

			while (true) {
				const [x,i] = await Promise.race(unresolved);
				unresolved[i] = watchers[i].next().then(v=>[v.value, i]);

				log.info(`${x.filename} changed`);
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
			window.showErrorMessage(`Watcher failed with ${e}`);
		});

		ctx.subscriptions.push(hotRequire<typeof import("./main")>(
			module,
			join(ctx.extensionPath, "out/main.js"),
			(x)=>initApp(x.default)
		));
	} else {
		ctx.subscriptions.push(...initApp(App));
	}
}