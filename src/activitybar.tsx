import { NextUIProvider } from "@nextui-org/system";
import { CompileError, defaultRunCfg, InitState, MessageFromExt, MessageToExt, TestCase, TestCaseI, testErr, TestResult } from "./shared";
import { Alert, AppTooltip, Button, Card, Divider, HiddenInput, Icon, IconButton, Input, Loading, render, send, Text, Textarea, verdictColor } from "./ui";
import { createRoot } from 'react-dom/client';
import { twMerge } from "tailwind-merge";
import { Spinner } from "@nextui-org/spinner";
import { useEffect, useRef, useState } from "react";
import React from "react";
import { Tooltip } from "@nextui-org/tooltip";
import { TestCaseFile, TestCaseOutput, useTestSource, useTestCases, SetProgram } from "./testcase";
import { Collapse } from "react-collapse";
import { Drag, DragHandle } from "./drag";

function SmallTestCaseEditor({i,test}: {i: number}&TestCaseI) {
	const source = useTestSource(i);
	if (!source.input.init || !source.answer.init) return <Loading/>;
	return <div className="flex flex-col gap-2 mt-2" >
		<TestCaseFile source={source.input.value} i={i} which="inFile" path={test.inFile} />
		<TestCaseFile source={source.answer.value} i={i} which="ansFile" path={test.ansFile} />
		<TestCaseOutput test={test} i={i} answer={source.answer.value ?? undefined} />
	</div>;
}

function SmallTestCase({test,i}: TestCaseI) {
	const run = (dbg: boolean) => () => send({type: "runTestCase", i, dbg});
	const e = testErr(test);

	const d = {disabled: test.cancellable!=null};
	const [open, setOpen] = useState(false);

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
							e ? <AppTooltip content={
								<Alert title={e.title} bad txt={e.msg} className="max-w-full" ></Alert>
							} className="text-red-500 flex flex-row gap-1 items-center" >
								<Icon icon="error" />
								Error
							</AppTooltip>
							: <></>
						)}
						{test.lastRun && <Text v="bold" className={`px-2 rounded-md bg-${verdictColor(test.lastRun.verdict)} text-black`} >
							{test.lastRun.verdict}
						</Text>}
					</div>
				</div>

				<Collapse isOpened={open} >
					{open && <SmallTestCaseEditor i={i} test={test} />}
				</Collapse>
			</div>
		</div>

		<Button className="rounded-none rounded-b-md hover:bg-zinc-700" icon={<Icon icon={`chevron-${open ? "up" : "down"}`} />}
			onClick={()=>setOpen(!open)} >
		</Button>
	</Card>;
}

function App() {
	const tc = useTestCases();

	return <div className="flex flex-col gap-2 p-3" >
		<SetProgram tc={tc} />

		<Button onClick={()=>send({type: "openTest"})} icon={<Icon icon="edit" />} className="bg-sky-700" >Open test editor</Button>

		<div className="flex flex-row w-full gap-1" >
			<Button icon={<Icon icon="trash" />} onClick={()=>send({type:"removeTestCase"})} className="bg-red-600 flex-1" >Delete all</Button>
			<Button icon={<Icon icon="run-all" />} className="bg-green-600 flex-1" >Run all</Button>
		</div>
		<Divider/>

		<Drag elements={tc.ordered.map(k=>
			[<SmallTestCase test={tc.cases[k]} i={Number(k)} ></SmallTestCase>,k]
		)}
			moveElement={(a,b)=>send({type:"moveTest",a,b})}
			className="contents"
			/>
		
		<Button onClick={()=>send({type:"createTestCase"})} icon={<Icon icon="add" />} >Add test case</Button>
	</div>;
}

render(App);