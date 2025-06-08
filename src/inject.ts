const myWindow = window as unknown as {
	spoofLocationHref: string,
	spoofLocation: URL,
	spoofWindow?: unknown,
	spoofDocument?: unknown,
};

const t = (x: string)=> `((window,document,self,location)=>{
	'use strict';
	${x}
}).call(
	window.spoofWindow, window.spoofWindow, window.spoofDocument,
	window.spoofWindow, window.spoofLocation
)`;

window.eval = ()=>myWindow.spoofWindow;

const u = new URL(myWindow.spoofLocationHref);

window.origin = u.origin;
Object.defineProperty(document, "baseURI", { get: ()=>myWindow.spoofLocationHref });
Object.defineProperty(document, "documentURI", { get: ()=>myWindow.spoofLocationHref });
Object.defineProperty(document, "URL", { get: ()=>myWindow.spoofLocationHref });

myWindow.spoofLocation = new Proxy(u, {
	get(_target, k) {
		return u[k as never];
	},
	set(_target, k, newValue) {
		window.location[k as never]=newValue as never;
		u[k as never]=newValue as never;
		return true;
	}
});

const locationHandler: ProxyHandler<Window|Document> = {
	get(target, k): unknown {
		if (k=="location") return myWindow.spoofLocation;
		const v = Reflect.get(target,k,target) as unknown;
		if (typeof v=="function") return v.bind(target);
		return v;
	},
	set(target, k, newValue) {
		if (k=="location") return false;
		return Reflect.set(target,k,newValue,target);
	}
};

myWindow.spoofWindow = new Proxy(window, locationHandler);
myWindow.spoofDocument = new Proxy(document, locationHandler);

function wrap(script: HTMLScriptElement) {
	if (script!=document.currentScript && !("wrapped" in script.dataset)) {
		console.log("wrapping script", script);

		if (script.src) {
			fetch(script.src, {
				referrerPolicy: "no-referrer"
			}).then(v=>v.text()).then(txt=>{
				const newScript = script.cloneNode(false) as HTMLScriptElement;
				newScript.textContent = t(txt);
				newScript.dataset["wrapped"] = "true";
				newScript.type = "text/javascript";
				script.parentElement!.replaceChild(newScript, script);
				console.log("loaded and wrapped script", script, newScript);
			}).catch(console.error);
			
			script.removeAttribute("src");
		} else if (script.textContent) {
			script.textContent=t(script.textContent);
			script.type = "text/javascript";
			script.dataset["wrapped"] = "true";
		}
	}
}

const oldCreateElement = document.createElement.bind(document);

(document.createElement as unknown) = (tag: string, opts?: ElementCreationOptions) => {
	const el = oldCreateElement(tag, opts);
	if (el instanceof HTMLScriptElement) el.type="application/json";
	return el;
};

for (const script of document.querySelectorAll("script")) wrap(script);

new MutationObserver(m=>{
	const scripts = m.flatMap(x=>[...x.addedNodes.values()])
		.filter(x=>x instanceof HTMLElement && x instanceof HTMLScriptElement);
	for (const script of scripts) wrap(script);
}).observe(document.querySelector("html")!, {
	subtree: true, childList: true
});