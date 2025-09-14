import { LanguageProvider } from "./languages";
import App from "./main";

import { EventEmitter } from "vscode";
import { isProd } from "./util";
import { BrowserContext, chromium, devices, FileChooser, firefox, Page } from "playwright";
import { AutoSubmitUpdate, AutoSubmitUpdateWhen } from "./shared";
import { mkdir, readFile } from "fs/promises";
import { join } from "path";

type SubmitOptions = {
	page: Page, path: string, source: string, language: string,
	abort: AbortController, promptAuth: (prompt: (page: Page)=>Promise<void>)=>Promise<Page>
};

abstract class AutoSubmitDomain {
	abstract domain: string;
	abstract languages: Set<string>;

	abstract submit(opts: SubmitOptions): AsyncGenerator<AutoSubmitUpdate>;
	abstract dispose(): void;
}

class AutoSubmitCodeforces extends AutoSubmitDomain {
	domain = "codeforces.com";
	languages = new Set(["c++", "python", "java", "rust"]);

	async* submit({page, path, source, language, abort, promptAuth}: SubmitOptions): AsyncGenerator<AutoSubmitUpdate> {
		if (!/^\/problemset\/problem\/\w+\/\w+|(?:contest|gym)\/\w+\/problem\/\w+$/.test(path))
			throw new Error("This URL isn't supported by the autosubmitter.");

		for (let retry=0; retry<=1; retry++) {
			await page.goto(new URL(path, "https://codeforces.com").href);
			await page.waitForLoadState("domcontentloaded");
			if (await page.locator("a[href='/register']").waitFor({timeout: 50}).catch(()=>false)!=false) {
				if (retry==0) {
					page=await promptAuth(async page=>{
						await page.goto("https://codeforces.com/enter");
						await page.evaluate(()=>{
							window.alert("Please login to enable autosubmit.");
						});
						await page.waitForURL("https://codeforces.com/profile/*", {timeout: 120_000}).catch(()=>{});
					});
				}
				else throw new Error("You aren't logged in to Codeforces.");
			}
		}

		const chooserPromise =  new Promise<FileChooser>((res,rej)=>{
			page.on("filechooser", chooser=>res(chooser));
			setTimeout(()=>rej(new Error("Failed to choose file to submit.")), 500);
		});
		
		await page.getByRole("button", {
			name: "sourceFile", exact: true
		}).click();

		const chooser = await chooserPromise;
		const fileName = {
			"c++": "main.cpp",
			"python": "main.py",
			"java": "Main.java",
			"rust": "main.rs"
		}[language];
		
		if (fileName==undefined)
			throw new Error("unsupported language");

		await chooser.setFiles({
			name: fileName,
			mimeType: "text/plain",
			buffer: Buffer.from(source, "utf-8")
		});
		
		// last chance to back out...
		if (abort.signal.aborted) return;
		await page.getByRole("button", {
			name: "Submit", exact: true
		}).click();
		
		await page.waitForURL(u=>u.pathname.endsWith("my"));

		const submissionId = await page.locator(".status-frame-datatable")
			.locator("tr[data-submission-id]")
			.first()
			.getAttribute("data-submission-id");
			
		if (submissionId==null)
			throw new Error("No submission ID");

		const link = `https://codeforces.com/problemset/submission/${submissionId}`;
		while (!abort.signal.aborted) {
			const verdict = (await page
				.locator(`tr[data-submission-id="${submissionId}"`)
				.locator(".status-verdict-cell").textContent())
				?.trim()?.toLowerCase();
			
			if (verdict==undefined) 
				throw new Error("Couldn't find verdict.")

			const testNumStr = verdict.match(/test (\d+)$/)?.[1];
			const testNum = testNumStr ? Number.parseInt(testNumStr) : undefined;

			if (verdict.startsWith("running on")) {
				yield { type: "testing", testCase: testNum, link };
			} else {
				const prefixToVerdict = [
					["time limit exceeded", "TL"],
					["memory limit exceeded", "ML"],
					["runtime error", "RE"],
					["compilation error", "CE"],
					["accepted", "AC"],
					["idleness limit exceeded", "INT"],
				] as const;
				
				const shortVerdict = prefixToVerdict.find(([a])=>verdict.startsWith(a))?.[1];
				if (shortVerdict==undefined)
					throw new Error("unrecognized verdict");

				yield { type: "verdict", verdict: shortVerdict, testCase: testNum, link };
				return;
			}

			await page.waitForTimeout(100);
		}
	}
	
	dispose() {}
}

export class AutoSubmit {
	private domains = new Map<string, AutoSubmitDomain>();
	private browser?: BrowserContext;
	private numAutoSubmit = 0;
	// for deduplicating problem names
	private numSubmits = new Map<string, number>();
	private autoSubmitterStatus = new Map<number, [AutoSubmitUpdateWhen, AbortController]>();

	autoSubmitterUpdates = new EventEmitter<AutoSubmitUpdateWhen>();
	status() {return [...this.autoSubmitterStatus.values()].map(v=>v[0]);}
	close(id: number) {
		const v = this.autoSubmitterStatus.get(id);
		if (!v) throw new Error("That autosubmitter doesn't exist.");
		v[1].abort();
	}
	
	isSupported(url: string) {
		return this.domains.has(new URL(url).host);
	}

	constructor(private app: App, private languages: LanguageProvider) {
		for (const autosubmitter of [
			new AutoSubmitCodeforces()
		]) {
			this.domains.set(autosubmitter.domain, autosubmitter);
		}

		this.autoSubmitterUpdates.event((update)=>{
			console.log("autosubmit update", update);
		});
	}
	
	private lastUpdate = new Map<string, AutoSubmitUpdateWhen>();
	
	getLastUpdate(url: string): AutoSubmitUpdateWhen|null {
		return this.lastUpdate.get(url) ?? null;
	}
	
	private async startBrowser(headless: boolean) {
		console.log("starting autosubmit browser");

		if (this.app.cfg.browserPath=="" || this.app.cfg.browserProfileDir=="") {
			throw new Error("Browser and profile path are not provided.");
		}
	
		const profilePath = join(this.app.ctx.globalStorageUri.fsPath, "browserProfile");
		await mkdir(profilePath, {recursive: true});

		const [makeBrowser, device] = ({
			firefox: [firefox, devices["Desktop Firefox"]],
			chromium: [chromium, devices["Desktop Chrome"]]
		} as const)[this.app.cfg.browserType];

		this.browser = await makeBrowser.launchPersistentContext(profilePath, {
			headless: isProd && !headless,
			ignoreDefaultArgs: !headless,
			args: headless ? [] : [
				"--no-first-run", "--remote-debugging-pipe",
				"--no-default-browser-check", `--user-data-dir=${profilePath}`,
			],
			executablePath: this.app.cfg.browserPath,
			...device
		});

		console.log("browser started");
		return this.browser;
	}

	private async promptAuth(prompt: (x: Page)=>Promise<void>) {
		await this.browser?.close();
		this.browser = await this.startBrowser(false);
		
		// this can't bypass cloudflare so it's off for now
		await prompt(await this.browser.newPage());
		
		await this.browser.close();
		this.browser = await this.startBrowser(true);
		return this.browser.newPage();
	}

	async submit(url: string, file: string, name: string) {
		const u = new URL(url);
		const domain = this.domains.get(u.host);
		if (!domain) throw new Error("unsupported domain");

		this.browser = await this.startBrowser(true);
		const languageName = this.languages.getLanguage(file)?.name;
		if (!languageName) throw new Error(`no language found for ${file}`);
		
		const page = await this.browser.newPage();
		const source = await readFile(file, "utf-8");

		const abort = new AbortController();
		const updater = domain.submit({
			page, path: u.pathname, source,
			language: languageName, abort,
			promptAuth: (url)=>this.promptAuth(url),
		});
		
		const newNumSubmits = (this.numSubmits.get(name) ?? 0)+1;
		this.numSubmits.set(name, newNumSubmits);
		const nameNum = `${name} (Submission ${newNumSubmits})`;

		const id = this.numAutoSubmit++;
		const up = (x: AutoSubmitUpdate) => {
			const update = { ...x, when: Date.now(), name: nameNum, id, problemLink: url };
			this.autoSubmitterStatus.set(id, [ update, abort ]);
			this.autoSubmitterUpdates.fire(update);
		};
		
		const abortPromise = new Promise<"abort">(res=>abort.signal.addEventListener("abort", ()=>res("abort")));

		(async () => {
			while (true) {
				const update = await Promise.race([updater.next(), abortPromise]);
				if (update=="abort" || update.done==true) return;
				up(update.value);
			}
		})().catch(err=>up({
			type: "error",
			error: err instanceof Error ? err : new Error("Unknown autosubmit error."),
		})).finally(()=>{
			void page.close();
		});
	}

	dispose() {
		for (const [,aborter] of this.autoSubmitterStatus.values())
			aborter.abort();
		for (const submitter of this.domains.values())
			submitter.dispose();

		if (this.browser) {
			console.log("closing autosubmit browser");
			void this.browser.close();
		}
	}
}
