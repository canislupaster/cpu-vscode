import { useEffect, useRef } from "react";
import { RunCfg, TestCase, TestCaseI, testErr, TestResult } from "./shared";
import { Alert, Anchor, Button, Card, Divider, Dropdown, expandedVerdict, FileName, Icon, IconButton, Input, render, Select, send, Text, verdictColor } from "./ui";
import { createRoot } from "react-dom/client";
import { Spinner } from "@nextui-org/spinner";
import { Collapse } from "react-collapse";
import React from "react";
import { TestCaseFile, TestCaseOutput, useTestSource, useTestCases, SetProgram } from "./testcase";
import { Checkbox } from "@nextui-org/checkbox";
import { Drag, DragHandle } from "./drag";

const RunStats = ({x}: {x: TestResult}) => <div className="flex flex-col items-end" >
	<Text v="bold" className={`text-${verdictColor(x.verdict)}`} >
		{expandedVerdict(x.verdict)}
	</Text>
	<Text v="dim" >
		{[
			`${x.wallTime!=null ? (x.wallTime/1000).toFixed(3) : "?"} s (wall)`,
			`${x.cpuTime!=null ? (x.cpuTime/1000).toFixed(3) : "?"} s (cpu)`,
			`${x.mem!=null ? Math.ceil(x.mem) : "?"} MB`,
			`exit code ${x.exitCode ?? "?"}`,
		].join(", ")}
	</Text>
</div>

function TestCase({test,i,open}: TestCaseI&{open: boolean}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (open) ref.current!.scrollIntoView();
	}, [open]);

	const e = testErr(test);
	const run = (dbg: boolean) => () => send({type: "runTestCase", i, dbg});
	const source = useTestSource(i);

	const d = {disabled: test.cancellable!=null};

	 const detach = (which: "inFile"|"ansFile") => <Anchor onClick={()=>{
			send({type: "setTestFile", i, ty: "detach", which});
		}} >Detach file</Anchor>;

	return <div ref={ref} className={`flex flex-col gap-1 border-l-3 px-5 py-2 ${
			test.lastRun ? `border-${verdictColor(test.lastRun.verdict)}` : "border-gray-500"
		} ${open ? "bg-yellow-300/5" : ""}`} >
		<div className="flex flex-row gap-2 justify-between pb-3" >
			<div className="flex flex-row gap-2 items-end" >
				<div className="flex flex-col items-start" >
					<span className="text-gray-400 text-sm" >
						Test name
					</span>
					<Input value={test.name} onChange={(e)=>send({type: "setTestName", i, name: e.target.value})} />
				</div>
				{test.cancellable==true
					? <Button icon={<Spinner color="white" size="sm" />} className="bg-red-600" onClick={()=>send({type: "cancelRun", i})} >Stop</Button>
					: <>
						<Button {...d} icon={<Icon icon="play" />} onClick={run(false)} className="bg-green-600" >Run</Button>
						<Button {...d} icon={<Icon icon="debug" />} onClick={run(true)} className="bg-green-600" >Debug</Button>
						<Button {...d} icon={<Icon icon="trash" />} onClick={()=>send({type: "removeTestCase", i})} className="bg-red-600" >Delete test</Button>
						<IconButton icon={<Icon icon="refresh" />} onClick={()=>send({type: "readSource", i})} />
					</>}
			</div>

			<div className="flex flex-row items-center gap-7" >
				{test.cancellable!=null && <Spinner color="white" size="md" />}
				{test.lastRun && <RunStats x={test.lastRun} />}
			</div>
		</div>

		{e && <Alert bad title={e.title} txt={<>
			{e.msg}
			<FileName path={e.file} />
		</>} ></Alert>}

		<Collapse isOpened={source.input.init && source.answer.init} >
			<div className="flex flex-col gap-2" >
				{[source && <TestCaseFile source={source.input.value} i={i} which="inFile" path={test.inFile} />,
				source && <TestCaseFile source={source.answer.value} i={i} which="ansFile" path={test.ansFile} />]
					.map((x,j)=> x && <Card className="px-4 py-2" key={j} >{x}</Card>)}
				{/* separate so it can update independently... */}
				<TestCaseOutput test={test} i={i} answer={source.answer.value ?? undefined} useCard />
			</div>
		</Collapse>

		<div className="flex flex-col gap-1 p-3 pb-0 pt-2 overflow-x-scroll" >
			{test.inFile && <div className="inline" >
				<Text v="dim" >Input: </Text> <FileName path={test.inFile} />. {detach("inFile")}
			</div>}
			{test.ansFile && <div className="inline" >
				<Text v="dim" >Answer: </Text> <FileName path={test.ansFile} />. {detach("ansFile")}
			</div>}
		</div>
	</div>;
}

function App() {
	const tc = useTestCases();
	const checkerV = tc.checker ? (tc.checker.type=="file"
		? {label: tc.checker.path, value: null} : {label: tc.checker.name, value: tc.checker.name}) : null;

	const modCfg = (x: Partial<RunCfg>) => send({type:"setCfg", cfg: {...tc.cfg, ...x}});

	const cases = tc.ordered.map((k): [React.ReactNode, number] =>
		[<React.Fragment>
			<Divider/>
			<DragHandle/>
			<TestCase open={k==tc.openTest} test={tc.cases[k]} i={k} />
		</React.Fragment>, k]
	);

	return <div className="flex flex-col gap-2 pt-4 p-3" >
		<Text v="big" >Test editor</Text>

		<div className="flex flex-col items-start gap-2" >
			<div className="grid grid-cols-2 gap-x-7 gap-y-2 mt-2 items-center" >
				<Text>Checker</Text>
				<Select value={checkerV}
					options={[...tc.checkers.map(x=>({value: x, label: x})), {value: null, label: "Choose file..."}]}
					onChange={(v) => send({type: "setChecker", checker: (v as any).value})}
					isOptionSelected={(x)=>
						tc.checker!=null && tc.checker.type=="default" && tc.checker.name==x as string
					} />
				<Text>Disable time limit</Text>
				<Checkbox isSelected={tc.cfg.disableTl} onValueChange={(x)=>modCfg({disableTl: x})} ></Checkbox>
				<Text>Time limit (s)</Text>
				<Input type="number" value={tc.cfg.tl} step={0.1} min={0.1} onChange={(ev)=>{
					const v = Number.parseFloat(ev.target.value);
					if (!isNaN(v)) modCfg({tl: v});
				}} disabled={tc.cfg.disableTl} ></Input>
				<Text>Memory limit (MB)</Text>
				<Input type="number" value={tc.cfg.ml} step={16} min={16} onChange={(ev)=>{
					modCfg({ml: Number.parseInt(ev.target.value)});
				}} ></Input>
				<div className="flex flex-col" >
					<Text>Send EOF</Text>
					<Text v="dim" >This will disable interacting with your program</Text>
				</div>
				<Checkbox isSelected={tc.cfg.eof} onValueChange={(x)=>modCfg({eof: x})} ></Checkbox>
			</div>
			<Button onClick={()=>send({type: "importTests"})} >Import test cases</Button>
		</div>

		<Drag elements={cases} moveElement={(a,b)=>send({type:"moveTest", a,b})} />

		<div className="flex flex-col items-center gap-2" >
			<IconButton icon={<Icon icon="add" className="text-3xl/7" />} onClick={()=>send({type: "createTestCase"})} />
			<Text v="dim" >Add test case</Text>
		</div>
	</div>;
}

render(App);