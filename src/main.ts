import { extname, isAbsolute, join, resolve } from "path";
import { ExtensionContext, LogOutputChannel, Uri, WebviewPanel, window, workspace, EventEmitter, ViewColumn, commands, OpenDialogOptions, env, ColorThemeKind, WorkspaceConfiguration } from "vscode";
import { Cfg, cfgKeys, InitState, MessageFromExt, MessageToExt, OpenFile, TestSetMeta, TestSets, Theme } from "./shared";
import { CBError, TestCases } from "./testcases";
import { CPUWebviewProvider, exists } from "./util";
import { Companion } from "./companion";
import { LanguageProvider } from "./languages";
import { copyFile, mkdir, writeFile } from "fs/promises";
import Mustache from "mustache";
import { AutoSubmit } from "./autosubmit";

type AllTestSets = {
	nextId: number,
	current: number,
	sets: TestSets
};

type Command = "cpu.debug"|"cpu.run"|"cpu.runAll"|"cpu.lastRun";

function loadCfg(config: WorkspaceConfiguration): Cfg {
	const obj = Object.fromEntries(cfgKeys.map(k=>{
		const v = config.get<Cfg[typeof k]>(k);
		if (v==undefined) throw new Error(`Couldn't find configuration value for ${k}`);
		return [k, v];
	}));

	for (const x of ["buildDir", "testDir", "createFileTemplate"]) {
		if (obj[x]=="") delete obj[x];
	}

	return obj as Cfg;
};

export default class App {
	languages: LanguageProvider;
	cases: TestCases;
	ts: AllTestSets;
	autosubmit: AutoSubmit;
	deleted: Record<number,boolean> = {};
	private openTestEditor?: WebviewPanel;

	lastRunCmd: Extract<MessageToExt, {type: "runAll"|"runTestCase"}>|null = null;
	private commandHandler: {[k in Command]: ()=>Promise<void>};

	private reducers: {[k in MessageToExt["type"]]: (msg: Omit<Extract<MessageToExt, {type: k}>,"type">)=>Promise<void>};
	private onMessageSource = new EventEmitter<MessageFromExt>();
	onMessage = this.onMessageSource.event;

	//may not actually exist, used for initializing new testeditor to selected TC
	openTest?: number;
	currentFile: string|null=null;
	companion: Companion;

	private cfgReloadTimeout: null|NodeJS.Timeout = null;
	private onCfgChangeSource = new EventEmitter<WorkspaceConfiguration>();
	onCfgChange = this.onCfgChangeSource.event;
	config=workspace.getConfiguration("cpu");

	cfg: Cfg = loadCfg(this.config);

	private panelReady=new EventEmitter<void>();

	testEditor = new CPUWebviewProvider("testeditor", this.onMessage, ["testCaseStream"]);

	private toDispose: {dispose: ()=>void}[] = [this.panelReady, this.onMessageSource, this.testEditor];

	codeFileFilter(): OpenDialogOptions["filters"] {
		return {"Source file": this.languages.allExts} // 💀
	};

	themeKindMap = new Map<ColorThemeKind, Theme>([
		[ColorThemeKind.Light, "light"],
		[ColorThemeKind.HighContrastLight, "light"],
		[ColorThemeKind.Dark, "dark"],
		[ColorThemeKind.HighContrast, "dark"]
	]);

	openFile(): OpenFile|null {
		return this.cases.file!=null ? {type: "file", path: this.cases.file}
			: this.currentFile!=null ? {type: "last", path: this.currentFile} : null;
	}
	
	autoSubmitSupported() {
		return false;
		// enable when supported...
		// const link = this.ts.sets[this.ts.current].problemLink;
		// return link!=undefined && this.autosubmit.isSupported(link);
	}

	getInitState = (): InitState => ({
		runCfg: this.cases.cfg, cfg: this.cfg,
		cases: Object.fromEntries(Object.entries(this.cases.cases).map(([k,v])=>[k,v.tc])),
		checkers: Object.keys(this.cases.checkers),
		openTest: this.openTest, run: this.cases.run,
		openFile: this.openFile(), order: this.cases.order,
		testSets: this.ts.sets, currentTestSet: this.ts.current,
		languagesCfg: this.languages.getLangsCfg(),
		buildDir: this.cases.runner.getBuildDir(), testSetDir: this.cases.getTestsetDir(),
		theme: this.themeKindMap.get(window.activeColorTheme.kind)!,
		autoSubmitSupported: this.autoSubmitSupported(),
		autoSubmitterStatus: this.autosubmit.status()
	});

	async upTestSet(mod: boolean=true) {
		if (mod) this.ts.sets[this.ts.current].mod=Date.now();

		this.send({
			type: "updateTestSets",
			current: this.ts.current, sets: this.ts.sets,
			autoSubmitSupported: this.autoSubmitSupported()
		});
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

	updateProgram() { this.send({type: "updateProgram", openFile: this.openFile()}); }

	checkActive() {
		const e = window.activeTextEditor;

		if (e?.document.uri.scheme!="file") return;

		const ext = extname(e.document.uri.fsPath);
		if (!this.languages.allExts.some(x=>ext.endsWith(x))) return;

		this.currentFile=resolve(e.document.fileName);
		if (this.cases.file==null) this.updateProgram();
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
			await this.loadTestSet(this.ts.current, false);
		}
	}

	async setProgram(cmd: Extract<MessageToExt,{type:"setProgram"}>["cmd"]) {
		if (cmd=="clear") {
			await this.cases.setCurrentFile(null);
		} else if (cmd=="open") {
			const u = await this.chooseSourceFile("program");
			if (u==null) return;

			await this.cases.setCurrentFile(u);
		} else if (cmd=="setLast" && this.currentFile!=null) {
			await this.cases.setCurrentFile(this.currentFile);
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

	async runPath() {
		if (this.currentFile==null && this.cases.file==null) {
			await this.setProgram("open");
		}

		const path = this.cases.file ?? this.currentFile;
		if (path==null) return null;

		await workspace.save(Uri.file(path));
		return path;
	}

	async loadTestSet(set: number, save: boolean, open=false) {
		await this.cases.loadTestSet(set, save);
		this.updateProgram();

		if (this.cfg.createFiles && this.cases.file!=null && open) {
			await commands.executeCommand("vscode.open", Uri.file(this.cases.file));
		}
	}

	lastFocus=Date.now();
	constructor(public ctx: ExtensionContext, public chunks: string[], public log: LogOutputChannel) {
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

				const oldFocus = this.lastFocus;
				this.lastFocus=Date.now();

				if (newCurrent && (newCurrent.mod??0)>Math.max(oldFocus, this.ts.sets[this.ts.current].mod??0)) {
					if (await window.showInformationMessage("Your current testset has changed in another window. Load changes?", "Reload testset") == "Reload testset") {
						this.ts.sets[this.ts.current] = newCurrent;
						await this.loadTestSet(this.ts.current, false);
					}
				}

				await this.upTestSet(false);
			})().catch(e=>this.handleErr(e));
		}));

		this.toDispose.push(workspace.onDidChangeConfiguration(() => {
			if (this.cfgReloadTimeout!=null) clearTimeout(this.cfgReloadTimeout);

			this.cfgReloadTimeout = setTimeout(()=>{
				this.config = workspace.getConfiguration("cpu");
				// maintain references
				const ncfg=loadCfg(this.config);
				for (const k of cfgKeys) {
					(this.cfg as Record<string,unknown>)[k] = ncfg[k];
				}

				this.onCfgChangeSource.fire(this.config);

				this.send({type: "updateLanguagesCfg", cfg: this.languages.getLangsCfg()});
				this.send({type: "updateCfg", cfg: this.cfg});
			}, 500);
		}));

		this.toDispose.push({dispose: ()=>{
			if (this.cfgReloadTimeout!=null) clearTimeout(this.cfgReloadTimeout);
		}});

		this.languages = new LanguageProvider(this.config, this.onCfgChange);
		this.cases = new TestCases(ctx, log, (x)=>this.send(x), this.ts.current,
			()=>this.upTestSet(), this.panelReady.event, this.languages, this.cfg);
		this.autosubmit = new AutoSubmit(this, this.languages);

		this.toDispose.push(
			this.languages, this.cases, this.autosubmit,
			this.autosubmit.autoSubmitterUpdates.event(()=>{
				this.send({ type: "updateAutoSubmitStatus", status: this.autosubmit.status() });
			}),
			workspace.onDidSaveTextDocument((e) => {
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
			const cur = id;
			this.ts.nextId+=tasks.length;

			for (const task of await Promise.all(tasks.map(async (task,i) => {
				if (this.cfg.createFiles) {
					const cwd = (this.currentFile ? workspace.getWorkspaceFolder(Uri.file(this.currentFile)) : undefined) ?? workspace.workspaceFolders?.[0];
					//really bad regex to find path segments at/after the one containing a number. works sometimes...
					const id = task.url.match(/\/[^/]*\d(?:\d|[^/])+(?:\/.+)*$/)?.[0]?.replaceAll(/\/|\s/g,"");

					const substituted = Mustache.render(this.cfg.createFileName, {
						contest: task.group,
						problem: task.name,
						id
					}).replaceAll(/[?%*:|"<>]/g, "");

					if (cwd==undefined && !isAbsolute(substituted))
						throw new Error(`No working directory for imported problem ${substituted}`);

					const path = cwd?.uri.fsPath ? join(cwd.uri.fsPath, substituted) : substituted;
					await mkdir(join(path, ".."), {recursive: true});
					if (!await exists(path)) {
						if (this.cfg.createFileTemplate) await copyFile(this.cfg.createFileTemplate, path);
						else await writeFile(path, "");
					}
				
					return {...task, path, i};
				} else {
					return {...task, path: undefined, i};
				}
			}))) {
				this.ts.sets[id] = {
					name: task.name, group: task.group,
					mod: Date.now(), problemLink: task.url,
					prev: task.i==0 ? undefined : id-1,
					next: task.i==tasks.length-1 ? undefined : id+1
				};

				await this.cases.makeTestSetData(id, task.tests, task.path);
				id++;
			}

			this.ts.current=cur;
			await this.upTestSet();
			await this.loadTestSet(cur, true, true);
		})().catch((e)=>this.handleErr(e))));

		this.toDispose.push(window.onDidChangeActiveTextEditor(()=>this.checkActive()));
		this.checkActive();

		this.toDispose.push(workspace.onDidCloseTextDocument((e) => {
			if (this.currentFile==resolve(e.fileName)) {
				this.currentFile=null;
				this.updateProgram();
			}
		}));

		this.toDispose.push(window.onDidChangeActiveColorTheme((e)=>{
			this.send({type: "themeChange", newTheme: this.themeKindMap.get(e.kind)!});
		}));

		this.commandHandler = {
			"cpu.debug": async () => await this.handleRunDbgCmd(true),
			"cpu.run": async () => await this.handleRunDbgCmd(false),
			"cpu.runAll": async () => await this.reducers.runAll({}),
			"cpu.lastRun": async () => {
				if (this.lastRunCmd==null) window.showErrorMessage("You haven't run anything yet.")
				else this.handleMsg(this.lastRunCmd);
			}
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
				await this.loadTestSet(this.ts.nextId++, true);
				await this.upTestSet();
			},
			renameTestSet: async ({name})=>{
				this.ts.sets[this.ts.current].name=name;
				await this.upTestSet();
			},
			switchTestSet: async ({i})=>{
				this.ts.current=i;
				await this.loadTestSet(i, true, true);
			},
			deleteTestSet: async ({i})=>{
				await this.deleteTestSet(i);
			},
			runAll: async ()=>{
				this.lastRunCmd = {type:"runAll"};

				const is = Object.keys(this.cases.cases).map(Number);
				if (is.length==0) throw new Error("No test cases to run");

				const file = await this.runPath();
				if (file==null) return;

				await this.cases.runMany(is, file);
			},
			moveTest: async ({a,b})=>{ this.cases.moveTest(a,b); },
			importTests: async ()=>{ await this.cases.importCases(); },
			createTestCase: async ()=>{ await this.cases.createTest(); },
			removeTestCase: async ({i})=>{ await this.cases.removeTest(i); },
			autosubmit: async ()=>{
				const link = this.ts.sets[this.ts.current].problemLink;
				if (link==undefined) throw new Error("No problem link!");
				const path = await this.runPath();
				if (path==null) throw new Error("No file provided");
				await this.autosubmit.submit(link, path, this.ts.sets[this.ts.current].name);
			},
			closeAutoSubmit: async ({submitter}) => {
				this.autosubmit.close(submitter);
			},
			testCaseInput: async ({inp})=>{
				if (this.cases.run.runningTest==undefined || !(this.cases.run.runningTest in this.cases.inputs))
					throw new Error("Can't input; program is not running");
				this.cases.inputs[this.cases.run.runningTest].fire(inp);
			},
			runTestCase: async ({i, dbg, runType})=>{
				this.lastRunCmd = {type:"runTestCase",i,dbg,runType};

				const file = await this.runPath();
				if (file==null) return;

				this.openTest=i;
				this.send({type: "openTest", i, focus: false});
				await this.cases.runTest(i, dbg, file, runType);
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
			setInteractor: async ({path}) => {
				this.cases.cfg.interactor=path;
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
			setCfg: async ({cfg, global})=>{
				for (const k of cfgKeys) {
					(this.cfg as Record<string,unknown>)[k]=cfg[k];
					this.config.update(k, cfg[k] ?? "", global || (workspace.workspaceFolders?.length ?? 0)==0);
				}

				this.send({type: "updateCfg", cfg: this.cfg});
			},
			setRunCfg: async ({cfg})=>{
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
			chooseFile: async ({key,name,kind})=>{
				if (kind=="source") {
					const path = await this.chooseSourceFile(name);
					if (path) this.send({type: "fileChosen", key, path});
				} else if (kind=="directory") {
					const u = await window.showOpenDialog({
						canSelectFiles: false,
						canSelectFolders: true,
						canSelectMany: false,
						filters: {[name]: ["*"]},
						title: `Choose ${name}`,
						openLabel: `Set ${name}`,
					});

					if (u==undefined || u.length!=1) return;
					this.send({type: "fileChosen", key, path: u[0].fsPath});
				}
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
				await this.languages.updateLangCfg(language, cfg);
			},
			setLanguageCfgGlobally: async ({language}) => {
				await this.languages.overwriteGlobalSettings(language);
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