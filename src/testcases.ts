import { CancellationTokenSource } from "vscode-languageclient";
import { badVerdicts, CompileError, defaultRunCfg, MessageFromExt, RunCfg, RunError, RunState, RunType, Stress, TestCase, TestOut, TestResult } from "./shared";
import { ExtensionContext, window, LogOutputChannel, EventEmitter, OpenDialogOptions, Disposable, CancellationToken, CancellationError, ProgressLocation, commands, workspace, Event } from "vscode";
import { CompileResult, Runner, Test } from "./runner";
import { cancelPromise, delay, exists } from "./util";
import { basename, extname, join, resolve } from "node:path";
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";

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

export class CBError extends Error {
	constructor(public name: string, public err?: Error) {
		super(err!=undefined ? `Error (${name}): ${err.message}` : `An error occurred (${name})`);
	}
}

type CancelUpdate = { cancel?: CancellationTokenSource, update?: boolean };

type TestSetData = {
	cases: Record<number, Omit<TestCase,"cancellable">>,
	runAll: Omit<RunState["runAll"],"cancellable">,
	order: number[],
	runCfg: RunCfg|null,
	nextId: number
};

const defaultRunAll = {cancellable: null, lastRun: null, err: null};

type TestFileType = "output"|"stress"|"fileIO";

type Stats = Pick<TestResult,"wallTime"|"cpuTime"|"mem">;

export class TestCases {
	cases: Record<number,{ tc: TestCase }&CancelBusy> = {};
	order: number[]=[];
	inputs: Record<number, EventEmitter<string>> = {};
	outputs: Record<number, TestOut> = {};
	id: number=0;

	runner: Runner;

	run: RunState = {runAll: defaultRunAll};
	runAllCancel: CancelBusy = {
		cancel:null,busy:false,
		up: ()=>this.upRun(),
		done: new EventEmitter()
	};

	checkers: Record<string,string> = {};
	cfg: RunCfg = defaultRunCfg;

	fileToCase: Map<string, {case: number, which: "inFile"|"ansFile"}> = new Map();

	maxOutputSize=1024*35;

	upCheckers() {
		this.send({type:"updateCheckers", checkers: Object.keys(this.checkers)});
		this.saveSoon();
	}

	upCfg() {
		this.send({type: "updateCfg", cfg: this.cfg});
		this.ctx.workspaceState.update("runcfg", this.cfg);
		this.saveSoon();
	}

	toTestSet=():TestSetData=>({
		cases: Object.fromEntries(Object.entries(this.cases).map(([k,v])=>[k,v.tc])),
		runAll: this.run.runAll,
		order: this.order,
		runCfg: this.cfg, nextId: this.id
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

		if (save) await this.save();

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
		) as typeof this.cases : {};

		this.send({type: "reorderTests", order: []});

		this.setId = setId;
		if (tests?.runCfg) this.cfg=tests.runCfg;
		else this.cfg.interactor=this.cfg.fileIO=null; //clear things which probably shouldn't be persisted across test sets
		this.order = tests?.order ?? [];
		this.id = tests?.nextId ?? 0;
		this.run.runAll={...tests?.runAll ?? {lastRun: null, err: null}, cancellable: null};
		this.outputs={};

		this.disableSave=true;

		this.upTestCase(...new Set([...Object.keys(this.cases).map(Number),...is]));
		this.upOrder();
		this.upRun();
		this.upCfg();

		this.disableSave=false;
	}

	timeout?: NodeJS.Timeout;
	async save() {
		if (this.timeout) {
			clearTimeout(this.timeout);
			delete this.timeout;
		}

		this.log.info("Saving tests...");

		this.fileToCase = new Map(Object.entries(this.cases).flatMap(([id,v])=>[
			[v.tc.inFile, {case: Number(id), which: "inFile"}],
			[v.tc.ansFile, {case: Number(id), which: "ansFile"}],
		]).filter(([a])=>a!=undefined) as [string, {case: number, which: "inFile"|"ansFile"}][])

		await this.onSaveTests();
		await this.ctx.globalState.update(`testset${this.setId}`, this.toTestSet());
	}

	disableSave: boolean=false;
	saveSoon() {
		if (this.timeout) clearTimeout(this.timeout);
		if (this.disableSave) return;
		this.timeout = setTimeout(()=>void this.save(), 5000);
	}

	upOrder() {
		this.send({type: "reorderTests", order: this.order});
		this.saveSoon();
	}

	upTestCase(...is:number[]) {
		this.send({type: "updateTestCases", testCasesUpdated:
			Object.fromEntries(is.map((v): [number, TestCase|null]=>[v, this.cases[v]?.tc ?? null])) });
		this.saveSoon();
	}

	upRun() {
		this.send({type: "updateRunState", run: this.run});
		this.saveSoon();
	}

	//return wrapped promise bc otherwise eslint is annoyed
	//and i need those lints! bc im stupid and keep forgetting await lmao
	withCb(c: CancelBusy,
		cb: (disp:(x: {dispose: ()=>void})=>void)=>Promise<void>,
		tc: {err: TestCase["err"], cancellable: boolean|null}, name: string,
		{cancel, update}: CancelUpdate={}): Promise<void> {

		if (cancel!=null && cancel.token.isCancellationRequested) return Promise.resolve();

		if (((!update || cancel!=null) && c.cancel!=null) || c.busy) {
			window.showErrorMessage("Sorry, busy processing this test case. Try again after the current task is finished.")
			return Promise.resolve();
		}

		if (cancel) c.cancel=cancel;
		else c.busy=true;
		tc.cancellable = c.cancel!=null;
		c.up();

		const disps: {dispose:()=>void}[]=[];

		return cb((d)=>disps.push(d)).then(()=>{
			tc.err=null;
		}).catch((e) => {
			if (e instanceof CompileError || e instanceof RunError) {
				console.error(e);
				if (e instanceof Error) this.log.error(e);

				tc.err={type:e instanceof CompileError ? "compile" : "run", err: e};
				window.showErrorMessage(e instanceof CompileError ? `Error compiling ${basename(e.file)}: ${e.err}` : `Error running ${basename(e.file)} on ${name}: ${e.err}`);
			} else if (e instanceof CancellationError) {
				return;
			} else {
				throw new CBError(name, e instanceof Error ? e : undefined);
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
			return Promise.reject(new Error("This test case no longer exists"));
		}

		const c = this.cases[i];
		return this.withCb(c, (d)=>cb(c.tc, d), c.tc, c.tc.name, opts);
	}

	async deleteTestSet(setId: number) {
		await rm(await this.getTestDir(setId), {recursive: true, force: true});
		this.ctx.globalState.update(`testset${setId}`, undefined);
	}

	getTestsetDir() {
		let testDir = workspace.getConfiguration("cpu.testDir").get<string>("") ?? null;
		if (testDir && testDir.length==0) testDir=null;
		if (this.ctx.storageUri) testDir=this.ctx.storageUri?.fsPath;
		else if (this.ctx.globalStorageUri) testDir=this.ctx.globalStorageUri?.fsPath;
		else throw new Error("No test directory");
		return testDir;
	}

	async getTestDir(setId?:number) {
		const testDir = join(this.getTestsetDir(), `testset${setId??this.setId}`);
		await mkdir(testDir, {recursive: true});
		return testDir;
	}

	async nextTestFile(pre: string, nextTc: number, setId?: number) {
		const dir = await this.getTestDir(setId);
		let inP:string, outP:string;
		while (true) {
			inP=join(dir, `${pre}${nextTc}.in`);
			outP=join(dir, `${pre}${nextTc}.ans`);

			if (await exists(inP)||await exists(outP)) nextTc++;
			else break;
		}

		return { inFile: resolve(inP), ansFile: resolve(outP) };
	}

	async makeTestSetData(setId: number, tests: {input:string,output:string}[]) {
		const data: TestSetData = {
			nextId: 0, order: tests.map((_,i)=>i),
			runCfg: null, cases: {}, runAll: defaultRunAll
		};

		for (const {input,output} of tests) {
			const {inFile, ansFile} = await this.nextTestFile("test", data.nextId, setId);
			await writeFile(inFile, input);
			await writeFile(ansFile, output);
			data.cases[data.nextId] = this.makeTestCase(`Test ${data.nextId+1}`,true,inFile,ansFile);
			data.nextId++;
		}

		await this.ctx.globalState.update(`testset${setId}`, data);
	}

	private makeTestCase=(name: string, tmp: boolean, inFile?: string, ansFile?: string, stress?: Stress): TestCase=>({
		inFile, ansFile, name, stress,
		tmpIn: tmp, tmpAns: tmp,
		cancellable: null, err: null, lastRun: null
	});

	private makeTest(tc: TestCase) {
		const i = this.id++;
		this.cases[i]={
			tc, cancel: null,
			busy: false,
			up: ()=>this.upTestCase(i),
			done: new EventEmitter()
		};

		this.order.push(i);
		return i;
	}

	async createTest(name?: string, stress?: Stress) {
		let nextTc=1;
		let m;
		for (const v of Object.values(this.cases)) {
			if (v && (m=v.tc.name.match(/Test (\d+)/))) {
				const y = Number.parseInt(m[1])+1;
				if (y>nextTc) nextTc=y;
			}
		}

		name ??= `Test ${nextTc}`;

		// new stresses don't have input/output
		const {inFile, ansFile} = stress!=undefined
			? {inFile: undefined, ansFile: undefined}
			: await this.nextTestFile("test", nextTc);
		
		if (inFile) await writeFile(inFile, "");
		if (ansFile) await writeFile(ansFile, "");

		this.upTestCase(this.makeTest(this.makeTestCase(name, true, inFile, ansFile, stress)));
		this.upOrder();
	}

	private async clearOldFile(c: TestCase, which: "inFile"|"ansFile") {
		if (which=="inFile" && c.tmpIn || which=="ansFile" && c.tmpAns)
			if (c[which]!=null) await rm(c[which], {force: true});
	}

	setFile(i: number, which: "inFile"|"ansFile", path?: string, tmp?: boolean) {
		return this.withTest(i, async (c) => {
			await this.clearOldFile(c,which);

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

	//stress and fileIO are directories (stress contains folder for each worker, fileIO contains named input/outputs which are copied from input / to output...)
	//stress dir may contain name input/outputs
	testFileTypes: TestFileType[]=["output","stress","fileIO"]
	async getTestFile(i: number, f: TestFileType, doRm?: boolean) {
		const bd = join(this.runner.getBuildDir(), `testset${this.setId}`);
		const out = resolve(join(bd, f=="output" ? `test${i}.out` : `${f}${i}`));

		if (doRm) await rm(out, {force: true, recursive: true});
		else await mkdir(f=="output" ? bd : out, {recursive: true});

		return out;
	}

	//files might not be cleaned if user changes build dir...
	removeTest(i: number) {
		return this.withTest(i, async (c) => {
			if (c.tmpIn && c.inFile) await rm(c.inFile, {force: true});
			if (c.tmpAns && c.ansFile) await rm(c.ansFile, {force: true});

			for (const k of this.testFileTypes) await this.getTestFile(i,k,true);

			delete this.cases[i];
			delete this.outputs[i];
			this.order = this.order.filter(x=>x!=i);
			this.upOrder();
		});
	}

	//run within withTest
	private async testIO(i: number, c: TestCase): Promise<Pick<Test,"onOutput"|"output"|"onJudge"|"inFile"|"end"|"ansFile">> {
		let tm: NodeJS.Timeout|null = null;
		const outPath = await this.getTestFile(i,"output");
		const fioPath = this.cfg.fileIO!=null ? await this.getTestFile(i, "fileIO") : null;

		delete this.outputs[i];
		this.send({type: "testCaseOutput", i});

		const getO=()=>{
			if (tm==null) tm=setTimeout(()=>{
				this.send({type: "testCaseOutput", i, out: this.outputs[i]});
				tm=null;
			}, 350);

			return this.outputs[i] ?? (this.outputs[i]={stderr: "", stdout: "", path: outPath});
		};

		return {
			end: async ()=>{
				if (tm) clearTimeout(tm);
				await this.setOutputFrom(i, outPath, this.outputs[i]?.judge);
			},
			ansFile: c.ansFile,
			...await this.mkFileIO(fioPath, c.inFile, outPath),
			onJudge: (x)=>{
				getO().judge=x;

				if (this.run.runningTest==i)
					this.send({type: "testCaseStream", which: "judge", txt: x});
			},
			onOutput: (x, which) => {
				if (this.run.runningTest==i)
					this.send({type: "testCaseStream", which, txt: x});

				const o=getO();
				if (o.stderr.length+o.stdout.length<this.maxOutputSize) {
					const extra = x.length+o.stderr.length+o.stdout.length-this.maxOutputSize;
					if (extra>0) {
						x=x.slice(0,this.maxOutputSize-o.stderr.length-o.stdout.length);
						o.hiddenSize=extra;
					}

					if (which=="stderr") o.stderr+=x;
					else o.stdout+=x;
				} else {
					o.hiddenSize!+=x.length;
				}
			}
		}
	}

	//https://stackoverflow.com/a/59722384
	//used for stress test and after interactive tests
	private async setOutputFrom(i: number, from: string, judge?: string) {
		const chunks=[];
		if (await exists(from)) {
			for await (const o of createReadStream(from, {start:0,end:this.maxOutputSize}))
				chunks.push(o);
		}

		if (chunks.length>0 || judge) this.outputs[i]={
			...this.outputs[i] ?? {stderr: ""},
			path: from, stdout: Buffer.concat(chunks).toString("utf-8"), judge
		}; else {
			delete this.outputs[i];
		}

		this.send({type: "testCaseOutput", i, out: this.outputs[i]});
	}

	private async compileProgChecker(d: (x:Disposable)=>void, path: string, stop: CancellationToken, dbg: "normal"|"interactor"|null, testlib?: boolean) {
		if (this.cfg.checker==null) throw new RunError("No checker set", path);

		d(window.setStatusBarMessage(`Compiling ${basename(path)}...`));
		const prog = await this.runner.compile({
			file: path, cached: true,
			type: dbg=="normal" ? "debug" : "fast", testlib: testlib==true, stop
		});

		const checkerFile = this.cfg.checker.type=="file" ? this.cfg.checker.path : this.checkers[this.cfg.checker.name];
		d(window.setStatusBarMessage(`Compiling ${basename(checkerFile)}...`));
		const checker = await this.runner.compile({
			file: checkerFile, cached: true, type: "fast", testlib: true, stop
		});

		let interactor: CompileResult|undefined;
		if (this.cfg.interactor!=null) {
			d(window.setStatusBarMessage(`Compiling interactor ${basename(this.cfg.interactor)}...`));

			interactor = await this.runner.compile({
				file: this.cfg.interactor, cached: true,
				type: dbg=="interactor" ? "debug" : "fast",
				testlib: true, stop
			});
		}
		
		return {prog,checker,interactor};
	}

	runCfgToTest = () => ({
		tl: this.cfg.tl, ml: this.cfg.ml, eof: this.cfg.eof
	});

	private maxStats(x: Stats, y: TestResult) {
		const xs: ("cpuTime"|"wallTime"|"mem")[] = ["cpuTime","wallTime","mem"];
		for (const prop of xs) {
			if (y[prop]!=null) x[prop]=Math.max(x[prop] ?? 0, y[prop]);
		}
	}

	runMany(is: number[], path: string) {
		const cancel = new CancellationTokenSource();

		return this.withRunAll(async (r,d) => {
			const compilation = await this.compileProgChecker(d,path,cancel.token,null);
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
				let err: Error|undefined;

				const take = () => {
					const i = is.shift()!;
					//deleted since run all started
					if (!(i in this.cases)) {
						return false;
					}

					this.withTest(i, async (c) => {
						//cursed!
						d(window.setStatusBarMessage(`Running ${basename(path)} / ${c.name}`));
						c.lastRun=null;

						const test: Test = {
							...this.runCfgToTest(),
							dbg: null, name: c.name,
							...compilation, stop: cancel.token,
							...await this.testIO(i,c)
						};

						const res = await this.runner.run(test);
						if (res==null) return;
						c.lastRun=res;
						
						this.maxStats(lr, res);

						if (lr.verdict==null || badVerdicts.indexOf(lr.verdict)<badVerdicts.indexOf(res.verdict))
							lr.verdict=res.verdict;
					}, {cancel}).catch((e)=>{
						if (e instanceof Error) err=e;
					}).finally(() => {
						testFinish.fire();
					});

					return true;
				};

				const update = () => {
					lr.progress[0]++;
					this.log.info(`Running all (${lr.progress[0]}/${lr.progress[1]})`);
					prog.report({increment: 100.0/lr.progress[1]});
					this.upRun();
				};

				let nworker = Math.min(this.cfg.nProcs, is.length);
				const cp = cancelPromise(cancel.token);
				while (lr.progress[0]<lr.progress[1]) {
					if (nworker==0) {
						await Promise.race([new Promise(testFinish.event), cp]);
						if (err) throw err;
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

	clearRunAll() {
		return this.withRunAll(async (c) => {
			c.lastRun=c.err=null;
		});
	}

	private async mkFileIO(dir: string|null, input: string|undefined, out: string) {
		const fio = this.cfg.fileIO;
		if (fio==null || dir==null) return {
			inFile: input, output: out
		};

		const ret: {inFile?: string, output: string, cwd: string, noStdio: boolean} = {
			output: join(dir, fio.output), cwd: dir, noStdio: true
		};

		await rm(ret.output, {force: true});
		await symlink(out, ret.output, "file");

		if (input!=undefined) {
			ret.inFile=join(dir, fio.input);
			await rm(ret.inFile, {force: true});
			await symlink(input, ret.inFile, "file");
		}
	
		return ret;
	}

	//there are some funky cases here
	//like runtype runinteractor just lets u debug interactor
	//and runtype generator only runs generator w/o interactor, etc
	//and then all the stress testing gunk
	async runTest(i: number, dbg: boolean, path: string, runType: RunType) {
		if (runType=="stress" && dbg)
			throw new Error("Stress tests don't support debugging");
		if (runType=="runInteractor" && this.cfg.interactor==null)
			throw new Error("No interactor to run");

		const cancel = new CancellationTokenSource();
		const cb = this.cases[i];
		if (cb.cancel!=null) {
			cb.cancel.cancel();
			await new Promise<void>(cb.done.event);
		}

		const dbgTy = dbg ? (runType=="runInteractor" ? "interactor" : "normal") : null;

		return this.withTest(i, async (c,d) => {
			const compilation = await this.compileProgChecker(d,
				runType=="generator" ? c.stress!.generator : path,
				cancel.token, dbgTy, runType=="generator");
			c.lastRun=null;

			const setFrom = async (which: "inFile"|"ansFile", from: string) => {
				if (c[which]!=from) await this.clearOldFile(c, which);
				c[which] = from;
				if (which=="inFile") c.tmpIn=true; else c.tmpAns=true;
				await this.reloadTestFile(i, c, which);
			};

			const genName = `${c.name} (Generator)`;
			const bruteName = `${c.name} (Brute force)`;

			if (c.stress!=undefined && runType=="stress") {
				const s = c.stress;
				s.status=null;

				d(window.setStatusBarMessage(`Compiling brute force solution ${basename(s.brute)}...`));
				const brute = await this.runner.compile({
					file: s.brute, cached: true, type: "fast", testlib: false, stop: cancel.token
				});

				d(window.setStatusBarMessage(`Compiling generator ${basename(s.generator)}...`));
				const gen = await this.runner.compile({
					file: s.generator, cached: true, type: "fast", testlib: true, stop: cancel.token
				});

				const dir = await this.getTestFile(i,"stress");

				await window.withProgress({
					cancellable: true,
					location: ProgressLocation.Notification,
					title: `Running stress test ${c.name}...`
				}, async (prog, progressStop) => {
					d(progressStop.onCancellationRequested(()=>cancel.cancel()));
					d(window.setStatusBarMessage(`Running stress test ${c.name}`));

					let ci=0;
					const startTime = Date.now();
					const stat = { i: 0, time: 0, maxI: s.maxI };
					s.status=stat;

					const update = ()=>{
						stat.i++; stat.time=Date.now()-startTime;
						prog.report({increment: 100/stat.maxI});
						this.upTestCase(i);
					};

					const stats: Stats = {cpuTime: null, wallTime: null, mem: null};

					const nworker = Math.min(this.cfg.nProcs, stat.maxI);
					await Promise.all([...(new Array(nworker) as unknown[])].map(async (_,workerI)=>{
						const workDir = join(dir, `worker${workerI}`);
						await mkdir(workDir, {recursive: true});
						const [stressIn, stressOut, stressAns] = ["input","output","answer"].map(x=>join(workDir,x));

						const fioDir = join(workDir,"fileIO");
						if (this.cfg.fileIO!=null) await mkdir(fioDir, {recursive: true});

						while (!cancel.token.isCancellationRequested && ci<stat.maxI) {
							const xi=ci++;
							const genTest: Test = {
								name: genName, dbg: null,
								prog: gen, stop: cancel.token,
								args: this.runner.evaluateStressArgs(s.args, xi),
								output: stressIn, eof: false
							};

							const res = await this.runner.run(genTest);
							if (!res) return;
							else if (res.exitCode!=0) {
								c.lastRun=res; //should be RE
								throw new RunError(`Stress test generator exited with code ${res.exitCode} (i=${xi})`, s.generator);
							}

							const bruteTest: Test = {
								...this.runCfgToTest(),
								interactor: compilation.interactor,
								name: bruteName, dbg: null, prog: brute,
								...await this.mkFileIO(fioDir, stressIn, stressAns),
								stop: cancel.token
							};
							
							const bruteRes = await this.runner.run(bruteTest);
							if (!bruteRes) return;
							else if (bruteRes.verdict!="AC") {
								if (cancel.token.isCancellationRequested) break;
								cancel.cancel();

								c.lastRun=bruteRes;
								await setFrom("inFile", stressIn);
								throw new RunError(`Brute force solver failed (i=${xi})`, s.brute);
							}

							let judge: string|undefined;
							const progTest: Test = {
								...this.runCfgToTest(),
								dbg: null, ...compilation,
								name: c.name, stop: cancel.token, ansFile: stressAns,
								...await this.mkFileIO(fioDir, stressIn, stressOut),
								onJudge(j) { judge=j; },
							};

							const progRes = await this.runner.run(progTest);
							if (!progRes) return;
							else if (progRes.verdict!="AC") {
								if (cancel.token.isCancellationRequested) break;
								cancel.cancel();

								c.lastRun=progRes;
								await setFrom("inFile", stressIn);
								await setFrom("ansFile", stressAns);
								await this.setOutputFrom(i, stressOut, judge);
							}

							this.maxStats(stats, progRes);

							update();
						}
					})).finally(()=>{
						cancel.cancel();
					});

					if (c.lastRun==null) c.lastRun={verdict: "AC", exitCode: 0, ...stats};
				});
			} else {
				this.inputs[i]=new EventEmitter<string>();
				d({dispose: ()=>{
					this.inputs[i].dispose();
					delete this.inputs[i];
				}});

				const test: Test = {
					...this.runCfgToTest(),
					//don't use input/answer files when running generator
					name: runType=="generator" ? genName : c.name,
					dbg: dbgTy, ...compilation, onInput: this.inputs[i].event,
					stop: cancel.token,
					args: runType=="generator"
						? this.runner.evaluateStressArgs(c.stress!.args, Math.floor(Math.random()*c.stress!.maxI))
						: undefined,
					...await this.testIO(i,c)
				};

				d(window.setStatusBarMessage(`Running ${basename(path)} / ${test.name}`))

				this.run.runningTest=i;
				this.upRun();

				d({dispose: ()=>{
					if (this.run.runningTest!=i) return;
					delete this.run.runningTest;
					this.upRun();
				}});

				if (this.cfg.focusTestIO) {
					await commands.executeCommand("cpu.panel.focus");
					await Promise.race([
						new Promise(res=>this.onPanelReady(res)),
						cancelPromise(cancel.token),
						delay(5000).then(()=>{
							throw new Error("Test I/O panel did not open. Disable focus test I/O if you don't want to interact with the program");
						})
					]);
				}

				const res = await this.runner.run(test);
				//no verdict for generator
				if (runType=="generator") c.lastRun=null;
				else if (res) c.lastRun=res;
			}
		}, {cancel});
	}

	shouldShowSource = (x: string) => stat(x).then(x=>x.size<1024*50).catch(()=>null);

	private async reloadTestFile(i: number, c: TestCase, x: "inFile"|"ansFile") {
		const r = c[x]!=undefined && await this.shouldShowSource(c[x]);
		const v = r ? await readFile(c[x]!,"utf-8") : null;
		this.send({ type: "testCaseRead", i, which: x, source: v });

		return r!=null;
	}

	reloadTestSource(i: number) {
		return this.withTest(i, async (c) => {
			const arr: ("inFile"|"ansFile")[] = ["inFile", "ansFile"];
			await Promise.all(arr.map(async x=>{
				//delete paths which no longer exist...
				if (!await this.reloadTestFile(i,c,x)) delete c[x];
			}));
		}, {update:true});
	}

	setSource(i: number, src: string, which: "ansFile"|"inFile") {
		return this.withTest(i, async (c) => {
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

	constructor(private ctx: ExtensionContext, private log: LogOutputChannel,
		private send: (x: MessageFromExt)=>void, public setId: number,
		private onSaveTests: ()=>Promise<void>, private onPanelReady: Event<void>) {

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
			.map((([k,v])=>this.makeTest(this.makeTestCase(k, false, v.in, v.out))));

		this.upTestCase(...ids);
		this.upOrder();
	}

	async init() {
		await this.loadTestSet(this.setId, false);

		const checkers = (await readdir(join(this.ctx.extensionPath, "testlib/checkers")))
			.filter(v=>v.endsWith(".cpp"));

		if (!checkers.includes("wcmp.cpp"))
			throw new Error("wcmp not found");
		this.cfg.checker={type: "default", name: "wcmp.cpp"};

		this.checkers = Object.fromEntries(checkers.map(c=>
			[c,join(this.ctx.extensionPath, "testlib/checkers", c)]
		));

		this.upCfg();
	}

	//not 100% perfect, since cancellation is async
	dispose() {
		this.runner.dispose();
		this.runAllCancel.cancel?.cancel();
		for (const c of Object.values(this.cases))
			c?.cancel?.cancel();
		void this.save();
	}
}