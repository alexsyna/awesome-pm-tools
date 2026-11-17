// Builds dist/index.html: the page from src/app.html with the engine (src/main.ts + src/engine.ts)
// bundled and inlined, and the user guide (docs/user-guide.md) rendered into its help pop-up, so the
// result is one self-contained file that works offline and from file://.
//   deno run -A build.ts
import * as esbuild from "npm:esbuild@0.24.0";
import { marked } from "npm:marked@14.1.3";

const result = await esbuild.build({
  entryPoints: ["src/main.ts"], bundle: true, format: "iife", minify: true, write: false,
  target: ["chrome100", "firefox100", "safari15"], platform: "browser",
});
const engine = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
const guide = await marked.parse(await Deno.readTextFile("docs/user-guide.md"));
const page = await Deno.readTextFile("src/app.html");
for (const mark of ["/*__ENGINE__*/", "<!--__HELP__-->"]) if (!page.includes(mark)) throw new Error(`src/app.html has no ${mark} placeholder`);
await Deno.mkdir("dist", { recursive: true });
await Deno.writeTextFile("dist/index.html", page.replace("/*__ENGINE__*/", () => engine).replace("<!--__HELP__-->", () => guide));
esbuild.stop();
const kb = Math.round((await Deno.stat("dist/index.html")).size / 1024);
console.log(`dist/index.html written (${kb} KB)`);
