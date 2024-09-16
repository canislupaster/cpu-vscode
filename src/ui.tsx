import "../node_modules/@vscode/codicons/dist/codicon.css";
import "../out/output.css";

import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/popover";
import { Collapse } from "react-collapse";
import { twMerge } from "tailwind-merge";
import { Spinner, SpinnerProps } from "@nextui-org/spinner";
import React, { AnchorHTMLAttributes, createContext, forwardRef, HTMLAttributes, PointerEvent, useContext, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipPlacement } from "@nextui-org/tooltip";
import { NextUIProvider } from "@nextui-org/system";
import { MessageFromExt, MessageToExt, TestResult } from "./shared";
import ReactSelect, { ClassNamesConfig } from "react-select";
import { createRoot } from "react-dom/client";
import { animations, handleDragstart, handleEnd, ParentConfig, performSort, } from "@formkit/drag-and-drop";
import { useDragAndDrop } from "@formkit/drag-and-drop/react";
import { Modal, ModalProps } from "@nextui-org/modal";

export const Input = ({className, icon, ...props}: {icon?: React.ReactNode}&React.InputHTMLAttributes<HTMLInputElement>) =>
	<input type="text" className={twMerge(`text-white bg-zinc-800 w-full p-2 border-2 border-zinc-600 focus:outline-none focus:border-blue-500 transition duration-300 rounded-lg disabled:bg-zinc-600 disabled:text-gray-400 ${icon ? "pl-11" : ""}`, className)} {...props} />;

export const Textarea = forwardRef<HTMLTextAreaElement, JSX.IntrinsicElements["textarea"]>((
	{className, children, ...props}: JSX.IntrinsicElements["textarea"], ref
) =>
	<textarea className={twMerge("text-white bg-zinc-800 w-full p-2 border-2 border-zinc-600 focus:outline-none focus:border-blue-500 disabled:bg-zinc-600 disabled:text-gray-400 transition duration-300 rounded-lg resize-y max-h-60 min-h-24", className)}
		rows={6} {...props} ref={ref} >
		{children}
	</textarea>);

export const Button = ({className, disabled, icon, ...props}: HTMLAttributes<HTMLButtonElement>&{icon?: React.ReactNode, disabled?: boolean}) =>
	<button disabled={disabled} className={twMerge('flex flex-row justify-center gap-1.5 px-4 py-1.5 bg-zinc-800 items-center border text-white rounded-xl border-zinc-700 hover:border-zinc-600 active:border-blue-500 aria-expanded:border-blue-500 group disabled:bg-zinc-600 disabled:text-gray-400',
		icon ? "pl-3" : "", className)} {...props} >
		{icon}
		{props.children}
	</button>;

export const HiddenInput = ({className, ...props}: React.InputHTMLAttributes<HTMLInputElement>) =>
	<input className={twMerge(`bg-transparent border-0 outline-none border-b-2
		hover:border-zinc-600 border-zinc-700
		focus:outline-none focus:border-blue-500 transition duration-300 px-1 py-px`, className)}
		{...props} ></input>

export const IconButton = ({className, icon, disabled, ...props}: {icon?: React.ReactNode, disabled?: boolean}&HTMLAttributes<HTMLButtonElement>) =>
	<button className={twMerge("rounded-full p-2 bg-zinc-800 border-zinc-700 border hover:border-zinc-600 active:border-blue-500 flex items-center justify-center aria-expanded:border-blue-500 disabled:bg-zinc-600 disabled:text-gray-400", className)} disabled={disabled} {...props} >
		{icon}
	</button>;

export const Anchor: React.FC<AnchorHTMLAttributes<HTMLAnchorElement>> = ({className,children,...props}) => {
	const classN = twMerge(
	`text-gray-300 inline-flex flex-row align-baseline items-baseline gap-1 underline decoration-dashed decoration-1
		underline-offset-2 transition-all hover:text-gray-50 hover:bg-cyan-100/5 cursor-pointer`,className
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

export const Loading = (props: SpinnerProps) =>
	<div className="h-full w-full flex item-center justify-center py-16 px-20" >
		<Spinner color="white" size="lg" {...props} ></Spinner>
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
	control: (state) => `flex flex-row gap-4 px-3 py-1.5 bg-zinc-800 items-center border-2 text-white rounded-lg hover:cursor-pointer ${state.menuIsOpen ? "border-blue-500" : "border-zinc-600"}`,
	menuList: () => "border-zinc-700 rounded-lg bg-black border bg-zinc-900 mt-1 flex flex-col items-stretch",
	option: ({ isDisabled, isFocused }) => {
		return `${isFocused ? "bg-zinc-800" : ""} hover:bg-zinc-800 p-2 border-t first:border-none border-zinc-700 hover:cursor-pointer ${isDisabled ? "text-gray-500" : ""}`;
	},
	menu: () => "text-white absolute w-full",
	multiValue: () => "bg-zinc-700 text-white px-2 py-0.5 rounded-md",
	multiValueLabel: () => "text-white hover:bg-zinc-700",
	valueContainer: () => "flex flex-row gap-1 overflow-x-scroll",
	multiValueRemove: () => "text-white hover:bg-zinc-700 hover:text-white ml-1",
	indicatorSeparator: () => "mx-1 h-full bg-zinc-600",
	input: () => "text-white",
	noOptionsMessage: () => "py-2",
	indicatorsContainer: () => "text-white",
}

export const Select = (props: React.ComponentProps<ReactSelect>) =>
	<ReactSelect unstyled classNames={selectStyle} {...props} />;

export type DropdownPart = ({type: "txt", txt?: React.ReactNode}
	| { type: "act", name?: React.ReactNode, act: ()=>void,
			disabled?: boolean, active?: boolean })&{key?: string|number};

export const AppModal = ({children,...props}: ModalProps) =>
	<Modal portalContainer={useContext(AppCtx).rootRef.current!} {...props} >{children}</Modal>;

export function Dropdown({parts, trigger}: {trigger?: React.ReactNode, parts: DropdownPart[]}) {
	const [open, setOpen] = useState(false);
	const ctx = useContext(AppCtx);
	//these components are fucked up w/ preact and props don't merge properly with container element
	return <Popover placement="bottom" showArrow isOpen={open}
		onOpenChange={setOpen} triggerScaleOnOpen={false} portalContainer={ctx.rootRef.current!} >
		<PopoverTrigger><div>{trigger}</div></PopoverTrigger>
		<PopoverContent className="rounded-md bg-zinc-900 border-gray-800 flex flex-col gap-2 items-stretch px-0 py-0 max-w-60 max-h-80 overflow-y-auto" >
			<div>
				{parts.map((x,i) => {
					//copy pasting is encouraged by tailwind!
					if (x.type=="act")
						return <Button key={x.key ?? i} disabled={x.disabled}
							className={`m-0 border-zinc-700 border-t-0 first:border-t rounded-none first:rounded-t-md last:rounded-b-md hover:bg-zinc-700 w-full active:border-1 ${
								x.active ? "bg-zinc-950" : ""
							}`}
							onClick={() => {
								x.act();
								setOpen(false);
							}} >{x.name}</Button>;
					else return <div key={x.key ?? i}
						className="flex flex-row justify-center gap-4 bg-zinc-900 items-center border m-0 border-zinc-700 border-t-0 first:border-t rounded-none first:rounded-t-md last:rounded-b-md w-full" >
							{x.txt}
						</div>
				})}
			</div>
		</PopoverContent>
	</Popover>;
}

export function MoreButton({collapsed, children, className, act: hide, down}: {collapsed: boolean, act: ()=>void, children?: React.ReactNode, className?: string, down?: boolean}) {
	return <Collapse isOpened={collapsed} >
		<div className={twMerge("flex flex-col w-full items-center", className)} >
			<button onClick={hide} className={`flex flex-col items-center cursor-pointer transition ${down ? "hover:translate-y-1" : "hover:-translate-y-1"}`} >
				{down ? <>{children}<Icon icon="chevron-down" /></>
					: <><Icon icon="chevron-up" />{children}</>}
			</button>
		</div>
	</Collapse>;
}

export function ShowMore({children, className, forceShowMore}: {children: React.ReactNode, className?: string, forceShowMore?: boolean}) {
	const [showMore, setShowMore] = useState<boolean|null>(false);
	const inner = useRef<HTMLDivElement>(null), ref=useRef<HTMLDivElement>(null);

	useEffect(()=>{
		if (showMore!=null && !forceShowMore
			&& inner.current!.clientHeight<=ref.current!.clientHeight+100)
			setShowMore(null); //not needed
	}, [showMore!=null, forceShowMore]);

	if (showMore==null || forceShowMore)
		return <div className={twMerge("overflow-y-auto max-h-dvh", className)} >
			{children}
		</div>;

	return <div className={className} >
		<Collapse isOpened >
			<div ref={ref} className={`relative ${showMore ? "" : "max-h-52 overflow-y-hidden"}`} >
				<div ref={inner} className={showMore ? "overflow-y-auto max-h-dvh" : ""} >
					{children}
				</div>

				<div className="absolute bottom-0 left-0 right-0 z-40" >
					<MoreButton act={()=>setShowMore(true)} collapsed={!showMore} down >
						Show more
					</MoreButton>
				</div>

				{!showMore &&
					<div className="absolute bottom-0 h-14 max-h-full bg-gradient-to-b from-transparent to-zinc-900 z-20 left-0 right-0" ></div>}
			</div>
		</Collapse>

		<MoreButton act={()=>setShowMore(false)} collapsed={showMore} className="pt-2" >
			Show less
		</MoreButton>
	</div>;
}

export const Divider = ({className}: {className?: string}) =>
	<span className={twMerge("w-full h-px bg-zinc-600 my-2", className)} ></span>

const AppCtx = createContext({
	incTooltipCount(): void { throw new Error("tooltips should be used in tooltip ctx only"); },
	tooltipCount: 0,
	rootRef: null as unknown as React.RefObject<HTMLDivElement>
});

function Wrapper({children,className,...props}: {children: React.ReactNode}&HTMLAttributes<HTMLDivElement>) {
	const [count, setCount] = useState(0);
	const root = useRef<HTMLDivElement>(null);

	return <AppCtx.Provider value={{
		incTooltipCount() { setCount(x=>x+1); },
		tooltipCount: count,
		rootRef: root
	}} >
		<div ref={root}
			className={twMerge("font-body text-gray-100 bg-zinc-900 min-h-dvh",className)}
			{...props} >

			<NextUIProvider className="contents" >{children}</NextUIProvider>
		</div>
	</AppCtx.Provider>;
}

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
	<div className={twMerge("flex flex-col gap-1 bg-zinc-800 rounded-md p-2 border-1 border-zinc-600 shadow-md shadow-black", className)} {...props} >
		{children}
	</div>;

export const Tag = ({className, children, ...props}: HTMLAttributes<HTMLDivElement>) =>
	<div className={twMerge("flex flex-row gap-1 items-center bg-sky-600 rounded-2xl p-1 px-4 border-1 border-zinc-600 shadow-lg shadow-sky-400/15", className)} {...props} >
		{children}
	</div>;

type TextVariants = "big"|"lg"|"md"|"dim"|"bold"|"normal";
export function Text({className, children, v, ...props}: HTMLAttributes<HTMLParagraphElement>&{v?: TextVariants}) {
	switch (v) {
		case "big": return <h1 className={twMerge("text-3xl font-display font-black", className)} {...props} >{children}</h1>;
		case "bold": return <b className={twMerge("text-lg font-display font-extrabold", className)} {...props} >{children}</b>;
		case "md": return <h3 className={twMerge("text-xl font-bold", className)} {...props} >{children}</h3>;
		case "lg": return <h3 className={twMerge("text-xl font-display font-extrabold", className)} {...props} >{children}</h3>;
		case "dim": return <span className={twMerge("text-sm text-gray-400", className)} {...props} >{children}</span>;
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
		if (x.type=="cppFileChosen" && x.key==key) chosen(x.path);
	});
	return (name: string)=>send({type: "chooseCppFile", key, name});
}

export function verdictColor(verdict: TestResult["verdict"]) {
	switch (verdict) {
		case "AC": return "green-400";
		case "RE": return "red-400";
		case "WA": return "red-400";
		case "TL": return "yellow-400";
		case "ML": return "yellow-400";
	}
}

export function expandedVerdict(verdict: TestResult["verdict"]) {
	switch (verdict) {
		case "AC": return "Accepted";
		case "RE": return "Runtime error";
		case "TL": return "Time limit exceeded";
		case "ML": return "Memory limit exceeded";
		case "WA": return "Wrong answer";
	}
}

export function FileName({path, children, ...props}: {path: string}&Partial<React.ComponentProps<typeof AppTooltip>>) {
	//i know, i know...
	const idx = Math.max(path.lastIndexOf("\\\\"), path.lastIndexOf("/"));
	return <AppTooltip content={<div className="flex flex-col max-w-full p-2 py-4 gap-2 items-start" >
		<div className="overflow-x-auto max-w-80 break-words text-gray-300" >
			{path}
		</div>
		<div className="flex flex-row gap-2" >
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

type VSCodeAPI = {
	postMessage: (msg: MessageToExt) => void
};

declare const acquireVsCodeApi: ()=>VSCodeAPI;
const vscode = acquireVsCodeApi();

export const send = vscode.postMessage;

export function render(component: React.FunctionComponent) {
	window.addEventListener("load", ()=>
		createRoot(document.getElementById("root")!).render(<Wrapper>
			{React.createElement(component)}
		</Wrapper>));
}

export const toSearchString = (x: string) => x.toLowerCase().replaceAll(" ","");