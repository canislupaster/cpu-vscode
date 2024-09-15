import { NextUIProvider } from "@nextui-org/system";
import { CompileError, defaultRunCfg, InitState, MessageFromExt, MessageToExt, RunState, TestCase, TestCaseI, testErr, TestResult } from "./shared";
import { Alert, AppTooltip, Button, Card, Divider, DragHandle, dragTCs, HiddenInput, Icon, IconButton, Input, Loading, render, send, Text, Textarea, verdictColor } from "./ui";
import { createRoot } from 'react-dom/client';
import { twMerge } from "tailwind-merge";
import { Spinner } from "@nextui-org/spinner";
import { useEffect, useRef, useState } from "react";
import React from "react";
import { Tooltip } from "@nextui-org/tooltip";
import { TestCaseFile, TestCaseOutput, useTestSource, useTestCases, SetProgram, RunStats, TestErr, TestSetStatus } from "./testcase";
import { Collapse } from "react-collapse";
import { Progress } from "@nextui-org/progress";

function SmallTestCaseEditor({i,test}: {i: number}&TestCaseI) {
	i==1;
	const source = useTestSource(i);
	if (!source.input.init || !source.answer.init) return <Loading/>;
	return <div className="flex flex-col gap-2 mt-2" >
		<TestCaseFile source={source.input.value} i={i} which="inFile" path={test.inFile} />
		<TestCaseFile source={source.answer.value} i={i} which="ansFile" path={test.ansFile} />
		<TestCaseOutput test={test} i={i} answer={source.answer.value ?? undefined} />
	</div>;
}

const SmallTestCase = React.memo(({test,i}: TestCaseI)=>{
	const run = (dbg: boolean) => () => send({type: "runTestCase", i, dbg});

	const d = {disabled: test.cancellable!=null};
	const [open, setOpen] = useState(test.tmpAns && test.tmpIn);

	return <Card className="pb-0 px-0" >
		<div className="px-3 mb-1 flex flex-row items-center gap-2" >
			<DragHandle/>
			<div className="flex-1" >
				<HiddenInput minLength={1} maxLength={25} className="overflow-x-clip w-full" value={test.name} onChange={(e)=>send({type: "setTestName", i, name: e.target.value})} />

				<div className="flex flex-row gap-2 items-center justify-between" >
					<div className="flex flex-row gap-1 items-center" >
						<IconButton {...d} icon={<Icon icon="edit" className="text-sky-400" />} onClick={() => {
							send({type: "openTest", i});
						}} />
						{test.cancellable==true
							? <IconButton icon={<Icon icon="circle-slash" />} onClick={()=>send({type: "cancelRun", i})} />
							: <>
								<IconButton {...d} icon={<Icon icon="play" className="text-green-500" />} onClick={run(false)} />
								<IconButton {...d} icon={<Icon icon="debug" className="text-green-500" />} onClick={run(true)} />
								<IconButton {...d} icon={<Icon icon="trash" className="text-red-500" />} onClick={() => {
									send({type: "removeTestCase", i});
								}} />
							</>}
					</div>

					<div className="flex flex-row gap-1 items-center" >
						{test.cancellable!=null ? <Spinner color="white" size="sm" /> : (
							test.err ? <AppTooltip content={
								<div className="max-w-full" ><TestErr x={test} noFile /></div>
							} className="text-red-500 flex flex-row gap-1 items-center cursor-pointer" >
								<Icon icon="error" />
								Error
							</AppTooltip>
							: <></>
						)}
						{test.lastRun && <VerdictText v={test.lastRun.verdict} />}
					</div>
				</div>

				<Collapse isOpened={open} initialStyle={{height: '0px', overflow: 'hidden'}} >
					{test.lastRun && <>
						<div className="my-2" ></div>
						<RunStats x={test.lastRun} />
					</>}
					{open && <SmallTestCaseEditor i={i} test={test} />}
				</Collapse>
			</div>
		</div>

		<Button className="rounded-none rounded-b-md hover:bg-zinc-700" icon={<Icon icon={`chevron-${open ? "up" : "down"}`} />}
			onClick={()=>setOpen(!open)} >
		</Button>
	</Card>;
});

const VerdictText = ({v}: {v:TestResult["verdict"]}) =>
	<Text v="bold" className={`px-2 rounded-md bg-${verdictColor(v)} text-black`} >
		{v}
	</Text>;

const RunAllStatus = React.memo(({runAll}: {runAll: RunState["runAll"]})=>{
	const lr = runAll.lastRun;

	return <>
		<div className="flex flex-col gap-px" >
			{lr && <Text v="dim" >{lr.progress[0]} of {lr.progress[1]} test cases{runAll.cancellable==null && " (stopped)"}</Text>}
			{lr && <div className="flex flex-row items-center gap-2" >
				<Progress size="md" isIndeterminate={lr.progress[0]==0} value={lr.progress[0]} maxValue={lr.progress[1]} color="secondary" ></Progress>
				{lr.verdict && <VerdictText v={lr.verdict} />}
			</div>}
		</div>

		{lr && <RunStats x={lr} />}
		
		<TestErr x={runAll} pre="Run all" />
	</>;
});

function App() {
	const tc = useTestCases();
	const [order,drag] = dragTCs(tc.ordered);

	return <div className="flex flex-col gap-2 p-3" >
		<TestSetStatus testSets={tc.testSets} currentTestSet={tc.currentTestSet} />
		<SetProgram tc={tc} />

		<Button onClick={()=>send({type: "openTest"})} icon={<Icon icon="edit" />} className="bg-sky-700" >Open editor</Button>
		<div className="flex flex-row w-full gap-1" >
			{tc.run.runAll.cancellable
				? <Button icon={<Spinner color="white" size="sm" />} className="bg-red-600 flex-1" onClick={()=>send({type: "cancelRun"})} >Stop</Button>
				: <Button icon={<Icon icon="run-all" />}
						onClick={()=>send({type: "runAll"})}
						className={`${tc.ordered.length>0 ? "bg-green-600" : ""} flex-1`}
						disabled={tc.ordered.length==0 || tc.run.runAll.cancellable!=null} >Run all</Button>}
		</div>

		<RunAllStatus runAll={tc.run.runAll} />

		<Divider/>

		<div ref={drag} className="flex flex-col gap-2" >
			{order.map(k=>
				<SmallTestCase test={tc.cases[k]} i={Number(k)} key={k} />
			)}
		</div>
		
		<Button onClick={()=>send({type:"createTestCase"})} icon={<Icon icon="add" />} >Add test case</Button>
	</div>;
}

render(App);