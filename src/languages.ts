import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { DebugConfiguration, Disposable, extensions, workspace, WorkspaceConfiguration } from "vscode";
import { argsToArr, portInUse, delay } from "./util";
import { Hash } from "node:crypto";

export type LanguageCompileOpts = {
	extPath: string,
	prog: string, source: string,
	testlib: boolean, type: "fast"|"debug"
};

export type LanguageRunOpts = {
	source: string, prog: string, dbg: boolean
};

export type LanguageDebugOpts = {
	pid: number, prog: string
};

export type LanguageConfig = {
	compiler?: string,
	runtime?: string,
	commonArgs?: string,
	fastArgs?: string,
	debugArgs?: string
};

export type LanguagesConfig = Record<string,LanguageConfig>;

export abstract class Language {
	abstract name: string;
	stopOnDebug: boolean=false;
	abstract exts: string[];

	protected get cfg(): LanguageConfig { return this.cfgs[this.name]; }
	constructor(protected cfgs: LanguagesConfig) {}

	getArgs(ty: "fast"|"debug"): string[] {
		return [this.cfg.commonArgs, this.cfg[`${ty}Args`]]
			.flatMap(v=> v ? argsToArr(v) : []);
	}

	compileHash(x: Hash, ty: "fast"|"debug") {
		x.update(this.cfg.commonArgs??"");
		x.update(this.cfg[`${ty}Args`]??"");
		x.update(this.cfg.compiler??"");
	}

	compile?: (x: LanguageCompileOpts)=>Promise<string[]>;
	run?: (x: LanguageRunOpts)=>Promise<string[]>;
	debug?: (x: LanguageDebugOpts)=>Promise<DebugConfiguration>;
};

async function existsInPath(name: string): Promise<boolean> {
	try {
		await promisify(execFile)(process.platform=="win32" ? "where" : "whereis", [name], {shell: true});
		return true;
	} catch {
		return false;
	}
}

async function waitForPort(port: number) {
	for (let i=0; i<10; i++) {
		if (await portInUse(port)) return true;
		await delay(300);
	}

	return false;
}

class CPP extends Language {
	compiler: string|null=null;
	name="c++";
	stopOnDebug=true;
	exts=["cpp","cxx","cc","c++"];

	compile=async ({extPath, prog, source, testlib, type}: LanguageCompileOpts): Promise<string[]> => {
		if (this.cfg.compiler!=undefined) this.compiler=this.cfg.compiler;
		else if (this.compiler==null) {
			if (await existsInPath("clang++")) this.compiler="clang++";
			else if (await existsInPath("g++")) this.compiler="g++";
			else throw new Error("G++ or Clang not found. Try setting a compiler in settings");
		}

		return [this.compiler, source, ...testlib ? ["-isystem", join(extPath, "testlib")] : [], "-o", prog, ...this.getArgs(type)];
	};

	debug=async ({pid, prog}: LanguageDebugOpts) => {
		if (extensions.getExtension("vadimcn.vscode-lldb")==undefined)
			throw new Error("Install CodeLLDB to debug C++");

		return {
			type: "lldb", request: "attach",
			name: "Attach", program: prog,
			pid, expressions: "native"
		};
	};
}

class Java extends Language {
	name="java";
	exts=["java"];
	debugPort=5005;

	compile=async ({prog, source, type}: LanguageCompileOpts): Promise<string[]> => {
		await mkdir(prog, {recursive:true});
		return [this.cfg.compiler ?? "javac", source, "-d", prog, ...this.getArgs(type)];
	};

	run=async ({source, prog, dbg}: LanguageRunOpts): Promise<string[]> => {
		const name = basename(source).slice(0,-extname(source).length);
		return [this.cfg.runtime ?? "java",
			...dbg ? [`-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,quiet=y,address=${this.debugPort}`] : [],
			 "-cp", prog, name];
	};

	debug=async ()=>{
		if (!await waitForPort(this.debugPort))
			throw new Error("Java debug agent failed to start");

		return {
			name: "Attach",
			type: "jdk", request: "attach",
			hostName: "localhost", port: this.debugPort.toString(),
			timeout: "5000"
		};
	};
}

// https://github.com/microsoft/vscode-python-debugger/blob/8d8281f0c989bd691d7d5a086c728696f124d966/src/extension/apiTypes.ts
type DebugPyAPI = {
	debug: {
		getRemoteLauncherCommand(host: string, port: number, waitUntilDebuggerAttaches: boolean): Promise<string[]>;
	}
};

class Python extends Language {
	name="python";
	exts=["py"];
	runtime: string|null=null;
	debugPort=5679;

	run=async ({prog, dbg}: LanguageRunOpts): Promise<string[]> => {
		if (this.cfg.runtime!=undefined) this.runtime=this.cfg.runtime;
		else if (this.runtime==null) {
			if (await existsInPath("python3")) this.runtime="python3";
			else if (await existsInPath("python")) this.runtime="python";
			else throw new Error("Python/python3 not found. Try setting a compiler in settings");
		}

		let dbgArgs: string[]=[];
		if (dbg) {
			const debugpy = extensions.getExtension("ms-python.debugpy");
			if (debugpy==undefined)
				throw new Error("Install the Python Debugger extension to debug python");

			if (!debugpy.isActive) await debugpy.activate();
			dbgArgs=await (debugpy.exports as DebugPyAPI).debug.getRemoteLauncherCommand("localhost", this.debugPort, true);
		}

		return [this.runtime, ...dbgArgs, prog];
	};

	debug=async () => {
		if (!await waitForPort(this.debugPort))
			throw new Error("Python debug adapter failed to start");

		return {
			type: "debugpy", request: "attach",
			name: "Python Debugger: Attach",
			connect: {
				host: "localhost",
				port: this.debugPort
			}
		};
	};
}

//UNTESTED
//sory im lazy
class Rust extends Language {
	name="rust";
	exts=["rs"];
	stopOnDebug=true;

	compile=async ({prog, source, type}: LanguageCompileOpts): Promise<string[]> => {
		await mkdir(prog, {recursive:true});
		return [this.cfg.compiler ?? "rustc", source, "-o", prog, ...this.getArgs(type)];
	};

	debug=async ({pid, prog}: LanguageDebugOpts) => {
		if (extensions.getExtension("vadimcn.vscode-lldb")==undefined)
			throw new Error("Install CodeLLDB to debug Rust");

		return {
			type: "lldb", request: "attach",
			name: "Attach", program: prog,
			pid, expressions: "native"
		};
	};
}

const cfgMap: Record<keyof LanguageConfig, string> = {
	compiler: "compiler", runtime: "runtime", commonArgs: "compileArgs.common",
	fastArgs: "compileArgs.fast", debugArgs: "compileArgs.debug"
}

//CRUD
function loadCfg(config: WorkspaceConfiguration): LanguagesConfig {
	const x=Object.fromEntries(Object.entries(cfgMap).map(([k,v]) => {
		return [k, config.get<Record<string,string>>(v)];
	})) as Record<keyof LanguageConfig, Record<string,string>>;

	const out: Record<string, LanguageConfig> = {};
	for (const k in x) {
		const lk = k as keyof LanguageConfig;
		for (const lang in x[lk]) {
			out[lang] ??= {};
			if (lang in x[lk] && x[lk][lang].length>0)
				out[lang][lk] = x[lk][lang];
		}
	}

	return out;
}

export class LanguageProvider {
	config=workspace.getConfiguration("cpu");
	private cfg: LanguagesConfig = loadCfg(this.config);

	languages: Language[] = [
		new CPP(this.cfg), new Rust(this.cfg), new Python(this.cfg), new Java(this.cfg)
	];

	allExts = this.languages.flatMap(x=>x.exts);
	extToLanguage = Object.fromEntries(this.languages.flatMap(x=>x.exts.map(y=>[`.${y}`,x]))) as Record<string, Language>;

	private listener: Disposable;

	constructor() {
		this.listener=workspace.onDidChangeConfiguration((e)=>{
			if (e.affectsConfiguration("cpu"))
				this.cfg=loadCfg(this.config);
		});
	}

	// cfg for UI (uninitialized but acceptable properties replaced w/ empty strings...)
	// lmfao
	getLangsCfg() {
		return Object.fromEntries(this.languages.map((lang): [string, LanguageConfig]=>{
			const cfg = this.cfg[lang.name];
			const o: LanguageConfig = {};

			if (lang.compile!=undefined) {
				for (const k of ["compiler","commonArgs","fastArgs","debugArgs"] as (keyof LanguageConfig)[]) {
					o[k] = cfg[k]??"";
				}
			}

			if (lang.run!=undefined) o.runtime=cfg.runtime??"";

			return [lang.name, o];
		}));
	}

	async updateLangCfg(name: string, cfg: Partial<LanguageConfig>) {
		for (const k in cfg) {
			const lk = k as keyof LanguageConfig;
			this.cfg[name][lk]=cfg[lk]!.length==0 ? undefined : cfg[lk];
			const sec = Object.fromEntries(Object.entries(this.cfg).map(([a,b]) =>[a, b[lk]]));
			await workspace.getConfiguration("cpu").update(cfgMap[lk], sec);
		}
	}

	getLanguage(file: string): Language|null {
		return this.extToLanguage[extname(file)]??null;
	}

	dispose() {this.listener.dispose();}
}
