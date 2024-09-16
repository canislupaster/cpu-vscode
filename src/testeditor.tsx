import { useEffect, useRef, useState } from "react";
import { RunCfg, Stress, TestCase, TestCaseI, TestResult } from "./shared";
import { Alert, Anchor, AppModal, Button, Card, Divider, DragHandle, dragTCs, expandedVerdict, FileName, Icon, IconButton, Input, render, Select, send, Tag, Text, Textarea, useChooseFile, verdictColor } from "./ui";
import { Spinner } from "@nextui-org/spinner";
import { Collapse } from "react-collapse";
import React from "react";
import { TestCaseFile, TestCaseOutput, useTestSource, useTestCases, RunStats, TestErr, appInit } from "./testcase";
import { Checkbox } from "@nextui-org/checkbox";
import { ModalBody, ModalContent, ModalFooter, ModalHeader, useDisclosure } from "@nextui-org/modal";

const Verdict = ({x}: {x: TestResult}) => <div className="flex flex-col items-end" >
	<Text v="bold" className={`text-${verdictColor(x.verdict)}`} >
		{expandedVerdict(x.verdict)}
	</Text>
	<RunStats x={x} />
</div>;

function TestStressOptions({i, stress}: {stress: Stress, i: number}) {
	const chooseGen = useChooseFile(`generator${i}`, (generator)=>{
		send({type: "updateStress", i, stress: {generator}});
	});

	const chooseBrute = useChooseFile(`brute${i}`, (brute)=>{
		send({type: "updateStress", i, stress: {brute}});
	});

	return <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-2 items-start" >
		<Text v="bold" >Generator</Text>
		<div className="flex flex-row items-center gap-2" >
			<FileName path={stress.generator} ></FileName>
			<Button onClick={()=>chooseGen("generator")} >Choose</Button>
		</div>

		<Text v="bold" >Brute force solution</Text>
		<div className="flex flex-row items-center gap-2" >
			<FileName path={stress.brute} ></FileName>
			<Button onClick={()=>chooseBrute("brute force solution")} >Choose</Button>
		</div>

		<div className="flex flex-col max-w-60" >
			<Text v="bold" >Generator arguments</Text>
			<Text v="dim" >Use {`{{i}}`} to substitute the test index. Mustache templating syntax is supported.</Text>
		</div>
		<Textarea value={stress.args} onChange={(e)=>{
			send({type: "updateStress", i, stress: {args: e.target.value}});
		}} className="resize-none h-14 max-w-72" ></Textarea>
	</div>;
}

const TestCase = React.memo(({test,i,open,focus}: TestCaseI&{open: boolean,focus:boolean})=>{
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (focus) ref.current!.scrollIntoView();
	}, [focus]);

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
				<DragHandle/>
				<div className="flex flex-col items-start" >
					<span className="text-gray-400 text-sm" >
						Test name
					</span>
					<Input value={test.name} onChange={(e)=>send({type: "setTestName", i, name: e.target.value})} />
				</div>

				{test.cancellable==true
					? <Button icon={<Spinner color="white" size="sm" />} className="bg-red-600" onClick={()=>send({type: "cancelRun", i})} >Stop</Button>
					: <>
						<Button {...d} icon={<Icon icon="refresh" />} onClick={()=>send({type: "removeTestCase", i})} >Reload file</Button>
						<Button {...d} icon={<Icon icon="trash" />} onClick={()=>send({type: "removeTestCase", i})} className="bg-rose-900" >Delete test</Button>
					</>}
			</div>

			<div className="flex flex-row items-center gap-7" >
				{test.cancellable!=null && <Spinner color="white" size="md" />}
				{test.lastRun && <Verdict x={test.lastRun} />}
			</div>
		</div>

		<TestErr x={test} />

		{test.stress && <div className="flex flex-col gap-2 items-start mb-3" >
			<Tag className="pr-5 -ml-3" ><Icon icon="wand" /> <Text v="bold" >Stress test</Text></Tag>
			<TestStressOptions stress={test.stress} i={i} />
		</div>}

		<Collapse isOpened={source.input.init && source.answer.init} >
			<div className="flex flex-col gap-2" >
				{[source && <TestCaseFile source={source.input.value} i={i} which="inFile" path={test.inFile} />,
				source && <TestCaseFile source={source.answer.value} i={i} which="ansFile" path={test.ansFile} />]
					.map((x,j)=> x && <Card className="px-4 py-2 gap-2" key={j} >{x}</Card>)}
				{/* separate so it can update independently... */}
				<TestCaseOutput test={test} i={i} answer={source.answer.value ?? undefined} useCard />
			</div>
		</Collapse>

		<div className="flex flex-col gap-1 p-3 pb-0 pt-2" >
			{test.inFile && <div className="inline" >
				<Text v="dim" >Input: </Text> <FileName path={test.inFile} />. {detach("inFile")}
			</div>}
			{test.ansFile && <div className="inline" >
				<Text v="dim" >Answer: </Text> <FileName path={test.ansFile} />. {detach("ansFile")}
			</div>}
		</div>
	</div>;
});

function StressTestCreator({open, onOpenChange}: {open: boolean, onOpenChange: (x:boolean)=>void}) {
	const [state, setState] = useState<{
		name?: string,
		generator: string|null,
		brute: string|null,
		args: string,
		maxI: number
	}>({
		generator: null, brute: null, args: "{{ i }}", maxI: 100
	});

	const [err, setErr] = useState<string|null>(null);

	const chooseGen = useChooseFile("generator", (gen)=>{
		setState(s=>({...s, generator: gen}));
	});

	const chooseBrute = useChooseFile("brute", (brute)=>{
		setState(s=>({...s, brute: brute}));
	});

	return <AppModal isOpen={open} onOpenChange={onOpenChange} >
		<ModalContent>
			{(close) => (
				<>
					<ModalHeader><Text v="md" >Create stress test</Text></ModalHeader>
					<ModalBody>
						<Text v="bold" >Name (optional)</Text>
						<Input placeholder="Test ..." maxLength={25} value={state.name ?? ""} onChange={(ev)=>{
							const v=ev.target.value;
							setState({...state, name: v.length>0 ? v : undefined});
						}} />

						<div className="flex flex-row gap-2 items-center" >
							<Text v="bold" >Generator:</Text>
							{state.generator!=null ? <FileName path={state.generator} ></FileName> : <Text className="text-red-400" >None set</Text>}
						</div>
						<Button onClick={()=>chooseGen("generator")} >Set generator</Button>

						<div className="flex flex-row gap-2 items-center" >
							<Text v="bold" >Brute force solution:</Text>
							{state.brute!=null ? <FileName path={state.brute} ></FileName> : <Text className="text-red-400" >None set</Text>}
						</div>
						<Button onClick={()=>chooseBrute("brute force solution")} >Set brute force solution</Button>

						{err && <Alert bad title="Invalid stress test" txt={err} />}
					</ModalBody>
					<ModalFooter>
						<Button className="bg-rose-900" onClick={close} >Close</Button>
						<Button icon={<Icon icon="add" />} onClick={()=>{
							if (state.brute==null) return setErr("Brute force solution is missing");
							else if (state.generator==null) return setErr("Generator is missing");
							else setErr(null);

							send({type: "createStress", stress: {
								...state, generator: state.generator, brute: state.brute //typescript strikes again
							}, name: state.name});
							close();
						}} >Create</Button>
					</ModalFooter>
				</>
			)}
		</ModalContent>
	</AppModal>;
}

function App() {
	const tc = useTestCases();
	const checkerV = tc.checker ? (tc.checker.type=="file"
		? {label: tc.checker.path, value: null} : {label: tc.checker.name, value: tc.checker.name}) : null;

	const modCfg = (x: Partial<RunCfg>) => send({type:"setCfg", cfg: {...tc.cfg, ...x}});
	const [order, drag] = dragTCs(tc.ordered);

	const {isOpen, onOpen, onOpenChange} = useDisclosure();

	return <div className="flex flex-col gap-2 pt-4 p-3" >
		<StressTestCreator open={isOpen} onOpenChange={onOpenChange} />

		<Text v="big" >Test editor</Text>

		<div className="flex flex-col items-start gap-2" >
			<div className="grid grid-cols-2 gap-x-7 gap-y-2 mt-2 items-center " >
				<Text>Checker</Text>
				<Select value={checkerV}
					options={[...tc.checkers.map(x=>({value: x, label: x})), {value: null, label: "Choose file..."}]}
					// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
					onChange={(v: any) => send({type: "setChecker", checker: v.value as string})}
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
			
			<div className="flex flex-row gap-2 p-2 justify-center w-full flex-wrap" >
				<Button icon={<Icon icon="new-file" />} onClick={()=>send({type: "importTests"})} >Import test cases</Button>
				<Button icon={<Icon icon="wand" />} onClick={onOpen} >Create stress test</Button>
				<Button icon={<Icon icon="close" />} onClick={()=>send({type:"clearCompileCache"})} >Clear compile cache</Button>
				<Button icon={<Icon icon="link-external" />} onClick={()=>send({type:"openFile", path: appInit.buildDir,inOS: true})} >Show build directory</Button>
				<Button icon={<Icon icon="link-external" />} onClick={()=>send({type:"openFile", path: appInit.testSetDir, inOS: true})} >Show testset directory</Button>
				<Button icon={<Icon icon="settings-gear" />} onClick={()=>send({type:"openSettings"})} >Settings</Button>
			</div>
		</div>

		<div className="flex flex-col gap-2" ref={drag} >
			{order.map(k=>{
				return <div key={k} >
					<Divider/>
					<TestCase open={k==tc.openTest} focus={tc.focusOpenTest && k==tc.openTest} test={tc.cases[k]} i={k} />
				</div>;
			})}
		</div>

		<div className="flex flex-col items-center gap-2" >
			<IconButton icon={<Icon icon="add" className="text-3xl/7" />} onClick={()=>send({type: "createTestCase"})} />
			<Text v="dim" >Add test case</Text>
		</div>
	</div>;
}

render(App);