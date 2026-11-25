# 🕵️ How Unique Are You?

A 1-minute game that shows how a few ordinary details can single you out, even in "anonymous" data.

Pick a few details about yourself (country, birth year, role, company size…) and see how many of
Europe's 10 million tech professionals share them. Then blur your details until you're hidden among
at least 5 people: that's what anonymization (k-anonymity) does to datasets.

**▶ Play:** https://alexsyna.github.io/awesome-pm-tools/how-unique-are-you/

## Privacy

Everything runs in your browser. Your choices are never sent or stored: the page blocks all network
access, uses no cookies and no analytics, and you only pick from lists, never type anything personal.

## How the estimate works

People like you ≈ 1 + (tech workforce − 1) × the share of people with each of your details.

- **Tech workforce:** Eurostat, ICT specialists in employment, 2025 (EU 10.45 million, Germany 2.3 million…).
- **Women's share and age split:** Eurostat 2025.
- **Role, experience, company size, work setup, education, industry:** Stack Overflow Developer Survey 2024.
- **City shares:** national population figures.

It's an estimate, not a lookup of real people. It treats details as independent, and city shares understate
big tech hubs. The page lists every source and limit under "How the estimate works".

## Files

- `index.html`: the whole game, one file, no dependencies.
- `preview.png`: the image shown when the link is shared.

## Related

Have a real dataset to share safely? Try the **[Data Anonymizer](https://alexsyna.github.io/awesome-pm-tools/data-anonymizer/)**.

Apache-2.0
