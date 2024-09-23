import { RunState, RunType, TestCaseI, TestResult } from "./shared";
import { Anchor, AppTooltip, Button, Card, Divider, DragHandle, dragTCs, HiddenInput, Icon, IconButton, Loading, render, send, Tag, Text, verdictColor } from "./ui";
import { Spinner } from "@nextui-org/spinner";
import { useMemo, useState } from "react";
import React from "react";
import { TestCaseFile, TestCaseOutput, useTestSource, useTestCases, SetProgram, RunStats, TestErr, TestSetStatus } from "./testcase";
import { Collapse } from "react-collapse";
import { Progress } from "@nextui-org/progress";

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
						<IconButton icon={<Icon icon="edit" className="text-sky-400" />} onClick={() => {
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

					{test.cancellable!=null || test.lastRun && <div className="flex flex-row gap-2 items-center" >
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
					</div>}
				</div>
			</div>
		</div>

		{interactive && <Card className="bg-zinc-900 flex flex-row items-start gap-2 rounded-none pr-3 shadow-sm pt-0 pb-0 pl-0 justify-between" >
			<Tag className="pr-6 rounded-l-none" col="secondary" >
				<Icon icon="robot" /> <Text v="bold" >Interactive</Text>
			</Tag>
			<IconButton {...d} className="self-center"
				icon={<Icon icon="debug" className="text-green-500" />}
				onClick={run(true, "runInteractor")} />
		</Card>}

		{test.stress && <Card className="bg-zinc-900 flex flex-col items-start gap-2 rounded-none px-3 shadow-sm mt-1 pt-0" >
			<Tag className="pr-6 rounded-t-none" >
				<Icon icon="wand" /> <Text v="bold" >Stress test</Text>
			</Tag>

			<div className="flex flex-row items-center gap-2 ml-2" >
				<Text v="dim" className="text-nowrap" >for 0 ≤ i {"< "}</Text>
				<HiddenInput value={test.stress.maxI} onChange={(ev) => {
					send({type: "updateStress", i, stress: {maxI: Number.parseInt(ev.target.value)}})
				}} min={0} max={1e9} type="number" />
			</div>

			<div className="flex flex-row items-center gap-2" >
				<IconButton {...d} icon={<Icon icon="play" className="text-green-500" />} onClick={run(false, "generator")} />
				<IconButton {...d} icon={<Icon icon="debug" className="text-green-500" />} onClick={run(true, "generator")} />
				<Button icon={<Icon icon="run-all" />} className="enabled:bg-sky-600"
					disabled={test.cancellable!=null} onClick={run(false, "stress")} >Run stress</Button>
			</div>

			{test.stress.status && <Progress size="md" isIndeterminate={test.stress.status.i==0 && test.cancellable==true} value={test.stress.status.i} maxValue={test.stress.status.maxI} color="primary" className="mt-2" ></Progress>}

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

		<Button className="rounded-none rounded-b-md hover:bg-zinc-700" icon={<Icon icon={`chevron-${open ? "up" : "down"}`} />}
			onClick={()=>setOpen(!open)} >
		</Button>
	</Card>;
});

const VerdictText = ({v,big}: {v:TestResult["verdict"], big?: boolean}) =>
	<Text v="bold" className={`px-2 rounded-md bg-${verdictColor(v)} text-black ${big ? "text-2xl" : ""}`} >
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
				<Progress size="md" isIndeterminate={lr.progress[0]==0} value={lr.progress[0]} maxValue={lr.progress[1]} color="secondary" ></Progress>

				<RunStats x={lr} />
			</div>

			{lr.verdict && <VerdictText v={lr.verdict} big />}
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
			<Button onClick={()=>send({type: "openTest"})} icon={<Icon icon="edit" />} className="bg-sky-700 flex-1" >Open editor</Button>
			{tc.run.runAll.cancellable
				? <Button icon={<Spinner color="white" size="sm" />} className="bg-red-600 flex-1" onClick={()=>send({type: "cancelRun"})} >Stop</Button>
				: <Button icon={<Icon icon="run-all" />}
						onClick={()=>send({type: "runAll"})} className="enabled:bg-green-600 flex-1"
						disabled={tc.ordered.length==0 || tc.run.runAll.cancellable!=null} >Run all</Button>}
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
			{eachSetOpen.map(([k,open,setOpen])=>
				<SmallTestCase test={tc.cases[k]} i={Number(k)} key={k} open={open}
					setOpen={setOpen} interactive={tc.cfg.interactor!=null} />
			)}
		</div>
		
		<Button onClick={()=>send({type:"createTestCase"})} icon={<Icon icon="add" />} >Add test case</Button>
	</div>;
}

render(App);