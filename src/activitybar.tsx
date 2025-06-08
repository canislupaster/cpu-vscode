import React from "react";
import { RunState, RunType, TestCaseI, TestResult } from "./shared";
import { Anchor, AppTooltip, bgColor, Button, Card, Divider, DragHandle, dragTCs, HiddenInput, Icon, IconButton, Loading, render, send, Tag, Text, textColor, ThemeSpinner, verdictColor } from "./ui";
import { useMemo, useState } from "react";
import { TestCaseFile, TestCaseOutput, useTestSource, useTestCases, SetProgram, RunStats, TestErr, TestSetStatus, DiffContextProvider } from "./testcase";
import { Collapse } from "react-collapse";
import { Progress } from "@heroui/progress";
import { twMerge } from "tailwind-merge";

function SmallTestCaseEditor({i,test}: {i: number}&TestCaseI) {
	const source = useTestSource(i);
	if (!source.input.init || !source.answer.init) return <Loading/>;
	return <div className="flex flex-col gap-2 mt-2" >
		<TestCaseFile source={source.input.value} i={i} which="inFile" path={test.inFile} />
		<TestCaseFile source={source.answer.value} i={i} which="ansFile" path={test.ansFile} />
		<TestCaseOutput test={test} i={i} answer={source.answer.value ?? undefined} />
	</div>;
}

const SmallTestCase = React.memo(({test,i,open: openOpt,setOpen,interactive}: TestCaseI&{open?: boolean,setOpen:(x: boolean)=>void,interactive:boolean})=>{
	const run = (dbg: boolean, ty?: RunType) => () =>
		send({type: "runTestCase", i, dbg, runType: ty??"normal"});

	const open = openOpt ?? (test.tmpAns && test.tmpIn);
	const d = {disabled: test.cancellable!=null};

	return <Card className="pb-0 px-0 gap-0" >
		<div className="px-3 flex flex-row items-center gap-2 mb-2" >
			<DragHandle/>
			<div className="flex-1" >
				<HiddenInput minLength={1} maxLength={25} className="overflow-x-clip w-full mb-2" value={test.name} onChange={(e)=>send({type: "setTestName", i, name: e.target.value})} />

				<div className="flex xs:flex-row gap-2 items-center xs:justify-between flex-col justify-center" >
					<div className="flex flex-row gap-1 items-center" >
						<IconButton icon={<Icon icon="edit" className={textColor.sky} />} onClick={() => {
							send({type: "openTest", i});
						}} />
						{test.cancellable==true
							? <IconButton icon={<Icon icon="circle-slash" />} onClick={()=>send({type: "cancelRun", i})} />
							: <>
								<IconButton {...d} icon={<Icon icon="play" className={textColor.green} />} onClick={run(false)} />
								<IconButton {...d} icon={<Icon icon="debug" className={textColor.green} />} onClick={run(true)} />
								<IconButton {...d} icon={<Icon icon="trash" className={textColor.red} />} onClick={() => {
									send({type: "removeTestCase", i});
								}} />
							</>}
					</div>

					{(test.cancellable!=null || test.lastRun) && <div className="flex flex-row gap-2 items-center" >
						{test.cancellable!=null ? <ThemeSpinner color="white" size="sm" /> : (
							test.err ? <AppTooltip content={
								<div className="max-w-full" ><TestErr x={test} noFile /></div>
							} className="flex flex-row gap-1 items-center cursor-pointer" >
								<Icon icon="error" />
								<Text v="err" >
									Error
								</Text>
							</AppTooltip>
							: <></>
						)}
						{test.lastRun && <VerdictText v={test.lastRun.verdict} />}
					</div>}
				</div>
			</div>
		</div>

		{interactive && <Card className={`flex flex-row items-start gap-2 rounded-none pr-3 shadow-sm pt-0 pb-0 pl-0 justify-between ${bgColor.default}`} >
			<Tag className="pr-6 rounded-l-none" col="secondary" >
				<Icon icon="robot" /> <Text v="bold" >Interactive</Text>
			</Tag>
			<IconButton {...d} className="self-center"
				icon={<Icon icon="debug" className={textColor.green} />}
				onClick={run(true, "runInteractor")} />
		</Card>}

		{test.stress && <Card className={`flex flex-col items-start gap-2 rounded-none px-3 shadow-sm mt-1 pt-0 ${bgColor.default}`} >
			<Tag className="pr-6 rounded-t-none" >
				<Icon icon="wand" /> <Text v="bold" >Stress test</Text>
			</Tag>

			<div className="flex flex-row items-center gap-2 ml-2" >
				<Text v="dim" className="text-nowrap" >for 0 ≤ i {"< "}</Text>
				<HiddenInput value={test.stress.maxI} onChange={(ev) => {
					const num = Number.parseInt(ev.target.value);
					if (isFinite(num) && num>=0)
						send({type: "updateStress", i, stress: {maxI: num}})
				}} type="number" min={1} max={1e9} />
			</div>

			<div className="flex flex-row items-center gap-2" >
				<IconButton {...d} icon={<Icon icon="play" className={textColor.green} />} onClick={run(false, "generator")} />
				<IconButton {...d} icon={<Icon icon="debug" className={textColor.green} />} onClick={run(true, "generator")} />
				<Button icon={<Icon icon="run-all" />} className={bgColor.sky}
					disabled={test.cancellable!=null} onClick={run(false, "stress")} >Run stress</Button>
			</div>

			{test.stress.status && <Progress disableAnimation size="md" isIndeterminate={test.stress.status.i==0 && test.cancellable==true} value={test.stress.status.i} maxValue={test.stress.status.maxI} color="primary" className="mt-2" ></Progress>}

			{test.stress.status && <Text v="dim" >
				{test.stress.status.i}/{test.stress.status.maxI}{test.cancellable!=true && " (stopped)"}, {(test.stress.status.time/1000).toFixed(3)} s
			</Text>}
		</Card>}

		{test.lastRun && <Collapse isOpened={open} >
			<div className="mt-1 px-3" >
				<RunStats x={test.lastRun} />
			</div>
		</Collapse>}

		<Collapse isOpened={open} initialStyle={{height: '0px', overflow: 'hidden'}} >
			<div className="px-3 mb-3" >
				{open && <SmallTestCaseEditor i={i} test={test} />}
			</div>
		</Collapse>

		<Button className={`rounded-none border-0 border-t rounded-b-md hover:bg-zinc-100 dark:hover:bg-zinc-700 ${bgColor.md}`} icon={<Icon icon={`chevron-${open ? "up" : "down"}`} />}
			onClick={()=>setOpen(!open)} >
		</Button>
	</Card>;
});

const VerdictText = ({v,big,className}: {v:TestResult["verdict"], big?: boolean, className?: string}) =>
	<Text v="bold" className={twMerge(`px-2 rounded-md ${verdictColor[v].bg} text-black ${big ? "text-2xl" : ""}`, className)} >
		{v}
	</Text>;

const RunAllStatus = React.memo(({runAll}: {runAll: RunState["runAll"]})=>{
	const lr = runAll.lastRun;
	if (lr==null) return <></>;

	return <div className="flex flex-col gap-px mt-2 px-4" >
		<Text v="dim" >
			{lr.progress[0]} of {lr.progress[1]} test cases{runAll.cancellable==null && " (stopped)"}
			{runAll.cancellable==null && <>{" "}<Anchor onClick={()=>send({type:"clearRunAll"})} >Dismiss.</Anchor></>}
		</Text>

		<div className="flex flex-row items-start gap-2 justify-between" >
			<div className="flex flex-col gap-1 flex-1 mt-1" >
				<Progress disableAnimation size="md" isIndeterminate={lr.progress[0]==0 && runAll.cancellable!=null}
					value={lr.progress[0]} maxValue={lr.progress[1]} color="secondary" ></Progress>

				<RunStats x={lr} />
			</div>

			{lr.verdict && <VerdictText v={lr.verdict} big className="mt-1" />}
		</div>

		<TestErr x={runAll} pre="Run all" className="mt-2" />
	</div>;
});

function App() {
	const tc = useTestCases();
	const [order,drag] = dragTCs(tc.ordered);
	const [opens, setOpens] = useState<Record<number,boolean>>({});
	const eachSetOpen = useMemo(() => {
		return order.map((k): [number, boolean|undefined, (x: boolean)=>void]=>
			[k, opens[k], (x: boolean)=>setOpens({...opens, [k]: x})]);
	}, [order,opens]);

	const setAllOpen = (x:boolean)=>()=>{
		setOpens(Object.fromEntries(Object.keys(tc.cases).map(Number).map(k=>[k,x])));
	};

	return <div className="flex flex-col gap-2 p-3" >
		<TestSetStatus testSets={tc.testSets} currentTestSet={tc.currentTestSet} />
		<SetProgram tc={tc} />

		<div className="flex flex-col xs:flex-row w-full gap-1" >
			<Button onClick={()=>send({type: "openTest"})} icon={<Icon icon="edit" />} className={`${bgColor.sky} flex-1`} >Open editor</Button>
			{tc.run.runAll.cancellable
				? <Button icon={<ThemeSpinner color="white" size="sm" />} className={`${bgColor.red} flex-1`} onClick={()=>send({type: "cancelRun"})} >Stop</Button>
				: <Button icon={<Icon icon="run-all" />}
						onClick={()=>send({type: "runAll"})} className={`${bgColor.green} flex-1`}
						disabled={tc.ordered.length==0 || tc.run.runAll.cancellable!=null} >Run all</Button>}
			{tc.autoSubmitSupported && <Button className="flex-1"
				onClick={()=>send({type: "autosubmit"})} >Submit</Button>}
		</div>

		<RunAllStatus runAll={tc.run.runAll} />

		<Divider/>

		<div className="flex flex-row gap-4 justify-between" >
			<Text v="bold" >Tests</Text>
			<div className="flex flex-row gap-2 justify-end" >
				<IconButton icon={<Icon icon="expand-all" />} onClick={setAllOpen(true)} />
				<IconButton icon={<Icon icon="collapse-all" />} onClick={setAllOpen(false)} />
			</div>
		</div>

		<div ref={drag} className="flex flex-col gap-2" >
			<DiffContextProvider>
				{eachSetOpen.map(([k,open,setOpen])=>
					<SmallTestCase test={tc.cases[k]} i={Number(k)} key={k} open={open}
						setOpen={setOpen} interactive={tc.runCfg.interactor!=null} />
				)}
			</DiffContextProvider>
		</div>
		
		<Button onClick={()=>send({type:"createTestCase"})} icon={<Icon icon="add" />} >Add test case</Button>
	</div>;
}

render(App);