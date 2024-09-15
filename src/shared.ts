export class CompileError extends Error {
	constructor(public err: string, public file: string) {super(err);}
}

export class RunError extends Error {
	constructor(public err: string, public file: string, public source?: Error) {super(source ? `${err}\n${source?.message}` : err);}
}

export type RunCfg = {
	disableTl: boolean,
	tl: number, //s
	ml: number, //mb
	eof: boolean
};

export const defaultRunCfg: RunCfg = {disableTl: false, tl: 10, ml: 512, eof: false};

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
	dbg: boolean
} | {
	type: "cancelRun",
	i?: number
} | {
	type: "setChecker",
	checker: string|null
} | {
	type: "setCfg",
	cfg: RunCfg
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
	type: "setProgram", clear: boolean
} | {
	type: "testCaseInput", inp: string
} | {
	type: "createTestSet"|"importTests"
} | {
	type: "moveTest", a: number, b: number
} | {
	type: "renameTestSet", name: string
} | {
	type: "switchTestSet"|"deleteTestSet", i: number
};

export type TestResult = {
	verdict: "AC"|"RE"|"TL"|"ML"|"WA",
	wallTime: number|null, cpuTime: number|null,
	mem: number|null, exitCode: number|null
};

export const badVerdicts: TestResult["verdict"][] = ["ML","TL","RE","WA"];

export type TestCase = {
	name: string,

	inFile?: string,
	ansFile?: string,
	tmpIn: boolean, tmpAns: boolean,

	cancellable: boolean|null,
	lastRun: TestResult|null,
	err: {type: "compile", err: CompileError}|{type: "run", err: RunError}|null,
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

export type InitState = {
	cases: Record<number,TestCase>,
	cfg: RunCfg,
	checker: Checker|null,
	checkers: string[],
	openTest?: number,
	run: RunState,
	openFile: string|null,
	order: number[],
	testSets: Record<number,string>,
	currentTestSet: number
};

export type TestOut = {
	stderr: string, stdout: string,
	path: string, judge?: string, hiddenSize?: number
};

export type Checker = {type: "file", path: string}|{type: "default", name: string};

export type MessageFromExt = {
	type: "updateTestCases",
	testCasesUpdated: Record<number, TestCase|null>
} | {
	type: "updateChecker",
	checker: Checker|null,
	checkers: string[]
} | {
	type: "updateCfg",
	cfg: RunCfg
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
	which: "stdout"|"stderr"|"judge", txt: string
} | {
	type: "openTest", i?: number
} | {
	type: "updateProgram", path: string|null
} | {
	type: "updateRunState", run: RunState
} | {
	type: "reorderTests", order: number[]
} | {
	type: "updateTestSets",
	current: number,
	sets: Record<number,string>
};