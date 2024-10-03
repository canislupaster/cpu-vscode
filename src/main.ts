import { extname, resolve } from "path";
import { ExtensionContext, LogOutputChannel, Uri, WebviewPanel, window, workspace, EventEmitter, ViewColumn, commands, OpenDialogOptions, env } from "vscode";
import { InitState, MessageFromExt, MessageToExt, OpenFile, TestSetMeta, TestSets } from "./shared";
import { CBError, TestCases } from "./testcases";
import { CPUWebviewProvider } from "./util";
import { Companion } from "./companion";

type AllTestSets = {
	nextId: number,
	current: number,
	sets: TestSets
};

type Command = "cpu.debug"|"cpu.run"|"cpu.runAll";

export default class App {
	cases: TestCases;
	ts: AllTestSets;
	deleted: Record<number,boolean> = {};
	private openTestEditor?: WebviewPanel;
	private commandHandler: {[k in Command]: ()=>Promise<void>};
	private reducers: {[k in MessageToExt["type"]]: (msg: Omit<Extract<MessageToExt, {type: k}>,"type">)=>Promise<void>};
	private onMessageSource = new EventEmitter<MessageFromExt>();
	onMessage = this.onMessageSource.event;

	//may not actually exist, used for initializing new testeditor to selected TC
	openTest?: number;
	openFile: OpenFile=null;
	companion: Companion;

	private panelReady=new EventEmitter<void>();

	testEditor = new CPUWebviewProvider("testeditor", this.onMessage, ["testCaseStream"]);

	private toDispose: {dispose: ()=>void}[] = [this.panelReady, this.onMessageSource, this.testEditor];

	codeFileFilter(): OpenDialogOptions["filters"] {
		return {"Source file": this.cases.runner.languages.allExts} // 💀
	};

	getInitState = (): InitState => ({
		cfg: this.cases.cfg,
		cases: Object.fromEntries(Object.entries(this.cases.cases).map(([k,v])=>[k,v.tc])),
		checkers: Object.keys(this.cases.checkers),
		openTest: this.openTest, run: this.cases.run,
		openFile: this.openFile, order: this.cases.order,
		testSets: this.ts.sets, currentTestSet: this.ts.current,
		languagesCfg: this.cases.runner.languages.getLangsCfg(),
		buildDir: this.cases.runner.getBuildDir(), testSetDir: this.cases.getTestsetDir()
	});

	async upTestSet(mod: boolean=true) {
		if (mod) this.ts.sets[this.ts.current].mod=Date.now();
		this.send({type: "updateTestSets", current: this.ts.current, sets: this.ts.sets});
		await this.ctx.globalState.update("testsets", this.ts);
	}

	handleErr(e: unknown) {
		if (e instanceof AggregateError) {
			for (const a of e.errors.slice(0,10)) this.handleErr(a);
			return;
		}
		
		console.error(e);
		if (e instanceof Error) {
			this.log.error(e);
			if (e instanceof CBError && e.err)
				this.log.error(e.err);
		}

		if (e instanceof CBError) {
			window.showErrorMessage(e.message);
		} else if (e instanceof Error) {
			window.showErrorMessage(`Error: ${e.message}`);
		}
	};

	handleMsg(msg: MessageToExt) {
		(this.reducers[msg.type] as (x: typeof msg) => Promise<void>)(msg).catch((e)=>this.handleErr(e));
	}

	async chooseSourceFile(name: string) {
		const u = await window.showOpenDialog({
			canSelectFiles: true,
			filters: this.codeFileFilter(),
			title: `Choose ${name}`, openLabel: `Set ${name}`
		});

		if (u==undefined || u.length!=1) return null;
		if (u[0].scheme!="file") throw new Error("Selected C++ file is not on disk");
		return resolve(u[0].fsPath);
	}

	send(x:MessageFromExt) { this.onMessageSource.fire(x); };

	updateProgram() {
		if (this.openFile!=null)
			this.cases.runner.loadFile(this.openFile.path).catch(e=>this.handleErr(e));
		this.send({type:"updateProgram", openFile: this.openFile});
	}

	checkActive() {
		const e = window.activeTextEditor;
		if (this.openFile?.type!="file" && e?.document.uri.scheme=="file") {
			const ext = extname(e.document.uri.fsPath);

			if (this.cases.runner.languages.allExts.some(x=>ext.endsWith(x))) {
				this.openFile={type:"last",path:resolve(e.document.fileName)};
				this.updateProgram();
			}
		}
	}

	needsReload: boolean=false;

	async deleteTestSet(i: number) {
		await this.cases.deleteTestSet(i);
		delete this.ts.sets[i];
		this.deleted[i]=true;

		if (this.ts.current==i) {
			const rest = Object.keys(this.ts.sets).map(Number);
			if (rest.length>0) this.ts.current=rest[0];
			else {
				this.ts.current=this.ts.nextId;
				this.ts.sets[this.ts.nextId++]={name: "Default"};
			}
			
			await this.upTestSet();
			await this.cases.loadTestSet(this.ts.current, false);
		}
	}

	async setProgram(cmd: Extract<MessageToExt,{type:"setProgram"}>["cmd"]) {
		if (cmd=="clear") {
			this.openFile=null;
		} else if (cmd=="open") {
			const u = await this.chooseSourceFile("program");
			if (u==null) return;

			this.openFile={type: "file", path: u};
		} else if (cmd=="setLast" && this.openFile!=null) {
			this.openFile.type="file";
		}

		this.updateProgram();
	}

	async pickTest() {
		const map = new Map<string,number>();
		for (const k in this.cases.cases) {
			const t = this.cases.cases[k];
			let v = t.tc.name; let i=1;
			while (map.has(v)) v=`${t.tc.name} (${i++})`;
			map.set(v, Number(k));
		}

		const res = await window.showQuickPick([...map.keys()], {canPickMany: false});
		if (res==undefined) return;
		return map.get(res)!;
	}

	async handleRunDbgCmd(dbg: boolean) {
		if (this.openTest==undefined) this.openTest=await this.pickTest();
		if (this.openTest==undefined) return;
		await this.reducers.runTestCase({i: this.openTest, dbg, runType: "normal"});
	};

	lastFocus=Date.now();
	constructor(public ctx: ExtensionContext, public log: LogOutputChannel) {
		log.info(`Initializing... extension uri: ${ctx.extensionUri.toString()}`);

		this.testEditor.app = this;
		this.ts = ctx.globalState.get<AllTestSets>("testsets") ?? {
			nextId: 1, current: 0, sets: {[0]: {name: "Default"}}
		};

		this.toDispose.push(window.onDidChangeWindowState((state) => {
			if (!state.focused) return;
			const sets = ctx.globalState.get<AllTestSets>("testsets");
			if (!sets) return;
			for (const x in this.deleted)
				delete sets.sets[x];

			(async ()=>{
				const newCurrent: TestSetMeta|undefined = sets.sets[this.ts.current];

				//merge
				this.ts={
					...this.ts,
					nextId: Math.max(sets.nextId, this.ts.nextId),
					sets: {...this.ts.sets, ...sets.sets, [this.ts.current]: this.ts.sets[this.ts.current] }
				};

				if (newCurrent && (newCurrent.mod??0)>Math.max(this.lastFocus, this.ts.sets[this.ts.current].mod??0)) {
					if (await window.showInformationMessage("Your current testset has changed in another window. Load changes?", "Reload testset") == "Reload testset") {
						this.ts.sets[this.ts.current] = newCurrent;
						await this.cases.loadTestSet(this.ts.current, false);
					}
				}

				this.lastFocus=Date.now();
				await this.upTestSet(false);
			})().catch(e=>this.handleErr(e));
		}));

		this.cases = new TestCases(ctx, log, (x)=>this.send(x), this.ts.current,
			()=>this.upTestSet(), this.panelReady.event);
		this.cases.runner.languages.onCfgChange(() => {
			this.send({type: "updateLanguagesCfg", cfg: this.cases.runner.languages.getLangsCfg()});
		});

		this.toDispose.push(
			this.cases, workspace.onDidSaveTextDocument((e) => {
				if (e.uri.scheme=="file") {
					const tc = this.cases.fileToCase.get(resolve(e.fileName));
					if (tc) this.cases.reloadTestSource(tc.case).catch((e)=>this.handleErr(e));
				}
			})
		);

		this.cases.init().catch((e)=>this.handleErr(e));

		this.companion = new Companion(log);
		this.companion.start().catch((e)=>this.handleErr(e));
		this.toDispose.push(this.companion, this.companion.event((tasks) => (async()=>{
			this.log.info("Received tasks from companion", tasks);

			let id = this.ts.nextId;
			this.ts.nextId+=tasks.length;

			for (const task of tasks) {
				this.ts.sets[id] = {
					name: task.name, group: task.group,
					mod: Date.now(), problemLink: task.url,
					next: task==tasks[tasks.length-1] ? undefined : id+1
				};

				await this.cases.makeTestSetData(id, task.tests);

				if (tasks.length==1) this.ts.current=id;
				id++;
			}

			await this.upTestSet();
			if (tasks.length==1) await this.cases.loadTestSet(id-1, true);
		})().catch((e)=>this.handleErr(e))));

		this.toDispose.push(window.onDidChangeActiveTextEditor(()=>this.checkActive()));
		this.checkActive();

		this.toDispose.push(workspace.onDidCloseTextDocument((e) => {
			if (this.openFile?.type=="last" && e.uri.scheme=="file"
				&& this.openFile.path==resolve(e.fileName)) {

				this.updateProgram();
			}
		}));

		this.commandHandler = {
			"cpu.debug": async () => await this.handleRunDbgCmd(true),
			"cpu.run": async () => await this.handleRunDbgCmd(false),
			"cpu.runAll": async () => await this.reducers.runAll({})
		};

		for (const cmd in this.commandHandler) {
			this.toDispose.push(commands.registerCommand(cmd, ()=>{
				this.commandHandler[cmd as keyof typeof this.commandHandler]().catch((e)=>this.handleErr(e));
			}));
		}

		this.reducers = {
			clearRunAll: async () => { await this.cases.clearRunAll(); },
			openSettings: async () => {
				commands.executeCommand("workbench.action.openSettings", "@ext:thomasqm.cpu");
			},
			createTestSet: async ()=>{
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

				this.ts.sets[this.ts.nextId]={name};
				this.ts.current=this.ts.nextId;
				await this.cases.loadTestSet(this.ts.nextId++, true);
				await this.upTestSet();
			},
			renameTestSet: async ({name})=>{ this.ts.sets[this.ts.current].name=name; },
			switchTestSet: async ({i})=>{
				this.ts.current=i;
				await this.cases.loadTestSet(i, true);
			},
			deleteTestSet: async ({i})=>{
				await this.deleteTestSet(i);
			},
			runAll: async ()=>{
				const is = Object.keys(this.cases.cases).map(Number);
				if (is.length==0) throw new Error("No test cases to run");
				if (this.openFile==null) await this.setProgram("open");
				if (this.openFile==null) return;

				await this.cases.runMany(is, this.openFile.path);
			},
			moveTest: async ({a,b})=>{ this.cases.moveTest(a,b); },
			importTests: async ()=>{ await this.cases.importCases(); },
			createTestCase: async ()=>{ await this.cases.createTest(); },
			removeTestCase: async ({i})=>{ await this.cases.removeTest(i); },
			testCaseInput: async ({inp})=>{
				if (this.cases.run.runningTest==undefined || !(this.cases.run.runningTest in this.cases.inputs))
					throw new Error("Can't input; program is not running");
				this.cases.inputs[this.cases.run.runningTest].fire(inp);
			},
			runTestCase: async ({i, dbg, runType})=>{
				if (this.openFile==null) await this.setProgram("open");
				if (this.openFile==null) return;

				await workspace.save(Uri.file(this.openFile.path));

				this.openTest=i;
				this.send({type: "openTest", i, focus: false});
				await this.cases.runTest(i, dbg, this.openFile.path, runType);
			},
			setProgram: async ({cmd})=>{ await this.setProgram(cmd); },
			setTestName: async ({i,name})=>{
				this.cases.cases[i].tc.name=name;
				this.cases.upTestCase(i);
			},
			cancelRun: async ({i})=>{
				if (i!=undefined) this.cases.cases[i].cancel?.cancel();
				else this.cases.runAllCancel.cancel?.cancel();
			},
			setInteractor: async ({clear}) => {
				if (clear) {
					this.cases.cfg.interactor=null;
				} else {
					const u = await this.chooseSourceFile("interactor");
					if (u!=null) this.cases.cfg.interactor=u;
				}

				this.cases.upCfg();
			},
			setChecker: async ({checker})=>{
				if (checker!=null) {
					if (!(checker in this.cases.checkers)) throw new Error("Checker not found");
					this.cases.cfg.checker={type: "default", name: checker};
				} else {
					const u = await this.chooseSourceFile("checker");
					if (u!=null) this.cases.cfg.checker = {type: "file", path: u};
				}

				this.cases.upCfg();
			},
			setCfg: async ({cfg})=>{
				this.cases.cfg=cfg;
				this.cases.upCfg();
			},
			openFile: async ({path, inOS})=>{
				await commands.executeCommand(inOS ? "revealFileInOS" : "vscode.open", Uri.file(path));
			},
			readSource: async ({i})=>{
				await this.cases.reloadTestSource(i);
			},
			readOutput: async ({i})=>{
				if (this.cases.outputs[i])
					this.send({type: "testCaseOutput", i, out: this.cases.outputs[i]});
			},
			setSource: async ({i, which, source})=>{
				await this.cases.setSource(i,source,which);
			},
			openTest: async ({i})=>{
				this.openTest=i;

				if (this.openTestEditor) {
					this.send({type: "openTest", i, focus: true});
					this.openTestEditor.reveal(ViewColumn.Active);
				} else {
					this.openTestEditor=window.createWebviewPanel("cpu.testeditor", "Test Editor",
						ViewColumn.Active, {retainContextWhenHidden: true});
					this.openTestEditor.iconPath = Uri.joinPath(this.ctx.extensionUri, "resources/small-icon.png");
					this.testEditor.resolveWebviewView(this.openTestEditor);
					this.toDispose.push(this.openTestEditor);

					this.openTestEditor.onDidDispose(()=>{
						this.openTestEditor=undefined;
					});
				}
			},
			setTestFile: async ({i,which,ty})=>{
				if (ty=="import") {
					const x = await window.showOpenDialog({
						canSelectFiles: true,
						title: `Choose test ${which=="inFile" ? "input" : "answer"} file`,
						openLabel: `Set ${which=="inFile" ? "input" : "answer"}`
					});

					if (x?.length==1) {
						if (x[0].scheme!="file") throw new Error("Selected input/answer is not on disk");
						await this.cases.setFile(i, which, x[0].fsPath);
					}
				} else {
					await this.cases.setFile(i,which,undefined,ty=="create");
				}
			},
			chooseSourceFile: async ({key,name})=>{
				const path = await this.chooseSourceFile(name);
				if (path) this.send({type: "sourceFileChosen", key, path});
			},
			createStress: async ({name, stress}) => {
				await this.cases.createTest(name, {...stress, status: null});
			},
			updateStress: async ({i,stress}) => {
				const tc = this.cases.cases[i].tc;
				if (tc.stress==undefined) throw new Error("No stress found for test");
				tc.stress = {...tc.stress, ...stress};
				this.cases.upTestCase(i);
			},
			clearCompileCache: async () => {
				await this.cases.runner.clearCompileCache();
			},
			setLanguageCfg: async ({language, cfg}) => {
				await this.cases.runner.languages.updateLangCfg(language, cfg);
			},
			openTestSetUrl: async ({i}) => {
				env.openExternal(Uri.parse(this.ts.sets[i].problemLink!));
			},
			panelReady: async () => { this.panelReady.fire(); }
		};
	}

	dispose() {
		this.log.info("Shutting down for the day...");
		for (const x of this.toDispose) x.dispose();
	}
}