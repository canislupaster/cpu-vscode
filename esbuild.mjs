import { ChildProcess, exec, execFile, spawn } from "child_process";
import * as esbuild from "esbuild";

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const start = async (cmd, watchArgs, name) => {
    const proc = spawn(watch ? `${cmd} ${watchArgs}` : cmd, {
      shell: true,
      stdio: "inherit"
    });

    console.log(`running ${name}...`);
    if (!watch) {
      await new Promise((res,rej) => proc.on("exit", (code)=>{
        if (code!=0) rej(new Error(`${name} exited with nonzero exit code ${code}`));
        else res();
      }));
    } else {
      proc.on("spawn", ()=>console.log(`${name} started`));
      proc.on("error", (err) => {
        console.error(`failed to spawn ${name}\n`, err);
      });
    }
  };

  await start("npx tsc --project ./tsconfig.json", "--watch --preserveWatchOutput", "tsc");
  await start("npx tailwindcss -i ./src/main.css -o ./out/output.css", "--watch", "tailwind");

  /**
   * @type {import('esbuild').Plugin}
   */
  const esbuildProblemMatcherPlugin = (name) => ({
    name: 'esbuild-problem-matcher',

    setup(build) {
      build.onStart(() => {
        console.log(`[${name}] build started`);
      });

      build.onEnd(result => {
        result.errors.forEach(({ text, location }) => {
          console.error(`✘ [ERROR][${name}] ${text}`);
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        });
        console.log(`[${name}] build finished`);
      });
    }
  });

  const makeCtx = (name, entryPoints, platform) => esbuild.context({
    entryPoints,
    bundle: true,
    outdir: "out",
    minify: production,
    sourcemap: !production,
    sourcesContent: !production,
    platform,
    loader: {
      ".ttf": "file",
      "": "empty" //esbuild tries to parse a README in terminal kit for some goddamned reason, idk if its bc there are glob requires there. no fucking clue.
    },
    external: ['vscode'],
    define: { WATCH: watch ? "true" : "false" },
    plugins: [ esbuildProblemMatcherPlugin(name) ]
  });

  await Promise.race([
    makeCtx("webviews", ["src/activitybar.tsx", "src/panel.tsx", "src/testeditor.tsx"], "browser"),
    makeCtx("extension", ["src/extension.ts", "src/main.ts"], "node")
  ].map(async ctx => {
    const a = await ctx;
    if (watch) {
      await a.watch();
    } else {
      await a.rebuild();
      await a.dispose();
    }
  }));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});