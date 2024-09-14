import { extname, join, resolve } from "path";
import { CancellationToken, Disposable, ExtensionContext, LogOutputChannel, OutputChannel, Uri, WebviewPanel, WebviewView, WebviewViewProvider, WebviewViewResolveContext, window, workspace, Event, EventEmitter, ViewColumn, commands, OpenDialogOptions, TextEditor } from "vscode";
import { InitState, MessageFromExt, MessageToExt } from "./shared";
import { TestCases } from "./testcases";
import { CPUWebviewProvider } from "./util";

const cppExts = ["cpp","cxx","cc","c++"];
const cppFileFilter: OpenDialogOptions["filters"] = { "C++ Source": cppExts };

export default class App {
	private toDispose: {dispose: ()=>void}[] = [];
	cases: TestCases;
	private openTestEditor?: WebviewPanel;

	private reducers: {[k in MessageToExt["type"]]: (msg: Extract<MessageToExt, {type: k}>)=>Promise<void>};
	private onMessageSource = new EventEmitter<MessageFromExt>();
	onMessage = this.onMessageSource.event;

	//may not actually exist, used for initializing new testeditor to selected TC
	openTest?: number;
	openFile: {type:"last"|"file", path:string}|null=null;

	getInitState = (): InitState => ({
		cfg: this.cases.cfg,
		cases: Object.fromEntries(Object.entries(this.cases.cases).map(([k,v])=>[k,v.tc])),
		checker: this.cases.checker,
		checkers: Object.keys(this.cases.checkers),
		openTest: this.openTest, runningTest: this.cases.runningTest,
		openFile: this.openFile?.path ?? null,
		order: this.cases.tcOrder
	});

	handleErr = (x: Promise<void>) => x.catch((e) => {
		console.error(e);
		this.log.error(e);
		if (e instanceof Error) {
			window.showErrorMessage(`Error: ${e.message}`);
		}
	});

	handleMsg(msg: MessageToExt) {
		// console.log("received", msg);
		this.handleErr((this.reducers[msg.type] as (x: typeof msg) => Promise<void>)(msg));
	}

	async chooseCppFile(name: string) {
		const u = await window.showOpenDialog({
			canSelectFiles: true,
			filters: cppFileFilter,
			title: `Choose ${name}`, openLabel: `Set ${name}`
		});

		if (u==undefined || u.length!=1) return null;
		if (u[0].scheme!="file") throw new Error("Selected C++ file is not on disk");
		return u[0].fsPath;
	}

	testEditor = new CPUWebviewProvider("testeditor", this.onMessage);

	send(x:MessageFromExt) {
		// console.log("sending", x);
		this.onMessageSource.fire(x);
	};

	checkActive() {
		const e = window.activeTextEditor;
		if (this.openFile?.type!="file" && e?.document.uri.scheme=="file") {
			const ext = extname(e.document.uri.fsPath);

			if (cppExts.some(x=>ext.endsWith(x))) {
				this.openFile={type:"last",path:resolve(e.document.fileName)};
				this.send({type:"updateProgram", path:this.openFile.path});
			}
		}
	}

	constructor(public ctx: ExtensionContext, public log: LogOutputChannel) {
		log.info("Initializing...");
		this.testEditor.app = this;

		this.cases = new TestCases(ctx, log, (x)=>this.send(x));
		
		this.toDispose.push(
			this.testEditor, this.cases,
			workspace.onDidSaveTextDocument((e) => {
				if (e.uri.scheme=="file") {
					const tc = this.cases.fileToCase.get(resolve(e.fileName));
					if (tc) this.cases.reloadTestSource(tc.case);
				}
			})
		);

		this.handleErr(this.cases.init());

		this.toDispose.push(window.onDidChangeActiveTextEditor(()=>this.checkActive()));
		this.checkActive();

		this.toDispose.push(workspace.onDidCloseTextDocument((e) => {
			if (this.openFile?.type=="last" && e.uri.scheme=="file"
				&& this.openFile.path==resolve(e.fileName)) {

				this.openFile=null;
				app.send({type:"updateProgram", path:null});
			}
		}))

		const app=this;
		this.reducers = {
			async moveTest({a,b}) { app.cases.moveTest(a,b); },
			async importTests() { app.cases.importCases(); },
			async createTestCase() { await app.cases.createTest(); },
			async removeTestCase({i}) {
				if (i) app.cases.removeTest(i);
				else Object.keys(app.cases.cases).forEach(i=>app.cases.removeTest(Number(i)));
			},
			async testCaseInput({inp}) {
				if (app.cases.runningTest==undefined || !(app.cases.runningTest in app.cases.inputs))
					throw new Error("Can't input; program is not running");
				app.cases.inputs[app.cases.runningTest].fire(inp);
			},
			async runTestCase({i, dbg}) {
				if (app.openFile==null) await this.setProgram({type:"setProgram",clear:false});
				if (app.openFile==null) return;

				app.cases.runTest(i, dbg, app.openFile.path);

			},
			async setProgram({clear}) {
				if (clear) {
					app.openFile=null;
				} else {
					const u = await app.chooseCppFile("program");
					if (u==null) return;

					app.openFile={type: "file", path: resolve(u)};
				}

				app.send({type:"updateProgram", path: app.openFile?.path ?? null});
			},
			async setTestName({i,name}) {
				app.cases.cases[i].tc.name=name;
				app.cases.upTestCase(i);
			},
			async cancelRun({i}) {
				app.cases.cases[i].cancel?.cancel();
			},
			async setChecker({checker}) {
				if (checker!=null) {
					if (!(checker in app.cases.checkers)) throw new Error("Checker not found");
					app.cases.checker={type: "default", name: checker};
				} else {
					const u = await app.chooseCppFile("checker");
					if (u!=null) app.cases.checker = {type: "file", path: resolve(u)};
				}

				app.cases.upChecker();
			},
			async setCfg({cfg}) {
				app.cases.cfg=cfg;
				app.cases.upCfg();
			},
			async openFile({path}) {
				await commands.executeCommand("vscode.open", Uri.file(path));
			},
			async readSource({i}) {
				app.cases.reloadTestSource(i);
			},
			async readOutput({i}) {
				if (app.cases.outputs[i])
					app.send({type: "testCaseOutput", i, out: app.cases.outputs[i]});
			},
			async setSource({i, which, source}) {
				app.cases.setSource(i,source,which);
			},
			async openTest({i}) {
				app.openTest=i;

				if (app.openTestEditor) {
					app.send({type: "openTest", i});
					app.openTestEditor.reveal(ViewColumn.Active);
				} else {
					app.openTestEditor=window.createWebviewPanel("cpu.testeditor", "Test Editor",
						ViewColumn.Active, {retainContextWhenHidden: true});
					app.testEditor.resolveWebviewView(app.openTestEditor);
					app.toDispose.push(app.openTestEditor);

					app.openTestEditor.onDidDispose(()=>{
						app.openTestEditor=undefined;
					});
				}
			},
			async setTestFile({i,which,ty}) {
				if (ty=="import") {
					const x = await window.showOpenDialog({
						canSelectFiles: true,
						title: `Choose test ${which=="inFile" ? "input" : "answer"} file`,
						openLabel: `Set ${which=="inFile" ? "input" : "answer"}`
					});

					if (x?.length==1) {
						if (x[0].scheme!="file") throw new Error("Selected input/answer is not on disk");
						app.cases.setFile(i, which, x[0].fsPath);
					}
				} else {
					app.cases.setFile(i,which,undefined,ty=="create");
				}
			}
		};
	}

	dispose() {
		this.log.info("Shutting down for the day...");
		for (const x of this.toDispose) x.dispose();
	}
}