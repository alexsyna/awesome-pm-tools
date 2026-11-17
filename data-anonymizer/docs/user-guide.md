<!-- The user guide. It's also built into the app: the "?" button next to the title opens it.
     Each "## " heading becomes an entry in the help's table of contents. -->

## What this tool does

The Medical Data Anonymizer turns a CSV with personal data into a version you can share for
research, and checks that nobody in it can be identified.

You open a file, decide which columns to share and how detailed each one is, and the tool keeps
checking the result. When every required check passes, you can download the anonymized CSV.

**Your data stays on your computer.** The file is read inside this page. It's never uploaded,
never stored, and it's gone when you close the tab. The page can't make any network requests at
all, so it can't send your data anywhere, even by mistake.

## Quick start

1. **Choose your data**: open a CSV, or click **Use mock data** to try the tool with 500 made-up patients.
2. **Select columns to share**: check the type and the use of each column. The tool pre-fills a guess.
3. **Configure column details**: make columns less detailed where needed, for example age in 10-year ranges.
4. **Review and export**: when the verdict says **Safe to release**, click **Download extract (CSV)**.

Not safe yet? Press **Suggest safer settings**, or open a red item in the safety checklist and use
one of its fixes.

You can move between the steps at any time with the bar at the top. The verdict and the safety
checklist on the right update as you change anything.

## The one idea behind it

Someone who already knows a few things about a person (age, sex, town) could look for them in a
shared file. If only one row matches, they've found that person, and can read everything else in
that row.

So the tool sorts every row into **groups**: rows that look the same on the things others could know.
A file is safe when:

- **every group is big enough** (at least 5 rows by default), so nobody can be picked out, and
- **the private answers vary inside each group**, so knowing someone's group doesn't reveal their answer.

**Example.** A file shares age, sex and city. Only one 87-year-old woman lives in Kiel, so she
is a group of one: anyone who knows her finds her row. Showing age in 10-year ranges (80–89) puts
her in a group with other women in their 80s in Kiel, and she can no longer be singled out.

## Step 1 · Choose your data

**The file.** A CSV whose first row holds the column names. Commas, semicolons and tabs all work
as separators. Excel exports with accented characters (é, ü) are read correctly. Choose the file,
or drag it onto the box.

**Empty values.** Blank cells, and the words NA, N/A, null, none, NaN, unknown, "-" and "?", count as empty.

**Mock data.** **Use mock data** loads 500 made-up clinic patients. They have names, emails,
postcodes, full dates and clinical values, so you can see everything the tool does without real data.

**Only include rows where…** (optional) keeps just the rows you want, for example
*Subtype is Tremor-dominant*. Pick a column, then tick the values to keep. Each value shows how
many rows have it. This works for text columns with up to 60 different values, and the column
doesn't have to be shared.

**Forget this file** removes it from the page.

## Step 2 · Select columns to share

Each column has two settings. The tool fills in a guess and says why, so check every row.

### Type: what the values are

| Type | Recognised when | What you can do with it |
|---|---|---|
| **Number** | 90% of the values are numbers ("26,5" counts) | Share in ranges, limit to a range |
| **Date** | 90% are dates (2019-05-03, 03.05.2019, 03/05/2019) | Shared as the **year only**, in ranges |
| **Postcode** | the name contains zip, postcode, postal or PLZ | Keep the first 3 or 2 characters |
| **Text / category** | anything else | Group rare values as "other" |
| **ID / identifier** | the name says ID, record or case number, or every row is different | Usually left out |

If the guess is wrong, change it. The detail options in step 3 follow the type. If the values don't
fit the new type (for example "Date" on a column of names), the tool says so and nothing changes.

### How it's used

- **Others could know it**: a neighbour, employer or social media could know this about a person
  (age, sex, city, postcode, job). These columns **form the groups**, and Suggest makes them less
  detailed when needed.
- **Private (research data)**: only the person told you this (a diagnosis, a test result, an
  answer). It isn't used to form groups. Instead the answers inside each group must vary, so
  nobody's answer can be worked out.
- **Leave out**: not in the file and not checked. Use it for names, contact details and
  anything the research doesn't need.

**Tip:** don't mark something private if others could know it. The file would look safer than it is.

**Identifiers.** Columns that look like names, emails, phone numbers, addresses or ID numbers start
as **Leave out**. You can still share an ID, for example when the recipient may hold pseudonymous
data under an agreement. The checklist then warns that the file is *pseudonymous, not anonymous*.

A column with the same value on every row starts as **Leave out**, because it tells the researcher nothing.

## Step 3 · Configure column details

Less detail makes people harder to single out. Each shared column has a card.

- **Shown value** (numbers and dates): the width of the ranges the researcher sees. At 1 the
  exact value is shared. At 10, ages appear as 60–69, 70–79…; dates are always shared as years.
- **Who's included** (numbers and dates): drag the two handles to keep only part of the range, for
  example ages 18–89. Rows outside the range, or without a value, are left out.
- **Detail level** (text and postcodes): exact value, the first 3 or 2 characters of a postcode,
  or **rare values as "other"**. That last option replaces values that fewer than *k* rows have
  (5 by default) with "other".
- **Leave out people who didn't give this**: drops rows where this column is empty.
- **Only rows with a value in every private column**: useful when many rows have private columns
  left empty. Groups made only of empty answers can't vary, so the check fails.
- **Remove people in groups smaller than k**: instead of making columns less detailed, leave out
  the few rows whose combination is too rare. It's only allowed up to a limit (5% of rows by default),
  because removing many rows would bias the research.

## Step 4 · Review and export

Step 4 lists every choice you made, each with a **Change** link back to its step.

### The verdict

At the top on the right: **Safe to release** or **Not safe to release yet**, with the number of rows,
how many are one of a kind, and how many are in groups that are too small. It stays visible while
you scroll.

- **Suggest safer settings**: let the tool make columns less detailed for you (see below).
- **Preview data**: the first 200 rows exactly as the file would contain them. This works even before it's safe.
- **Download extract (CSV)**: only enabled when every required check passes.

### The safety checklist

Four questions. Each one is a single line until you open it; red means it needs fixing.

**1. Can someone be picked out?**

| Check | Passes when |
|---|---|
| At least 20 people | the file has at least 20 rows (small files are easy to re-identify) |
| Everyone is in a group of k or more | the smallest group has at least k rows (k-anonymity) |
| Nobody is one of a kind | no row has a combination of values nobody else has |
| Low overall risk | groups ÷ rows is 10% or less (average re-identification risk) |
| Removed at most 5% | only when you remove small groups |

Open it to see **What drives the risk** (how many rows would still be one of a kind with less
detail or without each column), the **Rarest combinations**, **Group sizes**, and **ways to fix it**.

**2. Can private answers be guessed?** A table of every private column:

- **Variety**: the fewest different answers inside any group. It must be at least 2.
  *Example:* if all 6 women aged 70–79 from Germany answered "yes" to "Do you smoke?", variety is 1,
  so anyone who knows a neighbour is in that group knows she smokes. One "no", or one empty answer,
  makes it 2.
- **Gap**: how far a group's answers are from everyone's, from 0 (same mix) to 1 (completely
  different). Above 0.35 it's a **warning** only. *Example:* overall 20% said "yes" to chemical
  exposure, but 90% of "men, 60–79, Germany" did, so the gap is 0.7. Nobody's answer is revealed,
  but "yes" is very likely. It may also be exactly what the research is about, so check whether
  such a likely answer could harm someone.

**3. Are identifiers left out?** Confirms no ID column is shared, or warns if you chose to share one.

**4. Regulations.** GDPR and HIPAA indicators (see below).

### Fixing problems

Open a red item: under **Ways to fix it** each fix says what it costs the researcher, with a button:

- **Make columns less detailed** runs Suggest.
- **Leave out the N people in groups smaller than k** shows the share it needs and raises the limit to exactly that.
- **Remove the column** that causes the most risk, or a private column that gives answers away.

### What Suggest does

Suggest follows fixed rules. There's no AI and no randomness, so the same file always gets the same suggestions.

1. If leaving out the rows in small groups is enough, within your limit, it does that.
2. Otherwise it tries one small step on every column others could know: a wider range
   (1 → 2 → 3 → 4 → 5 → 6 → 8 → 10 → 12 → 15 → 20), a shorter postcode, or rare values as "other". It keeps
   the step that helps most, and repeats.
3. It stops when the file is safe, or when nothing can be made less detailed any more. Changes that
   turned out not to help are undone.

Suggest never leaves out people beyond your limit and never removes a column on its own. Those
change what the researcher gets, so it offers them as buttons for you to decide. **Undo these changes**
puts everything back.

### The exported file

- **One row per person**, in random order, with a new random **study_id** (S00001, S00002…) that
  can't be traced back to the original rows.
- **Columns:** first the ones others could know, then the private ones, under their original names.
- **Values as configured:** ranges like `60–69`, years for dates, shortened postcodes like `101…`,
  "other" for rare values. Empty values show as `(not given)`.
- **Left-out columns, and removed rows, are not in the file.**
- **File name:** `<your file>-anonymized-<date>.csv`.

## Release policy (the gear)

The gear next to the title opens the safety rules every file must meet. A dot on the gear means
you've changed something from the defaults. **Back to defaults** restores them.

| Setting | Default | What it means |
|---|---|---|
| **k: smallest group** | 5 | Every combination of the columns others could know must be shared by at least k rows. 5 is common; use 10+ for small or sensitive groups. This k is also used by "remove people in groups smaller than k" and "rare values as other". |
| **l: different answers** | 2 | Each group needs at least l different answers in every private column. 3 is stricter. |
| **t: max gap** | 0.35 | Above this, a group's answers count as noticeably different from everyone's. Warning only. |
| **Max average risk** | 0.1 | Groups ÷ rows must not exceed this (10%). |
| **Min people** | 20 | The smallest file you may export. |
| **Max share removed** | 0.05 | The most rows "remove people in groups smaller than k" may leave out (5%). |

## Regulations: GDPR and HIPAA

The **Regulations** item checks the file *as it would be exported* against two frameworks. It's an
indicator, **not legal advice**: your data protection officer makes the final call.

**GDPR (EU).** Data is anonymous only if people can't be re-identified by means reasonably likely to
be used. The EU data protection authorities test three risks:

- **Singling out**: nobody can be picked out (the group checks). An ID column you share fails this test.
- **Inference**: private answers can't be deduced from a group (variety and gap).
- **Linkability**: rows can't be joined back to people. Random study IDs and shuffled rows help.
  Whether the recipient holds other data to join on can't be checked here, so you confirm it.
- **Data minimisation**: only what the research needs. You confirm it.

**HIPAA Safe Harbor (US).** A fixed list of 18 identifier types. It only matters for US healthcare
recipients. The tool checks what the data can show:

- no names, contact details or ID numbers;
- no location smaller than a state: exact postcodes fail; the first 3 digits are allowed only where
  that area has more than 20,000 people;
- dates as years only;
- **ages over 89 grouped as 90+**: an age or birth year that is entirely 90 or older fails;
- no other unique codes.

Photos, biometrics, names hidden in free text, and "no actual knowledge that the data could identify
someone" can't be checked automatically, so they're listed for you to confirm.

## Glossary

- **Group** (equivalence class): rows with the same values in every column others could know.
- **k-anonymity**: every group has at least k rows.
- **l-diversity**: every group has at least l different values in each private column.
- **t-closeness**: each group's answers are close (within t) to the answers of the whole file.
- **Quasi-identifier**: a column others could know, which helps identify someone in combination with others.
- **Generalization**: showing less detail (ranges, shorter postcodes, "other").
- **Suppression**: leaving out the rows that are too rare.
- **Pseudonymous vs anonymous**: pseudonymous data can still be linked to a person, for example
  through an ID or a key someone keeps. It stays personal data under GDPR. Anonymous data can't be linked back.

## Questions and problems

**Suggest can't make it safe.** It then names the remaining options. Usually these are leaving out a few
more rows (raise the limit), removing the column that drives the risk (often a rare category such
as an unusual sex value or a small city), or removing a private column with a rare answer.

**"N values couldn't be read as numbers/dates".** Those cells count as empty. Check the column's type
in step 2, or fix the values in the file.

**My postcode column shows ranges.** It was recognised as a number. Set its type to **Postcode**.

**Strange characters (Ã©).** The file isn't UTF-8. The tool tries the Windows encoding Excel uses,
but saving the file as "CSV UTF-8" in Excel avoids the problem.

**Large files.** Everything happens in the browser's memory. Files up to about 200,000 rows work;
beyond that the page gets slow.

**Reloading the page** forgets the file. The tool only remembers which step you were on.
