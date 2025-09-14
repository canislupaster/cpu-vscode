import { LanguageConfig, LanguagesConfig } from "./languages";

export class CompileError extends Error {
	constructor(public err: string, public file: string) {super(err);}
}

export class RunError extends Error {
	constructor(public err: string, public file: string, public source?: Error) {super(source ? `${err}\n${source?.message}` : err);}
}

export type RunCfg = {
	tl: number|undefined, //s
	ml: number|undefined, //mb
	fileIO: {input: string, output: string}|null,
	checker: Checker|null,
	interactor: string|null,
	eof: boolean,
	focusTestIO: boolean,
};

export const runKeys = ["tl", "ml", "eof", "focusTestIO", "checker", "interactor", "fileIO"] as const;

export type Cfg = {
	createFiles: boolean,
	createFileName: string,
	createFileTemplate?: string,
	nProcs: number,
	testDir?: string,
	buildDir?: string,

	browserType: "firefox" | "chromium",
	browserPath: string,
	browserProfileDir: string
};

export const cfgKeys = [
	"createFiles", "createFileName", "createFileTemplate",
	"nProcs", "testDir", "buildDir", "browserType",
	"browserPath", "browserProfileDir"
] as const satisfies (keyof Cfg)[];

export const defaultRunCfg: RunCfg = {
	tl: 10, ml: 512, eof: false, focusTestIO: true,
	checker: null, interactor: null, fileIO: null
};

export type RunType = "normal"|"stress"|"generator"|"runInteractor";

//my giant reducer!
export type MessageToExt = {
	type: "createTestCase"
} | {
	type: "removeTestCase",
	i: number
} | {
	type: "setTestName"
	i: number,
	name: string
} | {
	type: "runAll"
} | {
	type: "runTestCase",
	i: number,
	dbg: boolean,
	runType: RunType
} | {
	type: "cancelRun",
	i?: number
} | {
	type: "setChecker",
	checker: string|null
} | {
	type: "setInteractor",
	path: string|null
} | {
	type: "setRunCfg",
	cfg: RunCfg
} | {
	type: "setCfg",
	cfg: Cfg,
	global: boolean
} | {
	type: "readSource", i: number
} | {
	type: "readOutput", i: number
} | {
	type: "openTest", i?: number
} | {
	type: "openFile", path: string, inOS?: boolean
} | {
	type: "setSource",
	i: number, which: "inFile" | "ansFile",
	source: string
} | {
	type: "setTestFile",
	i: number, which: "inFile" | "ansFile",
	ty: "import"|"create"|"detach"
} | {
	type: "setProgram", cmd: "clear"|"open"|"setLast"
} | {
	type: "autosubmit"
} | {
	type: "testCaseInput", inp: string
} | {
	type: "createTestSet"|"importTests"
} | {
	type: "moveTest", a: number, b: number
} | {
	type: "renameTestSet", name: string
} | {
	type: "switchTestSet"|"deleteTestSet"|"openTestSetUrl", i: number
} | {
	type: "updateStress", i: number, stress: Partial<Omit<Stress,"status">>
} | {
	type: "createStress",
	name?: string,
	stress: Omit<Stress,"status">
} | {
	type: "chooseFile", key: string, name: string,
	kind: "source"|"directory"
} | {
	type: "clearCompileCache"
} | {
	type: "clearRunAll"
} | {
	type: "openSettings"
} | {
	type: "setLanguageCfg",
	language: string, cfg: Partial<LanguageConfig>
} | {
	type: "setLanguageCfgGlobally", language: string
} | {
	type: "panelReady"
} | {
	type: "closeAutoSubmit", submitter: number
};

export type SetStateMessage = {type: "setUIState", newState: object};

export type TestResult = {
	verdict: "AC"|"RE"|"TL"|"ML"|"WA"|"INT"|"CE",
	wallTime: number|null, cpuTime: number|null,
	mem: number|null, exitCode: number|null
};

export const badVerdicts: TestResult["verdict"][] = ["ML","TL","RE","WA"];

export type Stress = {
	generator: string,
	brute: string,
	args: string,
	maxI: number,
	status: {
		i: number,
		time: number,
		maxI: number
	}|null
};

export type TestCase = {
	name: string,
	inFile?: string,
	ansFile?: string,
	tmpIn: boolean, tmpAns: boolean,
	cancellable: boolean|null,
	lastRun: TestResult|null,
	err: {type: "compile", err: CompileError}|{type: "run", err: RunError}|null,
	stress?: Stress
};

export type RunState = {
	runningTest?: number,
	runAll: {
		cancellable: boolean|null,
		lastRun: {
			verdict: TestResult["verdict"]|null,
			wallTime: number|null, cpuTime: number|null, mem: number|null,
			progress: [number,number]
		}|null,
		err: TestCase["err"]
	}
};

export function testErr({err}: Pick<TestCase,"err">) {
	return err?{
		title: err.type=="compile" ? `Compile Error` : `Run Error`,
		msg: err.err.err,
		file: err.err.file
	}:null;
}

export type TestCaseI = {i: number, test: TestCase};

//group not null <-> imported from companion
//maybe ill make things neater. but not now!
export type TestSetMeta = {
	name: string, group?: string,
	problemLink?: string,
	mod?: number,

	prev?: number, next?: number
};

export type TestSets = Record<number,TestSetMeta>;
export type OpenFile = {type:"last"|"file", path:string}|null;
export type Theme = "light"|"dark";

export type InitState = {
	cases: Record<number,TestCase>,
	cfg: Cfg,
	runCfg: RunCfg,
	languagesCfg: LanguagesConfig,
	checkers: string[],
	openTest?: number,
	run: RunState,
	openFile: OpenFile,
	order: number[],
	testSets: TestSets,
	currentTestSet: number,
	buildDir: string, testSetDir: string,
	theme: Theme,
	autoSubmitSupported: boolean,
	autoSubmitterStatus: AutoSubmitUpdateWhen[]
};

export type TestOut = {
	stderr: string, stdout: string,
	path: string, judge?: string, hiddenSize?: number
};

export type Checker = {type: "file", path: string}|{type: "default", name: string};

export type AutoSubmitUpdate = ({
	type: "verdict",
	verdict: TestResult["verdict"],
} | {
	type: "testing"|"submitting"|"closed",
} | {
	type: "error",
	error: Error
})&{
	testCase?: number,
	link?: string
};

export type AutoSubmitUpdateWhen = AutoSubmitUpdate&{
	id: number,
	// epoch, milliseconds
	when: number,
	name: string,
	problemLink: string
};

export type MessageFromExt = {
	type: "updateTestCases",
	testCasesUpdated: Record<number, TestCase|null>
} | {
	type: "updateCheckers",
	checkers: string[]
} | {
	type: "updateRunCfg",
	cfg: RunCfg
} | {
	type: "updateCfg",
	cfg: Cfg
} | {
	type: "updateLanguagesCfg",
	cfg: LanguagesConfig
} | {
	type: "testCaseRead",
	i: number,
	which: "inFile"|"ansFile",
	source: string|null
} | {
	type: "testCaseOutput", i: number, out?: TestOut
} | {
	//for running test only
	type: "testCaseStream",
	which: "stdout"|"stderr"|"judge"|"interaction"|"input", txt: string
} | {
	type: "openTest", i?: number, focus: boolean
} | {
	type: "updateProgram", openFile: OpenFile
} | {
	type: "updateRunState", run: RunState
} | {
	type: "reorderTests", order: number[]
} | {
	type: "updateTestSets",
	current: number,
	autoSubmitSupported: boolean,
	sets: TestSets
} | {
	type: "fileChosen", key: string, path: string
} | {
	type: "themeChange", newTheme: Theme
} | {
	type: "updateAutoSubmitStatus", status: AutoSubmitUpdateWhen[]
};