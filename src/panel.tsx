import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTestCases } from "./testcase";
import { render, useMessage, Text, Textarea, IconButton, Icon, send, FileName, Card, Divider } from "./ui";
import { InitState, MessageFromExt, RunCfg } from "./shared";

type Message = { which: "input"|"user"|"stdout"|"stderr"|"judge", txt: string };
const totalTxtLimit = 100*1024;

declare const init: InitState;

function InputBar({onAdd, disabled}: {onAdd: (x: Message)=>void, disabled?: boolean}) {
	const [v, setV] = useState("");
	const formRef = useRef<HTMLFormElement>(null);

	let nline=1;
	for (const x of v) if (x=="\n") nline++;

	const handle = () => {
		const vn = v+"\n";
		send({type: "testCaseInput", inp: vn})
		onAdd({which: "user", txt: vn});
		setV("");
	}

	return <form ref={formRef} className="flex flex-row w-full gap-2 items-center" onSubmit={(ev)=>{
		handle(); ev.preventDefault();
	}} >
		<Textarea disabled={disabled}
			className="flex-1 resize-none min-h-2 bg-zinc-800" value={v} onChange={(ev)=>setV(ev.target.value)}
			onKeyDown={(evt) => {
				if (evt.key=="Enter" && !evt.shiftKey) {
					handle();
					evt.preventDefault();
				}
			}} placeholder="Input to stdin" style={{
				height: `${nline*1.4+1}rem`
			}} />
		<IconButton disabled={disabled} icon={<Icon icon="send" />} ></IconButton>
	</form>;
}

type TermState = {
	i: number|null,
	inputPath: string|null,
	input: Extract<MessageFromExt,{type:"testCaseRead"}>|null,
	runCfg: RunCfg
};

function App() {
	const [msgs, setMsgs] = useState<[Message[],number]>([[],0]);

	const tcs = useTestCases();
	const runningI = tcs.run.runningTest;

	const [state, setState] = useState<TermState>({
		i: runningI??null,
		inputPath: null,
		input: null,
		runCfg: init.cfg
	});

	const preRef = useRef<HTMLPreElement>(null);

	const cond = runningI!=undefined && tcs.cases[runningI]?.cancellable==true;
	useEffect(() => {
		if (cond) {
			setMsgs([[],0]);
			const c = tcs.cases[runningI];
			setState({i: runningI, inputPath: c.inFile ?? null, input: null, runCfg: tcs.cfg});
			send({type: "readSource", i: runningI});
		}
	}, [runningI!=undefined && tcs.cases[runningI]?.cancellable==true]);

	const addMsg = useCallback((x: Message) => setMsgs(([xs,total]) => {
		const ns = [...xs,x];
		total += x.txt.length;
		let i=0;
		while (total>totalTxtLimit) {
			total-=ns[i].txt.length;
			i++;
		}

		if (i>0) {
			if (totalTxtLimit==total) return [ns.slice(i), totalTxtLimit];
			const s = ns[i-1].txt;
			const pv = {which: ns[i-1].which, txt: s.slice(s.length-(totalTxtLimit-total))};
			return [[ pv, ...ns.slice(i) ], totalTxtLimit];
		} else {
			return [ns, total];
		}
	}), []);

	const [fixScroll, setFixScroll] = useState(true);

	useEffect(() => {
		if (preRef.current==null) return;

		const scrollCb = ()=>setFixScroll(
			preRef.current!.scrollHeight-preRef.current!.clientHeight-preRef.current!.scrollTop<20
		);

		preRef.current.addEventListener("scroll", scrollCb);
		return ()=>preRef.current?.removeEventListener("scroll", scrollCb);
	}, [state.i==null])

	useEffect(() => {
		if (!fixScroll) return;

		if (preRef.current!=null) preRef.current.scroll({
			top: preRef.current.scrollHeight-preRef.current.clientHeight,
			behavior: "instant"
		});
	}, [msgs, fixScroll])

	useMessage((x) => {
		if (x.type=="testCaseStream") addMsg(x);
		else if (x.type=="testCaseRead" && x.which=="inFile" && x.i==state.i)
			setState(s=>({...s, input: x}));
	}, [state.i]);

	if (state.i==null)
		return <div className="flex items-center justify-center h-dvh" >
			<Text v="md" className="text-gray-400" >Run a test case to see its output or interact with it here</Text>
		</div>;

	return <div className="flex flex-col items-stretch w-dvw h-dvh p-2 px-5" >
		<pre className="flex-1 overflow-y-auto" ref={preRef} >
			{state.inputPath!=null && <Card className="mb-2" >
				<Text v="bold" >Input</Text>
				<span className="text-lime-200" >
					{state.input!=null && state.input.source==null
						? <FileName path={state.inputPath} >Test input is too large; it will not be shown here.</FileName>
						: state.input?.source ?? "Reading input file..."}{"\n"}
				</span>
			</Card>}

			{msgs[0].map((v,i) => {
				if (v.which=="user") {
					return <p key={i} className="w-full text-blue-500 bg-blue-100/10 px-1" ><span className="text-blue-300" >{">"}</span> {v.txt}</p>;
				} else if (v.which=="judge") {
					return <p key={i} className="w-full text-orange-500 bg-orange-100/10 px-1" ><span className="text-orange-300" >JUDGE:</span> {v.txt}</p>;
				} else {
					return <span key={i} className={v.which=="stdout" ? "text-gray-300" : "text-red-500"} >{v.txt}</span>;
				}
			})}
		</pre>
		<Divider className="mb-1 mt-0" />
		<InputBar disabled={runningI==undefined || state.runCfg.eof} onAdd={addMsg} />
	</div>;
}

render(App);