import { CancellationTokenSource } from "vscode-languageclient";
import { Checker, CompileError, defaultRunCfg, MessageFromExt, RunCfg, RunError, TestCase, TestOut } from "./shared";
import { ExtensionContext, WebviewPanel, window, LogOutputChannel, EventEmitter, OpenDialogOptions } from "vscode";
import { Runner, Test } from "./runner";
import { cfg, exists } from "./util";
import { basename, extname, join, resolve } from "node:path";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

const inNames = new Set([".in"]), ansNames = new Set([".out", ".ans"]);
const testCaseFilter: OpenDialogOptions["filters"] = {
	"Answer/input file": [...ansNames.values(), ...inNames.values()]
};

export class TestCases {
	cases: Record<number,{
		tc: TestCase,
		//cancel and busy represent disjoint tasks (long-running vs short updates)
		//e.g. user should be able to change input/outputs while program is compiling
		//kinda messy, but non-cancellable updates should be very fast and unlock quickly
		cancel: CancellationTokenSource|null,
		busy: boolean
	}> = {};
	inputs: Record<number, EventEmitter<string>> = {};
	outputs: Record<number, TestOut> = {};
	tcId: number;

	openCases: Record<number, WebviewPanel> = {};
	runner: Runner;
	runningTest?: number;

	checkers: Record<string,string> = {};
	checker: Checker|null=null;
	cfg: RunCfg = defaultRunCfg;

	fileToCase: Map<string, {case: number, which: "inFile"|"ansFile"}> = new Map();

	tcOrder: number[];

	maxOutputSize=1024*35;

	upCfg() {this.send({type: "updateCfg", cfg: this.cfg});}
	upChecker() {this.send({
		type: "updateChecker",
		checker: this.checker,
		checkers: Object.keys(this.checkers)
	});}

	timeout?: NodeJS.Timeout;
	upTests() {
		if (this.timeout) clearTimeout(this.timeout);
		this.timeout = setTimeout(()=>{
			this.log.info("Saving tests...");
			this.ctx.workspaceState.update("tests", this.cases);
			this.ctx.workspaceState.update("tcOrder", this.tcOrder);
			this.ctx.workspaceState.update("tcId", this.tcId);
		}, 5000);

		this.fileToCase = new Map(Object.entries(this.cases).flatMap(([id,v])=>[
			[v.tc.inFile, {case: Number(id), which: "inFile"}],
			[v.tc.ansFile, {case: Number(id), which: "ansFile"}],
		]).filter(([a,b])=>a!=undefined) as [string, {case: number, which: "inFile"|"ansFile"}][])
	}

	upOrder() {this.send({type: "reorderTests", order: this.tcOrder});}

	upTestCase(...is:number[]) {
		for (const i of is) {
			const c = this.cases[i];
			if (c) c.tc.cancellable=c.cancel!=null ? true : c.busy ? false : null;
		}
			
		this.send({type: "updateTestCases", testCasesUpdated:
			Object.fromEntries(is.map((v): [number, TestCase|null]=>[v, this.cases[v]?.tc ?? null])) });
		this.upTests();
	}

	//update - small update which shouldn't wait for cancellable processes to complete
	//otherwise locks everything
	withTest(i: number, cb: (c: TestCase, disp: (x: {dispose: ()=>void})=>void)=>Promise<void>,
		{cancel, update}: {cancel?: CancellationTokenSource, update?: boolean}={}) {

		const c = this.cases[i];
		if (((!update || cancel!=null) && c.cancel!=null) || c.busy) {
			window.showErrorMessage("Sorry, busy processing this test case. Try again after the current task is finished.")
			return;
		}

		if (cancel) c.cancel=cancel;
		else c.busy=true;

		this.upTestCase(i);

		let disps: {dispose:()=>void}[]=[];
		cb(c.tc,(d)=>disps.push(d)).then(()=>{
			c.tc.err=null;
		}).catch((e) => {
			console.error(e);
			this.log.error(e);

			if (e instanceof CompileError || e instanceof RunError) {
				c.tc.err={type:e instanceof CompileError ? "compile" : "run", err: e};
				window.showErrorMessage(e instanceof CompileError ? `Error compiling ${basename(e.file)}: ${e.err}` : `Error running ${basename(e.file)} on ${c.tc.name}: ${e.err}`);
			} else if (e instanceof Error) {
				window.showErrorMessage(`Error (${c.tc.name}): ${e.message}`);
			} else {
				window.showErrorMessage(`An error occurred (${c.tc.name})`);
			}
		}).finally(() => {
			if (cancel) c.cancel=null;
			else c.busy=false;

			this.upTestCase(i);
			disps.forEach(x=>x.dispose());
		});
	}

	async getTestDir() {
		let testDir = cfg().get<string>("buildDir") ?? null;
		if (testDir && testDir.length==0) testDir=null;
		if (this.ctx.storageUri) testDir=this.ctx.storageUri?.fsPath;
		else if (this.ctx.globalStorageUri) testDir=this.ctx.globalStorageUri?.fsPath;
		else throw new Error("No test directory");

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

	makeTest(name: string, tmp: boolean, inFile?: string, ansFile?: string) {
		this.cases[this.tcId++]={
			tc: {
				inFile, ansFile, name,
				tmpIn: tmp, tmpAns: tmp, cancellable: null, err: null, lastRun: null
			},
			cancel: null,
			busy: false
		};

		this.tcOrder.push(this.tcId-1);
		return this.tcId-1;
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
				if (which=="inFile") c.inFile=inFile, c.tmpIn=true;
				else c.ansFile=ansFile, c.tmpAns=true;
				await writeFile(c[which]!, "");

				v="";
			} else {
				c[which]=path ? resolve(path) : undefined;
				which=="inFile" ? c.tmpIn=false : c.tmpAns=false;
				v = path && await this.shouldShowSource(path) ? await readFile(path,"utf-8") : null;
			}

			this.send({ type: "testCaseRead", i, which, source: v });
		});
	}

	async getOutput(i: number) {
		const bd = this.runner.getBuildDir();
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
			this.tcOrder = this.tcOrder.filter(x=>x!=i);
			this.upOrder();
		});
	}

	runTest(i: number, dbg: boolean, path: string) {
		const cancel = new CancellationTokenSource();
		this.withTest(i, async (c,d) => {
			c.lastRun=null;

			delete this.outputs[i];
			this.send({type: "testCaseOutput", i});

			if (this.checker==null) throw new RunError("No checker set", path);

			d(window.setStatusBarMessage(`Compiling ${basename(path)}...`));
			const prog = await this.runner.compile({
				file: path, cached: true,
				type: dbg ? "debug" : "fast",
				testlib: false, cancel: cancel.token
			});

			//cancelled
			if (prog==null) return;

			d(window.setStatusBarMessage(`Compiling ${this.checker}...`));
			const checker = await this.runner.compile({
				file: this.checker.type=="file" ? this.checker.path : this.checkers[this.checker.name],
				cached: true, type: "fast", testlib: true, cancel: cancel.token
			});

			if (checker==null) return;

			const outPath = await this.getOutput(i);
			let tm: NodeJS.Timeout|null = null;
			d({dispose() { if (tm) clearTimeout(tm); }});

			this.inputs[i]=new EventEmitter<string>();
			d({dispose: ()=>{delete this.inputs[i];}});

			const test: Test = {
				...this.cfg, tc: this.cases[i].tc, dbg,
				prog, checker, output: outPath,
				onInput: this.inputs[i].event,
				cancel,
				onOutput: (x, which) => {
					const o = this.outputs[i] ?? (this.outputs[i]={stderr: "", stdout: "", path: outPath});

					if (which=="judge") {
						o.judge=x;
					} else if (o.stderr.length+o.stdout.length<this.maxOutputSize) {
						const extra = x.length+o.stderr.length+o.stdout.length-this.maxOutputSize;
						if (extra>0) x=x.slice(0,this.maxOutputSize-o.stderr.length-o.stdout.length), o.hiddenSize=extra;
						if (which=="stderr") o.stderr+=x; else o.stdout+=x;
					} else {
						o.hiddenSize!+=x.length;
					}

					this.send({type: "testCaseStream", which, txt: x});

					if (tm==null) tm=setTimeout(()=>{
						this.send({type: "testCaseOutput", i, out: o});
						tm=null;
					}, 350);
				}
			};

			d(window.setStatusBarMessage(`Running ${basename(path)} / ${test.tc.name}`))

			this.runningTest=i;
			this.send({type: "runTest", i});
			d({dispose: ()=>{
				this.runningTest=undefined;
				this.send({type: "runTest"});
			}});

			const res = await this.runner.runOnce(test);
			if (res) c.lastRun=res;

			// mm yes, maximally complicated! need to do this bc timeout will be cancelled right after
			this.send({type: "testCaseOutput", i, out: this.outputs[i]});
		}, {cancel});
	}

	shouldShowSource = (x: string) => stat(x).then(x=>x.size<1024*50).catch(x=>false);

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
		console.log(this.tcOrder,a,b);
		this.tcOrder.splice(b,0,...this.tcOrder.splice(a,1));
		this.upOrder();
	}

	constructor(private ctx: ExtensionContext, private log: LogOutputChannel, private send: (x: MessageFromExt)=>void) {
		this.runner = new Runner(ctx, log);

		const tests = ctx.workspaceState.get<typeof this.cases>("tests");
		if (tests) {
			//cleary busy/cancel status
			this.cases = Object.fromEntries(
				Object.entries(tests).map(([k,v])=>[
					k, {...v,tc:{...v.tc, cancellable: null},cancel:null,busy:false}
				])
			)
		}

		this.tcOrder = ctx.workspaceState.get<number[]>("tcOrder")
			?? Object.keys(this.cases).map(Number);
		this.tcId = ctx.workspaceState.get<number>("tcId") ?? 0;
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

			isIn ? rec[name].in=p : rec[name].out=p;
		}

		const ids = Object.entries(rec)
			.toSorted((([a,b],[c,d])=>{
				const l = Math.min(a.length,c.length);
				return a.slice(0,l)<c.slice(0,l) ? -1 : 1;
			}))
			.map((([k,v])=>this.makeTest(k, false, v.in, v.out)));
		this.upTestCase(...ids);
		this.upOrder();
	}

	async init() {
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

	dispose() {
		for (const c of Object.values(this.cases))
			c?.cancel?.cancel();
		for (const v of Object.values(this.openCases))
			v.dispose();
	}
}