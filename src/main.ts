import { extname, resolve } from "path";
import { ExtensionContext, LogOutputChannel, Uri, WebviewPanel, window, workspace, EventEmitter, ViewColumn, commands, OpenDialogOptions } from "vscode";
import { InitState, MessageFromExt, MessageToExt } from "./shared";
import { TestCases } from "./testcases";
import { CPUWebviewProvider } from "./util";
import { TCP } from "./ipc";

const cppExts = ["cpp","cxx","cc","c++"];
const cppFileFilter: OpenDialogOptions["filters"] = { "C++ Source": cppExts };

type AllTestSets = {
	nextId: number,
	current: number,
	sets: Record<number,string>
};

export default class App {
	private toDispose: {dispose: ()=>void}[] = [];
	cases: TestCases;
	ts: AllTestSets;
	private openTestEditor?: WebviewPanel;

	private reducers: {[k in MessageToExt["type"]]: (msg: Extract<MessageToExt, {type: k}>)=>Promise<void>};
	private onMessageSource = new EventEmitter<MessageFromExt>();
	onMessage = this.onMessageSource.event;

	private ipc: TCP;

	//may not actually exist, used for initializing new testeditor to selected TC
	openTest?: number;
	openFile: {type:"last"|"file", path:string}|null=null;

	getInitState = (): InitState => ({
		cfg: this.cases.cfg,
		cases: Object.fromEntries(Object.entries(this.cases.cases).map(([k,v])=>[k,v.tc])),
		checker: this.cases.checker,
		checkers: Object.keys(this.cases.checkers),
		openTest: this.openTest, run: this.cases.run,
		openFile: this.openFile?.path ?? null,
		order: this.cases.order,
		testSets: this.ts.sets, currentTestSet: this.ts.current
	});

	async upTestSet(id?: number, ty?: "focus"|"delete") {
		if (id!=undefined) {
			if (ty=="delete") this.ipc.send({type: "deleteTestSet", id});
			else this.ipc.send({type: "testSetChange", id, name: this.ts.sets[id], focus: ty=="focus"});
		}

		this.send({type: "updateTestSets", current: this.ts.current, sets: this.ts.sets});
		await this.ctx.globalState.update("testsets", this.ts);
	}

	handleErr(e: any) {
		console.error(e);
		this.log.error(e);
		if (e instanceof Error) {
			window.showErrorMessage(`Error: ${e.message}`);
		}
	};

	handleMsg(msg: MessageToExt) {
		// console.log("received", msg);
		(this.reducers[msg.type] as (x: typeof msg) => Promise<void>)(msg).catch((e)=>this.handleErr(e));
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

	needsReload: boolean=false;

	async deleteTestSet(i: number, ipc: boolean) {
		delete this.ts.sets[i];
		if (this.ts.current==i) {
			const rest = Object.keys(this.ts.sets).map(Number);
			if (rest.length>0) this.ts.current=rest[0];
			else {
				this.ts.current=this.ts.nextId;
				this.ts.sets[this.ts.nextId]="Default";
				await this.upTestSet(this.ts.nextId++);
			}
			
			await this.cases.loadTestSet(this.ts.current, false);
		}

		if (ipc) await this.upTestSet(i, "delete");
	}

	constructor(public ctx: ExtensionContext, public log: LogOutputChannel) {
		log.info("Initializing...");
		this.testEditor.app = this;
		this.ts = ctx.globalState.get<AllTestSets>("testsets") ?? {
			nextId: 1, current: 0, sets: {[0]: "Default"}
		};

		this.toDispose.push(window.onDidChangeWindowState((e) => {
			if (e.active && this.needsReload) {
				this.cases.loadTestSet(this.cases.setId, false).catch(e=>this.handleErr(e));
				this.needsReload=false;
			}
		}));

		this.cases = new TestCases(ctx, log, (x)=>this.send(x), this.ts.current);

		this.ipc = new TCP(this.ctx, this.handleErr, log);
		this.ipc.start().catch((e)=>this.handleErr(e));

		this.toDispose.push(this.ipc.recv((msg) => (async ()=>{
			if (msg.type=="testSetChange") {
				this.ts.sets[msg.id] = msg.name;
				if (msg.id>=this.ts.nextId) this.ts.nextId=msg.id+1;

				//am i crazy?
				if (msg.id==this.cases.setId) {
					if (window.state.active)
						await this.cases.loadTestSet(this.cases.setId, false);
					else this.needsReload=true;
				} else if (msg.focus) {
					await this.cases.loadTestSet(msg.id, true);
				}

				await this.upTestSet();
			} else if (msg.type=="deleteTestSet") {
				await this.deleteTestSet(msg.id,false);
			}
		})().catch((e)=>this.handleErr(e))));
		
		this.toDispose.push(
			this.testEditor, this.cases,
			workspace.onDidSaveTextDocument((e) => {
				if (e.uri.scheme=="file") {
					const tc = this.cases.fileToCase.get(resolve(e.fileName));
					if (tc) this.cases.reloadTestSource(tc.case);
				}
			})
		);

		this.cases.init().catch((e)=>this.handleErr(e));

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
			async createTestSet() {
				const name = await window.showInputBox({
					title: "Create testset",
					prompt: "Choose a name",
					validateInput(v) {
						if (v.length==0) return "Empty name is not allowed";
						else if (v.length>25) return "That's too long!";
						return null;
					}
				});

				if (name==undefined) return;

				app.ts.sets[app.ts.nextId]=name;
				app.ts.current=app.ts.nextId;
				await app.cases.loadTestSet(app.ts.nextId, true);
				await app.upTestSet(app.ts.nextId++);
			},
			async renameTestSet({name}) {
				app.ts.sets[app.ts.current]=name;
				await app.upTestSet(app.ts.current);
			},
			async switchTestSet({i}) {
				app.ts.current=i;
				await app.cases.loadTestSet(i, true);
				await app.upTestSet();
			},
			async deleteTestSet({i}) {
				await app.deleteTestSet(i,true);
			},
			async runAll() {
				const is = Object.keys(app.cases.cases).map(Number);
				if (is.length==0) throw new Error("No test cases to run");
				if (app.openFile==null) await this.setProgram({type:"setProgram",clear:false});
				if (app.openFile==null) return;
				app.cases.runMany(is, app.openFile.path);
			},
			async moveTest({a,b}) { app.cases.moveTest(a,b); },
			async importTests() { app.cases.importCases(); },
			async createTestCase() { await app.cases.createTest(); },
			async removeTestCase({i}) { app.cases.removeTest(i); },
			async testCaseInput({inp}) {
				if (app.cases.run.runningTest==undefined || !(app.cases.run.runningTest in app.cases.inputs))
					throw new Error("Can't input; program is not running");
				app.cases.inputs[app.cases.run.runningTest].fire(inp);
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
				if (i!=undefined) app.cases.cases[i].cancel?.cancel();
				else app.cases.runAllCancel.cancel?.cancel();
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
			async openFile({path, inOS}) {
				await commands.executeCommand(inOS ? "revealFileInOS" : "vscode.open", Uri.file(path));
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