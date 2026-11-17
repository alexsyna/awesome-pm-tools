// Smoke test: opens dist/index.html from disk (file://) in headless Chrome, loads the built-in mock
// data, runs Suggest, applies its fixes, and checks the anonymized CSV that would be downloaded.
//   deno run -A test/smoke.ts
import puppeteer from "npm:puppeteer-core@23.6.0";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const file = new URL("../dist/index.html", import.meta.url).href;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors: string[] = [], requests: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) requests.push(r.url()); });
await page.setViewport({ width: 1280, height: 900 });
await page.goto(file, { waitUntil: "load" });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (sel: string) => page.$eval(sel, (e) => (e as HTMLElement).innerText).catch(() => "");
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) Deno.exitCode = 1; };

ok(await page.title() === "CSV Anonymizer", "page loads");
ok(!(await page.$("header.top")), "no top bar");
await page.click("#an-help-btn"); await wait(400);
const toc = await page.$$eval("#an-help-toc a", (as) => as.map((a) => a.textContent));
ok(await page.$eval("#an-help", (d) => (d as HTMLDialogElement).open), "the ? button opens the user guide");
ok(toc.length >= 8 && toc.includes("Release policy (the gear)"), `guide contents: ${toc.length} sections`);
await page.screenshot({ path: new URL("./help.png", import.meta.url).pathname });
await page.click("#an-help-close"); await wait(200);
ok((await text("#an-verdict")).includes("Upload a CSV"), "asks for a file first");
await page.click("#an-mock"); await wait(1500);
ok((await text("#an-file-info")).includes("500 rows"), "mock data read in the page (500 rows)");
const roles = await page.$$eval(".ucol", (rows) => rows.map((r) => `${r.querySelector(".n")!.textContent}=${(r.querySelector("[data-ucol]") as HTMLSelectElement).value}`));
ok(roles.includes("patient_id=leave") && roles.includes("Email=leave"), "identifiers start as Leave out");
ok((await text("#an-verdict .big")).includes("Not safe"), "first check runs: not safe yet");
await page.click("#an-suggest"); await wait(4000);
const dlg = await text("#an-suggest-dlg");
ok(/Still not safe|Safe settings/.test(dlg), "Suggest opens with a result");
// Keep clicking the first offered fix until it's safe (as an admin would).
for (let i = 0; i < 6 && !(await text("#an-verdict .big")).includes("Safe to release"); i++) {
  const btn = await page.$("#an-suggest-dlg[open] [data-act]");
  if (btn) { await btn.click(); await wait(4000); }
  else { await page.evaluate(() => (document.querySelector("#an-suggest-dlg") as HTMLDialogElement).close()); await page.click("#an-suggest"); await wait(4000); }
}
await page.evaluate(() => { const d = document.querySelector("#an-suggest-dlg") as HTMLDialogElement; if (d.open) d.close(); });
await wait(1500);
ok((await text("#an-verdict .big")).includes("Safe to release"), "reaches Safe to release");
const csv = await page.evaluate(() => (globalThis as any).Engine.extract(null, "", (globalThis as any).an?.req ?? null).catch((e: Error) => "ERR " + e.message));
// `an` is a top-level const, not on window: ask the page for its current request instead.
const csv2 = csv.startsWith("ERR") ? await page.evaluate("Engine.extract(null, '', an.req)") as string : csv;
const lines = csv2.trim().split("\n");
ok(lines[0].startsWith("study_id"), `CSV header: ${lines[0].slice(0, 90)}`);
ok(!/patient_id|Email|First name|Last name/.test(lines[0]), "no identifier columns in the export");
ok(!/@example-mail\.de|KP-1\d{4}/.test(csv2), "no emails or patient IDs anywhere in the export");
ok(lines.length > 20, `${lines.length - 1} rows exported`);
ok(requests.length === 0, `no network requests (${requests.length})`);
ok(errors.length === 0, `no errors in the page${errors.length ? ": " + errors.join(" | ") : ""}`);
await page.screenshot({ path: new URL("./smoke.png", import.meta.url).pathname });
await browser.close();
