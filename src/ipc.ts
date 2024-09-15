//um why

import { createServer, Server, Socket } from "net";
import { EventEmitter, ExtensionContext, LogOutputChannel } from "vscode";

//this is just to support multiple windows :)
//yeah ik i have problems
//oh well
//really half assed but i dont regret it!

const PORT = 7378;

type TCPMessage = {
	type: "testSetChange", id: number, name: string,
	focus: boolean //if added via CPH, focus on creation
} | {
	type: "deleteTestSet", id: number
};

export class TCP {
	constructor(private ctx: ExtensionContext, private handleErr: (x: unknown)=>void, private log: LogOutputChannel) { }

	async connect() {
		const socket = new Socket();
		this.socket=socket;
		const onErrorPromise = new Promise((res,rej) => socket.on("error", (e)=>{ this.err(e); rej(e); }));
		const connPromise=new Promise(res=>socket.connect(PORT, ()=>res("started")));

		await Promise.race([onErrorPromise, connPromise]);
		this.log.info("successfully connected to TCP server");
		socket.on("data", (buf)=>this.recvEmitter.fire(JSON.parse(buf.toString("utf-8"))));

		socket.once("close", () => {
			this.log.info("socket closed, trying to bind again...");

			socket.destroy();
			delete this.socket;

			this.start().catch((e)=>this.handleErr(e));
		});
	}

	private connected: Record<number,Socket> = {};
	private error?: Error;
	private err(e: Error) {this.handleErr(e); this.error=e;}
	private server?: Server;
	private socket?: Socket;
	private recvEmitter = new EventEmitter<TCPMessage>;
	private id=0;
	recv=this.recvEmitter.event;

	async start() {
		const server = createServer((x) => {
			const sid = this.id++;
			x.on("ready", ()=>{ this.connected[sid]=x; });
			x.on("close", ()=>{ delete this.connected[sid]; });
			x.on("data", (buf) => {
				//no error handling :clown:
				this.recvEmitter.fire(JSON.parse(buf.toString("utf-8")));
			});
		});

		const errPromise = new Promise<"addrinuse"|"close">((res,rej)=>{
			server.on("error", (e)=>{
				if ("code" in e && e.code=="EADDRINUSE") res("addrinuse");
				else {this.err(e); rej(e);}
			});

			server.on("close", (e: {hadError: boolean})=>{
				if (e.hadError) rej(new Error("Socket closed due to error"));
				else res("close");
			});
		});

		this.log.info("starting TCP server");
		const startPromise = new Promise<"started">(res=>server.listen(PORT, ()=>res("started")));

		if (await Promise.race([startPromise, errPromise])=="addrinuse") {
			this.log.info("path in use, connecting to server");
			return await this.connect();
		} else {
			this.log.info("successfully started TCP server");
			this.server=server;
		}
	}

	dispose() {
		this.error = new Error("Server is disposed");
		//also no error handling!
		this.server?.close();
		for (const sock of Object.values(this.connected)) {
			sock.end(); sock.destroy();
		}
	}

	send(msg: TCPMessage) {
		// silently fail, since this error has already been handled
		if (this.error) return;

		for (const sock of Object.values(this.connected)) {
			if (sock.writable) sock.write(JSON.stringify(msg));
		}

		if (this.socket)
			this.socket.write(JSON.stringify(msg));
	}
}