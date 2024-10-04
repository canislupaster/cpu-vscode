import "../node_modules/@vscode/codicons/dist/codicon.css";

import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/popover";
import { twMerge } from "tailwind-merge";
import { Spinner, SpinnerProps } from "@nextui-org/spinner";
import React, { AnchorHTMLAttributes, createContext, forwardRef, HTMLAttributes, PointerEvent, useContext, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipPlacement } from "@nextui-org/tooltip";
import { NextUIProvider } from "@nextui-org/system";
import { InitState, MessageFromExt, MessageToExt, TestResult, Theme } from "./shared";
import ReactSelect, { ClassNamesConfig } from "react-select";
import { createRoot } from "react-dom/client";
import { animations, handleDragstart, handleEnd, ParentConfig, performSort, } from "@formkit/drag-and-drop";
import { useDragAndDrop } from "@formkit/drag-and-drop/react";
import { Modal, ModalProps } from "@nextui-org/modal";

declare const init: InitState;
export const appInit = init;

export const textColor = {
	sky: "dark:text-sky-400 text-sky-700",
	green: "dark:text-green-500 text-green-700",
	red: "dark:text-red-500 text-red-700",
	default: "dark:text-white text-zinc-800 dark:disabled:text-gray-400 disabled:text-gray-500"
};

export const bgColor = {
	default: "dark:bg-zinc-800 bg-zinc-200 dark:disabled:bg-zinc-600",
	md: "dark:bg-zinc-850 bg-zinc-150 dark:disabled:bg-zinc-600",
	secondary: "dark:bg-zinc-900 bg-zinc-100",
	green: "dark:enabled:bg-green-600 enabled:bg-green-400",
	sky: "dark:enabled:bg-sky-600 enabled:bg-sky-300",
	red: "dark:enabled:bg-red-600 enabled:bg-red-400",
	rose: "dark:enabled:bg-rose-900 enabled:bg-rose-400"
}

export const borderColor = {
	default: "focus:outline-none focus:border-blue-500 active:border-blue-500 border-zinc-300 hover:border-zinc-400 dark:border-zinc-600 dark:hover:border-zinc-600 disabled:bg-zinc-300 aria-expanded:border-blue-500"
};

const containerDefault = `${textColor.default} ${bgColor.default} ${borderColor.default}`;

export type InputProps = {icon?: React.ReactNode}&React.InputHTMLAttributes<HTMLInputElement>;
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({className, icon, ...props}, ref) =>
		<input ref={ref} type="text" className={twMerge(`w-full p-2 border-2 transition duration-300 rounded-lg ${icon ? "pl-11" : ""}`, containerDefault, className)} {...props} />
);

export const Textarea = forwardRef<HTMLTextAreaElement, JSX.IntrinsicElements["textarea"]>((
	{className, children, ...props}: JSX.IntrinsicElements["textarea"], ref
) =>
	<textarea className={twMerge("w-full p-2 border-2 transition duration-300 rounded-lg resize-y max-h-60 min-h-24", containerDefault, className)}
		rows={6} {...props} ref={ref} tabIndex={100} >
		{children}
	</textarea>);

export const Button = ({className, disabled, icon, ...props}: HTMLAttributes<HTMLButtonElement>&{icon?: React.ReactNode, disabled?: boolean}) =>
	<button disabled={disabled} className={twMerge("flex flex-row justify-center gap-1.5 px-4 py-1.5 items-center rounded-xl border group", containerDefault, icon ? "pl-3" : "", className)} {...props} >
		{icon}
		{props.children}
	</button>;

export const HiddenInput = ({className, ...props}: React.InputHTMLAttributes<HTMLInputElement>) =>
	<input className={twMerge(`bg-transparent border-0 outline-none border-b-2
		focus:outline-none focus:border-blue-500 transition duration-300 px-1 py-px`, borderColor.default, className)}
		{...props} ></input>

export const IconButton = ({className, icon, disabled, ...props}: {icon?: React.ReactNode, disabled?: boolean}&JSX.IntrinsicElements["button"]) =>
	<button className={twMerge("rounded-full p-2 border flex items-center justify-center", containerDefault, className)} disabled={disabled} {...props} >
		{icon}
	</button>;

export const Anchor: React.FC<AnchorHTMLAttributes<HTMLAnchorElement>> = ({className,children,...props}) => {
	const classN = twMerge(
	`text-gray-600 dark:text-gray-300 inline-flex flex-row align-baseline items-baseline gap-1 underline decoration-dashed decoration-1
		underline-offset-2 transition-all hover:text-black dark:hover:text-gray-50 hover:bg-cyan-100/5 cursor-pointer`,className
	);

	return <a className={classN} {...props} >{children}</a>;
}

export const LinkButton = ({className, icon, ...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>&{icon?: React.ReactNode}) =>
	<a className={twMerge('flex flex-row gap-2 px-3 py-1.5 bg-zinc-900 items-center border text-white rounded-xl border-zinc-900 hover:border-zinc-700 active:border-blue-500 text-sm',className)} rel="noopener noreferrer" {...props} >
		{icon &&
			<span className="inline-block h-4 w-auto" >{icon}</span> }
		{props.children}
	</a>;

export function StyleClasses({f,classStyles}: {f: (setRef: React.Ref<HTMLElement|null>)=>React.ReactNode, classStyles: Record<string, Partial<CSSStyleDeclaration>>}) {
	const ref = useRef<HTMLElement|null>(null);
	useEffect(()=>{
		const e = ref.current!;
		for (const [cls, styles] of Object.entries(classStyles)) {
			const st = (e.getElementsByClassName(cls)[0] as HTMLElement).style;
			for (const k in styles)
				if (styles[k]!==undefined) st[k]=styles[k];
		}
	}, []);
	return f(ref);
}

export const ThemeSpinner = (props: SpinnerProps) =>
	<Spinner classNames={{
		circle1: "dark:border-b-white border-b-blue-600",
		circle2: "dark:border-b-white border-b-blue-600"
	}} {...props} />;

export const Loading = (props: SpinnerProps) =>
	<div className="h-full w-full flex item-center justify-center py-16 px-20" >
		<ThemeSpinner size="lg" {...props} />
	</div>;

export const Icon = ({icon, className, ...props}: {icon: string}&HTMLAttributes<HTMLSpanElement>) =>
	<i className={twMerge(`align-middle mycodicon codicon-${icon}`, className)} {...props} ></i>;

export const Alert = ({title, txt, bad, className}: {title?: React.ReactNode, txt: React.ReactNode, bad?: boolean, className?: string}) =>
	<div className={twMerge(`border ${bad ? "border-red-500 bg-red-900" : "border-zinc-700 bg-zinc-900"} p-2 px-4 rounded-md flex flex-row gap-2`, className)} >
		<div className="flex-shrink-0 mt-1" >
			{bad ? <Icon icon="warning" /> : <Icon icon="info" />}
		</div>
		<div>
			{title && <h2 className="font-bold font-display text-lg" >{title}</h2>}
			<div>{txt}</div>
		</div>
	</div>;

const selectStyle: ClassNamesConfig<unknown,boolean> = {
	control: (state) => `flex flex-row gap-4 px-3 py-1.5 dark:bg-zinc-800 bg-zinc-200 items-center border-2 text-zinc-800 dark:text-white rounded-lg hover:cursor-pointer ${state.menuIsOpen ? "dark:border-blue-500 border-blue-400" : "dark:border-zinc-600 border-zinc-300"}`,
	menuList: () => "border-2 border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-100 dark:bg-black mt-1 flex flex-col items-stretch",
	option: ({ isDisabled, isFocused }) => {
		return `${isFocused ? "dark:bg-zinc-800 bg-zinc-300" : ""} hover:bg-zinc-300 dark:hover:bg-zinc-800 p-2 border-t first:border-none dark:border-zinc-700 border-zinc-300 hover:cursor-pointer ${isDisabled ? "dark:text-gray-500 text-gray-400" : ""}`;
	},
	menu: () => "dark:text-white text-zinc-800 absolute w-full",
	multiValue: () => "dark:bg-zinc-700 bg-zinc-300 dark:text-white text-zinc-800 px-2 py-0.5 rounded-md",
	multiValueLabel: () => "dark:text-white text-zinc-800 dark:hover:bg-zinc-700 hover:bg-zinc-300",
	valueContainer: () => "flex flex-row gap-1 overflow-x-auto",
	multiValueRemove: () => "dark:text-white text-zinc-800 dark:hover:bg-zinc-700 hover:bg-zinc-300 dark:hover:text-white hover:text-zinc-800 ml-1",
	indicatorSeparator: () => "mx-1 h-full dark:bg-zinc-600 bg-zinc-300",
	input: () => "dark:text-white text-zinc-800",
	noOptionsMessage: () => "py-2 text-zinc-800 dark:text-white",
	indicatorsContainer: () => "dark:text-white text-zinc-800",
}

export const Select = (props: React.ComponentProps<ReactSelect>) =>
	<ReactSelect unstyled classNames={selectStyle} {...props} />;

export type DropdownPart = ({type: "txt", txt?: React.ReactNode}
	| { type: "act", name?: React.ReactNode, act: ()=>void,
			disabled?: boolean, active?: boolean })&{key?: string|number};

export const AppModal = ({children,...props}: ModalProps) =>
	<Modal portalContainer={useContext(AppCtx).rootRef.current!} {...props} >{children}</Modal>;

export function Dropdown({parts, trigger, onOpenChange}: {trigger?: React.ReactNode, parts: DropdownPart[], onOpenChange?: (x:boolean)=>void}) {
	const [open, setOpen] = useState(false);
	const ctx = useContext(AppCtx);

	//these components are fucked up w/ preact and props don't merge properly with container element
	return <Popover placement="bottom" showArrow isOpen={open}
		onOpenChange={(x)=>{
			setOpen(x);
			onOpenChange?.(x);
		}} triggerScaleOnOpen={false} portalContainer={ctx.rootRef.current!} >
		<PopoverTrigger><div>{trigger}</div></PopoverTrigger>
		<PopoverContent className="rounded-md bg-zinc-900 dark:bg-zinc-900 bg-zinc-100 border-gray-800 dark:border-gray-800 border-zinc-300 px-0 py-0 max-w-60 max-h-80 overflow-y-auto justify-start" >
			<div>
				{parts.map((x,i) => {
					if (x.type=="act")
						return <Button key={x.key ?? i} disabled={x.disabled}
							className={`m-0 border-zinc-700 dark:border-zinc-700 border-zinc-300 border-t-0 first:border-t rounded-none first:rounded-t-md last:rounded-b-md hover:bg-zinc-700 dark:hover:bg-zinc-700 hover:bg-zinc-300 w-full active:border-1 ${
								x.active ? "bg-zinc-950 dark:bg-zinc-950 bg-zinc-200" : ""
							}`}
							onClick={() => {
								x.act();
								setOpen(false);
							}} >{x.name}</Button>;
					else return <div key={x.key ?? i}
						className="flex flex-row justify-center gap-4 bg-zinc-900 dark:bg-zinc-900 bg-zinc-100 items-center border m-0 border-zinc-700 dark:border-zinc-700 border-zinc-300 border-t-0 first:border-t rounded-none first:rounded-t-md last:rounded-b-md w-full" >
							{x.txt}
						</div>
				})}
			</div>
		</PopoverContent>
	</Popover>;
}

export const Divider = ({className}: {className?: string}) =>
	<span className={twMerge("w-full h-px dark:bg-zinc-600 bg-zinc-200 my-2", className)} ></span>

const AppCtx = createContext({
	incTooltipCount(): void { throw new Error("tooltips should be used in tooltip ctx only"); },
	tooltipCount: 0,
	theme: undefined as unknown as Theme,
	rootRef: null as unknown as React.RefObject<HTMLDivElement>
});

function Wrapper({children,className,...props}: {children: React.ReactNode}&HTMLAttributes<HTMLDivElement>) {
	const [count, setCount] = useState(0);
	const root = useRef<HTMLDivElement>(null);
	const [theme, setTheme] = useState(appInit.theme);
	
	useMessage((msg) => {
		if (msg.type=="themeChange") setTheme(msg.newTheme);
	});

	useEffect(() => {
		const html = document.getElementsByTagName("html")[0];
		html.classList.add(theme);
		return () => html.classList.remove(theme);
	}, [theme])

	return <div ref={root}
		className={twMerge("font-body dark:text-gray-100 dark:bg-zinc-900 text-gray-950 bg-zinc-100 min-h-dvh",className)}
		{...props} >

		<AppCtx.Provider value={{
			incTooltipCount() { setCount(x=>x+1); },
			tooltipCount: count,
			theme, rootRef: root
		}} >
			<NextUIProvider className="contents" >{children}</NextUIProvider>
		</AppCtx.Provider>
	</div>;
}

export const useTheme = () => useContext(AppCtx).theme;

export function AppTooltip({content, children, placement, className, onChange, ...props}: {content: React.ReactNode, placement?: TooltipPlacement, onChange?: (x: boolean)=>void}&Omit<HTMLAttributes<HTMLDivElement>,"content">) {
	const [open, setOpen] = useState(false);
	const [reallyOpen, setReallyOpen] = useState<number|null>(null);
	
	const unInteract = (p: PointerEvent<HTMLDivElement>) => {
		if (p.pointerType=="mouse") setOpen(false);
	};

	const interact = (p: PointerEvent<HTMLDivElement>) => {
		if (p.pointerType=="mouse") setOpen(true);
	};

	const ctx = useContext(AppCtx);
	useEffect(()=>{
		if (open) {
			if (reallyOpen==ctx.tooltipCount) return;

			ctx.incTooltipCount();
			const tm = setTimeout(() => {
				setReallyOpen(ctx.tooltipCount+1);
			}, 200);

			const cb = ()=>setOpen(false);
			document.addEventListener("click",cb);

			return ()=>{
				document.removeEventListener("click",cb);
				clearTimeout(tm);
			};
		} else {
			const tm = setTimeout(() => setReallyOpen(null), 500);
			return ()=>clearTimeout(tm);
		}
	}, [open]);

	useEffect(()=> {
		onChange?.(reallyOpen==ctx.tooltipCount);
	}, [reallyOpen==ctx.tooltipCount])
	
	return <Tooltip showArrow placement={placement} content={content}
		portalContainer={ctx.rootRef.current!}
		classNames={{content: "max-w-[90dvw] border-zinc-600 border p-0"}}
		isOpen={reallyOpen==ctx.tooltipCount}
		onPointerEnter={interact} onPointerLeave={unInteract} >

		<div className={twMerge("inline-block", className)}
			onPointerEnter={interact} onPointerLeave={unInteract}
			onClick={(ev)=>{
				setOpen(reallyOpen!=ctx.tooltipCount);
				ev.stopPropagation();
			}} {...props} >

			{children}
		</div>
	</Tooltip>;
}

export const Card = ({className, children, ...props}: HTMLAttributes<HTMLDivElement>) =>
	<div className={twMerge(`flex flex-col gap-1 rounded-md p-2 border-1
		dark:border-zinc-600 shadow-md dark:shadow-black shadow-white/20 border-zinc-300`, bgColor.md, className)} {...props} >
		{children}
	</div>;

export const Tag = ({className, children, col, ...props}: HTMLAttributes<HTMLDivElement>&{col?: "secondary"}) =>
	<div className={twMerge(
			`flex flex-row gap-1 items-center rounded-2xl p-1 px-4 border-1 border-zinc-300 dark:border-zinc-600 shadow-lg ${col=="secondary"
				? "dark:bg-orange-700 bg-orange-300 dark:shadow-orange-400/15 orange-300 shadow-orange-300/25"
				: "dark:bg-sky-600 dark:shadow-sky-400/15 shadow-sky-300/25 bg-sky-300"}`,
			className
		)} {...props} >
		{children}
	</div>;

type TextVariants = "big"|"lg"|"md"|"dim"|"bold"|"normal"|"err";
export function Text({className, children, v, ...props}: HTMLAttributes<HTMLParagraphElement>&{v?: TextVariants}) {
	switch (v) {
		case "big": return <h1 className={twMerge("text-3xl font-display font-black", className)} {...props} >{children}</h1>;
		case "bold": return <b className={twMerge("text-lg font-display font-extrabold", className)} {...props} >{children}</b>;
		case "md": return <h3 className={twMerge("text-xl font-bold", className)} {...props} >{children}</h3>;
		case "lg": return <h3 className={twMerge("text-xl font-display font-extrabold", className)} {...props} >{children}</h3>;
		case "dim": return <span className={twMerge("text-sm text-gray-500 dark:text-gray-400", className)} {...props} >{children}</span>;
		case "err": return <span className={twMerge("text-red-500", className)} {...props} >{children}</span>;
		default: return <p className={className} {...props} >{children}</p>;
	}
}
	
export function useMessage(handle: (x: MessageFromExt)=>void, deps?: unknown[]) {
	useEffect(()=>{
		const cb = (ev: MessageEvent<MessageFromExt>) => handle(ev.data);
		window.addEventListener('message', cb);
		return ()=>window.removeEventListener("message", cb);
	}, deps ?? []);
}

export function useChooseFile(key: string, chosen: (x: string)=>void) {
	useMessage((x) => {
		if (x.type=="sourceFileChosen" && x.key==key) chosen(x.path);
	});
	return (name: string)=>send({type: "chooseSourceFile", key, name});
}

const allVerdicts: TestResult["verdict"][] = ["AC","RE","WA","INT","TL","ML"];
export const verdictColor = Object.fromEntries(allVerdicts.map(verdict=>{
	let x: [string,string,string];
	switch (verdict) {
		case "AC": x=["bg-green-400", "dark:text-green-400 text-green-600", "dark:border-green-400 border-green-600"]; break;
		case "RE":
		case "WA":
		case "INT": x=["bg-red-400", "dark:text-red-400 text-red-600", "dark:border-green-400 border-green-600"]; break;
		case "TL":
		case "ML": x=["bg-yellow-400", "dark:text-yellow-400 text-yellow-600", "dark:border-green-400 border-green-600"]; break;
	}

	return [verdict, {bg: x[0], text: x[1], border: x[2]}];
})) as Record<TestResult["verdict"], {bg:string,text:string,border: string}>;

export function expandedVerdict(verdict: TestResult["verdict"]) {
	switch (verdict) {
		case "AC": return "Accepted";
		case "RE": return "Runtime error";
		case "TL": return "Time limit exceeded";
		case "ML": return "Memory limit exceeded";
		case "WA": return "Wrong answer";
		case "INT": return "Bad interaction";
	}
}

export function FileName({path, children, ...props}: {path: string}&Partial<React.ComponentProps<typeof AppTooltip>>) {
	//i know, i know...
	//display only
	const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
	return <AppTooltip content={<div className="flex flex-col max-w-80 p-2 py-4 pt-2 gap-2 items-start max-w-full" >
		<Text v="bold" >{path.slice(idx+1)}</Text>
		<div className="max-w-full break-words dark:text-gray-300 text-gray-500 px-2" >
			Full path: {path}
		</div>
		<div className="flex flex-col gap-2 w-full" >
			<Button onClick={()=>send({type:"openFile",path})} >Open in VSCode</Button>
			<Button onClick={()=>send({type:"openFile",path,inOS:true})} >Reveal in Explorer/Finder</Button>
		</div>
	</div>} {...props} >
		{children ?? <Anchor>{path.slice(idx+1)}</Anchor>}
	</AppTooltip>;
}

export function DragHandle() {
	return <Icon icon="move" className="cursor-pointer text-2xl dragHandle self-start mt-2 mr-2" />;
}

export function dragTCs(init: number[], cfg?: ParentConfig<number>): [number[], React.RefObject<HTMLDivElement>, boolean] {
	const [dragging, setDragging] = useState(false);
	const [parent, vs, setVs] = useDragAndDrop<HTMLDivElement,number>(init, {
		performSort(state, data) {
			performSort(state,data);
			send({type: "moveTest", a:state.draggedNode.data.index, b:state.targetIndex});
		},
		handleDragstart(d) {
			handleDragstart(d);
			setDragging(true);
		},
		handleEnd(data) {
			handleEnd(data);
			setDragging(false);
		},
		plugins: [animations()],
		dragHandle: ".dragHandle",
		...cfg
	});

	useEffect(()=>setVs(init),[init]);

	return [vs,parent,dragging];
}

type UIState = { diff: boolean };
const defaultUIState: UIState = {diff: false};

type VSCodeAPI = {
	postMessage: (msg: MessageToExt) => void,
	getState: ()=>UIState|undefined,
	setState: (x: UIState)=>void
};

declare const acquireVsCodeApi: ()=>VSCodeAPI;
const vscode = acquireVsCodeApi();

export const send = vscode.postMessage;
export let uiState = vscode.getState() ?? defaultUIState;

export function setUiState(update: Partial<UIState>) {
	uiState={...uiState, ...update};
	vscode.setState(uiState);
}

export function render(component: React.FunctionComponent) {
	window.addEventListener("DOMContentLoaded", ()=>
		createRoot(document.getElementById("root")!).render(<Wrapper>
			{React.createElement(component)}
		</Wrapper>));
}

export const toSearchString = (x: string) => x.toLowerCase().replaceAll(" ","");