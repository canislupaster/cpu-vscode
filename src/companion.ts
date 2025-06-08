import { EventEmitter, LogOutputChannel } from "vscode";
import { serve, ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { AddressInfo } from "node:net";
import { delay } from "./util";

type Task = {
	name: string,
	group: string,
	url: string,
	tests: {input:string, output:string}[],
	batch: {
		id: string,
		size: number
	}
};

export class Companion {
	port=4244; //sorry hightail

	private evSrc=new EventEmitter<Task[]>()
	event=this.evSrc.event;
	batches: Record<string,Task[]> = {};

	private app=new Hono().post("/", async (c) => {
		const json: unknown = await c.req.json();

		//very high quality validation!!
		//typescript proved it
		//just that pro 😎
		if (typeof json!="object" || !json
			|| !("name" in json) || !("group" in json) || !("tests" in json) || !("url" in json)
			|| typeof json.name != "string" || typeof json.group!="string" || typeof json.url!="string" || !Array.isArray(json.tests)
			|| !("batch" in json) || typeof json.batch!="object" || !json.batch || !("size" in json.batch)
			|| typeof json.batch.size!="number" || !("id" in json.batch) || typeof json.batch.id!="string")
			return c.json({status: "invalid"});

		const task: Task = {
			name: json.name, group: json.group, tests: [] as Task["tests"], url: json.url,
			batch: {size: json.batch.size, id: json.batch.id}
		};

		for (const x of json.tests as unknown[]) {
			if (typeof x!="object" || !x || !("input" in x) || !("output" in x)
				|| typeof x.input!="string" || typeof x.output!="string")
				return c.json({status: "invalid"});

			task.tests.push({input: x.input, output: x.output});
		}

		const pbatch = this.batches[task.batch.id] ?? [];
		pbatch.push(task);

		if (pbatch.length==task.batch.size) {
			this.evSrc.fire(pbatch);
			delete this.batches[task.batch.id];
		} else {
			this.batches[task.batch.id] = pbatch;
		}

		return c.json({status: "ok"});
	}).get("/", async (c) => {
		return c.json({status: "ok"});
	}).onError(async (err,c) => {
		this.log.error(err);
		return c.json({status: "error"});
	});

	constructor(private log: LogOutputChannel) {}

	async checkAlive() {
		let res: unknown;
		try {
			res = await (await fetch(`http://localhost:${this.port}`)).json();
		} catch {
			return false;
		}
		
		if (typeof res != "object" || !res || !("status" in res) || res.status!="ok")
			throw new Error("Server did not respond with ok status");
		return true;
	}
	
	server?: ServerType;
	stop: boolean=false;

	async start() {
		while (!this.stop) try {
			if (await this.checkAlive()) {
				this.log.info("CP server alive, polling in another minute");
				await delay(60*1000);
				continue;
			}

			if (this.stop) return;
			const [server,addr] = await new Promise<[ServerType,AddressInfo]>(res=>{
				const s = serve({
					...this.app,
					port: this.port
				}, (x)=>res([s,x]));
			});
			
			this.log.info(`Listening on ${addr.address}:${addr.port}`);
			this.server=server;

			await new Promise<void>(res=>server.once("close",res));
			this.log.info(`HTTP server closed${this.stop ? "" : ", restarting"}`);
		} catch (e) {
			if (e && typeof e == "object" && "code" in e && e.code=="EADDRINUSE") {
				this.log.info("Address already in use, checking in a minute...");
				await delay(60*1000);
			} else {
				throw e;
			}
		}
	}

	//wait how do i shut it down?!
	dispose() { this.stop=true; this.server?.close(); }
}