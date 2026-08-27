# Career Fit Scorer

<img width="1468" height="805" alt="image" src="https://github.com/user-attachments/assets/375c5ac2-8636-4c54-bb4f-382d1ce62322" />


A tiny, local-only tool to help you decide whether a job opportunity fits what you actually want next.

You define the criteria that matter to you (Compensation, Scope, Title, Tier of Company, Domain, Work Life Balance by default — fully editable), weight them so they add up to 100%, then score each opportunity 1-5 per criterion. Unsure about one? Mark it "?" instead of guessing, and the app shows a score range instead of a single number. Everything is sorted into a ranked list automatically.

No server, no account, no tracking. Everything lives in your browser's local storage.

## Why this exists

I kept making career decisions on gut feel, then rationalizing the numbers afterward. Compensation, scope, title, company tier, domain, work-life balance all pull in different directions, and I had no consistent way to weigh them against each other. This app forces that tradeoff conversation with myself before an offer's on the table, not during it.

**Who it's for:** PMs (or anyone) juggling multiple job opportunities who want a consistent way to compare them, instead of re-deciding what matters every time a new offer shows up.

**Tradeoffs I made:**

- **Manual weight sliders, no auto-balancing.** Moving one slider doesn't shift the others to compensate. I considered proportional redistribution, but it made the tool feel like it was deciding for me. A live "X% allocated" counter does the job with less magic.
- **"Unknown" scores stay wide.** Marking a criterion "?" always treats it as the full 1-5 range rather than a narrowed confidence band. A low/medium/high confidence input would've added precision, but it's a second judgment call stacked on the first one, and I'd rather keep the uncertainty honest than falsely precise.
- **The ranking freezes until you say it's current.** Changing a weight doesn't quietly reshuffle your rankings in the background. It marks them obsolete and grays them out until you click Reevaluate, so you notice the change instead of missing it.
- **localStorage instead of a real database.** No accounts, no server, no sync across devices. Your data lives in one browser. That's a real limitation if you switch laptops, but it's the honest cost of a tool with zero setup.

**What I'd build next:** export/import so a ranking survives a browser reset, a side-by-side view for comparing two opportunities instead of just a ranked list, and a way for a second opinion (a mentor, a partner) to score against the same criteria without handing over your whole history.

## Run it

Clone or download this folder, then open `index.html` in any modern browser.

```bash
git clone <this-repo-url>
cd career-fit-scorer
open index.html   # macOS; on other OSes, just double-click the file
```

Or serve it with any static file server if you prefer (e.g. GitHub Pages).

## How it works

1. **Criteria & Weights** — add, rename, or remove criteria. Adjust each weight so the total reads 100%.
2. **Add Opportunity** — name it, score each criterion 1-5, or mark it "?" if you don't know yet.
3. **Ranked Opportunities** — see every opportunity sorted by fit score. Opportunities with a "?" show a range (e.g. `3.1 – 4.6 (mid 3.9)`) instead of a single number.

Your data persists in this browser only — clearing site data / local storage resets it.
