# CSV Anonymizer

A standalone tool to check a CSV for re-identification risk and export an anonymized version.
It is the CSV part of KiPa Admin's Medical Data Anonymizer, without the registry, database,
analytics or server.

**Everything runs in the browser.** The file is read in the page, never uploaded and never stored;
it's gone when the tab closes. The page has a Content-Security-Policy that blocks all network
access, so it can't send data anywhere even by mistake.

## Use it

Open `dist/index.html` in a browser. Double-clicking the file works (no server needed), or host it.

1. **Choose your data**: open a CSV (comma, semicolon or tab separated; first row = column names), or try the mock data.
2. **Select columns to share**: for each column, its type and how it's used (others could know it, private, leave out).
3. **Configure column details**: ranges, shortened postcodes, rare values as "other", who's included.
4. **Review and export**: the safety checklist must be all green; then download the anonymized CSV.

The gear next to the title holds the release policy (group size k, etc.). The **?** next to it opens
the user guide, which explains every step, check and setting.

## Deploy

`dist/index.html` is the whole app (one file, about 135 KB, no external files). Put it on any static
host: an internal web server, GitHub Pages, Netlify, S3, or simply share the file.

## Build

Needs [Deno](https://deno.com) 2.

```bash
deno run -A build.ts
```

This bundles `src/main.ts` + `src/engine.ts` with esbuild, renders `docs/user-guide.md` into the
help pop-up, and inlines both into `src/app.html`, writing `dist/index.html`.

## Test

```bash
deno run -A build.ts && deno run -A test/smoke.ts
```

Opens `dist/index.html` from disk in headless Chrome (needs Google Chrome installed), loads the
mock data, follows Suggest's fixes to "Safe to release", and checks the exported CSV has no
identifiers, that no network requests were made, and that there were no errors.

## Files

| File | What it is |
|---|---|
| `src/app.html` | The page: layout, styles and UI code (taken from KiPa Admin's anonymizer, CSV flow only) |
| `src/engine.ts` | The anonymization engine: CSV parsing, checks, Suggest, GDPR/HIPAA indicators, export |
| `src/main.ts` | Exposes the engine to the page as `window.Engine` |
| `docs/user-guide.md` | The user guide, shown in the app by the **?** button. Edit it here and rebuild |
| `build.ts` | Builds `dist/index.html` |
| `test/smoke.ts` | End-to-end check in headless Chrome |

## Keeping in step with KiPa Admin

`src/engine.ts` is a copy of `~/Desktop/KIPA/kipa-admin/anonymize.ts` with one change: the
`import type pg …` line is replaced by a local `declare namespace pg` (see the top of the file).
To bring engine fixes over, copy the file again, re-apply that change, and rebuild. The registry
code in it is unused here.

`src/app.html` was taken from `kipa-admin/index.html` and then changed for this tool (no server
calls, CSV only), so UI changes need to be copied over by hand.

## Limits

- Files are processed in the page's memory: fine up to roughly 200,000 rows, slower beyond.
- The checks and the GDPR/HIPAA indicators support a decision; they are not legal advice.
