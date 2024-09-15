import { CancellationTokenSource } from "vscode-languageclient";
import { badVerdicts, Checker, CompileError, defaultRunCfg, MessageFromExt, RunCfg, RunError, RunState, TestCase, TestOut } from "./shared";
import { ExtensionContext, window, LogOutputChannel, EventEmitter, OpenDialogOptions, Disposable, CancellationToken, CancellationError, ProgressLocation } from "vscode";
import { Runner, Test } from "./runner";
import { cancelPromise, cfg, exists } from "./util";
import { basename, extname, join, resolve } from "node:path";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

const inNames = new Set([".in"]), ansNames = new Set([".out", ".ans"]);
const testCaseFilter: OpenDialogOptions["filters"] = {
	"Answer/input file": [...ansNames.values(), ...inNames.values()]
};

type CancelBusy = {
	//cancel and busy represent disjoint tasks (long-running vs short updates)
	//e.g. user should be able to change input/outputs while program is compiling
	//kinda messy, but non-cancellable updates should be very fast and unlock quickly
	cancel: CancellationTokenSource|null,
	busy: boolean,
	up: ()=>void,
	done: EventEmitter<void>
};

type CancelUpdate = { cancel?: CancellationTokenSource, update?: boolean };

type TestSetData = {
	cases: Record<number, Omit<TestCase,"cancellable">>,
	runAll: Omit<RunState["runAll"],"cancellable">,
	order: number[],
	nextId: number
};

export class TestCases {
	cases: Record<number,{ tc: TestCase }&CancelBusy> = {};
	order: number[]=[];
	inputs: Record<number, EventEmitter<string>> = {};
	outputs: Record<number, TestOut> = {};
	id: number=0;

	runner: Runner;

	run: RunState = {runAll: {cancellable: null, lastRun: null, err: null}};
	runAllCancel: CancelBusy = {
		cancel:null,busy:false,
		up: ()=>this.upRun(),
		done: new EventEmitter()
	};

	checkers: Record<string,string> = {};
	checker: Checker|null=null;
	cfg: RunCfg = defaultRunCfg;

	fileToCase: Map<string, {case: number, which: "inFile"|"ansFile"}> = new Map();

	maxOutputSize=1024*35;

	upCfg() {this.send({type: "updateCfg", cfg: this.cfg});}
	upChecker() {this.send({
		type: "updateChecker",
		checker: this.checker,
		checkers: Object.keys(this.checkers)
	});}

	toTestSet=():TestSetData=>({
		cases: Object.fromEntries(Object.entries(this.cases).map(([k,v])=>[k,v.tc])),
		runAll: this.run.runAll,
		order: this.order,
		nextId: this.id
	});

	// ok there are so many issues with the IPC thing that i don't want to deal with
	// this is not robust, but it should work for basically all use cases...
	// definitely poorly engineered though
	async loadTestSet(setId: number, save: boolean) {
		const is = new Set(Object.keys(this.cases).map(Number));
		while (true) {
			const cbs: CancelBusy[] = [this.runAllCancel, ...Object.values(this.cases)]
				.filter(x=>x.busy || x.cancel!=null);
			if (cbs.length==0) break;

			this.log.info(`Loading test set... cancelling ${cbs.length} existing tasks`);
			for (const c of cbs) {
				if (c.cancel!=null) c.cancel?.cancel();
				await new Promise(c.done.event);
			}
		}

		if (save) this.save();

		this.log.info("Actually loading test set now");
		const tests = this.ctx.globalState.get<TestSetData>(`testset${setId}`);

		this.cases = tests ? Object.fromEntries(
			Object.entries(tests.cases).map(([k,v])=>[
				k, {
					tc: {...v, cancellable: null},
					cancel:null,
					busy:false,
					up: ()=>this.upTestCase(Number(k)),
					done: new EventEmitter()
				}
			])
		) : {};

		this.send({type: "reorderTests", order: []});

		this.setId = setId;
		this.order = tests?.order ?? [];
		this.id = tests?.nextId ?? 0;
		this.run.runAll={...tests?.runAll ?? {lastRun: null, err: null}, cancellable: null};

		this.upTestCase(...is.union(new Set(Object.keys(this.cases).map(Number))).values());
		this.upOrder();
		this.upRun();
	}

	timeout?: NodeJS.Timeout;
	save() {
		if (this.timeout) {
			clearTimeout(this.timeout);
			delete this.timeout;
		}

		this.log.info("Saving tests...");
		this.ctx.globalState.update(`testset${this.setId}`, this.toTestSet());
	}

	upTests() {
		this.fileToCase = new Map(Object.entries(this.cases).flatMap(([id,v])=>[
			[v.tc.inFile, {case: Number(id), which: "inFile"}],
			[v.tc.ansFile, {case: Number(id), which: "ansFile"}],
		]).filter(([a])=>a!=undefined) as [string, {case: number, which: "inFile"|"ansFile"}][])

		if (this.timeout) clearTimeout(this.timeout);
		this.timeout = setTimeout(()=>this.save(), 5000);
	}

	upOrder() {
		this.send({type: "reorderTests", order: this.order});
		this.upTests();
	}

	upTestCase(...is:number[]) {
		this.send({type: "updateTestCases", testCasesUpdated:
			Object.fromEntries(is.map((v): [number, TestCase|null]=>[v, this.cases[v]?.tc ?? null])) });
		this.upTests();
	}

	upRun() {
		this.send({type: "updateRunState", run: this.run});
		this.upTests();
	}

	withCb(c: CancelBusy,
		cb: (disp:(x: {dispose: ()=>void})=>void)=>Promise<void>,
		tc: {err: TestCase["err"], cancellable: boolean|null}, name: string,
		{cancel, update}: CancelUpdate={}) {

		if (cancel!=null && cancel.token.isCancellationRequested) return;

		if (((!update || cancel!=null) && c.cancel!=null) || c.busy) {
			window.showErrorMessage("Sorry, busy processing this test case. Try again after the current task is finished.")
			return;
		}

		if (cancel) c.cancel=cancel;
		else c.busy=true;
		tc.cancellable = c.cancel!=null;
		c.up();

		const disps: {dispose:()=>void}[]=[];

		return cb((d)=>disps.push(d)).then(()=>{
			tc.err=null;
		}).catch((e) => {
			console.error(e);
			this.log.error(e);

			if (e instanceof CompileError || e instanceof RunError) {
				tc.err={type:e instanceof CompileError ? "compile" : "run", err: e};
				window.showErrorMessage(e instanceof CompileError ? `Error compiling ${basename(e.file)}: ${e.err}` : `Error running ${basename(e.file)} on ${name}: ${e.err}`);
			} else if (e instanceof CancellationError) {
				return;
			} else if (e instanceof Error) {
				window.showErrorMessage(`Error (${name}): ${e.message}`);
			} else {
				window.showErrorMessage(`An error occurred (${name})`);
			}
		}).finally(() => {
			if (cancel) c.cancel=null;
			else c.busy=false;
			tc.cancellable = c.cancel ? true : c.busy ? false : null;
			c.up();

			disps.forEach(x=>x.dispose());

			if (tc.cancellable==null) c.done.fire();
		});
	}

	withRunAll(cb: (c: RunState["runAll"], disp: (x: {dispose: ()=>void})=>void)=>Promise<void>, opts: CancelUpdate={}) {
		return this.withCb(this.runAllCancel, (d)=>cb(this.run.runAll, d),
			this.run.runAll, "all test cases", opts);
	}

	//update - small update which shouldn't wait for cancellable processes to complete
	//otherwise locks everything
	withTest(i: number, cb: (c: TestCase, disp: (x: {dispose: ()=>void})=>void)=>Promise<void>, opts: CancelUpdate={}) {
		//um im very bad at sychronization
		//it was ok when there was one testset and not rly gonna wrap each operation in another guard
		//for when i load new test sets. but they might fuck up existing operations which aren't
		//guarded by withcb
		if (!(i in this.cases)) {
			window.showErrorMessage("This test case no longer exists");
			return;
		}

		const c = this.cases[i];
		return this.withCb(c, (d)=>cb(c.tc, d), c.tc, c.tc.name, opts);
	}

	async getTestDir() {
		let testDir = cfg().get<string>("testDir") ?? null;
		if (testDir && testDir.length==0) testDir=null;
		if (this.ctx.storageUri) testDir=this.ctx.storageUri?.fsPath;
		else if (this.ctx.globalStorageUri) testDir=this.ctx.globalStorageUri?.fsPath;
		else throw new Error("No test directory");

		testDir = join(testDir, `testset${this.setId}`);
		await mkdir(testDir, {recursive: true});
		return testDir;
	}

	private async nextTestFile(pre: string, nextTc: number) {
		const dir = await this.getTestDir();
		let inP:string, outP:string;
		while (true) {
			inP=join(dir, `${pre}${nextTc}.in`);
			outP=join(dir, `${pre}${nextTc}.ans`);

			if (await exists(inP)||await exists(outP)) nextTc++;
			else break;
		}

		return { inFile: resolve(inP), ansFile: resolve(outP) };
	}

	private makeTest(name: string, tmp: boolean, inFile?: string, ansFile?: string) {
		this.cases[this.id]={
			tc: {
				inFile, ansFile, name,
				tmpIn: tmp, tmpAns: tmp, cancellable: null, err: null, lastRun: null
			},
			cancel: null,
			busy: false,
			up: ()=>this.upTestCase(this.id),
			done: new EventEmitter()
		};

		this.order.push(this.id);
		return this.id++;
	}

	async createTest() {
		let nextTc=1;
		let m;
		for (const v of Object.values(this.cases)) {
			if (v && (m=v.tc.name.match(/Test (\d+)/))) {
				const y = Number.parseInt(m[1])+1;
				if (y>nextTc) nextTc=y;
			}
		}

		const {inFile, ansFile} = await this.nextTestFile("test", nextTc);
		await writeFile(inFile, "");
		await writeFile(ansFile, "");

		this.upTestCase(this.makeTest(`Test ${nextTc}`, true, inFile, ansFile));
		this.upOrder();
	}

	setFile(i: number, which: "inFile"|"ansFile", path?: string, tmp?: boolean) {
		this.withTest(i, async (c) => {
			if (which=="inFile" && c.tmpIn || which=="ansFile" && c.tmpAns)
				if (c[which]!=null) await rm(c[which], {force: true});

			let v: string|null;
			if (tmp) {
				//oh my god this is so bad
				//who the fuck needs to create test cases, detach the created tmp file, and then attach another fucking tmp? who the fuck is this for
				const {inFile, ansFile} = await this.nextTestFile(`test-${c.name}`, 1);
				if (which=="inFile") {
					c.inFile=inFile; c.tmpIn=true;
				} else {
					c.ansFile=ansFile; c.tmpAns=true;
				}
				await writeFile(c[which]!, "");

				v="";
			} else {
				c[which]=path ? resolve(path) : undefined;
				if (which=="inFile") c.tmpIn=false; else c.tmpAns=false;
				v = path && await this.shouldShowSource(path) ? await readFile(path,"utf-8") : null;
			}

			this.send({ type: "testCaseRead", i, which, source: v });
		});
	}

	async getOutput(i: number) {
		const bd = join(this.runner.getBuildDir(), `testset${this.setId}`);
		await mkdir(bd, {recursive: true});
		return resolve(join(bd, `output${i}.out`));
	}

	removeTest(i: number) {
		this.withTest(i, async (c) => {
			if (c.tmpIn && c.inFile) await rm(c.inFile, {force: true});
			if (c.tmpAns && c.ansFile) await rm(c.ansFile, {force: true});
			await rm(await this.getOutput(i), {force: true});

			delete this.cases[i];
			delete this.outputs[i];
			this.order = this.order.filter(x=>x!=i);
			this.upOrder();
		});
	}

	//run within withTest
	private async handleTestOutput(i: number): Promise<Pick<Test,"onOutput"|"output">&{dispose: ()=>void}> {
		let tm: NodeJS.Timeout|null = null;
		const outPath = await this.getOutput(i);

		delete this.outputs[i];
		this.send({type: "testCaseOutput", i});

		return {
			dispose: ()=>{
				if (tm) clearTimeout(tm);
				this.send({type: "testCaseOutput", i, out: this.outputs[i]});
			},
			output: outPath,
			onOutput: (x, which) => {
				const o = this.outputs[i] ?? (this.outputs[i]={stderr: "", stdout: "", path: outPath});

				if (which=="judge") {
					o.judge=x;
				} else if (o.stderr.length+o.stdout.length<this.maxOutputSize) {
					const extra = x.length+o.stderr.length+o.stdout.length-this.maxOutputSize;
					if (extra>0) {
						x=x.slice(0,this.maxOutputSize-o.stderr.length-o.stdout.length);
						o.hiddenSize=extra;
					}
					if (which=="stderr") o.stderr+=x; else o.stdout+=x;
				} else {
					o.hiddenSize!+=x.length;
				}

				if (this.run.runningTest==i)
					this.send({type: "testCaseStream", which, txt: x});

				if (tm==null) tm=setTimeout(()=>{
					this.send({type: "testCaseOutput", i, out: o});
					tm=null;
				}, 350);
			}
		}
	}

	private async compileProgChecker(d: (x:Disposable)=>void, path: string, stop: CancellationToken) {
		if (this.checker==null) throw new RunError("No checker set", path);

		d(window.setStatusBarMessage(`Compiling ${basename(path)}...`));
		const prog = await this.runner.compile({
			file: path, cached: true,
			type: "fast", testlib: false, stop
		});

		const checkerFile = this.checker.type=="file" ? this.checker.path : this.checkers[this.checker.name];
		d(window.setStatusBarMessage(`Compiling ${basename(checkerFile)}...`));
		const checker = await this.runner.compile({
			file: checkerFile, cached: true, type: "fast", testlib: true, stop
		});

		return {prog,checker};
	}

	async runMany(is: number[], path: string) {
		const cancel = new CancellationTokenSource();

		this.withRunAll(async (r,d) => {
			const compilation = await this.compileProgChecker(d,path,cancel.token);

			await window.withProgress({
				cancellable: true,
				location: ProgressLocation.Notification,
				title: "Running tests..."
			}, async (prog, progressStop) => {
				d(progressStop.onCancellationRequested(()=>cancel.cancel()));
				d(window.setStatusBarMessage("Running test cases"));

				const lr: typeof r.lastRun={
					progress: [0,is.length], verdict:null,
					wallTime:null, cpuTime:null, mem: null
				};

				r.lastRun = lr;
				this.upRun();

				const testFinish = new EventEmitter<void>();
				d(testFinish);

				const take = () => {
					const i = is.shift()!;
					//deleted since run all started
					if (!(i in this.cases)) {
						return false;
					}

					this.withTest(i, async (c,dTc) => {
						//cursed!
						dTc({dispose(){ testFinish.fire(); }});
						d(window.setStatusBarMessage(`Running ${basename(path)} / ${c.name}`));
						c.lastRun=null;

						const test: Test = {
							...this.cfg, tc: c, dbg: false,
							...compilation, stop: cancel.token,
							...await this.handleTestOutput(i)
						};

						const res = await this.runner.run(test);
						if (res==null) return;
						c.lastRun=res;
						
						const xs: ("cpuTime"|"wallTime"|"mem")[] = ["cpuTime","wallTime","mem"];
						for (const prop of xs) {
							if (res[prop]!=null) lr[prop]=Math.max(lr[prop] ?? 0, res[prop]);
						}

						if (lr.verdict==null || badVerdicts.indexOf(lr.verdict)<badVerdicts.indexOf(res.verdict))
							lr.verdict=res.verdict;
					}, {cancel});

					return true;
				};

				const update = () => {
					lr.progress[0]++;
					this.log.info(`Running all (${lr.progress[0]}/${lr.progress[1]})`);
					prog.report({increment: 100.0/lr.progress[1]});
					this.upRun();
				};

				let nworker = Math.min(20, is.length);
				const cp = cancelPromise(cancel.token);
				while (lr.progress[0]<lr.progress[1]) {
					if (nworker==0) {
						await Promise.race([new Promise(testFinish.event), cp]);
						if (cancel.token.isCancellationRequested) break;
						update();
					} else {
						nworker--;
					}

					while (is.length>0 && !take()) update();
				}

				if (lr.verdict==null) lr.verdict="AC";
			});
		}, {cancel});
	}

	runTest(i: number, dbg: boolean, path: string) {
		const cancel = new CancellationTokenSource();
		this.withTest(i, async (c,d) => {
			const compilation = await this.compileProgChecker(d,path,cancel.token);
			c.lastRun=null;

			this.inputs[i]=new EventEmitter<string>();
			d({dispose: ()=>{
				this.inputs[i].dispose();
				delete this.inputs[i];
			}});

			const test: Test = {
				...this.cfg, tc: c, dbg,
				...compilation,
				onInput: this.inputs[i].event,
				stop: cancel.token,
				...await this.handleTestOutput(i)
			};

			d(window.setStatusBarMessage(`Running ${basename(path)} / ${test.tc.name}`))

			this.run.runningTest=i;
			this.upRun();
			d({dispose: ()=>{
				if (this.run.runningTest!=i) return;
				this.upRun();
			}});

			const res = await this.runner.run(test);
			if (res) c.lastRun=res;

		}, {cancel});
	}

	shouldShowSource = (x: string) => stat(x).then(x=>x.size<1024*50).catch(()=>false);

	reloadTestSource(i: number) {
		this.withTest(i, async (c) => {
			const arr: ("inFile"|"ansFile")[] = ["inFile", "ansFile"];
			await Promise.all(arr.map(async x=>{
				const v = c[x] && await this.shouldShowSource(c[x]) ? await readFile(c[x],"utf-8") : null;
				this.send({ type: "testCaseRead", i, which: x, source: v });
			}));
		}, {update:true});
	}

	setSource(i: number, src: string, which: "ansFile"|"inFile") {
		this.withTest(i, async (c) => {
			if (c[which]!=null) {
				await writeFile(c[which], src);
				this.send({ type: "testCaseRead", i, which, source:src });
			}
		}, {update:true});
	}

	moveTest(a: number, b: number) {
		this.order.splice(b,0,...this.order.splice(a,1));
		this.upOrder();
	}

	constructor(private ctx: ExtensionContext, private log: LogOutputChannel, private send: (x: MessageFromExt)=>void, public setId: number) {
		log.info("Loading test cases");

		this.runner = new Runner(ctx, log);

		const cfg = ctx.workspaceState.get<RunCfg>("runcfg");
		if (cfg) this.cfg = cfg;
	}

	async importCases() {
		const uris = await window.showOpenDialog({
			canSelectFiles: true, canSelectFolders: true, canSelectMany: true,
			filters: testCaseFilter, title: "Choose test files", openLabel: "Import tests"
		});

		if (!uris) return;

		const subs = (await Promise.all(uris.map(u=>u.fsPath).map(async p=>{
			if ((await stat(p)).isDirectory())
				return (await readdir(p, {withFileTypes: true}))
					.filter(x=>!x.isDirectory()).map(x=>join(x.parentPath,x.name));
			else return [p];
		}))).flat();

		const rec: Record<string, {in?:string,out?:string}> = {};
		for (const p of subs) {
			const ext = extname(p);
			const name = basename(p,ext);

			const isIn=inNames.has(ext), isOut=!isIn && ansNames.has(ext);
			if (!isIn && !isOut) continue;
			if (!(name in rec)) rec[name]={};

			const prev = isIn ? rec[name].in : rec[name].out;
			if (prev!=undefined) throw new Error(`Duplicate test names (path ${p} vs ${prev})`);

			if (isIn) rec[name].in=p; else rec[name].out=p;
		}

		const ids = Object.entries(rec)
			.toSorted((([a],[c])=>{
				const l = Math.min(a.length,c.length);
				return a.slice(0,l)<c.slice(0,l) ? -1 : 1;
			}))
			.map((([k,v])=>this.makeTest(k, false, v.in, v.out)));
		this.upTestCase(...ids);
		this.upOrder();
	}

	async init() {
		await this.loadTestSet(this.setId, false);

		const checkers = (await readdir(join(this.ctx.extensionPath, "testlib/checkers")))
			.filter(v=>v.endsWith(".cpp"));

		if (!checkers.includes("wcmp.cpp"))
			throw new Error("wcmp not found");
		this.checker={type: "default", name: "wcmp.cpp"};

		this.checkers = Object.fromEntries(checkers.map(c=>
			[c,join(this.ctx.extensionPath, "testlib/checkers", c)]
		));

		this.upChecker();
	}

	//not 100% perfect, since cancellation is async
	dispose() {
		this.runAllCancel.cancel?.cancel();
		for (const c of Object.values(this.cases))
			c?.cancel?.cancel();
	}
}