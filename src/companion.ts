import { EventEmitter, LogOutputChannel } from "vscode";
import { serve, ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { AddressInfo } from "node:net";
import { delay } from "./util";

type InputConfiguration={
  type: 'stdin' | 'file' | 'regex';
  fileName?: string;
  pattern?: string;
};

type OutputConfiguration={
  type: 'stdout' | 'file';
  fileName?: string;
};

type Task = {
	name: string,
	group: string,
	url: string,
	interactive: boolean,
	memoryLimit: number,
	timeLimit: number,
	tests: {input:string, output:string}[],
	testType: "single"|"multiNumber",
	input: InputConfiguration,
	output: OutputConfiguration,
	batch: {id: string, size: number}
};

export class Companion {
	port=4244; //sorry hightail

	private evSrc=new EventEmitter<Task>()
	event=this.evSrc.event;

	private app=new Hono().post("/", async (c) => {
		const json: Task = await c.req.json();
		this.evSrc.fire(json);
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