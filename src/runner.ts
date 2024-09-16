import { CancellationToken, EventEmitter, ExtensionContext, ProcessExecution, Task, tasks, TaskScope, Uri, workspace, extensions, debug, Event, Disposable, LogOutputChannel, DebugSession, CancellationError, TaskExecution } from "vscode";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { cancelPromise, cfg, delay, exists } from "./util";
import { execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import pidusage from "pidusage";
import { BaseLanguageClient } from "vscode-languageclient";
import { CompileError, RunError, TestResult } from "./shared";
import {parse} from "shell-quote";
import Mustache from "mustache";

//https://github.com/clangd/vscode-clangd/blob/master/api/vscode-clangd.d.ts
interface ClangdApiV1 { languageClient: BaseLanguageClient };
interface ClangdExtension { getApi(version: 1): ClangdApiV1; };

type CompileRequest = {
	file: string, cached: boolean,
	type: "fast"|"debug",
	testlib: boolean,
	stop: CancellationToken
};

type Cache = {
	dir: string,
	entries: string[]
};

export type Test = {
	output: string, prog: string,
	checker?: string, args?: string,
	name: string,
	inFile?: string,
	ansFile?: string,
	dbg: boolean,
	onOutput?: (x: string, which: "stderr"|"stdout")=>void,
	onJudge?: (judge: string)=>void,
	onInput?: Event<string>,
	stop: CancellationToken,
	tl?: number, ml?: number, eof: boolean,
	cwd?: string
};

function kill(pid: number) {
	try {
		process.kill(pid);
		return true;
	} catch (e) {
		//not sure why closed isn't flipped
		//maybe checker/program exit super quickly or nodejs takes a while before it can
		//switch execution context to handle exit event...
		if (typeof e=="object" && e && "code" in e && e.code=="ESRCH") return true;
		else return false;
	}
}

type Program = {
	dispose: ()=>void, write: (s: string)=>void, resume: ()=>void,
	exitCode: number|null, pid: number, closed: boolean,
	closePromise: Promise<void>
};

type ProgramStartOpts = {
	prog: string, cwd?: string, args?: string,
	stdin?: string, stdout?: string,
	eof: boolean,
	doStop?: boolean,
	runerr: (msg: string, src?: Error)=>RunError,
	onOutput?: (x: string, which:"stdout"|"stderr")=>void
};

function attachError(runerr: ProgramStartOpts["runerr"],
	x: {once: (type: "error", listener: (e: Error)=>void)=>void}, msg: string) {
	x.once("error", (err) => runerr(msg, err));
};

function startChildProgram({
	prog,stdin,stdout,doStop,runerr,onOutput,eof,cwd,args
}: ProgramStartOpts): Program {
	//sorry we're too poor for ptrace :)
	const cp = spawn(prog, args!=undefined ? parse(args).map(x=>{
		if (typeof x=="object") {
			if ("comment" in x) return x.comment;
			if (x.op=="glob") return x.pattern;
			else return x.op;
		} else {
			return x;
		}
	}) : [], { cwd });

	if (doStop && !cp.kill("SIGSTOP")) throw runerr("Couldn't pause process");
	
	attachError(runerr, cp, `Failed to start program ${prog}`);

	//usually spawning is instant and we need to register handlers immediately to capture output
	//move to once spawn if this causes issues
	if (cp.pid==null || cp.stdout==null || cp.stderr==null)
		throw runerr("Process missing PID, stdout, or stderr");

	if (onOutput!=undefined) {
		cp.stdout.on("data", (v:string|Buffer) => onOutput?.(v.toString("utf-8"),"stdout"));
		cp.stderr.on("data", (v:string|Buffer) => onOutput?.(v.toString("utf-8"),"stderr"));
	}

	if (stdout) {
		const write = createWriteStream(stdout);
		attachError(runerr, write, "Failed to open output file");
		cp.stdout.pipe(write);
	}

	if (stdin) {
		const inp = createReadStream(stdin, "utf-8");
		attachError(runerr, inp, "Failed to open input file");
		inp.pipe(cp.stdin, {end: eof});
	}

	const o: Program = {
		exitCode: null,
		closed: false,
		pid: cp.pid,
		resume() {
			if (!cp.kill("SIGCONT"))
				throw runerr("Couldn't resume process");
		},
		dispose() {
			if (!this.closed && !kill(this.pid))
				throw runerr("Failed to kill process");
		},
		write(s) { cp.stdin.write(s, (err)=>{
			if (err) runerr("Couldn't write to process", err);
		}); },
		closePromise: new Promise((res) => cp.once("close", (v) => {
			o.closed=true;
			o.exitCode=v;
			res();
		}))
	};

	return o;
}

export class Runner {
	private cacheLimit=20;
	private cache: Cache;
	// wait for promise when matching active
	private activeCompilations: Record<string, Promise<void>> = {};

	constructor(private ctx: ExtensionContext, private log: LogOutputChannel) {
		this.cache=ctx.globalState.get<Cache>("cache") ?? {entries: [], dir: this.getBuildDir()};
	}

	async updateCache() { await this.ctx.globalState.update("cache", this.cache); }

	async clearCompileCache() {
		for (const ent of this.cache.entries) {
			await rm(join(this.cache.dir, ent), {force: true});
		}

		this.cache.entries=[]; this.cache.dir=this.getBuildDir();
		await this.updateCache();
	}

	getBuildDir() {
		const buildDir = cfg().get<string>("buildDir");
		if (buildDir && buildDir.length>0) return buildDir;
		if (this.ctx.storageUri) return join(this.ctx.storageUri?.fsPath, "build");
		else if (this.ctx.globalStorageUri) return join(this.ctx.globalStorageUri?.fsPath, "build");
		else throw new Error("No build directory");
	}

	getCwd(file: string) {
		const folder = workspace.getWorkspaceFolder(Uri.file(file))?.uri?.fsPath;
		return folder ?? dirname(file);
	}

	async compile({file,cached,type,testlib,stop}: CompileRequest): Promise<string> {
		if (!workspace.isTrusted) throw new CompileError("Workspace is not trusted", file);
		if (!await exists(file)) throw new CompileError("Program not found", file);

		const config = cfg();
		const buildDir = this.getBuildDir();
		await mkdir(buildDir, {recursive: true});

		if (this.cache.dir!=buildDir) {
			await this.clearCompileCache();
		}

		const hash = createHash("md5");
		hash.update(file);
		const fileSrc = await readFile(file, "utf-8");
		hash.update(fileSrc);
		
		let compiler: string;
		switch (process.platform) {
			case "win32": compiler="cl"; break;
			case "linux": compiler="g++"; break;
			case "darwin": compiler="clang++"; break;
			default: throw new CompileError("Unsupported platform", file);
		}

		const compilerSetting = config.get<string>("compiler");
		if (compilerSetting!=undefined && compilerSetting.length>0) compiler=compilerSetting;

		const args = config.get<string[]>("compileArgs.common") ?? [];
		args.push(...config.get<string[]>(`compileArgs.${type}`) ?? [])

		if (testlib) args.unshift("-isystem", join(this.ctx.extensionPath, "testlib"));

		for (const arg of args) hash.update(arg);

		const hashStr = hash.digest().toString("hex")

		if (hashStr in this.activeCompilations)
			await this.activeCompilations[hashStr];

		let exec: TaskExecution;
		const doCompile = async () => {
			const cwd = this.getCwd(file);

			const clangd = extensions.getExtension<ClangdExtension>("llvm-vs-code-extensions.vscode-clangd");

			const setting: Record<string, {workingDirectory: string, compilationCommand: string[]}> = {
				[file]: {compilationCommand: args, workingDirectory: cwd}
			};

			if (clangd?.isActive) {
				const lsp = clangd.exports.getApi(1).languageClient;
				
				await lsp.start();
				if (lsp.isRunning())
					//can't use DidChangeConfigurationNotification.type for arcane reasons
					//you don't want to know
					await lsp.sendNotification("workspace/didChangeConfiguration", {
						settings: { compilationDatabaseChanges: setting }
					});
			}

			const path = join(buildDir,hashStr);
			const cacheI = this.cache.entries.indexOf(hashStr);
			if (cacheI!=-1 && await exists(path)) {
				this.cache.entries.splice(cacheI,1);

				if (cached) {
					this.log.info(`Cache hit for ${file}, using cached program (hash ${hashStr})`);
					this.cache.entries.push(hashStr);
					await this.updateCache()
					return path;
				}
			}

			args.unshift(file, "-o", path);
			const proc = new ProcessExecution(compiler, args, { cwd });

			const name = basename(file);
			const task = new Task({ type: "process" }, TaskScope.Workspace,
				`Compiling ${name}`, "Competitive Programming", proc, ["$gcc"]);

			const prom = new Promise<number|undefined>((res) => tasks.onDidEndTaskProcess((e) => {
				if (e.execution.task==task) {
					res(e.exitCode);
				}
			}));

			exec = await tasks.executeTask(task);
			//um depending on how this is executed ig task could end before below, not sure how vscode queues the task and shit or why the above is a promise.
			const res = await Promise.race([
				delay(60_000).then(():"timeout"=>"timeout"),
				cancelPromise(stop), prom
			]);

			if (res=="timeout") {
				throw new CompileError(`Compilation of ${name} timed out`, file);
			} else if (res!=0 || !await exists(path)) {
				throw new CompileError(`Failed to compile ${name}`, file);
			}

			while (this.cache.entries.length>=this.cacheLimit) {
				const old = this.cache.entries.shift()!;
				await rm(join(buildDir,old), {force: true});
			}

			this.log.info(`Adding compiled output for ${file} to cache (hash ${hashStr})`);
			this.cache.entries.push(hashStr);
			await this.updateCache();
			return path;
		};

		const prom = doCompile().finally(()=>exec?.terminate());
		this.activeCompilations[hashStr] = prom.then(()=>{}).catch(()=>{});
		return await prom;
	}

	evaluateStressArgs(args: string, i: number) { return Mustache.render(args, {i}); }

	async run({
		output,prog,checker,name,inFile,ansFile,dbg,stop,onInput,onOutput,onJudge,tl,ml,eof,cwd,args
	}: Test): Promise<TestResult|null> {
		cwd ??= join(prog,"..");
		if (tl!=undefined) tl*=1000; // in ms
		let pid:number|null=null;

		const log = (s: string) =>
			this.log.appendLine(`${name} | ${prog} | ${pid!=null ? pid : "no PID"} | ${s}`);
		const runerr = (err: string, src?: Error) => {
			const x=new RunError(err, prog, src);
			errEvent.fire(x); return x;
		};

		if (!workspace.isTrusted) throw runerr("Workspace is not trusted");

		const cbs: Disposable[]=[];
		let cpuTime:number|null=null, mem:number|null=null, wallTime: number|null=null,
			dbgSession: DebugSession|null=null, dbgStarted: boolean=false;

		const errEvent = new EventEmitter<RunError>();
		const limitExceeded = new EventEmitter<"ML"|"TL">();
		cbs.push(errEvent, limitExceeded);

		const cancelPromise = new Promise<void>(stop.onCancellationRequested).then(()=>{
			throw new CancellationError();
		});

		let stopUsageLoop = false;

		const onErrorPromise = new Promise<RunError>(errEvent.event).then(x=>{ throw x; });
		let debugSessionEndPromise = Promise.resolve();
		const timeout = async (x: number, err: string) => {
			await delay(x);
			throw runerr(err);
		};

		try {
			const cp = startChildProgram({
				prog, stdin: inFile, stdout: output, runerr,
				doStop: dbg, onOutput, eof, args, cwd
			});

			pid=cp.pid;
			cbs.push(cp);

			if (dbg) {
				log("Starting debugger");

				const codelldb = extensions.getExtension("vadimcn.vscode-lldb")!;
				if (!codelldb.isActive) await codelldb.activate();

				cbs.push(debug.onDidStartDebugSession((x)=>{
					if (!dbgStarted) {
						dbgSession=x; dbgStarted=true;
						log("Debug session started");
					}
				}));

				//attaching resumes program
				if (!await debug.startDebugging(workspace.getWorkspaceFolder(Uri.file(prog)), {
					type: "lldb", request: "attach",
					name: "Attach", program: prog, pid: cp.pid,
					expressions: "native"
				}).then(x=>x, (reason)=>{
					runerr("Couldn't start debugger", reason instanceof Error ? reason : undefined);
					return false;
				})) {
					log("Debugging cancelled, stopping program");
					return null;
				}

				debugSessionEndPromise = new Promise<void>(res=>
					cbs.push(debug.onDidTerminateDebugSession((e)=>{
						if (e.id==dbgSession?.id) {
							dbgSession=null; res();
							log("Debug session ended");
						}
					}))
				);
			}

			void (async () => {
				while (!stopUsageLoop) {
					try {
						const usage = await pidusage(cp.pid);
						wallTime=usage.elapsed; cpuTime=usage.ctime; mem=usage.memory/1024/1024;

						if (tl!=undefined && wallTime>tl) limitExceeded.fire("TL");
						else if (ml!=undefined && mem>ml) limitExceeded.fire("ML");

						await delay(150);
					} catch (e) {
						if (cp.closed) break;
						runerr("Couldn't get process usage", e instanceof Error ? e : undefined);
					}
				}
			})();

			if (onInput) cbs.push(onInput((inp)=>{
				if (stop.isCancellationRequested) return;
				cp.write(inp);
			}));

			const res = await Promise.race([
				cp.closePromise, cancelPromise, onErrorPromise,
				new Promise(limitExceeded.event)
			]);

			if (!cp.closed) {
				if (dbg && dbgSession) {
					log("Waiting for debug session to end");
					await Promise.race([ debugSessionEndPromise, cancelPromise, onErrorPromise ]);
				}

				cp.dispose();
			}

			const ret = (v: TestResult["verdict"]): TestResult =>
				({verdict: v, wallTime, cpuTime, mem, exitCode: cp.exitCode});

			if (res=="ML" || res=="TL") return ret(res);
			else if (cp.exitCode!=0) return ret("RE");

			if (inFile && ansFile && checker) {
				log("Checking output...");
				const x = execFile(checker, [inFile, output, ansFile], { cwd }, (err, stdout, stderr) => {
					let jout = x.exitCode!=null ? `Checker exited with code ${x.exitCode}` : `Checker was killed`;
					if (stdout.length>0) jout+=`\n${stdout}`;
					if (stderr.length>0) jout+=`\n${stderr}`;

					onJudge?.(jout);
				});

				attachError(runerr, x, "Failed to start checker");

				let checkerClosed=false;
				cbs.push({dispose(){
					if (!checkerClosed && !kill(x.pid!))
						throw runerr("Failed to kill checker");
				}});

				await Promise.race([
					new Promise<void>((res)=>x.once("close", ()=>{
						checkerClosed=true; res();
					})),
					cancelPromise, onErrorPromise,
					timeout(60_000, "Checker timed out")
				]);

				if (x.exitCode!=0) return ret("WA");
			}

			return ret("AC");
		} catch (e) {
			if (e instanceof CancellationError) return null;
			throw e;
		} finally {
			stopUsageLoop=true;
			errEvent.dispose();
			if (dbg && dbgSession) {
				log("Stopping debugger");
				await debug.stopDebugging(dbgSession);
			}

			const errs: Error[] = [];
			cbs.forEach(x=>{
				try {
					x.dispose()
				} catch (e) {
					if (e instanceof Error) errs.push(e);
				}
			});

			// eslint-disable-next-line no-unsafe-finally
			if (errs.length==1) throw errs[0];
			// eslint-disable-next-line no-unsafe-finally
			else if (errs.length>0) throw new AggregateError(errs);
		}
	}
}