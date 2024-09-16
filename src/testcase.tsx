//ok fuck esbuild is so crappy or something, react needs to be included for <></> to work
import React, { useEffect, useRef, useState } from "react";
import { InitState, RunState, TestCase, testErr, TestOut, TestResult, TestSets } from "./shared";
import { IconButton, send, useMessage, Text, Icon, Button, Card, Textarea, verdictColor, FileName, Alert, HiddenInput, Dropdown, DropdownPart, Input, toSearchString } from "./ui";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection, ViewUpdate } from "@codemirror/view";
import { EditorState, Text as CMText, ChangeSet, Extension } from "@codemirror/state";
import { unifiedMergeView } from "@codemirror/merge";

declare const init: InitState;
export const appInit = init;

type TestSource = {
	value: string|null,
	init: boolean
};

type UseTestSource = { input: TestSource, answer: TestSource };

export function useTestSource(i: number) {
	const [res, setRes] = useState<UseTestSource>({
		input: {value: null, init: false}, answer: {value: null, init: false}
	});

	useEffect(()=>send({type: "readSource", i}), []);
	useMessage((msg) => {
		if (msg.type=="testCaseRead" && msg.i==i) setRes(x=>{
			const ns = {...x};
			const y = {value: msg.source, init: true};
			if (msg.which=="inFile") ns.input=y; else ns.answer=y;
			return ns;
		});
	});
	return res;
}

export function useTestOutput(i: number) {
	const [res, setRes] = useState<null|TestOut>(null);
	useEffect(()=>send({type: "readOutput", i}), []);
	useMessage((msg)=>{
		if (msg.type=="testCaseOutput" && msg.i==i)
			setRes(msg.out ?? null);
	});

	return res;
}

export function useTestCases() {
	const [tcs, setTcs] = useState<Record<number,TestCase>>(init.cases);
	const [ordered, setOrder] = useState<number[]>(init.order);
	const [run, setRun] = useState<RunState>(init.run);

	const [state, setState] = useState({
		cfg: init.cfg, checker: init.checker, checkers: init.checkers,
		openTest: init.openTest, focusOpenTest: false,
		openFile: init.openFile, testSets: init.testSets, currentTestSet: init.currentTestSet
	});

	useMessage((msg) => {
		switch (msg.type) {
			case "reorderTests": setOrder(msg.order); break;
			case "updateTestCases": setTcs(x=>{
				const newTcs = {...x};

				for (const k in msg.testCasesUpdated) {
					if (msg.testCasesUpdated[k])
						newTcs[k]=msg.testCasesUpdated[k];
					else delete newTcs[k];
				}

				return newTcs;
			}); break;

			case "updateCfg": setState(s=>({...s, cfg: msg.cfg})); break;
			case "updateChecker": setState(s=>({...s, checker: msg.checker, checkers: msg.checkers})); break;
			case "openTest": setState(s=>({...s, openTest: msg.i, focusOpenTest: msg.focus})); break;
			case "updateProgram": setState(s=>({...s, openFile: msg.path})); break;
			case "updateRunState": setRun(msg.run); break;
			case "updateTestSets": setState(s=>({...s, currentTestSet: msg.current, testSets: msg.sets})); break;
		}
	});

	return {...state, cases: tcs, ordered, run};
}

const mainTheme = (err: boolean) => EditorView.theme({
	".cm-gutters": {
		"backgroundColor": "#1e1e1e",
		"color": "#838383"
	},
	"&": {
		"backgroundColor": "#1e1e1e",
		"color": err ? "#f27b63" : "#9cdcfe",
		"max-height": "10rem",
		"flex-grow": "1",
		width: "0",
		"border-radius": "0.5rem",
		"outline": "2px solid #52525b",
		"padding": "2px",
		"transition-property": "outline",
		"transition-timing-function": "cubic-bezier(0.4, 0, 0.2, 1)",
		"transition-duration": "300ms",
	},
	"&.cm-editor.cm-focused": {
		"outline": "2px solid #3B82F6",
	},
	"&.cm-editor .cm-scroller": {
		"fontFamily": "Menlo, Monaco, Consolas, \"Andale Mono\", \"Ubuntu Mono\", \"Courier New\", monospace"
	},
	".cm-content": {
		"caretColor": "#c6c6c6"
	},
	".cm-cursor, .cm-dropCursor": {
		"borderLeftColor": "#c6c6c6"
	},
	".cm-activeLine": {
		"backgroundColor": "#ffffff0f"
	},
	".cm-activeLineGutter": {
		"color": "#c7c5c3",
		"backgroundColor": "#ffffff0f"
	},
	"&.cm-focused .cm-selectionBackground, & .cm-line::selection, & .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection": {
		"background": "#6199ff2f !important"
	},
	"& .cm-selectionMatch": {
		"backgroundColor": "#72a1ff59"
	}
}, {dark: true});

export const baseExt = (err: boolean, readOnly: boolean) => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
	mainTheme(err),
	drawSelection(),
	rectangularSelection(),
	crosshairCursor(),
	highlightSelectionMatches(),
	keymap.of([
		...defaultKeymap,
		...searchKeymap,
		...historyKeymap
	]),
	...readOnly ? [
		EditorState.readOnly.of(true)
	] : [
		history(),
		dropCursor()
	]
];

type EditorType = { type: "err" } | { type: "out" } | { type: "edit", onc: (x: ViewUpdate)=>void };
const bases: Record<EditorType["type"], Extension> = {
	err: baseExt(true, true),
	out: baseExt(false, true),
	edit: baseExt(false, false)
}

export const exts = ({type, onc}: EditorType&{onc?: (x: ViewUpdate)=>void}) => [
	bases[type],
	...onc!=undefined ? [
		EditorView.updateListener.of(onc),
	] : []
];

export function CMReadOnly({v, err, original}: {v: string, err?: boolean, original?: string}) {
	const [editor, setEditor] = useState<EditorView|null>(null);
	const cmDiv = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const edit = new EditorView({
			parent: cmDiv.current!,
			extensions: [
				exts({type: err ? "err" : "out"}),
				...original ? unifiedMergeView({
					mergeControls: false,
					original
				}) : []
			]
		});

		setEditor(edit);
		return () => edit.destroy();
	}, [original]);

	useEffect(()=>{
		if (editor!=null)
			editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: v}});
	}, [v, editor==null])

	return <div ref={cmDiv} className="flex flex-row" />;
}

export const TestCaseOutput = React.memo(({i, test, useCard, answer}: {i: number, test: TestCase, answer?: string, useCard?: boolean}) => {
	const out = useTestOutput(i);
	if (out==null) return <></>;

	const inner = <>
		<div className="flex flex-row justify-between items-center gap-2" >
			<Text v="md" >{answer ? "Output (diff)" : "Output"}</Text>
			<div className="flex flex-row gap-1 items-center" >
				{out.stdout.length>0 && <IconButton icon={<Icon icon="copy" />} onClick={()=>{
					void window.navigator.clipboard.writeText(out.stdout);
				}} ></IconButton>}
				<FileName path={out.path} >
					<IconButton icon={<Icon icon="link-external" />} onClick={
						()=>send({type: "openFile", path: out.path})
					} ></IconButton>
				</FileName>
			</div>
		</div>

		<CMReadOnly v={out.stdout} original={answer && test.lastRun ? answer : undefined} />

		{out.stderr.length>0 && <>
			<div className="flex flex-row justify-between" >
				<Text v="bold" >Stderr</Text>
				{<IconButton icon={<Icon icon="copy" />} onClick={()=>{
					void window.navigator.clipboard.writeText(out.stderr);
				}} ></IconButton>}
			</div>
			<CMReadOnly err v={out.stderr} />
		</>}

		{out.hiddenSize && <FileName path={out.path} className="self-center sm:self-start" ><Button className="w-full py-1" onClick={()=>{
			send({type: "openFile", path: out.path})
		}} >
			Show all output <Text v="dim" >({Math.ceil(out.hiddenSize/1024)} KB hidden)</Text>
		</Button></FileName>}

		{out.judge && <div>
			<Text v="lg" >Checker output</Text>
			<Textarea value={out.judge} readOnly className={`font-mono min-h-20 bg-zinc-900 mt-2 ${test.lastRun?.verdict!=null
				? `text-${verdictColor(test.lastRun.verdict)}` : "text-lime-400"}`} rows={2} />
		</div>}
	</>;

	if (useCard) return <Card className="px-4 py-2" >{inner}</Card>;
	else return inner;
});

type TestCaseFileProps = {
	i: number, source: string|null,
	which: "inFile"|"ansFile", path?: string
};

function TestCaseFileEditor({i,which,source}:TestCaseFileProps&{path:string,source:string}) {
	const [v,setV] = useState<{txt: CMText|null, lastSrcChange: ChangeSet|null}>({
		txt: null, lastSrcChange: null
	});
	const [editor, setEditor] = useState<EditorView|null>(null);
	const cmDiv = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const edit = new EditorView({
			parent: cmDiv.current!,
			extensions: exts({type: "edit", onc(x) {
				if (x.docChanged) setV(s=>{
					if (s.lastSrcChange==x.changes) return s;
					else return {...s, txt: x.state.doc};
				});
			}})
		});

		setEditor(edit);
		return () => edit.destroy();
	}, []);

	useEffect(()=>{
		if (editor==null) return;

		const upd = ()=>{
			const l = editor.state.doc.length;
			const changes = ChangeSet.of({from: 0, to: l, insert: source},l);
			editor.dispatch({changes});

			setV({lastSrcChange: changes, txt: null});
		};

		//no pending changes
		if (v.txt==null) return upd();

		//ample time for debounce below + file update
		//if anything fails fallback to source
		const tm = setTimeout(upd, 1200);
		return ()=>clearTimeout(tm);
	}, [source,v.txt,editor]);

	useEffect(()=>{
		const c = v.txt;
		if (c!=null) {
			const tm = setTimeout(()=>send({type: "setSource", i, source: c.toString(), which}), 500);
			return () => clearTimeout(tm);
		} else {
			return ()=>{};
		}
	}, [v.txt]);

	return <div ref={cmDiv} className="flex flex-row" />;
}

export const TestCaseFile = React.memo(({i, which, path, source}: TestCaseFileProps)=>{
	return <>
		<div className="flex flex-row justify-between" >
			<Text v="md" >{which=="inFile" ? "Input" : "Answer"}</Text>
			<div className="flex flex-row gap-1" >
				{source!=null && path!=null && <IconButton icon={<Icon icon="copy" />} onClick={()=>
					void window.navigator.clipboard.writeText(source)
				} ></IconButton>}
				{path!=null && <FileName path={path} ><IconButton icon={<Icon icon="link-external" />} onClick={
					()=>send({type: "openFile", path})
				} ></IconButton></FileName>}
			</div>
		</div>
		{source!=null && path!=null ? <TestCaseFileEditor {...{i,which,path,source}} />
		: <div className="flex flex-col p-3 w-full justify-center items-center gap-2" >
			{path==null ? <>
				<Text v="dim" >{"This file hasn't been initialized yet. Import something from disk or create an empty file."}</Text>
				<div className="flex flex-row gap-2" >
					<Button className="bg-blue-600"
						onClick={()=>send({type: "setTestFile", i, which, ty: "create"})} >Create</Button>
					<Button onClick={()=>send({type: "setTestFile", i, which, ty: "import"})} >Import</Button>
				</div>
			</> : <>
				<Text v="dim" >This file is too large to show here</Text>
				<Button onClick={()=>send({type: "openFile", path})} >Open in new editor</Button>
			</>}
		</div>}
	</>;
});

export const TestSetStatus = React.memo(({testSets, currentTestSet}: {
	testSets: TestSets, currentTestSet: number
})=>{
	const [search, setSearch] = useState("");
	const sets = Object.entries(testSets).filter(([,v]) =>
		search=="" || toSearchString(v.name).includes(toSearchString(search))
	).map(([k,v]): DropdownPart => {
		const ki = Number(k);
		return {type: "act", key: ki, name: <>
				{v.group && <Icon icon="cloud-download" />}{v.name}
			</>, active: ki==currentTestSet, act(){
			if (currentTestSet!=ki) send({type: "switchTestSet", i: ki});
		}};
	});

	const cur = testSets[currentTestSet];
	return <Card className="flex flex-col sm:flex-row sm:gap-6 flex-wrap items-stretch md:items-center" >
		<div className="flex flex-col gap-1 items-center" >
			<div className="flex flex-row gap-2 items-center w-full justify-center px-2" >
				<Text v="bold" className="text-nowrap" >Test set:</Text>

				{cur.group ? <Text>{cur.name}</Text> : <HiddenInput minLength={1} maxLength={25}
					className="flex-1 overflow-x-clip"
					value={cur.name}
					onChange={(e)=>send({type: "renameTestSet", name: e.target.value})} />}
			</div>
			
			{cur.group && <Text v="dim" > {cur.group} </Text>}

			<div className="flex flex-row gap-2 flex-wrap justify-center w-full mt-1" >
				<Button icon={<Icon icon="trash" />}
					onClick={()=>send({type:"deleteTestSet", i: currentTestSet})}
					className="bg-rose-900" >Delete</Button>

				<Dropdown trigger={
					<Button icon={<Icon icon="arrow-swap" />} >Switch</Button>
				} parts={[
					{type: "txt", txt: <Input placeholder="Search..." value={search} onChange={(ev) => {
							setSearch(ev.target.value)
						}} />, key: "search" },
					...sets,
					{ type: "act", name: <><Icon icon="add" /> Create testset</>,
						act() {
							//nextjs animates close of popover and then focuses document, which closes input box
							//so we need some delay to ensure popover has closed
							//(fuck)
							setTimeout(()=>send({type: "createTestSet"}), 200);
						}, key: "add"
					}
				]} />
			</div>
		</div>
	</Card>;
});

export function SetProgram({tc}: {tc: ReturnType<typeof useTestCases>}) {
	return <Card className="flex flex-col sm:flex-row sm:gap-6 flex-wrap items-center" >
		<div className="flex flex-row gap-2 items-center justify-center" >
			<Text v="bold" >Active program:</Text>
			{tc.openFile!=null ? <FileName path={tc.openFile} /> : <Text className="text-red-400" >none set</Text>}
		</div>
		<Button className="min-w-40" onClick={()=>{
			send({type:"setProgram", clear: tc.openFile!=null});
		}} >{tc.openFile==null ? "Choose program" : "Clear"}</Button>
	</Card>;
}

export function TestErr({x,pre,noFile}: {x: Pick<TestCase,"err">,pre?:string,noFile?:boolean}) {
	const e = testErr(x);

	return e && <Alert bad title={e.title} txt={<>
		{pre && <Text v="dim" >({pre}) </Text>}
		{e.msg}
		<br/>
		{!noFile && <FileName path={e.file} />}
	</>} ></Alert>;
}

type RunStatTypes = "wallTime"|"cpuTime"|"mem"|"exitCode";
type RunStatProps = Partial<Pick<TestResult,RunStatTypes>>;
export const RunStats = ({x}: {x: RunStatProps}) => <Text v="dim" >
	{[
		`${x.wallTime!=null ? (x.wallTime/1000).toFixed(3) : "?"} s (wall)`,
		`${x.cpuTime!=null ? (x.cpuTime/1000).toFixed(3) : "?"} s (cpu)`,
		`${x.mem!=null ? Math.ceil(x.mem) : "?"} MB`,
		...x.exitCode ? [`exit code ${x.exitCode}`] : []
	].join(", ")}
</Text>;