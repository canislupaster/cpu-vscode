import "../node_modules/@vscode/codicons/dist/codicon.css";

import { Popover, PopoverContent, PopoverTrigger } from "@heroui/popover";
import { twMerge } from "tailwind-merge";
import { Spinner, SpinnerProps } from "@heroui/spinner";
import React, { AnchorHTMLAttributes, createContext, forwardRef, HTMLAttributes, JSX, PointerEvent, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Tooltip, TooltipPlacement } from "@heroui/tooltip";
import { HeroUIProvider } from "@heroui/system";
import { InitState, MessageFromExt, MessageToExt, SetStateMessage, TestResult, Theme } from "./shared";
import ReactSelect, { ClassNamesConfig } from "react-select";
import { createRoot } from "react-dom/client";
import { animations, ParentConfig } from "@formkit/drag-and-drop";
import { useDragAndDrop } from "@formkit/drag-and-drop/react";
import { Modal, ModalProps } from "@heroui/modal";

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
	default: "border-zinc-300 hover:border-zinc-400 dark:border-zinc-600 dark:hover:border-zinc-500 disabled:bg-zinc-300"
};

export const outlineColor = {
	default: "active:outline focus:outline theme:outline-2 focus:theme:outline-blue-500 active:theme:outline-blue-500 theme:outline-offset-[-2px]"
};

const containerDefault = `${textColor.default} ${bgColor.default} ${borderColor.default} ${outlineColor.default}`;

function restoreInputPosition<T extends HTMLTextAreaElement|HTMLInputElement>(forwardRef: React.Ref<T>, value: JSX.IntrinsicElements["input"]["value"]) {
	const pos = useRef<[number|null,number|null,T["selectionDirection"]]|null>(null);

	const ref = useRef<T>(null);
	useImperativeHandle(forwardRef, ()=>ref.current!, []);

	useEffect(()=>{
		if (value!=undefined && value.toString()!=ref.current!.value)
			ref.current!.value=value.toString();
		if (pos.current!=null && (!(ref.current instanceof HTMLInputElement) || ref.current.type=="text"))
			ref.current!.setSelectionRange(pos.current[0],pos.current[1],pos.current[2] ?? undefined);
	}, [value]);

	return [ref, (el: T)=>{
		pos.current = [el.selectionStart, el.selectionEnd, el.selectionDirection];
	}] as const;
}

const invalidInputStyle = `dark:invalid:bg-rose-900 invalid:bg-rose-400 dark:invalid:border-red-500 invalid:border-red-700`;

export type InputProps = {icon?: React.ReactNode}&React.InputHTMLAttributes<HTMLInputElement>;
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({className, onChange, value, icon, ...props}, forwardRef) {
	const [ref, save] = restoreInputPosition(forwardRef, value);
	return <input ref={ref} type="text" className={twMerge(containerDefault, `w-full p-2 border-2 transition duration-300 rounded-lg ${icon ? "pl-11" : ""} ${invalidInputStyle}`, className)} onChange={(ev)=>{
		save(ev.target);
		onChange?.(ev);
	}} {...props} />
});

export function HiddenInput({className, onChange, value, ...props}: React.InputHTMLAttributes<HTMLInputElement>) {
	const [ref, save] = restoreInputPosition<HTMLInputElement>(null, value);
	return <input className={twMerge(borderColor.default, `bg-transparent border-0 outline-none border-b-2
		focus:outline-none focus:theme:border-blue-500 focus:hover:theme:border-blue-500 active:hover:theme:border-blue-500 active:theme:border-blue-500 transition duration-300 px-1 py-px ${invalidInputStyle}`, className)}
		{...props} ref={ref} onChange={(ev)=>{
			save(ev.target); onChange?.(ev);
		}} ></input>
};

export const Textarea = forwardRef<HTMLTextAreaElement, JSX.IntrinsicElements["textarea"]>(function Textarea(
	{className, children, onChange, value, ...props}: JSX.IntrinsicElements["textarea"], forwardRef
) {
	const [ref, save] = restoreInputPosition(forwardRef, value);
	return <textarea className={twMerge(containerDefault, `w-full p-2 border-2 transition duration-300 rounded-lg resize-y max-h-60 min-h-24 ${invalidInputStyle}`, className)} ref={ref}
		rows={6} {...props} tabIndex={100} onChange={(ev)=>{
			save(ev.target); onChange?.(ev);
		}} >
		{children}
	</textarea>
});

export type ButtonProps = HTMLAttributes<HTMLButtonElement>&{icon?: React.ReactNode, disabled?: boolean};
export const Button = React.forwardRef(function Button({className, disabled, icon, ...props}: ButtonProps, ref: React.Ref<HTMLButtonElement>) {
	return <button ref={ref} disabled={disabled} className={twMerge("flex flex-row justify-center gap-1.5 px-4 py-1.5 items-center rounded-xl border group", containerDefault, icon ? "pl-3" : "", className)} {...props} >
		{icon}
		{props.children}
	</button>
});

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
		<div className="shrink-0 mt-1" >
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
	<ReactSelect unstyled classNames={selectStyle} styles={{ menu: base => ({ ...base, zIndex: 50 }) }} {...props} />;

export type DropdownPart = ({type: "txt", txt?: React.ReactNode}
	| {type: "big", txt?: React.ReactNode}
	| { type: "act", name?: React.ReactNode, act: ()=>void,
			disabled?: boolean, active?: boolean })&{key?: string|number};

export const AppModal = ({children,...props}: ModalProps) =>
	<Modal portalContainer={useContext(AppCtx).rootRef.current!} {...props} >{children}</Modal>;

export function Dropdown({parts, trigger, onOpenChange, open, setOpen}: {
	trigger?: React.ReactNode, parts: DropdownPart[],
	onOpenChange?: (x:boolean)=>void,
	open?: boolean, setOpen?: (x: boolean)=>void
}) {
	const state = useState(false);
	open ??= state[0]; setOpen ??= state[1];
	
	const ctx = useContext(AppCtx);

	const [keySel, setKeySel] = useState<string|number|null>(null);
	const [focusSel, setFocusSel] = useState<boolean>(false);

	const acts = parts.map((v,i)=>({key: v.key ?? i, type: v.type})).filter(v=>v.type=="act");
	const idx = keySel!=null ? acts.findIndex(p=>p.key==keySel) : -1;

	//these components are fucked up w/ preact and props don't merge properly with container element
	return <Popover placement="bottom" showArrow isOpen={open}
		onOpenChange={(x)=>{
			setOpen(x);
			onOpenChange?.(x);
		}} triggerScaleOnOpen={false} portalContainer={ctx.rootRef.current!} >
		<PopoverTrigger><div>{trigger}</div></PopoverTrigger>
		<PopoverContent className="rounded-md dark:bg-zinc-900 bg-zinc-100 dark:border-gray-800 border-zinc-300 px-0 py-0 max-w-60 overflow-y-auto justify-start max-h-[min(90dvh,30rem)]"
			onKeyDown={ev=>{
				if (acts.length==0 || !open) return;

				if (ev.key=="ArrowDown") {
					const nidx = idx==-1 ? 0 : (idx+1)%acts.length;
					setKeySel(acts[nidx].key);
					setFocusSel(true);
					ev.preventDefault();
				} else if (ev.key=="ArrowUp") {
					const pidx = idx==-1 ? acts.length-1 : (idx+acts.length-1)%acts.length;
					setKeySel(acts[pidx].key);
					setFocusSel(true);
					ev.preventDefault();
				}
			}} >
			<div>
				{parts.map((x,i) => {
					if (x.type=="act")
						return <Button key={x.key ?? i} disabled={x.disabled}
							className={`m-0 dark:border-zinc-700 border-zinc-300 border-t-0 first:border-t rounded-none first:rounded-t-md last:rounded-b-md dark:hover:bg-zinc-700 hover:bg-zinc-300 w-full hover:outline hover:outline-1 not-focus:hover:dark:outline-zinc-600 not-focus:hover:outline-zinc-400 ${
								x.active ? "dark:bg-zinc-950 bg-zinc-200" : ""
							} ${outlineColor.default}`}
							onBlur={(x.key??i)==keySel ? ()=>setFocusSel(false) : undefined}
							ref={(el)=>{
								if ((x.key??i)==keySel && el!=null && focusSel) {
									el.focus();
								}
							}}
							onClick={() => {
								x.act();
								setOpen(false);
								onOpenChange?.(false);
							}} >{x.name}</Button>;
					else if (x.type=="txt") return <div key={x.key ?? i}
						className="flex flex-row justify-center gap-4 dark:bg-zinc-900 bg-zinc-100 items-center border m-0 dark:border-zinc-700 border-zinc-300 border-t-0 first:border-t rounded-none first:rounded-t-md last:rounded-b-md w-full" >
							{x.txt}
						</div>
					else return <div key={x.key ?? i}
						className="flex flex-row justify-start gap-4 p-2 dark:bg-zinc-900 bg-zinc-100 items-center border m-0 dark:border-zinc-700 border-zinc-300 border-t-0 first:border-t rounded-none first:rounded-t-md last:rounded-b-md w-full" >
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
	rootRef: null as unknown as React.RefObject<HTMLDivElement|null>
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
			<HeroUIProvider className="contents" >{children}</HeroUIProvider>
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
	<div className={twMerge(`flex flex-col gap-1 rounded-md p-2 border
		dark:border-zinc-600 shadow-md dark:shadow-black shadow-white/20 border-zinc-300`, bgColor.md, className)} {...props} >
		{children}
	</div>;

export const Tag = ({className, children, col, ...props}: HTMLAttributes<HTMLDivElement>&{col?: "secondary"}) =>
	<div className={twMerge(
			`flex flex-row gap-1 items-center rounded-2xl p-1 px-4 border border-zinc-300 dark:border-zinc-600 shadow-lg ${col=="secondary"
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

export function useChooseFile(key: string, chosen: (x: string)=>void, kind: "source"|"directory"="source", deps?: unknown[]) {
	useMessage((x) => {
		if (x.type=="fileChosen" && x.key==key) chosen(x.path);
	}, deps);
	return (name: string)=>send({type: "chooseFile", key, name, kind});
}

export function FileChooser({name,id,path,setPath,optional,kind, deps}: {
	name: string, id: string, path: string|null,
	setPath: (x: string|null)=>void, optional?: boolean,
	kind: "source"|"directory", deps?: unknown[]
}) {
	const choose = useChooseFile(id, setPath, kind, deps);

	return <div className="flex flex-row items-center gap-2" >
		{path==null ? <Text v={optional ? "dim" : "err"} >No {name} set</Text>
			: <FileName path={path} ></FileName>}
		<Button onClick={()=>choose(name)} >Choose</Button>
		{optional && path!=null && <IconButton icon={<Icon icon="close" />} onClick={()=>setPath(null)} />}
	</div>;
}

const allVerdicts: TestResult["verdict"][] = ["AC","RE","WA","INT","TL","ML"];
export const verdictColor = Object.fromEntries(allVerdicts.map(verdict=>{
	let x: [string,string,string];
	switch (verdict) {
		case "AC": x=["bg-green-400", "dark:text-green-400 text-green-600", "dark:border-green-400 border-green-600"]; break;
		case "RE":
		case "WA":
		case "INT": x=["bg-red-400", "dark:text-red-400 text-red-600", "dark:border-red-400 border-red-600"]; break;
		case "TL":
		case "ML": x=["bg-yellow-400", "dark:text-yellow-400 text-yellow-600", "dark:border-yellow-400 border-yellow-600"]; break;
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
		<div className="flex flex-col gap-2 w-full xs:flex-row xs:justify-start" >
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
		onSort(d) {
			send({type: "moveTest", a:d.previousPosition, b:d.position});
		},
		onDragstart() { setDragging(true); },
		onDragend() { setDragging(false); },
		plugins: [animations()],
		dragHandle: ".dragHandle",
		...cfg
	});

	useEffect(()=>setVs(init),[init]);

	return [vs,parent,dragging];
}

type VSCodeAPI = { postMessage: (msg: MessageToExt|SetStateMessage) => void };

declare const acquireVsCodeApi: ()=>VSCodeAPI;
const vscode = acquireVsCodeApi();
declare let uiState: object|undefined;

export const send = vscode.postMessage;

export const useUIState = <T extends object>(defaultUIState: T) => ({
	uiState: (): T => ({...defaultUIState, ...(uiState ?? {})}),
	update(x: Partial<T>) {
		const ns: T = {...defaultUIState, ...(uiState ?? {}), ...x};
		uiState=ns;
		send({type: "setUIState", newState: ns});
		return ns;
	}
});

export function render(component: React.FunctionComponent) {
	window.addEventListener("DOMContentLoaded", ()=>
		createRoot(document.getElementById("root")!).render(<Wrapper>
			{React.createElement(component)}
		</Wrapper>));
}

export const toSearchString = (x: string) => x.toLowerCase().replaceAll(" ","");