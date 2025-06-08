import { LanguageProvider } from "./languages";
import App from "./main";

import { serve, ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { AddressInfo } from "node:net";
import { getCookie, setCookie } from 'hono/cookie';
import { createHash, randomBytes } from "node:crypto";
import { env, Uri } from "vscode";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { serveStatic } from '@hono/node-server/serve-static'
import { join } from "node:path";
import { outDir } from "./util";

const hash = (x: string)=>createHash("sha256").update(x).digest().toString("hex");

type AutoSubmitDomain = "codeforces.com";
type AutoSubmitCookies = Record<AutoSubmitDomain, Record<string,string>>;

export class AutoSubmit {
	private port: number;
	private server?: ServerType;

	private key: string;
	private keyHash: string;

	private currentDomain: AutoSubmitDomain|null=null;
	private supportedDomains = new Set<AutoSubmitDomain>(["codeforces.com"]);
	
	isSupported(url: string) {
		return this.supportedDomains.has(new URL(url).host as AutoSubmitDomain);
	}

	constructor(private app: App, private languages: LanguageProvider) {
		this.port = app.cfg.autosubmitPort;
		this.key = randomBytes(32).toString("hex");
		this.keyHash = hash(this.key);
	}

	async start(domain: string) {
		if (!this.supportedDomains.has(domain as AutoSubmitDomain))
			throw new Error("unsupported domain");

		const [server,addr] = await new Promise<[ServerType,AddressInfo]>(res=>{
			const hono = new Hono();

			for (const res of ["inject.js", "inject.js.map"])
				hono.get(res, serveStatic({
					path: join(this.app.ctx.extensionPath, outDir, res)
				}));

			hono.all("/:path{.*$}", async ctx=>{
				const queryKey = ctx.req.query("key");
				if (queryKey!=undefined && hash(queryKey)==this.keyHash) {
					setCookie(ctx, "key", queryKey);
				} else {
					const cv = getCookie(ctx, "key");
					if (cv==undefined || hash(cv)!=this.keyHash) {
						return ctx.text("missing key", 401);								
					}
				}
				
				const dom = this.currentDomain;
				if (dom==null) return ctx.text("inactive", 500);
				
				const allCookies = this.app.ctx.globalState.get<AutoSubmitCookies>("autosubmitCookies");
				let cookies = allCookies?.[dom] ?? {};

				const search = new URL(ctx.req.url).searchParams;
				const u = new URL(ctx.req.param("path"), `https://${dom}`);
				u.search = new URLSearchParams([...search.entries()].filter(([k])=>k!="key")).toString();
				const safe = u.host==dom && u.protocol=="https:";

				const hdrs = new Headers(ctx.req.header());

				hdrs.delete("host");
				hdrs.delete("origin");
				hdrs.delete("cookie");

				if (safe) {
					for (const [k,v] of Object.entries(cookies))
						hdrs.append("cookie", `${k}=${encodeURIComponent(v)}`);
				}

				const reqBody = hdrs.has("content-length") ? await ctx.req.arrayBuffer() : null;
				if (reqBody) hdrs.set("content-length", reqBody.byteLength.toString());

				const resp = await fetch(u, {
					method: ctx.req.method, headers: hdrs,
					body: reqBody,
					credentials: safe ? "include": "omit",
					mode: "cors"
				});
				
				if (safe) {
					for (const cookie of resp.headers.getSetCookie()) {
						const eq = cookie.indexOf("=");
						if (eq==-1) return ctx.text("invalid set-cookie", 500);
						cookies = {...cookies, [cookie.slice(0,eq)]: cookie.slice(eq+1)};
					}
					
					this.app.ctx.globalState.update("autosubmitCookies", {
						...allCookies, [dom]: cookies
					} satisfies AutoSubmitCookies);
				}

				let body;
				if (resp.headers.get("content-type")?.startsWith("text/html")) {
					let txt = await resp.text();
					const headStr = "<head>";
					const headStart = txt.indexOf(headStr);

					if (headStart!=-1) {
						txt = `${txt.slice(0,headStart+headStr.length)}`
							+ `<script>window.spoofLocationHref = ${JSON.stringify(u.href)};</script>`
							+ `<script src="/inject.js" ></script>`
							+ txt.slice(headStart+headStr.length);
					}
					
					body = Buffer.from(txt);
				} else {
					body = await resp.bytes();
				}

				return ctx.body(
					body,
					resp.status as ContentfulStatusCode,
					{
						"Content-Type": resp.headers.get("content-type") ?? "",
						"Content-Length": body.byteLength.toString()
					}
				);
			});

			const s = serve({
				fetch: hono.fetch,
				port: this.port
			}, (x)=>res([s,x]));
		});
		
		this.server?.close();
		this.server=server;
		this.currentDomain=domain as AutoSubmitDomain;
		
		if (addr.port!=this.port) throw new Error("incorrect port");
		this.app.log.info(`Started autosubmit proxy at ${addr.address}:${addr.port}`);
	}

	async submit(url: string, file: string) {
		const u = new URL(url);
		if (this.server==undefined) await this.start(u.host);

		const newU = new URL(`http://localhost:${this.port}`);
		newU.pathname=u.pathname;
		newU.search=u.search;
		newU.searchParams.append("key", this.key);

		env.openExternal(Uri.parse(newU.href));
		// this.languages.getLanguage(file).name
	}

	dispose() {
		console.log("closing autosubmit");
		this.server?.close();
	}
}
