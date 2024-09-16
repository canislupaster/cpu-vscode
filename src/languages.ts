import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

export type LanguageCompileOpts = {
	compiler: string|null,
	extPath: string,
	prog: string, source: string,
	testlib: boolean
};

export type LanguageRunOpts = {
	source: string,  prog: string, runtime: string|null
}

export abstract class Language {
	abstract name: string;
	abstract exts: string[];
	abstract compile?: (x: LanguageCompileOpts)=>Promise<string[]>;
	abstract run?: (x: LanguageRunOpts)=>Promise<string[]>;
};

async function existsInPath(name: string): Promise<boolean> {
	try {
		await promisify(execFile)(process.platform=="win32" ? "where" : "whereis", [name], {shell: true});
		return true;
	} catch {
		return false;
	}
}

class CPP implements Language {
	compiler: string|null=null;
	name="c++";
	exts=["cpp","cxx","cc","c++"];

	async compile({compiler, extPath, prog, source}: LanguageCompileOpts): Promise<string[]> {
		if (compiler!=null) this.compiler=compiler;
		else if (this.compiler==null) {
			if (await existsInPath("clang++")) this.compiler="clang++";
			else if (await existsInPath("g++")) this.compiler="g++";
			else throw new Error("G++ or Clang not found. Try setting a compiler in settings");
		}

		return [this.compiler, source, "-isystem", join(extPath, "testlib"), "-o", prog];
	}
}

class Java implements Language {
	name="java";
	exts=["java"];

	async compile({compiler, prog, source}: LanguageCompileOpts): Promise<string[]> {
		await mkdir(prog, {recursive:true});
		return [compiler ?? "javac", source, "-d", prog];
	}

	async run({runtime, source, prog}: LanguageRunOpts): Promise<string[]> {
		const name = basename(source).slice(0,-extname(source).length);
		return [runtime ?? "java", "-cp", prog, name];
	}
}

class Python implements Language {
	name="python";
	exts=["py"];
	runtime: string|null=null;

	async run({runtime, prog}: LanguageRunOpts): Promise<string[]> {
		if (runtime!=null) this.runtime=runtime;
		else if (this.runtime==null) {
			if (await existsInPath("python3")) this.runtime="python3";
			else if (await existsInPath("python")) this.runtime="python";
			else throw new Error("Python/python3 not found. Try setting a compiler in settings");
		}

		return [this.runtime, prog];
	}
}

//UNTESTED
//sory im lazy
class Rust implements Language {
	name="rust";
	exts=["rs"];

	async compile({compiler, prog, source}: LanguageCompileOpts): Promise<string[]> {
		await mkdir(prog, {recursive:true});
		return [compiler ?? "rustc", source, "-o", prog];
	}
}

export const languages: Language[] = [
	new CPP(), new Rust(), new Python(), new Java()
];

export const allExts = languages.flatMap(x=>x.exts);
export const extToLanguage = Object.fromEntries(languages.flatMap(x=>x.exts.map(y=>[`.${y}`,x]))) as Record<string, Language>;
