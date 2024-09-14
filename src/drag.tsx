import React, {createContext, HTMLAttributes, useContext, useEffect, useMemo, useRef, useState} from 'react';
import { Icon } from "./ui";

const DragHandleCtx = createContext<(draggable: boolean)=>void>(undefined as any);

export function DragHandle() {
	const ctx = useContext(DragHandleCtx);
	return <Icon icon="move" className="cursor-pointer text-2xl" onMouseDown={()=>{ ctx(true); }} />;
}

export function Drag({elements, moveElement, ...props}: {
	elements: [React.ReactNode, string|number][],
	moveElement: (from: number, to: number) => void
}&HTMLAttributes<HTMLDivElement>) {
	const [dragging, setDragging] = useState(-1);
	const [draggable, setDraggable] = useState(false);

	let els = elements.map(([el,k],i) => <div
		draggable={true}
		onDragStart={(ev)=>setDragging(i)}
		onDragEnd={()=>{
			setDragging(-1);
			setDrop(-1);
			if (drop!=-1 && drop!=i) moveElement(i, drop);
		}} key={k} >
			{el}
	</div>);

	useEffect(()=>{
		const cb = ()=>setDraggable(false);
		document.addEventListener("mouseup", cb);
		return ()=>document.removeEventListener("mouseup", cb);
	}, []);

	const [drop, setDrop] = useState(-1);
	const stackRef = useRef<HTMLDivElement>(null);

	if (dragging!=-1) {
		const nels=[];
		const mkDropper = (i: number)=>
			<div key={`drag${i}`} data-i={i} className={`h-0 border-1 my-1 ${i==drop ? "border-sky-400" : "border-gray-400"} rounded-md w-full`} />;

		for (let i=0; i<dragging; i++)
			nels.push(mkDropper(i), els[i]);
		for (let i=dragging; i<els.length; i++)
			nels.push(els[i], mkDropper(i));
		els=nels;
	}

	useEffect(() => {
		if (dragging==-1) return;

		const stack = stackRef.current!;

		let divsToI: [number,number][] = [];
		for (const child of stack.children) {
			const i = (child as HTMLElement).dataset.i;
			if (i==undefined) continue;
			divsToI.push([child.getBoundingClientRect().top, parseInt(i)]);
		}

		let onBottom=true, onTop=true, v: number|null=null;
		const int = setInterval(() => {
			if (v==null) return;
			if (onBottom) window.scroll({top: window.scrollY+600, behavior: "smooth"});
			if (onTop) window.scroll({top: window.scrollY-600, behavior: "smooth"});
			onBottom=onTop=true; v=null;
		}, 500);

		let listen = (e: DragEvent) => {
			if (window.innerHeight-e.screenY > 300) onBottom=false;
			if (e.screenY > 300) onTop=false;
			v=e.clientY; //wtf

			let x=-1, minDist:number|null = null;
			for (const [t,i] of divsToI) {
				let d = Math.abs(v-t);
				if (minDist==null || d<minDist) x=i, minDist=d;
			}

			setDrop(x);
			e.preventDefault();
		};

		stack.addEventListener("dragover", listen);

		return () => {
			clearInterval(int);
			stack.removeEventListener("dragover", listen);
		};
	}, [dragging]);

	useEffect(() => {
		const stack = stackRef.current!;
		let pdef = (e: Event) => e.preventDefault();
		stack.addEventListener("dragenter", pdef);
		stack.addEventListener("dragover", pdef);

		return () => {
			stack.removeEventListener("dragenter", pdef);
			stack.removeEventListener("dragover", pdef);
		};
	}, []);

	return <div {...props} ref={stackRef} ><DragHandleCtx.Provider value={setDraggable} >
		{els}
	</DragHandleCtx.Provider></div>;
}