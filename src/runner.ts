import { CancellationToken, EventEmitter, ExtensionContext, ProcessExecution, Task, tasks, TaskScope, Uri, workspace, debug, Event, Disposable, LogOutputChannel, DebugSession, CancellationError, TaskExecution, window } from "vscode";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { argsToArr, cancelPromise, delay, exists } from "./util";
import { execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import pidusage from "pidusage";
import { CompileError, RunError, TestResult } from "./shared";
import Mustache from "mustache";
import { Language, LanguageProvider } from "./languages";
import { Readable, Writable } from "node:stream";
import { platform } from "node:process";

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

export type CompileResult = {
	lang: Language,
	source: string,
	prog: string
};

export type Test = {
	output: string,
	interactor?: CompileResult,
	prog: CompileResult,
	checker?: CompileResult, args?: string,
	name: string,
	inFile?: string,
	noStdio?: boolean,
	ansFile?: string,
	dbg: "normal"|"interactor"|null,
	onOutput?: (x: string, which: "stderr"|"stdout"|"interaction"|"input")=>void,
	onJudge?: (judge: string)=>void,
	onInput?: Event<string>,
	stop: CancellationToken,
	tl?: number, ml?: number, eof: boolean,
	cwd?: string,
	end?: ()=>Promise<void>
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
	exitCode: number|null, pid: number|null, closed: boolean,
	closePromise: Promise<void>, spawnPromise: Promise<number>,
	stdin: Writable, stdout: Readable
};

type ProgramStartOpts = {
	prog: string, cwd?: string, args?: string[],
	stdin?: string, stdout?: string,
	pipeStdin?: Readable, pipeStdout?: Writable,
	eof: boolean,
	doStop?: boolean,
	runerr: (msg: string, src?: Error)=>RunError,
	onOutput?: (x: string, which:"stdout"|"stderr"|"input")=>void
};

function attachError(runerr: ProgramStartOpts["runerr"],
	x: {once: (type: "error", listener: (e: Error)=>void)=>void}, msg: string) {
	x.once("error", (err) => runerr(msg, err));
};

async function startChildProgram({
	prog,stdin,stdout,doStop,runerr,onOutput,eof,cwd,args,pipeStdin,pipeStdout
}: ProgramStartOpts): Promise<Program> {
	const suspend = process.platform=="win32" ? (await import("ntsuspend")) : null;

	const cp = spawn(prog, args, { cwd });

	//sorry we're too poor for ptrace :)
	if (doStop && process.platform!="win32" && !cp.kill("SIGSTOP"))
		throw runerr("Couldn't pause process");

	attachError(runerr, cp, `Failed to start program ${prog}`);

	const o: Omit<Program&{handle: ()=>number}, "spawnPromise">&{spawnPromise?: Program["spawnPromise"]}  = {
		handle() {
			if (o.closed && cp.pid!=undefined) {
				kill(cp.pid);
				throw runerr("Process killed before spawning");
			}

			if (cp.pid!=undefined) o.pid=cp.pid;
			else throw runerr("PID of process not set");

			if (doStop && suspend!=null) suspend.suspend(cp.pid);

			if (onOutput!=undefined) {
				cp.stdout.on("data", (v:string|Buffer) => onOutput?.(v.toString("utf-8"),"stdout"));
				cp.stderr.on("data", (v:string|Buffer) => onOutput?.(v.toString("utf-8"),"stderr"));
			}

			if (stdout) {
				const write = createWriteStream(stdout);
				attachError(runerr, write, "Failed to open output file");
				cp.stdout.pipe(write);
			}

			if (pipeStdout) cp.stdout.pipe(pipeStdout);

			if (stdin) {
				const inp = createReadStream(stdin, "utf-8");
				attachError(runerr, inp, "Failed to open input file");
				inp.on("data", (v:string|Buffer) => onOutput?.(v.toString("utf-8"),"input"));
				inp.pipe(cp.stdin, {end: eof});
			}

			if (pipeStdin) pipeStdin.pipe(cp.stdin);

			return cp.pid;
		},
		exitCode: null,
		closed: false,
		pid: null,
		stdin: cp.stdin, stdout: cp.stdout,
		resume() {
			if (!doStop || cp.pid==null) return;

			if (suspend!=null) suspend.resume(cp.pid);
			else if (!cp.kill("SIGCONT"))
				throw runerr("Couldn't resume process");
		},
		dispose() {
			if (!this.closed && this.pid!=null && !kill(this.pid))
				throw runerr("Failed to kill process");
			this.closed=true;
		},
		write(s) { cp.stdin.write(s, (err)=>{
			if (err) runerr("Couldn't write to process", err);
		}); },
		closePromise: new Promise((res) => cp.once("close", (v) => {
			o.closed=true;
			o.exitCode=v??cp.exitCode;
			res();
		}))
	};

	//sorry
	//this should be a class or something that can actually reference itself on construction
	//but fuck that!
	//i swear this would look sane without typescript :)

	//usually spawning is instant and we need to register handlers immediately to capture output
	const launched = cp.pid==null || cp.stdout==null || cp.stderr==null;
	o.spawnPromise=!launched ? new Promise(res=>{
		cp.once("spawn", ()=>res(o.handle()));
	}) : Promise.resolve(o.handle());

	return o as Program;
}

export class Runner {
	//needs to be at least large enough to store interactor, generator, checker, brute force, and main program
	private cacheLimit=20;
	private cache: Cache;
	// wait for promise when matching active
	private activeCompilations: Record<string, Promise<void>> = {};
	languages = new LanguageProvider();

	constructor(private ctx: ExtensionContext, private log: LogOutputChannel) {
		this.cache=ctx.globalState.get<Cache>("cache") ?? {entries: [], dir: this.getBuildDir()};
	}

	async updateCache() { await this.ctx.globalState.update("cache", this.cache); }

	async rmCachedProgram(prog: string) {
		await rm(join(this.cache.dir, prog), {force: true, recursive: true});
		const dsym = join(this.cache.dir,`${prog}.dSYM`);
		if (platform=="darwin" && await exists(dsym))
			await rm(dsym, {force: true, recursive: true});
	}

	async clearCompileCache() {
		for (const ent of this.cache.entries) await this.rmCachedProgram(ent);

		this.cache.entries=[]; this.cache.dir=this.getBuildDir();
		await this.updateCache();
	}
	
	getBuildDir() {
		const buildDir = workspace.getConfiguration("cpu.buildDir").get<string>("");
		if (buildDir && buildDir.length>0) return buildDir;
		if (this.ctx.storageUri) return join(this.ctx.storageUri?.fsPath, "build");
		else if (this.ctx.globalStorageUri) return join(this.ctx.globalStorageUri?.fsPath, "build");
		else throw new Error("No build directory");
	}

	getCwd(file: string) {
		const folder = workspace.getWorkspaceFolder(Uri.file(file))?.uri?.fsPath;
		return folder ?? dirname(file);
	}

	fileLoaded: Record<string,boolean> = {};
	async loadFile(file: string) {
		const language = this.languages.getLanguage(file);
		if (language?.load && !this.fileLoaded[file]) {
			await language.load({extPath: this.ctx.extensionPath, source: file, cwd: this.getCwd(file)});
			this.fileLoaded[file]=true;
		}
	}

	async compile({file,cached,type,testlib,stop}: CompileRequest): Promise<CompileResult> {
		if (!workspace.isTrusted) throw new CompileError("Workspace is not trusted", file);
		if (!await exists(file)) throw new CompileError("Program not found", file);
		const language = this.languages.getLanguage(file);
		if (language==null) throw new CompileError(`Unrecognized extension ${extname(file)}`, file);
		if (language.compile==undefined) return {prog: file, lang: language, source: file};

		const buildDir = this.getBuildDir();
		await mkdir(buildDir, {recursive: true});

		if (this.cache.dir!=buildDir) {
			await this.clearCompileCache();
		}

		const hash = createHash("md5");
		hash.update(file);
		const fileSrc = await readFile(file, "utf-8");
		hash.update(fileSrc);

		language.compileHash(hash, type);

		const hashStr = hash.digest().toString("hex");
		const path = join(buildDir, process.platform=="win32" ? `${hashStr}.exe` : hashStr);

		if (hashStr in this.activeCompilations)
			await this.activeCompilations[hashStr];

		let exec: TaskExecution|undefined;
		const doCompile = async () => {
			let args: string[];
			try {
				args=await language.compile!({
					extPath: this.ctx.extensionPath, prog: path, source: file, testlib, type
				});
			} catch (e) {
				if (e instanceof Error) throw new CompileError(e.message, file);
				else throw new CompileError("Failed to compile", file);
			}

			const cwd = this.getCwd(file);

			if (language.load) {
				await language.load({
					extPath: this.ctx.extensionPath,
					source: file, cwd, testlib, type
				});

				this.fileLoaded[file]=true;
			}

			const cacheI = this.cache.entries.indexOf(hashStr);
			if (cacheI!=-1 && cached) {
				this.cache.entries.splice(cacheI,1);

				if (await exists(path)) {
					this.log.info(`Cache hit for ${file}, using cached program (hash ${hashStr})`);
					this.cache.entries.push(hashStr);
					await this.updateCache()
					return path;
				}
			}

			const proc = new ProcessExecution(args[0], args.slice(1), { cwd });

			const name = basename(file);
			const task = new Task({ type: "process" }, TaskScope.Workspace,
				`Compiling ${name}`, "Competitive Programming", proc, ["$gcc"]);

			const prom = new Promise<number|undefined>((res) => tasks.onDidEndTaskProcess((e) => {
				if (e.execution.task==task) {
					res(e.exitCode);
				}
			}));

			if (window.terminals.length==0) window.createTerminal();

			exec = await tasks.executeTask(task);
			//um depending on how this is executed ig task could end before below, not sure how vscode queues the task and shit or why the above is a promise.
			const res = await Promise.race([
				delay(60_000).then(():"timeout"=>"timeout"),
				cancelPromise(stop), prom
			]);

			if (res=="timeout") {
				throw new CompileError(`Compilation of ${name} timed out`, file);
			} else if (res!=0) {
				throw new CompileError(`Failed to compile ${name} (nonzero exit code)`, file);
			} else if (!await exists(path)) {
				throw new CompileError(`Failed to compile ${name} (file not found)`, file);
			}

			while (this.cache.entries.length>=this.cacheLimit) {
				const old = this.cache.entries.shift()!;
				await this.rmCachedProgram(old);
			}

			this.log.info(`Adding compiled output for ${file} to cache (hash ${hashStr})`);
			this.cache.entries.push(hashStr);
			await this.updateCache();
			return path;
		};

		const prom = doCompile().finally(()=>{
			exec?.terminate();
		});

		this.activeCompilations[hashStr] = prom.then(()=>{}).catch(()=>{});
		return {prog: await prom, lang: language, source: file};
	}

	evaluateStressArgs(args: string, i: number) { return Mustache.render(args, {i}); }

	async run({
		output,prog,checker,name,inFile,ansFile,interactor,noStdio,
		dbg,stop,onInput,onOutput,onJudge,tl,ml,eof,cwd,args,end
	}: Test): Promise<TestResult|null> {
		cwd ??= this.getCwd(prog.source);
		if (tl!=undefined) tl*=1000; // in ms
		let pid:number|null=null;

		const cbs: Disposable[]=[];
		const errEvent = new EventEmitter<RunError>();
		const limitExceeded = new EventEmitter<"ML"|"TL">();
		cbs.push(errEvent, limitExceeded);

		//utilities
		const log = (s: string) =>
			this.log.appendLine(`${name} | ${prog.prog} | ${pid!=null ? pid : "no PID"} | ${s}`);

		const runerr = (err: string, src?: Error) => {
			const x=new RunError(err, prog.prog, src);
			errEvent.fire(x);
			return x;
		};

		const timeout = async (x: number, err: string) => {
			await delay(x);
			throw new RunError(err,prog.prog);
		};

		let cpuTime:number|null=null, mem:number|null=null, wallTime: number|null=null,
			dbgSession: DebugSession|null=null, dbgStarted: boolean=false;

		const cancelPromise = new Promise<void>(stop.onCancellationRequested).then(()=>{
			throw new CancellationError();
		});

		let stopUsageLoop = false;

		const onErrorPromise = new Promise<RunError>(errEvent.event).then(x=>{ throw x; });
		let debugSessionEndPromise = Promise.resolve();

		const getArgs = async (x: CompileResult, argsArr: string[], dbg: boolean) => {
			try {
				if (x.lang.run!=undefined) {
					return [...await x.lang.run({
						prog: x.prog, source: x.source, dbg
					}), ...argsArr];
				} else {
					return [x.prog, ...argsArr];
				}
			} catch (e) {
				if (e instanceof Error) throw runerr("Error getting arguments", e);
				throw e;
			}
		};

		try {
			if (dbg && prog.lang.debug==undefined) throw runerr("This language does not support debugging");
			if (!workspace.isTrusted) throw runerr("Workspace is not trusted");
			if (dbg=="interactor" && interactor==undefined) throw runerr("No interactor specified to debug");
			if (interactor!=undefined && noStdio) throw runerr("Can't use interactor without standard input/output");

			const [progArg0, ...progArgs] = await getArgs(prog, args!=undefined ? argsToArr(args) : [], dbg=="normal");

			log("Starting program");
			const cp = await startChildProgram({
				prog: progArg0, args: progArgs,
				stdin: interactor==undefined && !noStdio ? inFile : undefined,
				stdout: interactor==undefined && !noStdio ? output : undefined,
				runerr, doStop: dbg=="normal" && prog.lang.stopOnDebug,
				onOutput, eof, cwd
			});

			cbs.push(cp);

			let interactorProg: Program|undefined;
			if (interactor!=undefined) {
				const [intArg0, ...intArgs] = await getArgs(interactor, [inFile ?? "", output], dbg=="interactor")
				log("Starting interactor");
				interactorProg = await startChildProgram({
					prog: intArg0, args: intArgs,
					pipeStdin: cp.stdout, pipeStdout: cp.stdin, runerr,
					doStop: dbg=="interactor" && interactor.lang.stopOnDebug,
					onOutput: onOutput==undefined ? undefined : (x,w)=>{
						onOutput(x,w=="stdout" ? "interaction" : "stderr");
					},
					eof: false, cwd
				});
			}

			if (interactorProg) cbs.push(interactorProg);

			pid = await Promise.race([
				cancelPromise, onErrorPromise, cp.spawnPromise,
				timeout(10_000, "Process took >10s to spawn")
			]);

			let interactorPid: number|null=null;
			if (interactorProg) {
				interactorPid = await Promise.race([
					cancelPromise, onErrorPromise,
					interactorProg.spawnPromise, timeout(10_000, "Interactor took >10s to spawn")
				]);
			}

			if (dbg) {
				//interactor undefined-ness checked above
				const launchCfg = await Promise.race([
					cancelPromise, onErrorPromise, prog.lang.debug!({ //debug may wait for port to open and stuff
						prog: dbg=="interactor" ? interactor!.prog : prog.prog,
						pid: dbg=="interactor" ? interactorPid! : pid
					})
				]);

				log("Starting debugger");

				cbs.push(debug.onDidStartDebugSession((x)=>{
					if (!dbgStarted) {
						dbgSession=x; dbgStarted=true;
						log("Debug session started");
					}
				}));

				//attaching resumes program
				if (!await debug.startDebugging(workspace.getWorkspaceFolder(Uri.file(prog.source)), launchCfg)
					.then(x=>x, (reason)=>{
						runerr("Couldn't start debugger", reason instanceof Error ? reason : undefined);
						return false;
					})
				) {
					log("Debugging cancelled, stopping program");
					return null;
				}

				if (dbg=="interactor") interactorProg!.resume();
				else cp.resume();

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
						if (pid!=null) {
							const usage = await pidusage(pid);
							wallTime=usage.elapsed; cpuTime=usage.ctime;
							mem=Math.max(mem ?? 0,usage.memory/1024/1024);

							if (tl!=undefined && wallTime>tl) limitExceeded.fire("TL");
							else if (ml!=undefined && mem>ml) limitExceeded.fire("ML");
						}

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
				Promise.all([cp.closePromise, interactorProg ? interactorProg.closePromise : Promise.resolve()]),
				cancelPromise, onErrorPromise,
				new Promise(limitExceeded.event)
			]);

			if (((interactorProg && !interactorProg.closed) || !cp.closed) && dbgSession) {
				log("Waiting for debug session to end before killing processes");
				await Promise.race([ debugSessionEndPromise, cancelPromise, onErrorPromise ]);
			}

			cp.dispose();
			interactorProg?.dispose();

			const ret = (v: TestResult["verdict"]): TestResult =>
				({verdict: v, wallTime, cpuTime, mem, exitCode: cp.exitCode});

			if (res=="ML" || res=="TL") return ret(res);
			else if (interactorProg && interactorProg.exitCode!=0) return ret("INT");
			else if (cp.exitCode!=0) return ret("RE");

			if (inFile && ansFile && checker) {
				log("Checking output...");
				const [checkerArg0, ...checkerArgs] = await getArgs(checker, [inFile, output, ansFile], false);
				const x = execFile(checkerArg0, checkerArgs, { cwd }, (err, stdout, stderr) => {
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

			await end?.();
		}
	}

	dispose() {
		this.languages.dispose();
	}
}