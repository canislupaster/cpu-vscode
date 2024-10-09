import React, { useEffect, useRef, useState } from "react";
import { useTestCases } from "./testcase";
import { render, useMessage, Text, Textarea, IconButton, Icon, send, Divider, Anchor, useUIState, Dropdown } from "./ui";
import { InitState, RunCfg, TestCase } from "./shared";
import { Switch } from "@nextui-org/switch";
import { Checkbox } from "@nextui-org/checkbox";

type Message = {
	which: "input"|"user"|"stdout"|"stderr"|"judge"|"interaction",
	txt: string, i: number
};
const totalTxtLimit = 10*1024;

declare const init: InitState;

const msgTy: Message["which"][] = ["input","user","stdout","stderr","judge","interaction"];
const styles: Record<Message["which"], [string, string, string]> = {
	input: ["text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-100/10", "bg-blue-200 dark:bg-blue-600", "input"],
	user: ["text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-100/10", "bg-blue-200 dark:bg-blue-600", "user"],
	interaction: ["text-teal-700 bg-teal-100 px-1 dark:text-teal-400 dark:bg-teal-100/10", "bg-teal-200 dark:bg-teal-600", "interactor"],
	judge: ["text-orange-700 bg-orange-100 px-1 dark:text-orange-400 dark:bg-orange-100/10", "bg-orange-200 dark:bg-orange-600", "judge"],
	stdout: ["text-gray-700 dark:text-gray-300", "bg-gray-200 dark:bg-gray-600", "stdout"],
	stderr: ["text-red-700 dark:text-red-500 bg-red-100 dark:bg-red-100/10", "bg-red-200 dark:bg-red-600", "stderr"]
};

for (const k in styles) {
	const s = styles[k as Message["which"]];
	s[0] = `${s[0]} px-1`;
	s[1] = `${s[1]} border-r-1 text-right text-gray-800 dark:text-gray-200 dark:border-r-zinc-600 border-r-zinc-200 pr-1 whitespace-nowrap`;
}

type UIState = {
	show: Record<Message["which"], boolean>,
	newlineOnEnter: boolean,
	showNewlines: boolean
};

const panelUIState = useUIState<UIState>({
	show: Object.fromEntries(msgTy.map((x=>[x,true]))) as Record<Message["which"],true>,
	newlineOnEnter: true,
	showNewlines: false
});

function InputBar({onAdd, disabled, uiState, updateUIState}: {
	onAdd: (x: Omit<Message,"i">)=>void, disabled?: boolean,
	uiState: UIState, updateUIState: (x: Partial<UIState>)=>void
}) {
	const [v, setV] = useState("");
	const formRef = useRef<HTMLFormElement>(null);

	let nline=1;
	for (const x of v) if (x=="\n") nline++;

	const handle = () => {
		const vn = uiState.newlineOnEnter ? v+"\n" : v;
		send({type: "testCaseInput", inp: vn})
		onAdd({which: "user", txt: vn});
		setV("");
	};

	return <form ref={formRef} className="flex flex-row w-full gap-2 items-center" onSubmit={(ev)=>{
		handle(); ev.preventDefault();
	}} >
		<Textarea disabled={disabled}
			className="flex-1 resize-none min-h-2 max-h-[60dvh]" value={v} onChange={(ev)=>setV(ev.target.value)}
			onKeyDown={(evt) => {
				if (evt.key=="Enter" && !evt.shiftKey) {
					handle();
					evt.preventDefault();
				}
			}} placeholder="Input to stdin" style={{
				height: `${nline*1.4+1}rem`
			}} />
		<IconButton disabled={disabled} icon={<Icon icon="send" />} ></IconButton>
		<Dropdown trigger={<IconButton type="button" icon={<Icon icon="settings-gear" />} ></IconButton>}
			parts={[
				{type: "big", txt: <Text v="dim" >Use shift-enter to add extra newlines</Text>},
				{type: "big", txt: <Switch size="sm" onValueChange={v=>updateUIState({showNewlines: v})}
					isSelected={uiState.showNewlines} >Show newlines</Switch>},
				{type: "big", txt: <Switch size="sm" onValueChange={v=>updateUIState({newlineOnEnter: v})}
					isSelected={uiState.newlineOnEnter} >End message with newline</Switch>},
				...msgTy.map(ty=>({type: "big" as const, txt: <Checkbox isSelected={uiState.show[ty]}
					onValueChange={v=>updateUIState({show: {...uiState.show, [ty]: v}})} >Receive {styles[ty][2]}</Checkbox>}))
			]} />
	</form>;
}

type TermState = {
	i: number|null,
	runCfg: RunCfg,
	tc: TestCase|null
};

function App() {
	const [msgs, setMsgs] = useState<[Message[],number,number]>([[],0,0]);
	const [uiState, setUIState] = useState(()=>panelUIState.uiState());

	const tcs = useTestCases();
	const runningI = tcs.run.runningTest;

	const [state, setState] = useState<TermState>({
		i: runningI??null,
		runCfg: init.cfg,
		tc: null
	});

	const preRef = useRef<HTMLTableElement>(null);

	const cond = runningI!=undefined && tcs.cases[runningI]?.cancellable==true;
	useEffect(() => {
		if (cond) {
			setMsgs([[],0,0]);
			const c = tcs.cases[runningI];
			setState({i: runningI, tc: c, runCfg: tcs.cfg});
			send({type: "panelReady"});
		}
	}, [cond, runningI]);

	const addMsg = (x: Omit<Message,"i">) => {
		if (!uiState.show[x.which]) return;

		setMsgs(([xs,total,ni]) => {
			const ns = [...xs,{...x, i: ni++}];
			total += x.txt.length;
			let i=0;
			while (total>totalTxtLimit) {
				total-=ns[i].txt.length;
				i++;
			}

			if (i>0) {
				if (totalTxtLimit==total) return [ns.slice(i), totalTxtLimit, ni];
				const s = ns[i-1].txt;
				const pv = {which: ns[i-1].which, i: ni++, txt: s.slice(s.length-(totalTxtLimit-total))};
				return [[ pv, ...ns.slice(i) ], totalTxtLimit, ni];
			} else {
				return [ns, total, ni];
			}
		});
	};

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
	}, [state.i, uiState.show]);

	return <div className="flex flex-col items-stretch w-dvw h-dvh p-2 pt-1 px-5" >
		{state.tc && <Text v="dim" className="mb-1" >
			Test <Anchor onClick={()=>{
				if (state.i!=null) send({type:"openTest", i: state.i});
			}} >{state.tc.name}</Anchor>
			{cond ? <> (<Anchor onClick={()=>{
				send({type:"cancelRun", i: runningI});
			}} >stop</Anchor>)</> : runningI!=undefined ? " (running)" : " (stopped)"}
			{msgs[0].length>0 && <>{", "}<Anchor onClick={()=>{
				setMsgs([[],0,0]);
			}} >Clear</Anchor></>}
		</Text>}

		{msgs[0].length==0 ? <div className="flex items-center justify-center h-dvh" >
			<Text v="md" className="text-gray-400" >Run a test case to see its output or interact with it here</Text>
		</div>
		: <div className="flex-1 overflow-y-auto font-mono break-all" ref={preRef} >
			<table>
				{msgs[0].map(v => {
					const [style,leftStyle,name] = styles[v.which];
					const trs: React.ReactNode[]=[];

					for (let i=0; i<v.txt.length; i++) {
						const j=i;
						while (i<v.txt.length && v.txt[i]!='\n') i++;

						if (!uiState.showNewlines && i==j) continue;

						const c = uiState.showNewlines && v.txt[i]=='\n'
							? <>{v.txt.slice(j,i)}<span className="dark:text-gray-400 text-gray-600" >\n</span></>
							: v.txt.slice(j,i);

						trs.push(<tr key={`${v.i},${i}`} className={style} >
							<td className={leftStyle} >{name}</td>
							<td className="w-full pl-1" >{c}</td>
						</tr>);
					}

					return trs;
				})}
			</table>
		</div>}

		<Divider className="mb-1 mt-0" />
		<InputBar disabled={runningI==undefined || state.runCfg.eof} onAdd={addMsg} uiState={uiState}
			updateUIState={(x: Partial<UIState>) => setUIState(panelUIState.update(x))} />
	</div>;
}

render(App);