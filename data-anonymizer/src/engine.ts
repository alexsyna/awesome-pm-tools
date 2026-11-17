// Anonymization checks for researcher data requests.
//
// A request names the fields a researcher wants, how coarse each one is ("generalization
// level") and whether it can identify someone when combined with outside knowledge
// ("quasi-identifier", e.g. age + country) or is the research data itself ("sensitive",
// e.g. a survey answer). From that we build the extract in memory and measure:
//   k-anonymity   smallest group of people who share the same quasi-identifier values
//   uniqueness    people who are alone in their group (k = 1)
//   risk          re-identification risk: max = 1/k, average = groups / people
//   l-diversity   fewest distinct sensitive answers inside any group
//   t-closeness   how far a group's answers can differ from everyone's (0 = same, 1 = totally)
// Nothing here writes to the database; the extract only leaves through /api/anon/extract,
// which refuses unless every check passes.

// Standalone build: copied from kipa-admin/anonymize.ts. The registry (database) parts are unused here;
// only the uploaded-CSV path runs, entirely in the browser. Keep this file in sync by copying it over again
// and re-applying this one change (the database client type below instead of the pg import).
// deno-lint-ignore no-namespace
declare namespace pg { type PoolClient = any; } // eslint-disable-line

export type Use = "qi" | "sensitive";
// band: width in years for "banded" levels. min/max: only people whose value is in that range
// (a cohort filter, for numeric fields such as age and year of diagnosis).
export type FieldReq = { id: string; use: Use; level: number; band?: number; min?: number | null; max?: number | null; dropMissing?: boolean };
export type Policy = { k: number; l: number; t: number; maxSuppression: number; minCohort: number; maxAvgRisk: number };
export type AnonRequest = {
  upload?: string | null; // id of an uploaded CSV to use instead of the registry database
  // "Only include people where <column> is one of <values>" (any column, shared or not).
  filters?: { id: string; values: string[] }[];
  fields: FieldReq[];
  roles: string[];
  requireAnswers: boolean;
  suppress: boolean;
  policy: Policy;
};

export const DEFAULT_POLICY: Policy = { k: 5, l: 2, t: 0.35, maxSuppression: 0.05, minCohort: 20, maxAvgRisk: 0.1 };

const MISSING = "(not given)";
const REFERENCE = new Date(); // ages are worked out from today

type Person = { userId: string; profile: Record<string, unknown>; answers: Map<string, string> };
// fn returns the released value. A "banded" level groups numbers into bands
// whose width the admin chooses (f.band years), starting from the range minimum if one is set.
type Level = { label: string; fn: (v: unknown, f: FieldReq) => string | null; banded?: boolean; rare?: boolean };

const band = (n: number, w: number, start = 0) => {
  if (w <= 1) return String(n);
  const lo = start + Math.floor((n - start) / w) * w;
  return `${lo}–${lo + w - 1}`;
};
// Band widths Suggest steps through. It stops at 20: wider bands say almost nothing, so after
// that it moves on to the next level (e.g. under/over 65). To leave a column out, untick it.
export const BAND_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
const ageOf = (v: unknown) => {
  const d = new Date(String(v));
  let a = REFERENCE.getFullYear() - d.getFullYear();
  if (REFERENCE < new Date(REFERENCE.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
};
const orMissing = (fn: (v: unknown, f: FieldReq) => string) => (v: unknown, f: FieldReq) => v == null || v === "" ? MISSING : fn(v, f);
// "Rare values as other": values fewer than k people have (k from the release policy, counted in the
// current file) become "other". The level returns the exact value; buildRecords does the grouping
// because it needs everyone's values.
const RARE: Level = { label: "Rare values as “other”", rare: true, fn: orMissing(String) };
// ISO 3166 alpha-2 country → continent (countries not listed show as "Other").
const CONTINENT: Record<string, string> = Object.fromEntries(Object.entries({
  "Europe": "AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK",
  "Asia": "AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE",
  "Africa": "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
  "North America": "AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI",
  "South America": "AR BO BR CL CO EC FK GF GY PE PY SR UY VE",
  "Oceania": "AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS",
}).flatMap(([cont, codes]) => codes.split(" ").map((c) => [c, cont])));

// Profile fields a researcher can ask for. Each lists its levels from finest to coarsest.
// numeric: the field can be cut into bands and limited to a range; value() turns the stored value into the number.
// scale: band widths Suggest tries are BAND_STEPS × scale (for numbers in the thousands, e.g. income).
// decimals: values aren't whole numbers, so a band is labelled "20–<25" instead of "20–24".
type Numeric = { unit: string; rangeLabel: string; lo: number; hi: number; value: (v: unknown) => number; bandLabel: (w: number) => string; scale?: number; decimals?: boolean; bandMax?: number };
type FieldDef = { label: string; column: string; defaultUse: Use; levels: Level[]; numeric?: Numeric };
export const PROFILE_FIELDS: Record<string, FieldDef> = {
  age: {
    label: "Age (from date of birth)", column: "dateOfBirth", defaultUse: "qi", levels: [
      // Only ever released in bands; band width 1 = age in whole years. Never the date of birth.
      { label: "Age in bands", banded: true, fn: orMissing((v, f) => band(ageOf(v), f.band ?? 5, f.min ?? 0)) },
    ],
    numeric: { unit: "years old", rangeLabel: "Ages", lo: 18, hi: 100, value: ageOf, bandLabel: (w) => w <= 1 ? "Exact age" : `${w}-year ranges` },
  },
  yearDiagnosed: {
    label: "Year of diagnosis", column: "yearDiagnosed", defaultUse: "qi", levels: [
      // Like age: one control, the range width (1 = exact year).
      { label: "Year in bands", banded: true, fn: orMissing((v, f) => band(Number(v), f.band ?? 5, f.min ?? 0)) },
    ],
    numeric: { unit: "", rangeLabel: "Diagnosed", lo: 1970, hi: new Date().getFullYear(), value: Number, bandLabel: (w) => w <= 1 ? "Exact year" : `${w}-year ranges` },
  },
  gender: {
    label: "Gender", column: "gender", defaultUse: "qi", levels: [
      { label: "Exact value", fn: orMissing(String) },
      RARE,
    ],
  },
  country: {
    label: "Country", column: "country", defaultUse: "qi", levels: [
      { label: "Exact value", fn: orMissing(String) },
      RARE,
      { label: "Continent", fn: orMissing((v) => CONTINENT[String(v).trim().toUpperCase()] ?? "Other") },
    ],
  },
  ethnicity: {
    label: "Ethnicity", column: "ethnicity", defaultUse: "qi", levels: [
      { label: "Exact value", fn: orMissing(String) },
      RARE,
      { label: "Central European / other", fn: orMissing((v) => v === "centralEuropean" ? "centralEuropean" : "other") },
    ],
  },
  role: {
    label: "Role", column: "role", defaultUse: "qi", levels: [
      { label: "Exact value", fn: orMissing(String) },
      { label: "Patient / not a patient", fn: orMissing((v) => v === "pd-patient" ? "patient" : "not a patient") },
    ],
  },
};

// Never released, whatever the request says.
export const DIRECT_IDENTIFIERS = [
  { id: "email", label: "Email" }, { id: "firstName", label: "First name" },
  { id: "nickname", label: "Nickname" }, { id: "userId", label: "User ID" },
];

const QUESTION_LEVELS: Level[] = [{ label: "Exact answer", fn: orMissing(String) }, { ...RARE, label: "Rare answers as “other”" }];
// Columns of uploaded CSV files ("u:<upload>:<n>"), registered when the file is read.
const UPLOADED_FIELDS = new Map<string, FieldDef>();
const def = (id: string): FieldDef | undefined => PROFILE_FIELDS[id] ?? UPLOADED_FIELDS.get(id);
const levelsFor = (id: string) => id.startsWith("q:") ? QUESTION_LEVELS : def(id)?.levels;
const levelLabel = (f: FieldReq) => {
  const l = levelsFor(f.id)![f.level];
  return l.banded ? def(f.id)!.numeric!.bandLabel(f.band ?? 5) : l.label;
};
// The next coarser setting for a field: a wider band if it's banded, otherwise the next level.
// Entering a banded level starts at 2-year bands (1 would be the same as the level before).
function coarserOf(f: FieldReq): FieldReq | null {
  const levels = levelsFor(f.id)!;
  if (levels[f.level].banded) {
    const scale = def(f.id)?.numeric?.scale ?? 1;
    const w = BAND_STEPS.map((x) => x * scale).find((x) => x > (f.band ?? 5));
    if (w) return { ...f, band: w };
  }
  if (f.level + 1 >= levels.length) return null;
  return levels[f.level + 1].banded ? { ...f, level: f.level + 1, band: 2 } : { ...f, level: f.level + 1 };
}

// ---------- loading ----------

// Registry columns the admin can filter rows on (role has its own checkboxes).
const FILTERABLE = ["gender", "country", "ethnicity"];
const NOT_GIVEN = "(not given)";

export async function listFields(c: pg.PoolClient, excludeUsers: string) {
  const surveys = (await c.query(`
    select s.id, s.name, g.name as "group", s.questionnaire from survey s
    join survey_group g on g.id = s."surveyGroupId" order by g.name, s.name`)).rows;
  const counts = new Map((await c.query(`
    select a->>'questionId' as q, count(distinct r."userId")::int as n
    from survey_response r, json_array_elements(r.response->'answers') a
    where r."userId" not in (${excludeUsers}) group by 1`)).rows.map((r) => [r.q, r.n]));
  return {
    profile: Object.entries(PROFILE_FIELDS).map(([id, f]) => ({
      id, label: f.label, defaultUse: f.defaultUse, levels: f.levels.map((l) => l.label),
      bandLevel: f.levels.findIndex((l) => l.banded),
      numeric: f.numeric ? { unit: f.numeric.unit, rangeLabel: f.numeric.rangeLabel, lo: f.numeric.lo, hi: f.numeric.hi } : null,
    })),
    bandSteps: BAND_STEPS,
    directIdentifiers: DIRECT_IDENTIFIERS,
    questionLevels: QUESTION_LEVELS.map((l) => l.label),
    surveys: surveys.map((s) => ({
      id: s.id, name: s.name, group: s.group,
      questions: (s.questionnaire?.questions ?? []).map((q: { id: string; questionText: string; options: string[] }) => ({
        id: `q:${q.id}`, text: q.questionText, options: q.options, answered: counts.get(q.id) ?? 0,
      })),
    })),
    defaultPolicy: DEFAULT_POLICY,
    filterValues: Object.fromEntries(await Promise.all(FILTERABLE.map(async (id) => [id, (await c.query(`
      select coalesce(nullif(${id === "gender" ? "gender::text" : `"${PROFILE_FIELDS[id].column}"`}, ''), '${NOT_GIVEN}') as v, count(*)::int as n
      from user_data where "userId" not in (${excludeUsers}) group by 1 order by 2 desc`)).rows]))),
  };
}

async function loadPeople(c: pg.PoolClient, excludeUsers: string, req: AnonRequest): Promise<Person[]> {
  const params: unknown[] = [];
  let where = `d."userId" not in (${excludeUsers})`;
  if (req.roles.length) {
    params.push(req.roles);
    where += ` and d.role = any($${params.length})`;
  }
  const profiles = (await c.query(`
    select d."userId", to_char(d."dateOfBirth", 'YYYY-MM-DD') as "dateOfBirth", d."yearDiagnosed", d.gender::text as gender,
      d.country, d.ethnicity, d.role from user_data d where ${where}`, params)).rows;
  const people = new Map<string, Person>(profiles.map((p) => [p.userId, { userId: p.userId, profile: p, answers: new Map() }]));

  const qids = req.fields.filter((f) => f.id.startsWith("q:")).map((f) => f.id.slice(2));
  if (qids.length) {
    // Latest answer per person per question.
    const rows = (await c.query(`
      select r."userId", a->>'questionId' as q, a->'values'->>0 as v
      from survey_response r, json_array_elements(r.response->'answers') a
      where a->>'questionId' = any($1) order by r."createdTs"`, [qids])).rows;
    for (const r of rows) people.get(r.userId)?.answers.set(`q:${r.q}`, r.v);
  }
  return applyFilters([...people.values()], req);
}

// Filters shared by the registry and uploaded files.
function applyFilters(list: Person[], req: AnonRequest): Person[] {
  const qids = req.fields.filter((f) => f.id.startsWith("q:")).map((f) => f.id.slice(2));
  // Range filters on numeric fields: people without a value, or outside the range, are left out.
  for (const f of req.fields) {
    const num = def(f.id)?.numeric;
    if (!num || (f.min == null && f.max == null)) continue;
    const col = def(f.id)!.column;
    list = list.filter((p) => {
      const raw = p.profile[col];
      if (raw == null || raw === "") return false;
      const v = num.value(raw);
      return (f.min == null || v >= f.min) && (f.max == null || v <= f.max);
    });
  }
  // "Only include people where Country is DE or AT" etc.
  for (const flt of req.filters ?? []) {
    const col = def(flt.id)?.column; if (!col) continue;
    const keep = new Set(flt.values);
    list = list.filter((p) => { const v = p.profile[col]; return keep.has(v == null || v === "" ? NOT_GIVEN : String(v)); });
  }
  // "Leave out people who didn't give their country" etc.
  for (const f of req.fields) {
    if (!f.dropMissing || !def(f.id)) continue;
    const col = def(f.id)!.column;
    list = list.filter((p) => p.profile[col] != null && p.profile[col] !== "");
  }
  if (req.requireAnswers && qids.length) list = list.filter((p) => qids.every((q) => p.answers.has(`q:${q}`)));
  // Uploaded files: "only people with a value in every private column".
  if (req.requireAnswers && req.upload) {
    const cols = req.fields.filter((f) => f.use === "sensitive" && UPLOADED_FIELDS.has(f.id)).map((f) => f.id);
    list = list.filter((p) => cols.every((c) => p.profile[c] != null && p.profile[c] !== ""));
  }
  return list;
}

// ---------- metrics ----------

function valueOf(p: Person, f: FieldReq): string | null {
  const levels = levelsFor(f.id);
  if (!levels) return null;
  const level = levels[Math.min(Math.max(0, f.level), levels.length - 1)];
  const raw = f.id.startsWith("q:") ? p.answers.get(f.id) : p.profile[def(f.id)!.column];
  return level.fn(raw, f);
}

type Rec = { qi: string[]; key: string; sens: (string | null)[] };

function buildRecords(people: Person[], fields: FieldReq[], k = DEFAULT_POLICY.k) {
  const qiFields = fields.filter((f) => f.use === "qi" && levelsFor(f.id));
  const sensFields = fields.filter((f) => f.use === "sensitive" && levelsFor(f.id));
  // Fields set to "rare values as other": which of their values fewer than k people have here.
  const rare = new Map<FieldReq, Set<string>>();
  for (const f of [...qiFields, ...sensFields]) {
    const levels = levelsFor(f.id)!;
    if (!levels[Math.min(f.level, levels.length - 1)].rare) continue;
    const n = new Map<string, number>();
    for (const p of people) { const v = valueOf(p, f); if (v != null && v !== MISSING) n.set(v, (n.get(v) ?? 0) + 1); }
    rare.set(f, new Set([...n].filter(([, c]) => c < k).map(([v]) => v)));
  }
  const val = (p: Person, f: FieldReq) => { const v = valueOf(p, f); return v != null && rare.get(f)?.has(v) ? "other" : v; };
  const recs: Rec[] = people.map((p) => {
    const q = qiFields.map((f) => val(p, f) ?? MISSING);
    return { qi: q, key: q.join("\u0001"), sens: sensFields.map((f) => val(p, f)) };
  });
  return { recs, qiFields, sensFields };
}

function measure(recs: Rec[], sensCount: number, policy: Policy) {
  const groups = new Map<string, Rec[]>();
  for (const r of recs) {
    const g = groups.get(r.key);
    g ? g.push(r) : groups.set(r.key, [r]);
  }
  const n = recs.length;
  const sizes = [...groups.values()].map((g) => g.length);
  const k = sizes.length ? Math.min(...sizes) : 0;
  const unique = sizes.filter((s) => s === 1).length;
  const atRisk = sizes.filter((s) => s < policy.k).reduce((a, b) => a + b, 0);
  const buckets: [string, number, number][] = [["1", 1, 1], ["2", 2, 2], ["3–4", 3, 4], ["5–9", 5, 9], ["10–19", 10, 19], ["20+", 20, Infinity]];
  const classSizes = buckets.map(([label, lo, hi]) => {
    const inB = sizes.filter((s) => s >= lo && s <= hi);
    return { label, groups: inB.length, people: inB.reduce((a, b) => a + b, 0) };
  });

  // l-diversity and t-closeness per sensitive attribute. "Not answered" counts as an answer of its
  // own: in a group of 5 where one person answered, nobody can tell which one it was. Groups where
  // nobody answered reveal nothing and are skipped.
  const sensitive = Array.from({ length: sensCount }, (_, i) => {
    const val = (r: Rec) => r.sens[i] ?? MISSING;
    const overall = new Map<string, number>();
    for (const r of recs) overall.set(val(r), (overall.get(val(r)) ?? 0) + 1);
    const answered = recs.length - (overall.get(MISSING) ?? 0);
    let l = Infinity, t = 0, lowL = 0, highT = 0;
    for (const g of groups.values()) {
      const dist = new Map<string, number>();
      for (const r of g) dist.set(val(r), (dist.get(val(r)) ?? 0) + 1);
      if (dist.size === 1 && dist.has(MISSING)) continue;
      l = Math.min(l, dist.size);
      if (dist.size < policy.l) lowL += g.length;
      // Total variation distance (= Earth Mover's Distance when all answers are equally far apart).
      let tv = 0;
      for (const [v, c] of overall) tv += Math.abs((dist.get(v) ?? 0) / g.length - c / recs.length);
      tv /= 2;
      t = Math.max(t, tv);
      if (tv > policy.t) highT += g.length;
    }
    return { l: l === Infinity ? null : l, t: answered ? +t.toFixed(3) : null, answered, distinct: overall.size - (overall.has(MISSING) ? 1 : 0), peopleInLowLGroups: lowL, peopleInHighTGroups: highT };
  });

  return {
    n, groups: groups.size, k, unique, uniquePct: n ? unique / n : 0, atRisk, atRiskPct: n ? atRisk / n : 0,
    maxRisk: k ? 1 / k : 1, avgRisk: n ? groups.size / n : 0, classSizes, sensitive,
    groupMap: groups,
  };
}

function evaluate(people: Person[], req: AnonRequest) {
  const { recs, qiFields, sensFields } = buildRecords(people, req.fields, req.policy.k);
  const before = measure(recs, sensFields.length, req.policy);
  let after = before, suppressed = 0;
  if (req.suppress) {
    const keep = recs.filter((r) => (before.groupMap.get(r.key)?.length ?? 0) >= req.policy.k);
    suppressed = recs.length - keep.length;
    after = measure(keep, sensFields.length, req.policy);
  }
  return { recs, qiFields, sensFields, before, after, suppressed };
}

function checksFor(ev: ReturnType<typeof evaluate>, req: AnonRequest) {
  const p = req.policy, m = ev.after;
  const sup = ev.before.n ? ev.suppressed / ev.before.n : 0;
  // "warn" checks are shown but don't block the extract.
  const c: { id: string; label: string; ok: boolean; detail: string; severity?: "warn"; tech?: string; trivial?: boolean }[] = [];
  c.push({ id: "direct", label: "No names, emails or IDs", ok: true, trivial: true, detail: "Never shared; each row gets a random study ID." });
  c.push({ id: "fields", label: "Columns chosen", ok: ev.qiFields.length + ev.sensFields.length > 0, trivial: true, detail: req.upload ? `${ev.qiFields.length} that others could know, ${ev.sensFields.length} private.` : `${ev.qiFields.length} profile, ${ev.sensFields.length} survey answer${ev.sensFields.length === 1 ? "" : "s"}.` });
  c.push({ id: "cohort", label: `At least ${p.minCohort} people`, ok: m.n >= p.minCohort, detail: `${m.n} people in the extract.` });
  c.push({ id: "k", label: `Everyone is in a group of ${p.k} or more`, tech: "k-anonymity", ok: m.n > 0 && m.k >= p.k, detail: m.n ? `People with the same profile values form a group. The smallest group has ${m.k} ${m.k === 1 ? "person" : "people"}.` : "Empty extract." });
  c.push({ id: "unique", label: "Nobody is one of a kind", ok: m.unique === 0, detail: `${m.unique} ${m.unique === 1 ? "person has" : "people have"} a combination of profile values nobody else has.` });
  c.push({ id: "avgRisk", label: `Low overall risk (${Math.round(p.maxAvgRisk * 100)}% or less)`, tech: "average re-identification risk", ok: m.avgRisk <= p.maxAvgRisk, detail: `${(m.avgRisk * 100).toFixed(1)}%: ${m.groups} groups for ${m.n} people.` });
  ev.sensFields.forEach((f, i) => {
    const s = m.sensitive[i];
    const name = fieldLabel(f.id);
    // Most people not answering is the usual reason a group has only one "answer" (no answer).
    const fewAnswered = m.n && s.answered / m.n < 0.5
      ? ` Only ${s.answered} of ${m.n} people answered this question, so many groups contain just “no answer”: tick “Only people who answered every chosen question” in step 3.` : "";
    c.push({ id: `l:${f.id}`, label: `Answers vary within each group: ${name}`, tech: `l-diversity ≥ ${p.l}`, ok: s.l == null || s.l >= p.l,
      detail: s.l == null ? "Nobody answered." : `Every group must contain at least ${p.l} different answers (no answer counts as one). The least varied has ${s.l}; ${s.peopleInLowLGroups} people are in groups below ${p.l}.${s.l < p.l ? fewAnswered : ""}` });
    c.push({ id: `t:${f.id}`, label: `Groups answer like everyone else: ${name}`, tech: `t-closeness ≤ ${p.t}`, ok: s.t == null || s.t <= p.t, severity: "warn",
      detail: s.t == null ? "Nobody answered." : `Largest gap between a group's answers and everyone's: ${s.t} (0 = same mix, 1 = completely different). ${s.peopleInHighTGroups} people are in groups above ${p.t}. A warning only.` });
  });
  for (const name of sharedIds(ev, req)) {
    c.push({ id: `id:${name}`, label: `“${name}” is an ID and is shared as is`, ok: false, severity: "warn",
      detail: "Each value points to one person, so the file is pseudonymous, not anonymous. Only share it if the recipient may hold pseudonymous data (e.g. under a data processing agreement)." });
  }
  if (req.suppress) c.push({ id: "suppression", label: `Removed at most ${Math.round(p.maxSuppression * 100)}% of people`, ok: sup <= p.maxSuppression, detail: `${ev.suppressed} removed (${(sup * 100).toFixed(1)}%) so everyone is in a group of ${p.k} or more.` });
  return c;
}

const passesAll = (checks: { ok: boolean; severity?: string }[]) => checks.every((c) => c.ok || c.severity === "warn");

let questionTexts = new Map<string, string>();
const fieldLabel = (id: string) => def(id)?.label ?? questionTexts.get(id) ?? id;

function summarize(ev: ReturnType<typeof evaluate>, req: AnonRequest, people: Person[]) {
  const checks = checksFor(ev, req);
  const strip = (m: ReturnType<typeof measure>) => { const { groupMap: _, ...rest } = m; return rest; };

  // Which identifying field drives the risk: what happens if it's one step coarser, or unticked.
  const impact = ev.qiFields.map((f) => {
    const without = measure(buildRecords(people, req.fields.filter((x) => x !== f), req.policy.k).recs, 0, req.policy);
    const next = coarserOf(f);
    const coarser = next
      ? measure(buildRecords(people, req.fields.map((x) => x === f ? next : x), req.policy.k).recs, 0, req.policy) : null;
    return {
      id: f.id, label: fieldLabel(f.id), level: levelLabel(f), distinct: new Set(ev.recs.map((r) => r.qi[ev.qiFields.indexOf(f)])).size,
      without: { k: without.k, unique: without.unique, atRisk: without.atRisk },
      coarser: coarser && next && { level: levelLabel(next), k: coarser.k, unique: coarser.unique, atRisk: coarser.atRisk },
    };
  });

  // Smallest groups (generalized values only), so the admin can see which combinations are rare.
  const smallest = [...ev.before.groupMap.values()].sort((a, b) => a.length - b.length).slice(0, 12)
    .map((g) => ({ size: g.length, values: g[0].qi }));

  const missing: Record<string, number> = {};
  for (const f of req.fields) {
    const col = def(f.id)?.column;
    if (col) missing[f.id] = people.filter((p) => p.profile[col] == null || p.profile[col] === "").length;
  }

  return {
    ok: passesAll(checks),
    missing,
    compliance: compliance(ev, req, checks),
    checks,
    qiFields: ev.qiFields.map((f) => ({ id: f.id, label: fieldLabel(f.id) })),
    sensFields: ev.sensFields.map((f) => ({ id: f.id, label: fieldLabel(f.id) })),
    before: strip(ev.before),
    after: strip(ev.after),
    suppressed: ev.suppressed,
    impact,
    smallest,
  };
}

// ---------- entry points ----------

function normalize(req: AnonRequest): AnonRequest {
  const policy = { ...DEFAULT_POLICY, ...(req.policy ?? {}) };
  for (const k of Object.keys(policy) as (keyof Policy)[]) policy[k] = Number(policy[k]);
  const num = (v: unknown) => v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const fields = (req.fields ?? []).filter((f) => levelsFor(f.id)).map((f) => ({
    // Profile columns are always things others could know; only survey answers can be private.
    id: f.id, use: f.use === "sensitive" && !PROFILE_FIELDS[f.id] ? "sensitive" : "qi", level: Math.max(0, Math.min(Number(f.level) || 0, levelsFor(f.id)!.length - 1)),
    band: Math.max(1, Math.min(def(f.id)?.numeric?.bandMax ?? 50, Math.round(Number(f.band) || 5))),
    min: def(f.id)?.numeric ? num(f.min) : null, max: def(f.id)?.numeric ? num(f.max) : null,
    dropMissing: !!def(f.id) && !!f.dropMissing,
  } as FieldReq));
  const upload = req.upload && UPLOADS.has(String(req.upload)) ? String(req.upload) : null;
  if (req.upload && !upload) throw new Error("That uploaded file is no longer in memory (the admin server was restarted). Upload it again.");
  const filters = (req.filters ?? []).filter((x) => x && def(String(x.id)) && Array.isArray(x.values) && x.values.length)
    .map((x) => ({ id: String(x.id), values: x.values.map(String) }));
  return { upload, filters, fields, roles: (req.roles ?? []).map(String), requireAnswers: !!req.requireAnswers, suppress: !!req.suppress, policy };
}

// The people for a request: from an uploaded file, or from the registry database.
async function peopleFor(c: pg.PoolClient | null, excludeUsers: string, req: AnonRequest) {
  if (req.upload) return applyFilters(UPLOADS.get(req.upload)!.people, req);
  await loadTexts(c!);
  return await loadPeople(c!, excludeUsers, req);
}

async function loadTexts(c: pg.PoolClient) {
  if (questionTexts.size) return;
  const rows = (await c.query(`select q->>'id' as id, q->>'questionText' as text from survey s, json_array_elements(s.questionnaire->'questions') q`)).rows;
  questionTexts = new Map(rows.map((r) => [`q:${r.id}`, r.text]));
}

export async function check(c: pg.PoolClient | null, excludeUsers: string, raw: AnonRequest) {
  const req = normalize(raw);
  const people = await peopleFor(c, excludeUsers, req);
  const result = summarize(evaluate(people, req), req, people);
  // When it isn't safe yet: the one-click fixes the results page offers next to each problem.
  if (result.ok) return result;
  const { options, notes } = whyStuck(people, req, result);
  return { ...result, fixes: { options, notes } };
}

// Greedy search for the least damaging settings that pass:
//  1. if removing the few people in too-small groups (within the allowed share) is enough, do that;
//  2. otherwise make one identifying field a step coarser, picking the step that leaves the fewest
//     people at risk; repeat until it passes or nothing can be made coarser.
// It never removes a column: whether to share a column is the admin's decision (the tick in step 1).
export async function suggest(c: pg.PoolClient | null, excludeUsers: string, raw: AnonRequest) {
  const req = normalize(raw);
  const people = await peopleFor(c, excludeUsers, req);
  const run = (fields: FieldReq[], suppress: boolean) => {
    const r = { ...req, fields, suppress };
    const ev = evaluate(people, r);
    const checks = checksFor(ev, r);
    return { ev, pass: passesAll(checks), fails: checks.filter((x) => !x.ok && x.severity !== "warn").length };
  };
  let fields = req.fields.map((f) => ({ ...f }));
  let suppress = req.suppress;
  const steps: string[] = [];
  const fieldSteps = new Map<string, string>();
  for (let i = 0; i < 60; i++) {
    if (run(fields, suppress).pass) break;
    if (!suppress && run(fields, true).pass) {
      suppress = true;
      steps.push(`Remove the people in groups smaller than ${req.policy.k}`);
      break;
    }
    let best: { fs: FieldReq[]; score: number; msg: string; id: string } | null = null;
    for (const f of fields) {
      if (f.use !== "qi") continue;
      const next = coarserOf(f);
      if (!next) continue;
      const fs = fields.map((x) => x === f ? next : { ...x });
      const r = run(fs, suppress);
      const score = r.fails * 1e6 + r.ev.before.atRisk * 10 + r.ev.before.groups / Math.max(1, r.ev.before.n);
      if (!best || score < best.score) best = { fs, score, id: f.id, msg: `${fieldLabel(f.id)} → ${levelLabel(next)}` };
    }
    if (!best) break;
    fields = best.fs;
    // One line per column, showing where it ended up: "Age → Age in 10-year bands".
    fieldSteps.set(best.id, best.msg);
  }
  // Undo changes that didn't help: put each changed column back as it was if that's no worse.
  const scoreOf = (fs: FieldReq[]) => { const r = run(fs, suppress); return (r.pass ? 0 : 1e9) + r.fails * 1e6 + r.ev.before.atRisk * 10 + r.ev.before.groups / Math.max(1, r.ev.before.n); };
  for (const id of [...fieldSteps.keys()]) {
    const orig = req.fields.find((f) => f.id === id)!;
    const reverted = fields.map((f) => f.id === id ? { ...orig } : f);
    if (scoreOf(reverted) <= scoreOf(fields)) { fields = reverted; fieldSteps.delete(id); }
  }
  steps.unshift(...fieldSteps.values());
  const final = { ...req, fields, suppress };
  const result = summarize(evaluate(people, final), final, people);
  return { fields, suppress, steps, result, why: result.ok ? [] : whyStuck(people, final, result) };
}

// When Suggest can't reach a pass: what's left, in numbers, so the admin knows which lever to pull.
// When Suggest can't reach a pass:
//  limits  — why it couldn't go further on its own (information only);
//  options — each one would make the file safe (or safer), with what it costs the researcher and a button;
//  notes   — options that were checked but wouldn't be enough.
type WhyAction = { type: "suppress"; maxSuppression?: number; label: string } | { type: "drop"; id: string; label: string };
function whyStuck(people: Person[], req: AnonRequest, result: ReturnType<typeof summarize>) {
  const pct = (x: number) => x > 0 && x < 0.01 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`;
  const list = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const options: { title: string; cost: string; action: WhyAction }[] = [];
  const notes: string[] = [];

  // Columns Suggest can't make less detailed any more, said in one sentence.
  const maxed = req.fields.filter((f) => f.use === "qi" && !coarserOf(f));
  const banded = maxed.filter((f) => levelsFor(f.id)![f.level].banded);
  const parts: string[] = [];
  if (banded.length) parts.push(`${list(banded.map((f) => fieldLabel(f.id)))} ${banded.length > 1 ? "are" : "is"} at ${levelLabel(banded[0])} (the widest it goes)`);
  for (const f of maxed.filter((f) => !banded.includes(f))) {
    parts.push(levelsFor(f.id)!.length === 1 ? `${fieldLabel(f.id)} has no less detailed version` : `${fieldLabel(f.id)} is already at ${levelLabel(f)}`);
  }
  const limits = parts.length ? `It can't go further: ${list(parts)}.` : null;

  // Option: leave out the people in small groups (how many, and what share that is).
  const sup = { ...req, suppress: true, policy: { ...req.policy, maxSuppression: 1 } };
  const ev = evaluate(people, sup);
  const share = ev.before.n ? ev.suppressed / ev.before.n : 0;
  const failing = checksFor(ev, sup).filter((c) => !c.ok && c.severity !== "warn");
  if (ev.suppressed && !failing.length) {
    const need = Math.ceil(share * 100) / 100;
    const over = share > req.policy.maxSuppression;
    options.push({
      title: `Leave out the ${ev.suppressed} people in groups smaller than ${req.policy.k}`,
      cost: `That's ${pct(share)} of the file${over ? `, more than your ${pct(req.policy.maxSuppression)} limit, so the limit is raised to ${pct(need)}` : ""}. The researcher gets ${(ev.before.n - ev.suppressed).toLocaleString("en")} people instead of ${ev.before.n.toLocaleString("en")}, and the rarest profiles are missing from the data.`,
      action: { type: "suppress", maxSuppression: over ? need : undefined, label: over ? `Leave them out (allow ${pct(need)})` : "Leave them out" },
    });
  } else if (ev.suppressed) {
    notes.push(`Leaving out the ${ev.suppressed} people in groups smaller than ${req.policy.k} (${pct(share)}) wouldn't be enough on its own: “${failing[0].label}” would still fail.`);
  }

  // Option: remove a private column whose answers some groups all share (it would reveal them).
  const lFail = (failing.length ? failing : checksFor(evaluate(people, req), req).filter((c) => !c.ok && c.severity !== "warn")).find((c) => c.id.startsWith("l:"));
  if (lFail) {
    const id = lFail.id.slice(2);
    options.push({
      title: `Remove the private column “${fieldLabel(id)}”`,
      cost: `In some groups everyone gave the same answer, so sharing it would reveal their answer. Usually a rare answer (few people said “yes”). The researcher doesn't get this column. Suggest then runs again.`,
      action: { type: "drop", id, label: `Remove “${fieldLabel(id).slice(0, 40)}” and try again` },
    });
  }

  // Option: remove the profile column that causes the most risk.
  const now = result.before.unique;
  const top = [...result.impact].sort((a, b) => a.without.unique - b.without.unique)[0];
  if (top && now && top.without.unique < now) {
    options.push({
      title: `Remove the ${top.label} column`,
      cost: `It causes the most risk: without it, ${top.without.unique === 0 ? "nobody is" : `${top.without.unique} ${top.without.unique === 1 ? "person is" : "people are"}`} one of a kind instead of ${now}. The researcher gets no ${top.label.toLowerCase()} at all. Suggest then runs again.`,
      action: { type: "drop", id: top.id, label: `Remove ${top.label} and try again` },
    });
  }
  return { limits, options, notes };
}

// The extract itself, only when every check passes. Rows are shuffled and get a random study ID.
// The rows exactly as the CSV would contain them: shuffled, small groups removed if asked, random study IDs.
async function extractRows(c: pg.PoolClient | null, excludeUsers: string, raw: AnonRequest) {
  const req = normalize(raw);
  const people = await peopleFor(c, excludeUsers, req);
  const ev = evaluate(people, req);
  let recs = ev.recs;
  if (req.suppress) recs = recs.filter((r) => (ev.before.groupMap.get(r.key)?.length ?? 0) >= req.policy.k);
  recs = recs.map((r) => ({ r, o: crypto.getRandomValues(new Uint32Array(1))[0] })).sort((a, b) => a.o - b.o).map((x) => x.r);
  const header = ["study_id", ...ev.qiFields.map((f) => fieldLabel(f.id)), ...ev.sensFields.map((f) => fieldLabel(f.id))];
  const rows = recs.map((r, i) => [`S${String(i + 1).padStart(5, "0")}`, ...r.qi, ...r.sens.map((v) => v ?? "")]);
  return { ok: passesAll(checksFor(ev, req)), header, rows };
}

export async function extract(c: pg.PoolClient | null, excludeUsers: string, raw: AnonRequest) {
  const { ok, header, rows } = await extractRows(c, excludeUsers, raw);
  if (!ok) throw new Error("This request doesn't pass every check, so no extract is produced.");
  const csv = (v: unknown) => /[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? "");
  return [header, ...rows].map((r) => r.map(csv).join(",")).join("\n") + "\n";
}

// For the admin's preview pop-up: the first rows of what the CSV would contain (shown even before
// the checks pass, so the admin can see the effect of the settings; downloading still needs a pass).
export async function preview(c: pg.PoolClient | null, excludeUsers: string, raw: AnonRequest, limit = 200) {
  const { ok, header, rows } = await extractRows(c, excludeUsers, raw);
  return { ok, header, rows: rows.slice(0, limit), total: rows.length };
}

// ---------- uploaded CSV files ----------
// An admin can check and anonymize their own CSV instead of the registry. The file is parsed in
// memory, never written to disk or the database, and forgotten on "Forget this file" or a restart.

type UploadColumn = {
  id: string; label: string; name: string; kind: Kind; detected: Kind; role: "qi" | "sensitive" | "leave";
  why: string; distinct: number; missing: number; unreadable: number; examples: string[]; values: { v: string; n: number }[] | null;
  levels: string[]; bandLevel: number; numeric: { unit: string; rangeLabel: string; lo: number; hi: number; bandMax: number; scale: number } | null;
};
// What a column is. The tool guesses; the admin can correct it with the type dropdown.
type Kind = "number" | "date" | "postcode" | "text" | "id";
const KINDS: Kind[] = ["number", "date", "postcode", "text", "id"];
const UPLOADS = new Map<string, { id: string; name: string; rows: number; columns: UploadColumn[]; people: Person[]; raw: string[][] }>();

// Small CSV reader: quotes, "" escapes, newlines inside quotes, and , ; or tab as separator.
function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const first = text.slice(0, text.search(/\r?\n/) >>> 0 || text.length);
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const MISSING_TOKENS = new Set(["", "na", "n/a", "null", "none", "-", "nan", "unknown", "?"]);
const isMissing = (v: string) => MISSING_TOKENS.has(v.trim().toLowerCase());
const toNumber = (v: string) => {
  const t = v.trim().replace(/\s/g, "");
  const n = Number(/^-?\d+,\d+$/.test(t) ? t.replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
};
// Dates → year: 2019-05-03, 03/05/2019, 03.05.2019, 2019/05/03 (with or without a time).
const toYear = (v: string) => {
  const t = v.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})([ T].*)?$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})([ T].*)?$/.exec(t);
  return m ? Number(m[3]) : null;
};
// Names that point at a direct identifier, or at something others could know about a person.
const DIRECT_NAME = /(^|[^a-z])(e-?mail|mail|first.?name|last.?name|surname|full.?name|^name$|phone|tel|mobile|address|street|ssn|social.?sec|passport|iban|account|ip.?addr|mrn|medical.?record|record.?n|insurance.?n|national.?id|patient.?id|user.?id|^id$)([^a-z]|$)/i;
const KNOWN_NAME = /(\bage\b|birth|dob|sex|gender|country|nation|city|town|region|state|zip|post.?code|postal|plz|ethnic|race|occupation|job|profession|marital|height|weight|year|date|admission|discharge)/i;
const POSTCODE_NAME = /(zip|post.?code|postal|plz)/i;
const ID_NAME = /(^|[^a-z])(id|mrn|medical.?record|record.?n|patient.?id|user.?id|case.?n|subject.?id)([^a-z]|$)/i;

// The column's type from its name and values (see "type dropdown" for overriding it).
function detectKind(label: string, present: string[]): Kind {
  if (POSTCODE_NAME.test(label)) return "postcode"; // looks like a number, but it's a code to shorten
  const share = (f: (v: string) => number | null) => present.length ? present.filter((v) => f(v) != null).length / present.length : 0;
  if (present.length && share(toYear) >= 0.9) return "date";
  const distinct = new Set(present).size;
  if (ID_NAME.test(label) || (present.length > 20 && distinct === present.length && share(toNumber) < 0.9)) return "id";
  if (present.length && share(toNumber) >= 0.9 && distinct > 2) return "number";
  return "text";
}
// The role to start with: direct identifier, something others could know, or the research data itself.
function guessRole(label: string, kind: Kind, distinct = 2): { role: UploadColumn["role"]; why: string } {
  if (distinct <= 1) return { role: "leave", why: "Same value on every row, so it tells the researcher nothing." };
  if (kind === "id") return { role: "leave", why: "An ID or code that points to one person, so it's left out by default." };
  if (DIRECT_NAME.test(label)) return { role: "leave", why: "The name looks like a direct identifier, so it's left out by default." };
  if (kind === "postcode") return { role: "qi", why: "A postcode: others could know where someone lives." };
  if (KNOWN_NAME.test(label)) return { role: "qi", why: "The name looks like something others could know." };
  return { role: "sensitive", why: "Looks like research data." };
}

// Values and how many rows have each, for the row filter (only for columns with few different values).
function valueCounts(raw: string[]) {
  const n = new Map<string, number>();
  for (const v of raw) { const k = isMissing(v) ? NOT_GIVEN : v; n.set(k, (n.get(k) ?? 0) + 1); }
  return n.size > 60 ? null : [...n].sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ v, n: c }));
}

// (Re)build one uploaded column for a type: its values on every row, its detail options, its field.
function buildColumn(up: { id: string; people: Person[]; raw: string[][] }, c: number, name: string, kind: Kind, detected: Kind, role?: UploadColumn["role"]): UploadColumn {
  const fid = `u:${up.id}:${c}`;
  const raw = up.raw[c];
  const present = raw.filter((v) => !isMissing(v));
  const label = kind === "date" ? `${name} (year)` : name;
  const parse = kind === "date" ? toYear : kind === "number" ? toNumber : null;
  let unreadable = 0;
  const values = raw.map((v) => {
    if (isMissing(v)) return null;
    if (!parse) return v;
    const x = parse(v); if (x == null) unreadable++;
    return x;
  });
  if (parse && !values.some((v) => typeof v === "number")) throw new Error(`None of the values in “${name}” can be read as ${kind === "date" ? "dates" : "numbers"}.`);
  values.forEach((v, i) => up.people[i].profile[fid] = v ?? ""); // only once the type is known to work
  const guess = guessRole(name, kind, new Set(present).size);

  let levels: Level[], numeric: Numeric | undefined, out: UploadColumn["numeric"] = null;
  if (kind === "number" || kind === "date") {
    const ns = values.filter((v): v is number => typeof v === "number");
    if (!ns.length) throw new Error(`None of the values in “${name}” can be read as ${kind === "date" ? "dates" : "numbers"}.`);
    const lo = Math.floor(Math.min(...ns)), hi = Math.ceil(Math.max(...ns));
    const span = Math.max(1, hi - lo);
    const scale = span > 2000 ? 10 ** Math.floor(Math.log10(span / 200)) : 1;
    const decimals = ns.some((n) => !Number.isInteger(n));
    const bandMax = Math.max(30, Math.ceil(span / 2));
    numeric = { unit: "", rangeLabel: label, lo, hi, value: Number, scale, decimals, bandMax,
      bandLabel: (w) => w <= 1 ? (kind === "date" ? "Exact year" : "Exact value") : kind === "date" ? `${w}-year ranges` : `${w.toLocaleString("en")}-wide ranges` };
    const fmtBand = (n: number, w: number, start: number) => {
      if (w <= 1) return decimals ? String(n) : String(Math.round(n));
      const b = start + Math.floor((n - start) / w) * w;
      return decimals ? `${b}–<${b + w}` : `${b}–${b + w - 1}`;
    };
    levels = [{ label: kind === "date" ? "Year in ranges" : "Value in ranges", banded: true,
      fn: (v, f) => v == null || v === "" ? MISSING : fmtBand(Number(v), f.band ?? 1, f.min ?? lo) }];
    out = { unit: "", rangeLabel: label, lo, hi, bandMax, scale };
  } else {
    const freq = new Map<string, number>();
    for (const v of present) freq.set(v, (freq.get(v) ?? 0) + 1);
    levels = [{ label: "Exact value", fn: orMissing(String) }];
    if (kind === "postcode") {
      levels.push({ label: "First 3 characters", fn: orMissing((v) => `${String(v).slice(0, 3)}…`) });
      levels.push({ label: "First 2 characters", fn: orMissing((v) => `${String(v).slice(0, 2)}…`) });
    }
    if (kind !== "id" && freq.size > 1) levels.push(RARE);
  }
  const r = role ?? guess.role; // the admin decides; IDs only start as "leave out"
  UPLOADED_FIELDS.set(fid, { label, column: fid, defaultUse: r === "sensitive" ? "sensitive" : "qi", levels, numeric });
  return {
    id: fid, label, name, kind, detected, role: r, why: kind === detected ? guess.why : "Type set by you.",
    distinct: new Set(present).size, missing: raw.length - present.length, unreadable,
    examples: [...new Set(present)].slice(0, 3), levels: levels.map((l) => l.label), bandLevel: levels.findIndex((l) => l.banded), numeric: out,
    values: kind === "text" || kind === "postcode" ? valueCounts(raw) : null,
  };
}

export function readUpload(name: string, text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The file needs a header row and at least one data row.");
  const header = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const data = rows.slice(1);
  if (data.length > 200_000) throw new Error("That file has more than 200,000 rows; please split it.");
  const id = crypto.randomUUID().slice(0, 8);
  const people: Person[] = data.map((_, i) => ({ userId: `row${i + 1}`, profile: {}, answers: new Map() }));
  const raw = header.map((_, c) => data.map((r) => (r[c] ?? "").trim()));
  const up = { id, people, raw };
  const columns: UploadColumn[] = header.map((name, c) => {
    const kind = detectKind(name, raw[c].filter((v) => !isMissing(v)));
    return buildColumn(up, c, name, kind, kind);
  });
  // Keep a few files at most; each one lives only in this server's memory.
  while (UPLOADS.size >= 5) forgetUpload(UPLOADS.keys().next().value!);
  const upload = { id, name, rows: data.length, columns, people, raw };
  UPLOADS.set(id, upload);
  return uploadMeta(upload);
}
const uploadMeta = (u: { id: string; name: string; rows: number; columns: UploadColumn[] }) => ({ id: u.id, name: u.name, rows: u.rows, columns: u.columns });

// The admin corrected a column's type: rebuild it, keeping how the admin chose to use it.
export function setColumnKind(uploadId: string, colId: string, kind: string, role?: string) {
  const u = UPLOADS.get(uploadId);
  if (!u) throw new Error("That uploaded file is no longer in memory (the admin server was restarted). Upload it again.");
  if (!KINDS.includes(kind as Kind)) throw new Error(`Unknown type “${kind}”.`);
  const i = u.columns.findIndex((c) => c.id === colId);
  if (i < 0) throw new Error("No such column.");
  const old = u.columns[i];
  const keep = role && ["qi", "sensitive", "leave"].includes(role) ? role as UploadColumn["role"] : undefined;
  u.columns[i] = buildColumn(u, Number(colId.split(":")[2]), old.name, kind as Kind, old.detected, keep);
  return u.columns[i];
}

export function forgetUpload(id: string) {
  const u = UPLOADS.get(id);
  if (!u) return false;
  for (const c of u.columns) UPLOADED_FIELDS.delete(c.id);
  return UPLOADS.delete(id);
}

// Uploaded columns typed "ID / identifier" that the admin chose to share anyway.
function sharedIds(ev: ReturnType<typeof evaluate>, req: AnonRequest) {
  const cols = req.upload ? UPLOADS.get(req.upload)?.columns ?? [] : [];
  return [...ev.qiFields, ...ev.sensFields].map((f) => cols.find((c) => c.id === f.id)).filter((c) => c?.kind === "id").map((c) => c!.name);
}

// ---------- regulatory indicators ----------
// Not a legal verdict: each framework's rules, checked against the file as it would be exported.
//   GDPR (EU): the three anonymisation tests of the EU data protection authorities (WP29 Opinion
//     05/2014): singling out, linkability, inference.
//   HIPAA Safe Harbor (US): the 18 identifier types of 45 CFR 164.514(b)(2), as far as the data
//     can show them; the rest is listed for the admin to confirm.
type Rule = { id: string; label: string; status: "ok" | "fail" | "review"; detail: string };
function compliance(ev: ReturnType<typeof evaluate>, req: AnonRequest, checks: ReturnType<typeof checksFor>) {
  const ok = (id: string) => checks.find((c) => c.id === id)?.ok ?? true;
  const per = (prefix: string) => checks.filter((c) => c.id.startsWith(prefix));
  const recs = req.suppress ? ev.recs.filter((r) => (ev.before.groupMap.get(r.key)?.length ?? 0) >= req.policy.k) : ev.recs;
  const year = new Date().getFullYear();
  // Every exported column with its label, kind (for uploads) and released values.
  const cols = [
    ...ev.qiFields.map((f, j) => ({ f, values: recs.map((r) => r.qi[j]) })),
    ...ev.sensFields.map((f, j) => ({ f, values: recs.map((r) => r.sens[j] ?? MISSING) })),
  ].map(({ f, values }) => {
    const up = req.upload ? UPLOADS.get(req.upload)?.columns.find((c) => c.id === f.id) : undefined;
    return { f, label: fieldLabel(f.id), kind: up?.kind ?? (f.id === "age" || f.id === "yearDiagnosed" ? "number" : "text"), rawLabel: up ? up.name : fieldLabel(f.id),
      values: values.filter((v) => v !== MISSING && v !== "") };
  });
  const bounds = (v: string) => { const m = /^(-?\d+(?:\.\d+)?)(?:–<?(-?\d+(?:\.\d+)?))?$/.exec(v); return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null; };

  // ---- GDPR
  const ids = sharedIds(ev, req);
  const lFails = per("l:").filter((c) => !c.ok).length, tWarn = per("t:").filter((c) => !c.ok).length;
  const gdpr: Rule[] = [
    { id: "single", label: "Singling out: nobody can be picked out", status: ok("k") && ok("unique") && !ids.length ? "ok" : "fail",
      detail: ids.length ? `${ids.map((x) => `“${x}”`).join(", ")} ${ids.length === 1 ? "is an ID that points" : "are IDs that point"} to one person, so every row can be singled out. With it the file is pseudonymous data, still under GDPR.`
        : ok("k") && ok("unique") ? `Everyone shares their profile values with at least ${req.policy.k - 1} others.` : "Some people have a combination of values few or no others have." },
    { id: "infer", label: "Inference: private answers can't be deduced from a group", status: lFails ? "fail" : tWarn ? "review" : "ok",
      detail: lFails ? `${lFails} private column${lFails > 1 ? "s" : ""} would reveal answers for some groups.` : tWarn ? `Answers vary in every group, but ${tWarn} column${tWarn > 1 ? "s differ" : " differs"} noticeably from the overall mix in some groups.` : "Every group contains different answers." },
    { id: "link", label: "Linkability: rows can't be joined back to people", status: "review",
      detail: "Rows get random study IDs that aren't stored anywhere, and are shuffled. Whether the recipient holds other data they could join on (e.g. their own patient list) can't be checked here." },
    { id: "risk", label: "Overall re-identification risk is low", status: ok("avgRisk") ? "ok" : "fail", detail: checks.find((c) => c.id === "avgRisk")?.detail ?? "" },
    { id: "minimal", label: "Data minimisation: only what the research needs", status: "review",
      detail: `${cols.length} column${cols.length === 1 ? "" : "s"} will be shared. Confirm each one is needed for the stated research purpose (Art. 5(1)(c)).` },
  ];

  // ---- HIPAA Safe Harbor
  const named = (re: RegExp) => cols.filter((c) => re.test(c.rawLabel));
  const fullDate = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/;
  const textLike = (k: string) => k === "text" || k === "postcode" || k === "id";
  const textDates = cols.filter((c) => textLike(c.kind) && c.values.some((v) => fullDate.test(String(v))));
  // Ages over 89: a released age (or range) that is entirely 90+, or a birth year that implies it.
  let over89 = 0;
  for (const c of cols) {
    const isAge = c.f.id === "age" || /(^|[^a-z])age([^a-z]|$)/i.test(c.rawLabel);
    const isBirth = !isAge && /birth|dob|born/i.test(c.rawLabel); // "Age (from date of birth)" is an age
    if (!isAge && !isBirth) continue;
    for (const v of c.values) {
      const b = bounds(String(v)); if (!b) continue;
      if (isAge && b[0] >= 90) over89++;
      if (isBirth && b[1] <= year - 90) over89++;
    }
  }
  const postcodes = cols.filter((c) => c.kind === "postcode" || /(zip|post.?code|postal|plz)/i.test(c.rawLabel));
  // Only shortened postcodes are allowed; "exact" and "rare values as other" still show full ones.
  const postExact = postcodes.filter((c) => !/^First /.test(levelLabel(c.f)));
  const postShort = postcodes.filter((c) => c.f.level > 0 && /First 3/.test(levelLabel(c.f)));
  const geo = named(/(city|town|street|address|county|district|municipal|village|geo|latitude|longitude|gps)/i);
  const direct = cols.filter((c) => DIRECT_NAME.test(c.rawLabel));
  const codes = cols.filter((c) => (c.kind === "id" || (textLike(c.kind) && c.values.length > 20 && new Set(c.values).size === c.values.length)));
  const nameList = (xs: { label: string }[]) => xs.map((x) => `“${x.label}”`).join(", ");
  const hipaa: Rule[] = [
    { id: "direct", label: "No names, contact details or ID numbers", status: direct.length ? "fail" : "ok",
      detail: direct.length ? `${nameList(direct)} look${direct.length === 1 ? "s" : ""} like a name, contact detail or ID number (identifiers A, D–K, N, O).` : "No exported column looks like a name, address, phone, email, SSN, record, account, licence, device, URL or IP number." },
    { id: "geo", label: "No location smaller than a state", status: postExact.length || geo.length ? "fail" : postShort.length ? "review" : "ok",
      detail: postExact.length || geo.length ? `${nameList([...postExact, ...geo])} ${postExact.length + geo.length === 1 ? "is" : "are"} more precise than a state (identifier B).`
        : postShort.length ? `${nameList(postShort)}: the first 3 digits are allowed only where that area has more than 20,000 people; otherwise use “000”. Check against census data.` : "Only country or continent level, or shortened postcodes." },
    { id: "dates", label: "Dates shown as year only", status: textDates.length ? "fail" : "ok",
      detail: textDates.length ? `${nameList(textDates)} contain${textDates.length === 1 ? "s" : ""} full dates (identifier C).` : "Every date is released as a year or a range of years." },
    { id: "age90", label: "Ages over 89 grouped as 90+", status: over89 ? "fail" : "ok",
      detail: over89 ? `${over89} row${over89 === 1 ? " shows" : "s show"} an age (or birth year) that is entirely 90 or older. Safe Harbor needs them in one “90 or older” group: limit “Who's included” to under 90, or use ranges wide enough that none starts at 90 or above.` : "No released age or birth year is entirely 90 or older." },
    { id: "codes", label: "No other unique codes", status: codes.length ? "fail" : "ok",
      detail: codes.length ? `${nameList(codes)}: every row has a different value, like a code or ID (identifier R).` : "No exported column has a different value on every row. Study IDs are random and not derived from any identifier." },
    { id: "unseen", label: "Photos, biometrics and free text", status: "review",
      detail: "Full-face photos, fingerprints/voiceprints (P, Q), and names hidden inside free-text answers can't be detected automatically. Confirm none are in the file." },
    { id: "knowledge", label: "No actual knowledge the data could identify someone", status: "review",
      detail: "Safe Harbor also requires that the sender doesn't know of a way the remaining data could identify a person. That's your confirmation." },
  ];
  // "pass" means every rule the data can show passes; "review" rules remain for the admin to confirm.
  const statusOf = (rules: Rule[]) => rules.some((r) => r.status === "fail") ? "fail" : "pass";
  return {
    gdpr: { status: statusOf(gdpr), rules: gdpr },
    hipaa: { status: statusOf(hipaa), rules: hipaa },
  };
}
