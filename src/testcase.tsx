//ok fuck esbuild is so crappy or something, react needs to be included for <></> to work
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { RunState, TestCase, testErr, TestOut, TestResult, TestSets, Theme } from "./shared";
import { IconButton, send, useMessage, Text, Icon, Button, Card, Textarea, verdictColor, FileName, Alert, HiddenInput, Dropdown, DropdownPart, Input, toSearchString, Anchor, setUiState, uiState, appInit, bgColor, useTheme } from "./ui";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection, ViewUpdate } from "@codemirror/view";
import { EditorState, Text as CMText, ChangeSet, Extension } from "@codemirror/state";
import { unifiedMergeView } from "@codemirror/merge";
import { Switch } from "@nextui-org/switch";

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
	const [tcs, setTcs] = useState<Record<number,TestCase>>(appInit.cases);
	const [ordered, setOrder] = useState<number[]>(appInit.order);
	const [run, setRun] = useState<RunState>(appInit.run);

	const [state, setState] = useState({
		...appInit, cases: undefined, order: undefined, run: undefined, focusOpenTest: false,
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
			case "updateCheckers": setState(s=>({...s, checkers: msg.checkers})); break;
			case "openTest": setState(s=>({...s, openTest: msg.i, focusOpenTest: msg.focus})); break;
			case "updateProgram": setState(s=>({...s, openFile: msg.openFile})); break;
			case "updateLanguagesCfg": setState(s=>({...s, languagesCfg: msg.cfg})); break;
			case "updateRunState": setRun(msg.run); break;
			case "updateTestSets": setState(s=>({...s, currentTestSet: msg.current, testSets: msg.sets})); break;
		}
	});

	return {...state, cases: tcs, ordered, run};
}

const mainTheme = (err: boolean, theme: Theme) => EditorView.theme({
	".cm-gutters": {
		"backgroundColor": theme=="dark" ? "#1e1e1e" : "#e3e4e6",
		"color": theme=="dark" ? "#838383" : "#7e7f80"
	},
	"&": {
		"backgroundColor": theme=="dark" ? "#1e1e1e" : "#e5e7eb",
		"color": err ? (theme=="dark" ? "#ef4444" : "#dc2626") : (theme=="dark" ? "#9cdcfe" : "#2563eb"),
		"max-height": "10rem",
		"flex-grow": "1",
		width: "0",
		"border-radius": "0.5rem",
		"outline": theme=="dark" ? "2px solid #52525b" : "2px solid #9ca3af",
		"padding": "2px",
		"transition-property": "outline",
		"transition-timing-function": "cubic-bezier(0.4, 0, 0.2, 1)",
		"transition-duration": "300ms",
	},
	"&.cm-editor.cm-focused": {
		"outline": theme=="dark" ? "2px solid #3B82F6" : "2px solid #2563eb",
	},
	"&.cm-editor .cm-scroller": {
		"fontFamily": "Menlo, Monaco, Consolas, \"Andale Mono\", \"Ubuntu Mono\", \"Courier New\", monospace"
	},
	".cm-content": {
		"caretColor": theme=="dark" ? "#c6c6c6" : "#4b5563"
	},
	".cm-cursor, .cm-dropCursor": {
		"borderLeftColor": theme=="dark" ? "#c6c6c6" : "#4b5563"
	},
	".cm-activeLine": {
		"backgroundColor": theme=="dark" ? "#ffffff0f" : "#edeff0"
	},
	".cm-activeLineGutter": {
		"color": theme=="dark" ? "#c7c5c3" : "#000",
		"backgroundColor": theme=="dark" ? "#ffffff0f" : "#edeff0"
	},
	"&.cm-focused .cm-selectionBackground, & .cm-line::selection, & .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection": {
		"background": theme=="dark" ? "#6199ff2f !important" : "#bfdbfe !important"
	},
	"& .cm-selectionMatch": {
		"backgroundColor": theme=="dark" ? "#72a1ff59" : "#93c5fd59"
	}
}, { dark: theme=="dark" });

export const baseExt = (err: boolean, readOnly: boolean, theme: Theme) => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
	mainTheme(err, theme),
	drawSelection(),
	rectangularSelection(),
	crosshairCursor(),
	highlightSelectionMatches(),
	EditorView.contentAttributes.of({tabindex: "10"}),
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
const makeBasesForTheme = (x: Theme) => ({
	err: baseExt(true, true, x),
	out: baseExt(false, true, x),
	edit: baseExt(false, false, x)
});

const bases: Record<Theme, Record<EditorType["type"], Extension>> = {
	light: makeBasesForTheme("light"), dark: makeBasesForTheme("dark")
};

export const exts = ({type, onc, theme}: EditorType&{onc?: (x: ViewUpdate)=>void, theme: Theme}) => [
	bases[theme][type],
	...onc!=undefined ? [
		EditorView.updateListener.of(onc),
	] : []
];

export function CMReadOnly({v, err, original}: {v: string, err?: boolean, original?: string}) {
	const [editor, setEditor] = useState<EditorView|null>(null);
	const cmDiv = useRef<HTMLDivElement>(null);

	const theme = useTheme();

	useEffect(() => {
		const edit = new EditorView({
			parent: cmDiv.current!,
			doc: v,
			extensions: [
				exts({type: err ? "err" : "out", theme}),
				...original ? unifiedMergeView({
					mergeControls: false,
					original
				}) : []
			],
		});

		setEditor(edit);
		return () => edit.destroy();
	}, [original, theme]);

	useEffect(()=>{
		if (editor!=null)
			editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: v}});
	}, [v])

	return <div ref={cmDiv} className="flex flex-row" />;
}

const DiffContext = createContext<{isDiff: boolean, setDiff: (x: boolean)=>void}>({isDiff: false, setDiff: ()=>{}})

export function DiffContextProvider({children}: {children: React.ReactNode}) {
	const [isDiff, setDiff] = useState(uiState.diff);
	return <DiffContext.Provider value={{isDiff, setDiff: (nd) => {
		setDiff(nd);
		setUiState({diff: nd});
	}}} >
		{children}
	</DiffContext.Provider>;
}

export const TestCaseOutput = React.memo(({i, test, useCard, answer}: {i: number, test: TestCase, answer?: string, useCard?: boolean}) => {
	const {isDiff, setDiff} = useContext(DiffContext);

	const out = useTestOutput(i);
	if (out==null) return <></>;

	const inner = <>
		<div className="flex flex-row justify-between items-center gap-2 flex-wrap" >
			<Text v="md" >Output</Text>
			<div className="flex flex-row gap-1 items-center" >
				<Switch isSelected={isDiff} onValueChange={setDiff} className="mr-2" size="sm" >Diff</Switch>
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

		<CMReadOnly v={out.stdout} original={answer && test.lastRun && isDiff ? answer : undefined} />

		{out.stderr.length>0 && <>
			<div className="flex flex-row justify-between" >
				<Text v="bold" >Stderr</Text>
				{<IconButton icon={<Icon icon="copy" />} onClick={()=>{
					void window.navigator.clipboard.writeText(out.stderr);
				}} ></IconButton>}
			</div>
			<CMReadOnly err v={out.stderr} />
		</>}

		{out.hiddenSize && <FileName path={out.path} className="self-center" ><Button className="w-full py-1" onClick={()=>{
			send({type: "openFile", path: out.path})
		}} >
			Show all output <Text v="dim" >({Math.ceil(out.hiddenSize/1024)} KB hidden)</Text>
		</Button></FileName>}

		{out.judge && <div>
			<Text v="lg" >Checker output</Text>
			<Textarea value={out.judge} readOnly className={`font-mono min-h-20 ${bgColor.secondary} mt-2 ${test.lastRun?.verdict!=null
				? verdictColor[test.lastRun.verdict].text : "dark:text-lime-400 text-lime-700"} ${bgColor.default}`} rows={2} />
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
	const theme = useTheme();

	useEffect(() => {
		const edit = new EditorView({
			parent: cmDiv.current!,
			extensions: exts({type: "edit", theme, onc(x) {
				if (x.docChanged) setV(s=>{
					if (s.lastSrcChange==x.changes) return s;
					else return {...s, txt: x.state.doc};
				});
			}})
		});

		setEditor(edit);
		return () => edit.destroy();
	}, [theme]);

	useEffect(()=>{
		if (editor==null) return;

		const upd = ()=>{
			const txt = CMText.of(source.split("\n"));
			if (editor.state.doc.eq(txt)) {
				setV({lastSrcChange: v.lastSrcChange, txt: null})
				return;
			}

			const l = editor.state.doc.length;
			const changes = ChangeSet.of({from: 0, to: l, insert: txt},l);
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
					<Button className={bgColor.sky}
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

//mounted in popover
//if it focuses too soon, then popover has not measured itself yet and we scroll to a random ass place
//what the fuck.
function LazyAutoFocusSearch({search,setSearch}:{search: string, setSearch: (x:string)=>void}) {
	const ref = useRef<HTMLInputElement>(null);

	useEffect(()=>{
		const t = setTimeout(()=>ref.current?.focus(), 50);
		return ()=>clearTimeout(t);
	});

	return <Input placeholder="Search..." ref={ref}
		className="rounded-b-none rounded-t-md"
		value={search} onChange={(ev) => {
			setSearch(ev.target.value)
		}} />;
}

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

	const prev = cur.prev!=undefined && cur.prev in testSets ? cur.prev : null;
	const nxt = cur.next!=undefined && cur.next in testSets ? cur.next : null;

	return <Card className="flex flex-col sm:flex-row sm:gap-6 flex-wrap items-stretch md:items-center" >
		<div className="flex flex-col gap-1 items-center" >
			<div className="flex flex-row justify-between gap-2 px-2 self-stretch" >
				{prev!=null && <IconButton icon={<Icon icon="chevron-left" />}
					onClick={()=>send({type:"switchTestSet", i: prev})} />}

				<div className="flex flex-row gap-2 items-center w-full justify-center" >
					<Text v="bold" className="text-nowrap" >Test set:</Text>

					{cur.group ? <Text>{cur.name}</Text> : <HiddenInput minLength={1} maxLength={25}
						className="flex-1 overflow-x-clip w-0"
						value={cur.name}
						onChange={(e)=>send({type: "renameTestSet", name: e.target.value})} />}
				</div>

				{nxt!=null && <IconButton icon={<Icon icon="chevron-right" />}
					onClick={()=>send({type:"switchTestSet", i: nxt})} />}
			</div>
			
			{cur.group && (cur.problemLink
				? <Anchor onClick={()=>send({type:"openTestSetUrl", i: currentTestSet})} >{cur.group}</Anchor>
				: <Text v="dim" >{cur.group}</Text>)}

			<div className="flex flex-row gap-2 flex-wrap justify-center w-full mt-1" >
				<Button icon={<Icon icon="add" />}
					onClick={()=>send({type:"createTestSet"})}
					className={bgColor.sky} >New</Button>

				<Button icon={<Icon icon="trash" />}
					onClick={()=>send({type:"deleteTestSet", i: currentTestSet})}
					className={bgColor.rose} >Delete</Button>

				<Dropdown trigger={
					<Button icon={<Icon icon="arrow-swap" />} >Switch</Button>
				} parts={[
					{
						type: "txt",
						txt: <LazyAutoFocusSearch search={search} setSearch={setSearch} />,
						key: "search"
					},
					...sets
				]} onOpenChange={(x)=>{
					if (!x) setSearch("");
				}} />
			</div>
		</div>
	</Card>;
});

export function SetProgram({tc}: {tc: ReturnType<typeof useTestCases>}) {
	return <Card className="flex flex-col sm:flex-row sm:gap-6 flex-wrap items-center" >
		<div className="flex flex-row gap-2 items-center justify-center" >
			<Text v="bold" >Active program:</Text>
			{tc.openFile!=null ? <FileName path={tc.openFile.path} /> : <Text v="err" >none set</Text>}
		</div>
		<div className="flex flex-row gap-2 items-center justify-center" >
			<Button className="min-w-40" onClick={()=>{
				send({type:"setProgram", cmd:tc.openFile==null ? "open" : "clear"});
			}} >{tc.openFile==null ? "Choose program" : "Clear"}</Button>
			{tc.openFile!=null && tc.openFile.type=="last" &&
				<IconButton icon={<Icon icon="pinned" />} onClick={()=>send({type:"setProgram", cmd:"setLast"})} />}
		</div>
	</Card>;
}

export function TestErr({x,pre,noFile,className}: {x: Pick<TestCase,"err">,pre?:string,noFile?:boolean,className?:string}) {
	const e = testErr(x);

	return e && <Alert className={className} bad title={e.title} txt={<>
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