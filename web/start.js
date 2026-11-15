/* The trend view: choose a variable and a region in the header, read the verdict in the
   side panel, and see where it is changing on the globe. Answers the four questions of a
   trend detective: what is changing, where, how much, and is it significant. */

import "./app.js"; // the globe, its layers, the Place and Today panes
import { compareChart, lineChart } from "./charts.js";
import { claimColour, evidenceBar, rangeBar, record } from "./record.js";
import { anomalyChart, decadeRidges, forestPlot, latitudeTime } from "./science.js";
import { addGroup, bindKeys, open as openPalette } from "./command.js";
import { initLive } from "./live.js";
import { combobox, copyText, icon, initTheme, sortableTable, toast, viewTabs } from "./ui.js";
import { coordText, el, fixed, getJSON, sig, thousands } from "./util.js";

const canary = window.canary;
const map = canary.map;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FIRST_YEAR = 1981, LAST_YEAR = 2025, MIN_SPAN = 15;
// Outlines on the globe: the region you chose is Canary yellow ("look here"); a comparison
// region is white and dashed, so the two differ by more than colour.
const SERIES = ["#ffd21f", "#ecebe6"];
// Snapshot build: results are precomputed for the full record and built-in regions only.
const PREVIEW = Boolean(window.CANARY_PREVIEW);

const DEMOS = [
  { id: "arctic", title: "The Arctic is warming",
    blurb: "What a significant trend looks like, and how to read the verdict.",
    state: { variable: "temperature", region: "preset:arctic", compare: null } },
  { id: "haze", title: "One cause, opposite trends",
    blurb: "Haze from human activity is rising over India and falling over Japan.",
    state: { variable: "haze", region: "country:IND", compare: "country:JPN" } },
  { id: "sahel", title: "A trend you cannot call yet",
    blurb: "Rain in the Sahel is edging up, but is it more than chance?",
    state: { variable: "precipitation", region: "preset:sahel", compare: null } },
];

const state = { variable: "temperature", region: "world", start: FIRST_YEAR, end: LAST_YEAR, compare: null };
let cat = null; // variables, themes, regions
let maps = null; // trend-map index
let boxes = null; // the three searchable selects in the header
let results = { a: null, b: null };
let requestId = 0;
let pickingFor = "region"; // which region a click on the globe sets
let drawing = null; // {target, corner} while a box is being drawn
let clicked = null; // {lat, lon, region} of the last click that chose a country
let frameNext = true; // whether the next update should fly the globe to the region
let tour = null;
let seriesView = "chart";

const $ = (id) => document.getElementById(id);
const variable = () => cat.variables.find((v) => v.id === state.variable);
const signedFix = (x, d) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}`;
const digits = (x) => (x === 0 ? 0 : Math.max(0, Math.min(4, 1 - Math.floor(Math.log10(Math.abs(x))))));
const pShort = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const pEq = (p) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
/** A region's name as it reads mid-sentence: "the Arctic", "Kenya". */
const nm = (r) => r.region.name.replace(/^The /, "the ");
const rateText = (r) => `${sig(r.trend.per_decade)} ${r.variable.unit} per decade`;

/** A region's own name, as a label: "The Arctic", "Kenya". */
function regionLabel(id) {
  if (id === "world") return "The whole world";
  const all = [...cat.regions.presets, ...cat.regions.continents, ...cat.regions.countries];
  const hit = all.find((r) => r.id === id);
  if (hit) return hit.name;
  if (id.startsWith("box:")) return "Drawn box";
  return id;
}
const regionName = (id) => regionLabel(id).replace(/^The /, "the ").replace(/^Drawn box$/, "the drawn box");

/* ---------- URL ---------- */

function writeHash() {
  if (PREVIEW || canary.state.pane === "place") return; // a selected place owns the address while it is showing
  const parts = ["investigate", state.variable, state.region, `${state.start}-${state.end}`];
  if (state.compare) parts.push("vs", state.compare);
  history.replaceState(null, "", `#${parts.join("/")}`);
}

function readHash() {
  if (PREVIEW) return;
  const parts = decodeURIComponent(location.hash.slice(1)).split("/");
  if (parts[0] !== "investigate" || parts.length < 4) return;
  const [from, to] = parts[3].split("-").map(Number);
  Object.assign(state, { variable: parts[1], region: parts[2] });
  if (from >= FIRST_YEAR && to <= LAST_YEAR && to - from + 1 >= MIN_SPAN) Object.assign(state, { start: from, end: to });
  state.compare = parts[4] === "vs" && parts[5] ? parts[5] : null;
}

/* ---------- the query strip ---------- */

function buildQuery() {
  const regionGroups = (exclude) => () => [
    { options: [{ value: "world", label: "The whole world", detail: "Every grid cell on Earth." }] },
    { name: "Named regions", options: cat.regions.presets.map((r) => ({ value: r.id, label: r.name, detail: r.about })) },
    { name: "Continents", options: cat.regions.continents.map((r) => ({ value: r.id, label: r.name })) },
    { name: "Countries", options: cat.regions.countries.map((r) => ({ value: r.id, label: r.name })) },
  ].map((g) => ({ ...g, options: g.options.filter((o) => o.value !== exclude()) }));
  const drawAction = (target) => () => (PREVIEW ? [] : [{ label: "Draw a box on the map",
    detail: "Any rectangle of at least 1 degree.", run: () => startDrawing(target) }]);

  boxes = {
    variable: combobox({
      label: "Variable", prefix: "Variable", searchLabel: "Search variables",
      groups: () => cat.themes.map((theme) => ({ name: theme.name, about: theme.about,
        options: cat.variables.filter((v) => v.theme === theme.id).map((v) => ({
          value: v.id, label: v.label, detail: v.definition, meta: `${v.unit} · from ${v.record_from}` })) })),
      onChange: (id) => { state.variable = id; frameNext = false; update(); },
    }),
    region: combobox({
      label: "Region", prefix: "Region", searchLabel: "Search countries and regions",
      groups: regionGroups(() => null), actions: drawAction("region"),
      onChange: (id) => { pickingFor = "region"; clicked = null; canary.showPane("trend"); setRegion("region", id); },
    }),
    compare: combobox({
      label: "Compare with", prefix: "Compare", placeholder: "none", searchLabel: "Search countries and regions",
      groups: regionGroups(() => state.region), actions: drawAction("compare"),
      onChange: (id) => { pickingFor = "compare"; canary.showPane("trend"); setRegion("compare", id); },
      clearLabel: "Stop comparing", onClear: () => { state.compare = null; pickingFor = "region"; update(); },
    }),
  };
  for (const [name, box] of Object.entries(boxes)) {
    box.trigger.id = `pick-${name}`;
    $(`slot-${name}`).replaceChildren(box.root);
  }
}

function renderQuery() {
  const v = variable();
  boxes.variable.set(v.id, v.label);
  boxes.region.set(state.region, regionLabel(state.region));
  boxes.compare.set(state.compare, state.compare ? regionLabel(state.compare) : "");
  for (const [id, lo, hi] of [["year-start", FIRST_YEAR, LAST_YEAR - MIN_SPAN + 1], ["year-end", FIRST_YEAR + MIN_SPAN - 1, LAST_YEAR]]) {
    const select = $(id);
    if (!select.options.length) for (let y = lo; y <= hi; y++) select.append(el("option", { value: y, text: y }));
    // Some records start later (satellite radiation data begin in 2001): grey out years before that.
    for (const option of select.options) option.disabled = id === "year-start" && Number(option.value) < v.record_from;
    select.value = id === "year-start" ? Math.max(state.start, Math.min(v.record_from, hi)) : state.end;
    select.disabled = PREVIEW;
  }
}

/* ---------- verdict ---------- */

/** Three numbers under the chart: the rate with its range, the total change, the evidence. */
function statsRow(r) {
  const v = r.variable, t = r.trend, d = digits(t.per_decade);
  return el("div", { class: "stats-row" },
    el("div", { class: "stat-cell" },
      el("span", { class: "stat-k", text: "Theil-Sen, per decade" }),
      el("span", { class: "stat-v", style: `color:${claimColour(v, t.per_decade, r.significant)}` }, signedFix(t.per_decade, d), el("small", { text: ` ${v.unit}` })),
      rangeBar(v, t.per_decade, t.range_per_decade, r.significant, true),
      el("span", { class: "stat-n", text: `95%: ${signedFix(t.range_per_decade[0], d)} to ${signedFix(t.range_per_decade[1], d)}` })),
    el("div", { class: "stat-cell" },
      el("span", { class: "stat-k", text: `Δ ${r.period[0]}–${r.period[1]}` }),
      el("span", { class: "stat-v", style: `color:${claimColour(v, t.total_change, r.significant)}` }, signedFix(t.total_change, digits(t.total_change)),
        el("small", { text: ` ${v.unit}` })),
      el("span", { class: "stat-n", text: t.signal_to_noise == null ? "" : `S/N ${t.signal_to_noise.toFixed(1)}` })),
    el("div", { class: "stat-cell" },
      el("span", { class: "stat-k", text: "Mann-Kendall" }),
      el("span", { class: "stat-v" }, el("span", { class: `tag ${r.significant ? "is-yes" : "is-no"}` }, el("i"), r.significant ? "Significant" : "Could be chance")),
      evidenceBar(v, r.tests.mann_kendall.p, r.significant, t.per_decade, true),
      el("span", { class: "stat-n", text: pEq(r.tests.mann_kendall.p) })));
}

function verdictBlock(r, key) {
  const v = r.variable, up = r.trend.direction === "rising";
  const title = r.significant
    ? [`${v.label} in ${nm(r)} is ${up ? "rising" : "falling"} by `, el("mark", { text: rateText(r) })]
    : [`${v.label} in ${nm(r)}: no significant trend`];
  return el("article", { class: `verdict ${r.significant ? "is-significant" : "not-significant"}` },
    key ? el("p", { class: "verdict-region" }, el("i", { class: `key series-${key === "a" ? 1 : 2}` }), r.region.name)
      : el("p", { class: "question", text: `${r.region.name} · ${r.period[0]}–${r.period[1]}` }),
    el(key ? "h2" : "h1", { class: "verdict-headline" }, ...title),
    key ? statsRow(r) : null);
}

/** Kept for the header glyph: the record as nine coloured cells. */
function recordOf(r, size = "glyph") {
  return record({ v: r.variable, years: r.years, size,
    anomaly: r.values.map((x) => (x == null ? null : x - r.normal)), label: `${r.variable.label}: the record` });
}

function comparisonLine(a, b) {
  const u = a.variable.unit, rate = (r) => `${signedFix(r.trend.per_decade, digits(r.trend.per_decade))}`;
  const both = a.significant && b.significant;
  const lead = both ? (Math.sign(a.trend.per_decade) !== Math.sign(b.trend.per_decade) ? "Opposite significant trends" : "Both significant")
    : a.significant || b.significant ? `Significant in ${(a.significant ? a : b).region.name} only` : "Neither significant";
  return el("p", { class: "comparison" }, el("strong", { text: `${lead}. ` }),
    `${a.region.name} ${rate(a)}, ${b.region.name} ${rate(b)} ${u} per decade.`);
}

/* ---------- the series figure: chart or table ---------- */

function seriesChart(a, b) {
  // Two regions on one axis: each as its anomaly against its own 1991-2020 base.
  const v = a.variable;
  const prep = (r) => ({ name: r.region.name, x: r.years, y: r.values.map((val) => (val == null ? null : val - r.normal)) });
  return [
    el("div", { class: "legend" },
      el("span", {}, el("i", { class: "key series-1" }), a.region.name),
      el("span", {}, el("i", { class: "key series-2" }), b.region.name)),
    compareChart({ series: [prep(a), prep(b)], unit: v.unit, decimals: v.decimals, width: 440, height: 250,
      label: `${v.label} anomaly relative to 1991 to 2020: ${a.region.name} and ${b.region.name}` }),
  ];
}

function seriesTable(a, b) {
  const v = a.variable;
  const cell = (r, year) => {
    const value = r.values[r.years.indexOf(year)];
    return value == null ? "" : fixed(value, v.decimals);
  };
  const head = b
    ? ["Year", `${a.region.name} (${v.unit})`, `${b.region.name} (${v.unit})`]
    : ["Year", `Yearly average (${v.unit})`, "Against the 1991–2020 average"];
  const table = el("table", { class: "data" },
    el("thead", {}, el("tr", {}, ...head.map((h, i) => el("th", { scope: "col", class: i ? "num" : "", text: h })))),
    el("tbody", {}, ...a.years.map((year, i) => el("tr", {},
      el("td", { text: year }),
      el("td", { class: "num", text: cell(a, year) }),
      el("td", { class: "num", text: b ? cell(b, year) : a.values[i] == null ? "" : signedFix(a.values[i] - a.normal, v.decimals) })))));
  return [el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Yearly values" }, table)];
}

function downloadCsv(a, b) {
  const v = a.variable;
  const head = ["year", `${a.region.name} (${v.unit})`].concat(b ? [`${b.region.name} (${v.unit})`] : []);
  const lines = [head.map((h) => `"${h}"`).join(",")];
  a.years.forEach((year, i) => {
    const row = [year, a.values[i] ?? ""];
    if (b) row.push(b.values[b.years.indexOf(year)] ?? "");
    lines.push(row.join(","));
  });
  lines.push("", `"Source: ${v.source}, parameter ${v.parameter}. Area-weighted yearly averages computed by Canary."`);
  const link = el("a", { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })),
    download: `canary_${v.id}_${a.region.id.replace(/[^a-z0-9]+/gi, "-")}.csv` });
  link.click();
  URL.revokeObjectURL(link.href);
}

/** The JSON query behind the current result, for anyone who wants to reproduce it. */
function apiQuery(region = state.region) {
  return `${location.origin}/api/investigate?variable=${state.variable}&region=${encodeURIComponent(region)}&start=${state.start}&end=${state.end}`;
}

function citation(r) {
  const today = new Date().toISOString().slice(0, 10);
  const v = r.variable;
  return {
    result: `Canary (${new Date().getFullYear()}). ${v.label} in ${nm(r)}, ${r.period[0]}–${r.period[1]}: `
      + `${signedFix(r.trend.per_decade, digits(r.trend.per_decade))} ${v.unit} per decade (95% range `
      + `${signedFix(r.trend.range_per_decade[0], digits(r.trend.per_decade))} to ${signedFix(r.trend.range_per_decade[1], digits(r.trend.per_decade))}), `
      + `Theil-Sen slope; Mann-Kendall test corrected for autocorrelation, ${pEq(r.tests.mann_kendall.p)}. `
      + `Area-weighted yearly means of NASA POWER ${v.source.replace("NASA POWER ", "")}, parameter ${v.parameter}. Retrieved ${today}${PREVIEW ? "" : ` from ${location.href}`}.`,
    data: "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project, funded through the "
      + "NASA Earth Science/Applied Science Program. The MERRA-2 reanalysis is produced by NASA's Global Modeling and "
      + "Assimilation Office (GMAO); CERES SYN1deg by NASA Langley.",
  };
}

function openCite() {
  const r = results.a;
  if (!r) return;
  const c = citation(r);
  const block = (title, text, action) => {
    const pre = el("pre", { class: "cite-text", text });
    return [el("h3", { text: title }), pre,
      el("button", { type: "button", class: "btn small", onclick: () => copyText(text, `${title} copied`, pre) }, icon("link"), action)];
  };
  openDialog("Cite and reproduce", [
    ...block("Citation", c.result, "Copy citation"),
    ...block("Data acknowledgement", c.data, "Copy acknowledgement"),
    ...(PREVIEW ? [] : block("API query", `curl '${apiQuery()}'`, "Copy API query")),
    el("p", { class: "steps-note", text: "The API returns every number on this page as JSON: the yearly series, the trend and its range, both tests and the explanation." }),
  ]);
}

function copyLink() { copyText(location.href, "Link to this view copied"); }

function toolButton(name, label, onclick) {
  return el("button", { type: "button", class: "tool", "aria-label": label, title: label, onclick }, icon(name));
}

/** What the chart shows and where the data come from, on request. */
function openAbout(a) {
  const v = a.variable;
  openDialog("About this result", [
    el("dl", { class: "about" },
      el("dt", { text: "Variable" }), el("dd", { text: `${v.label}: ${v.definition}` }),
      el("dt", { text: "Region" }), el("dd", { text: `${a.region.name}, area-weighted average of ${thousands(a.region.cells)} grid cells` }),
      el("dt", { text: "Data" }), el("dd", { text: `${v.source}, parameter ${v.parameter}, yearly means ${a.period[0]}–${a.period[1]}` }),
      el("dt", { text: "Normal" }), el("dd", { text: `1991–2020 average: ${fixed(a.normal, v.decimals)} ${v.unit}` }),
      el("dt", { text: "Trend" }), el("dd", { text: "Theil-Sen slope (the median of all pairwise slopes), with its 95% range shaded as a fan around the line" }),
      el("dt", { text: "Test" }), el("dd", { text: "Mann-Kendall, corrected for memory in the data; a least-squares t-test as a second opinion" }),
      v.caution ? el("dt", { text: "Caution" }) : null, v.caution ? el("dd", { text: v.caution }) : null),
  ]);
}

function renderSeries(a, b) {
  const body = el("div", { class: "figure-body" });
  const views = b ? [{ id: "chart", label: "Change" }, { id: "table", label: "Table" }]
    : [{ id: "chart", label: "Change" }, ...(a.zonal ? [{ id: "lat", label: "Latitude" }] : []),
      { id: "shift", label: "Distribution" }, { id: "table", label: "Table" }];
  if (!views.some((x) => x.id === seriesView)) seriesView = "chart";
  const draw = (view) => {
    seriesView = view;
    if (view === "table") body.replaceChildren(...seriesTable(a, b));
    else if (view === "shift") body.replaceChildren(decadeRidges(a));
    else if (view === "lat") body.replaceChildren(latitudeTime(a));
    else body.replaceChildren(...(b ? seriesChart(a, b) : [anomalyChart(a)]));
  };
  $("card-series").replaceChildren(
    el("header", { class: "figure-head" },
      viewTabs("View", views, draw, seriesView),
      el("div", { class: "tools" },
        toolButton("info", "About this result", () => openAbout(a)),
        PREVIEW ? null : toolButton("download", "Download the yearly data (CSV)", () => downloadCsv(a, b)),
        PREVIEW ? null : toolButton("link", "Copy a link to this view", copyLink),
        toolButton("quote", "Cite this result and get its API query", openCite))),
    body);
  draw(seriesView);
}

/* ---------- details: significance, context, every variable ---------- */

function evidenceCard(r) {
  const detail = r.significant ? r.detail : r.detail.replace(/^Not significant\. /, "");
  const v = r.variable, mk = r.tests.mann_kendall, tt = r.tests.t_test;
  const d = digits(r.trend.per_decade);
  const rows = [
    ["Mann-Kendall", "Are later years higher than earlier ones more often than chance would give?",
      `τ = ${signedFix(mk.tau, 2)}`, pShort(mk.p)],
    ["t-test on the slope", "Is a straight line fitted through the years tilted?",
      `${signedFix(tt.per_decade, d)} per decade`, pShort(tt.p)],
  ];
  return [
    el("table", { class: "data tests" },
      el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Test" }),
        el("th", { scope: "col", class: "num", text: "Result" }), el("th", { scope: "col", class: "num", text: "p-value" }))),
      el("tbody", {}, ...rows.map(([name, what, result, p]) => el("tr", {},
        el("td", {}, el("strong", { text: name }), el("small", { text: what })),
        el("td", { class: "num", text: result }), el("td", { class: "num", text: p }))))),
    el("p", { class: "note-text", text:
      `A p-value below 0.05 is the usual line for “significant”. The two tests ${r.tests.agree ? "agree" : "disagree, so treat the verdict with care"}. `
      + (mk.variance_inflation > 1.05 ? `Years are not independent of each other here, so the uncertainty was widened ${mk.variance_inflation.toFixed(1)} times before testing. ` : "")
      + (r.more_years_needed ? `At this rate, about ${r.more_years_needed} more year${r.more_years_needed > 1 ? "s" : ""} of data would settle it.` : "") }),
    el("p", { class: "note-text", text: detail }),
  ];
}

function whyCard(r) {
  const v = r.variable;
  const items = [];
  const add = (label, text) => items.push(el("li", {}, el("strong", { text: label }), el("span", { text })));
  if (r.split) {
    const s = r.split;
    add("Inside the region",
      `${fixed(s.rising_percent, 0)}% of the area has a significant rise, ${fixed(s.falling_percent, 0)}% a significant fall, `
      + `and ${fixed(s.unclear_percent, 0)}% no clear trend.`
      + (s.rising_percent > 10 && s.falling_percent > 10 ? " The average hides opposite trends: look at the map." : ""));
  }
  const world = maps && maps.layers.find((l) => l.id === v.id);
  if (world && r.region.kind !== "world") {
    const w = world.mean_trend_per_decade;
    add("Against the world", `The mapped world as a whole is changing by ${signedFix(w, digits(w))} ${v.unit} per decade; `
      + `this region by ${signedFix(r.trend.per_decade, digits(r.trend.per_decade))}.`);
  }
  for (const link of r.links.slice(0, 2)) {
    add(link.name, `The region's ups and downs from year to year follow it (correlation ${signedFix(link.r, 2)}, `
      + `about ${link.share_of_swings_percent}% of the swings). That explains good and bad years, not the long-term trend.`);
  }
  if (!r.links.length) {
    add("Climate rhythms", "The yearly ups and downs here do not follow El Niño or the four other ocean and pressure rhythms tested.");
  }
  if (v.caution) add("Caution", v.caution);
  add("Remember", "A significant trend says that something is changing, not why. The cause has to be argued from other evidence.");
  const centre = r.region.bounds && r.region.kind !== "world"
    ? [(r.region.bounds[0] + r.region.bounds[2]) / 2, (r.region.bounds[1] + r.region.bounds[3]) / 2] : null;
  const out = [el("ul", { class: "why" }, ...items)];
  if (centre && !PREVIEW) {
    out.push(el("button", { type: "button", class: "btn small",
      onclick: () => canary.select(centre[0], centre[1], `Centre of ${nm(r)}`, { tab: "case" }) },
      icon("globe"), "Open a detective case file for this region"));
  }
  return out;
}

async function renderScan(id) {
  const box = $("scan-body");
  $("scan-title").textContent = `All variables · ${regionLabel(state.region)}`;
  $("scan-gist").textContent = "";
  box.replaceChildren(el("p", { class: "loading-note", text: "Testing every variable…" }));
  let data;
  try {
    data = await getJSON(`/api/scan?region=${encodeURIComponent(state.region)}&start=${state.start}&end=${state.end}`);
  } catch (error) {
    if (id === requestId) box.replaceChildren(el("p", { class: "note-text", text: `The scan could not run: ${error.message}` }));
    return;
  }
  if (id !== requestId) return;
  $("scan-gist").textContent = `${data.significant} of ${data.tested} changing`;
  box.replaceChildren(
    forestPlot(data.variables, state.variable, (r) => {
      state.variable = r.id; frameNext = false; update();
      $("panel").scrollTo({ top: 0, behavior: REDUCED_MOTION ? "auto" : "smooth" });
    }),
    el("p", { class: "forest-note", text: "Theil-Sen slope per decade ÷ detrended interannual σ, with 95% interval. "
      + "Filled: Mann-Kendall significant after Benjamini-Hochberg FDR (q = 0.05)." }));
}

/* ---------- the globe: countries, selected regions, drawing a box ---------- */

const EMPTY = { type: "FeatureCollection", features: [] };
const NO_COUNTRY = ["==", ["get", "code"], ""];

function attachMap() {
  map.addSource("countries", { type: "geojson", data: EMPTY });
  map.addSource("shapes", { type: "geojson", data: EMPTY });
  const under = "storm-tracks"; // keep event markers and routes on top
  const line = (id, source, filter, color, width, extra = {}) => map.addLayer({ id, type: "line", source, ...(filter ? { filter } : {}),
    layout: { "line-join": "round" }, paint: { "line-color": color, "line-width": width, ...extra } }, under);
  map.addLayer({ id: "country-hit", type: "fill", source: "countries", paint: { "fill-color": "#ffffff", "fill-opacity": 0 } }, under);
  // The snapshot build has no reference imagery, so it draws the outlines itself.
  if (PREVIEW) line("country-lines", "countries", null, "rgba(232,234,237,0.35)", 0.6);
  line("country-hover", "countries", NO_COUNTRY, "#ffffff", 1.2);
  const casing = "rgba(11,14,19,0.75)";
  line("sel-a-case", "countries", NO_COUNTRY, casing, 5);
  line("sel-b-case", "countries", NO_COUNTRY, casing, 5);
  line("shapes-case", "shapes", null, casing, 5);
  line("sel-a", "countries", NO_COUNTRY, SERIES[0], 2.5);
  line("sel-b", "countries", NO_COUNTRY, SERIES[1], 2.5, { "line-dasharray": [2, 1.5] });
  line("shapes", "shapes", null, ["match", ["get", "key"], "b", SERIES[1], "draw", "#ffffff", SERIES[0]], 2.5);

  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "country-tip" });
  map.on("mousemove", "country-hit", (e) => {
    if (drawing || canary.state.pane === "place") return;
    const p = e.features[0].properties;
    map.getCanvas().style.cursor = "pointer";
    map.setFilter("country-hover", ["==", ["get", "code"], p.code]);
    tip.setLngLat(e.lngLat).setText(p.name).addTo(map);
  });
  map.on("mouseleave", "country-hit", () => {
    map.getCanvas().style.cursor = drawing ? "crosshair" : "";
    map.setFilter("country-hover", NO_COUNTRY);
    tip.remove();
  });
  map.on("mousemove", (e) => {
    if (drawing && drawing.corner) drawShapes([boxFeature(drawing.corner, e.lngLat, "draw")]);
  });
  canary.onMapClick = onMapClick;
}

/** A click on the globe: a box corner while drawing, a place in the Place pane, otherwise a country. */
function onMapClick(e) {
  if (drawing) {
    if (!drawing.corner) { drawing.corner = e.lngLat; return; }
    const a = drawing.corner, b = e.lngLat, target = drawing.target;
    stopDrawing();
    setRegion(target, `box:${Math.min(a.lat, b.lat).toFixed(1)},${Math.min(a.lng, b.lng).toFixed(1)},${Math.max(a.lat, b.lat).toFixed(1)},${Math.max(a.lng, b.lng).toFixed(1)}`);
    return;
  }
  const hit = canary.state.pane === "place" ? null : map.queryRenderedFeatures(e.point, { layers: ["country-hit"] })[0];
  if (!hit) { canary.select(e.lngLat.lat, e.lngLat.lng, null, { fly: false }); return; }
  const target = state.compare ? pickingFor : "region";
  const region = `country:${hit.properties.code}`;
  clicked = { lat: e.lngLat.lat, lon: e.lngLat.lng, region };
  frameNext = false; // the visitor is already looking at it
  canary.stopSpin();
  canary.showPane("trend");
  setRegion(target, region);
}

function boxFeature(a, b, key) {
  const s = Math.min(a.lat, b.lat), n = Math.max(a.lat, b.lat), w = Math.min(a.lng, b.lng), e = Math.max(a.lng, b.lng);
  return { type: "Feature", properties: { key },
    geometry: { type: "LineString", coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] } };
}

let regionShapes = [];
function drawShapes(extra = []) {
  map.getSource("shapes").setData({ type: "FeatureCollection", features: [...regionShapes, ...extra] });
}

function startDrawing(target) {
  endTour();
  drawing = { target, corner: null };
  canary.stopSpin();
  canary.showPane("trend");
  map.getCanvas().style.cursor = "crosshair";
  $("map-note").replaceChildren("Click two opposite corners of the box on the globe. ",
    el("button", { type: "button", class: "btn small", text: "Cancel", onclick: stopDrawing }));
  $("map-note").hidden = false;
}

function stopDrawing() {
  drawing = null;
  map.getCanvas().style.cursor = "";
  drawShapes();
  $("map-note").hidden = true;
}

function setRegion(target, id) {
  if (target === "compare") state.compare = id; else state.region = id;
  update();
}

function showRegionsOnMap(a, b, frame) {
  const filterFor = (r) => {
    if (!r) return NO_COUNTRY;
    if (r.region.kind === "country") return ["==", ["get", "code"], r.region.id.split(":")[1]];
    if (r.region.kind === "continent") return ["==", ["get", "continent"], r.region.name];
    return NO_COUNTRY;
  };
  for (const [key, r] of [["a", a], ["b", b]]) {
    map.setFilter(`sel-${key}`, filterFor(r));
    map.setFilter(`sel-${key}-case`, filterFor(r));
  }
  regionShapes = [];
  for (const [r, key] of [[a, "a"], [b, "b"]]) {
    if (r && (r.region.kind === "preset" || r.region.kind === "box")) {
      const [s, w, n, e] = r.region.bounds;
      if (e - w >= 359) {
        // A band around the whole globe (the Arctic, the tropics): draw its edges as parallels only.
        for (const lat of [s, n]) {
          if (Math.abs(lat) >= 85) continue;
          const circle = [];
          for (let x = -180; x <= 180; x += 5) circle.push([x, lat]);
          regionShapes.push({ type: "Feature", properties: { key }, geometry: { type: "LineString", coordinates: circle } });
        }
        continue;
      }
      // Step along each edge so that it follows a parallel on the globe instead of cutting a great circle.
      const ring = [];
      const east = e < w ? e + 360 : e;
      for (let x = w; x <= east; x += 5) ring.push([x, s]);
      ring.push([east, s]);
      for (let x = east; x >= w; x -= 5) ring.push([x, Math.min(n, 85)]);
      ring.push([w, Math.min(n, 85)], [w, s]);
      regionShapes.push({ type: "Feature", properties: { key }, geometry: { type: "LineString", coordinates: ring } });
    }
  }
  drawShapes();

  const frames = [a, b].filter((r) => r && r.region.bounds && r.region.kind !== "world").map((r) => r.region.bounds);
  if (!frame || !frames.length) return;
  canary.stopSpin();
  const s = Math.min(...frames.map((x) => x[0])), n = Math.max(...frames.map((x) => x[2]));
  const w = Math.min(...frames.map((x) => x[1])), e = Math.max(...frames.map((x) => x[3]));
  const span = Math.max(n - s, (e - w) * 0.6, 8);
  map.easeTo({ center: [e - w > 300 ? 10 : (w + e) / 2, Math.max(-70, Math.min(70, (s + n) / 2))],
    zoom: Math.max(1.2, Math.min(4.6, Math.log2(170 / span) + 1.2)), pitch: 0, bearing: 0, duration: 1200 });
}

/* ---------- the guide: three questions, and worked examples ---------- */

function openDialog(title, body) {
  const dialog = $("picker");
  dialog.replaceChildren(
    el("div", { class: "dialog-head" }, el("h2", { text: title }),
      el("button", { type: "button", class: "btn quiet icon-only", "aria-label": "Close", onclick: () => dialog.close() }, icon("close"))),
    el("div", { class: "dialog-body" }, ...body));
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function openGuide() {
  const answers = { interest: null, place: null };
  const option = (label, onclick, ...more) => el("button", { type: "button", class: "pick", onclick }, el("strong", { text: label }), ...more);
  const step = (n) => {
    if (n === 0) {
      openDialog("Guide", [
        el("h3", { text: "How Canary works" }),
        el("ol", { class: "how" },
          el("li", { text: "Choose a variable and a region at the top, or click a country on the globe." }),
          el("li", { text: "The globe shows where the variable is changing: bright cells have a significant trend, faint cells could be chance." }),
          el("li", { text: "The panel gives the verdict for the region: the rate of change, its likely range, and whether it is significant." }),
          el("li", { text: "Open the Place tab and click any point for that exact spot: vital signs, where its rain goes, the weather now." })),
        el("h3", { text: "Worked examples" }),
        el("ul", { class: "examples" }, ...DEMOS.map((d) => el("li", {},
          el("div", {}, el("strong", { text: d.title }), el("span", { text: d.blurb })),
          el("button", { type: "button", class: "btn small", onclick: () => { $("picker").close(); playDemo(d); } },
            icon("play"), "Play")))),
      ]);
    } else if (n === 1) {
      openDialog("Guide", [
        el("p", { class: "steps-note", text: "Question 1 of 3. What are you curious about?" }),
        el("div", { class: "pick-grid" }, ...cat.interests.map((i) => option(i.question, () => { answers.interest = i.id; step(2); })))]);
    } else if (n === 2) {
      openDialog("Guide", [
        el("p", { class: "steps-note", text: "Question 2 of 3. What kind of place?" }),
        el("div", { class: "pick-grid" },
          ...cat.place_kinds.map((k) => option(k.name, () => { answers.place = k.id; step(3); })),
          option("No particular kind", () => { answers.place = null; step(3); }))]);
    } else {
      getJSON(`/api/suggest?interest=${answers.interest}${answers.place ? `&place=${answers.place}` : ""}`).then((picks) => {
        openDialog("Guide", [
          el("p", { class: "steps-note", text: "Question 3 of 3. Start with one of these variables. You choose the place next." }),
          el("div", { class: "pick-list" }, ...picks.map((p) => option(p.label,
            () => { state.variable = p.id; $("picker").close(); canary.showPane("trend"); update(); boxes.region.open(); },
            el("span", { text: p.definition }), el("small", { text: p.why }))))]);
      });
    }
  };
  step(0);
}

function tourSteps(demo, a, b) {
  const v = a.variable;
  const steps = [
    { target: "ask", text: `Step 1: choose what and where. Here: ${v.label.toLowerCase()} in ${nm(a)}${b ? `, compared with ${nm(b)}` : ""}.` },
    { target: "card-series", text: b
      ? "Step 2: look at the record. Each line is one region, shown against its own normal so that they share an axis."
      : "Step 2: look at the record. Each point is one year's average for the whole region. The straight line is the trend." },
    { target: "verdict", text: a.significant
      ? `Step 3: read the verdict. ${a.headline}. “Significant” means a pattern this steady would rarely appear by chance.`
      : `Step 3: read the verdict. ${a.headline.replace(/ \(.*/, "")}. The line tilts, but years bounce around so much that chance could do this.` },
  ];
  if (b) {
    steps.push({ target: "verdict", text: `In ${nm(b)}: ${b.headline.toLowerCase()}. Same variable, same satellites, opposite direction.` });
  } else if (!a.significant && a.more_years_needed) {
    steps.push({ target: "card-numbers", text: `Not significant is not the same as no change. At this rate, about ${a.more_years_needed} more year${a.more_years_needed > 1 ? "s" : ""} of data would settle it.` });
  } else {
    steps.push({ target: "card-numbers", text: `Step 4: check the evidence. Two different tests are run; here they ${a.tests.agree ? "agree" : "disagree"}. The 95% range shows how well the rate is pinned down.` });
  }
  steps.push({ target: "legend", text: "Then ask where. The globe shows the trend in every grid cell: bright where it is significant, faint where it could be chance." });
  steps.push({ target: "card-why", text: "Last, ask why. A trend says something is changing, not what causes it. Now try your own: change the variable or click a country." });
  return steps;
}

async function playDemo(demo) {
  endTour();
  stopDrawing();
  Object.assign(state, { start: FIRST_YEAR, end: LAST_YEAR }, demo.state);
  seriesView = "chart";
  clicked = null;
  canary.showPane("trend");
  await update();
  if (!results.a) return;
  const steps = tourSteps(demo, results.a, results.b);
  const bar = $("tour");
  let index = 0, timer = null, paused = false;
  const show = () => {
    document.querySelectorAll(".tour-focus").forEach((n) => n.classList.remove("tour-focus"));
    const s = steps[index];
    const target = $(s.target);
    if (target.tagName === "DETAILS") target.open = true;
    target.classList.add("tour-focus");
    target.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
    bar.replaceChildren(
      el("div", { class: "tour-text" }, el("strong", { text: `${demo.title} · ${index + 1} of ${steps.length}` }), el("p", { text: s.text })),
      el("div", { class: "tour-actions" },
        el("button", { type: "button", class: "btn small", text: paused ? "Resume" : "Pause",
          onclick: () => { paused = !paused; show(); } }),
        el("button", { type: "button", class: "btn small", text: index === steps.length - 1 ? "Finish" : "Next",
          onclick: () => next() }),
        el("button", { type: "button", class: "btn small quiet icon-only", "aria-label": "Close the walkthrough", onclick: endTour }, icon("close"))));
    bar.hidden = false;
    clearTimeout(timer);
    if (!paused && !REDUCED_MOTION) timer = setTimeout(next, 7000);
  };
  const next = () => { if (index >= steps.length - 1) endTour(); else { index += 1; show(); } };
  tour = { stop: () => clearTimeout(timer) };
  show();
}

function endTour() {
  if (tour) tour.stop();
  tour = null;
  $("tour").hidden = true;
  document.querySelectorAll(".tour-focus").forEach((n) => n.classList.remove("tour-focus"));
}

/* ---------- command palette and shortcuts ---------- */

function openShortcuts() {
  const rows = [["⌘ K or Ctrl K", "Search everything"], ["/", "Search everything"], ["1  2  3", "Trends, weather, satellite"], ["D", "Trend as 3D columns"],
    ["Space", "Play or pause the timeline"], ["←  →", "Step the timeline by one image or hour"], ["?", "This list"], ["Esc", "Close a dialog or stop drawing"]];
  openDialog("Keyboard shortcuts", [el("table", { class: "data shortcuts" },
    el("tbody", {}, ...rows.map(([k, what]) => el("tr", {}, el("td", {}, ...k.split("  ").map((x) => el("kbd", { text: x }))), el("td", { text: what })))))]);
}

function registerCommands() {
  const view = (mode) => () => canary.setMode(mode);
  addGroup({ name: "Actions", limit: 6, idle: 7, items: () => [
    { icon: "◐", label: "Show weather, last 24 hours", detail: "Clouds, rain, temperature and wind from NASA GEOS-FP", keys: ["2"], keywords: "weather clouds rain wind now", run: view("weather") },
    ...(PREVIEW ? [] : [{ icon: "◉", label: "Show the satellite loop", detail: "GOES and Himawari, last 3 hours", keys: ["3"], keywords: "satellite imagery goes himawari clouds live", run: view("satellite") }]),
    { icon: "↗", label: "Show trends", detail: "The chosen variable's trend map", keys: ["1"], keywords: "trend map", run: view("trends") },
    { icon: "▥", label: "Trend as 3D columns", detail: "Height is the rate; only significant cells rise", keys: ["D"], keywords: "3d columns extrude bars height", run: () => { view("trends")(); document.getElementById("toggle-3d").click(); } },
    { icon: "⇄", label: "Compare with another region…", keywords: "compare versus vs", run: () => boxes.compare.open() },
    { icon: "❝", label: "Cite this result and get its API query", keywords: "cite citation reference api reproduce json curl", run: openCite },
    ...(PREVIEW ? [] : [
      { icon: "⇩", label: "Download the yearly data as CSV", keywords: "download export csv data", run: () => results.a && downloadCsv(results.a, results.b) },
      { icon: "⧉", label: "Copy a link to this view", keywords: "share link url permalink", run: copyLink },
      { icon: "◑", label: "Switch between light and dark", keywords: "theme dark light mode", run: () => $("theme-toggle").click() },
    ]),
    { icon: "⌖", label: "Find a place…", detail: "Its vital signs, where its rain goes, the weather now", keywords: "place city point search", run: () => { canary.showPane("place"); $("search-input").focus(); } },
    { icon: "☰", label: "Earth today", detail: "Planet indicators and the biggest events now", keywords: "today dashboard events indicators", run: () => canary.showPane("today") },
    { icon: "?", label: "Open the guide", keywords: "help guide how", run: openGuide },
    { icon: "⌨", label: "Keyboard shortcuts", keys: ["?"], keywords: "keys shortcuts", run: openShortcuts },
    ...DEMOS.map((d) => ({ icon: "▶", label: `Walkthrough: ${d.title}`, detail: d.blurb, keywords: "demo example walkthrough tour", run: () => playDemo(d) })),
  ] });
  addGroup({ name: "Variables", limit: 6, idle: 0, items: () => cat.variables.map((v) => ({
    icon: "≋", label: v.label, detail: v.definition, meta: v.unit, keywords: `${v.theme} ${v.parameter}`,
    run: () => { state.variable = v.id; frameNext = false; canary.showPane("trend"); update(); } })) });
  addGroup({ name: "Regions", limit: 6, idle: 0, items: () => [
    { id: "world", name: "The whole world", kind: "World" },
    ...cat.regions.presets.map((r) => ({ ...r, kind: "Region" })),
    ...cat.regions.continents.map((r) => ({ ...r, kind: "Continent" })),
    ...cat.regions.countries.map((r) => ({ ...r, kind: "Country" })),
  ].map((r) => ({ icon: "▢", label: r.name, detail: r.about, meta: r.kind, keywords: r.id,
    run: () => { clicked = null; canary.showPane("trend"); setRegion("region", r.id); } })) });
  addGroup({ name: "Places", limit: 5, items: () => [] });
}

/* ---------- update ---------- */

function pointNote(a) {
  const note = $("point-note");
  const here = clicked && clicked.region === state.region && !state.compare ? clicked : null;
  note.hidden = !here || PREVIEW;
  if (note.hidden) return;
  note.replaceChildren(`You clicked ${coordText(here.lat, here.lon)}. The verdict above is for all of ${nm(a)}. `,
    el("button", { type: "button", class: "link", text: "Open that exact place",
      onclick: () => canary.select(here.lat, here.lon, null, { fly: false }) }),
    " for its vital signs, where its rain goes and the weather now.");
}

async function update() {
  const id = ++requestId;
  const frame = frameNext;
  frameNext = true;
  if (state.end - state.start + 1 < MIN_SPAN) state.end = Math.min(LAST_YEAR, state.start + MIN_SPAN - 1);
  if (state.compare === state.region) state.compare = null;
  renderQuery();
  if (results.a && results.a.variable.id !== state.variable) $("pick-variable").querySelector(".record-glyph")?.remove();
  writeHash();
  if (canary.state.trendId !== state.variable) canary.setTrend(state.variable, { keepSpin: true });
  const box = document.querySelector(".results");
  box.classList.add("loading");
  const ask = (region) => getJSON(`/api/investigate?variable=${state.variable}&region=${encodeURIComponent(region)}&start=${state.start}&end=${state.end}`);
  let a, b = null;
  try {
    [a, b] = await Promise.all([ask(state.region), state.compare ? ask(state.compare) : null]);
  } catch (error) {
    if (id !== requestId) return;
    results = { a: null, b: null };
    box.classList.remove("loading");
    box.classList.add("has-error");
    $("verdict").replaceChildren(el("div", { class: "error" },
      el("strong", { text: "This combination cannot be analysed. " }), error.message,
      " Choose another variable or region."));
    return;
  }
  if (id !== requestId) return;
  results = { a, b };
  box.classList.remove("loading", "has-error");
  const trigger = $("pick-variable");
  trigger.querySelector(".record-glyph")?.remove();
  trigger.insertBefore(recordOf(a), trigger.querySelector(".combo-value"));
  $("verdict").replaceChildren(...(b ? [verdictBlock(a, "a"), verdictBlock(b, "b"), comparisonLine(a, b)] : [verdictBlock(a)]));
  $("stats").replaceChildren(...(b ? [] : [statsRow(a)]));
  pointNote(a);
  renderSeries(a, b);
  const conf = (r) => `${r.significant ? "significant" : "n.s."}, ${pEq(r.tests.mann_kendall.p)}`;
  $("numbers-gist").textContent = b ? `${a.region.name}: ${a.significant ? "sig." : "n.s."} · ${b.region.name}: ${b.significant ? "sig." : "n.s."}` : conf(a);
  $("numbers-body").replaceChildren(...(b
    ? [el("h3", { class: "sub" }, el("i", { class: "key series-1" }), a.region.name), ...evidenceCard(a),
       el("h3", { class: "sub" }, el("i", { class: "key series-2" }), b.region.name), ...evidenceCard(b)]
    : evidenceCard(a)));
  $("why-body").replaceChildren(...whyCard(a));
  showRegionsOnMap(a, b, frame);
  renderScan(id);
}

/* ---------- start ---------- */

async function main() {
  if (PREVIEW) $("theme-toggle").hidden = true; // the host page sets the theme
  else initTheme($("theme-toggle"));
  $("ask").addEventListener("submit", (event) => event.preventDefault());

  [cat, maps] = await Promise.all([getJSON("/api/catalogue"), getJSON("maps/index.json").catch(() => null), canary.ready]);
  readHash();
  if (!cat.variables.some((v) => v.id === state.variable)) state.variable = "temperature";
  buildQuery();
  $("open-guide").addEventListener("click", openGuide);
  $("year-start").addEventListener("change", (e) => { state.start = Number(e.target.value); frameNext = false; update(); });
  $("year-end").addEventListener("change", (e) => { state.end = Number(e.target.value); frameNext = false; update(); });
  $("picker").addEventListener("click", (e) => { if (e.target === $("picker")) $("picker").close(); });
  window.addEventListener("canary-pane", (e) => { if (e.detail === "trend") writeHash(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawing) stopDrawing(); });

  registerCommands();
  bindKeys();
  $("open-search").addEventListener("click", () => openPalette());
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
    const modes = { 1: "trends", 2: "weather", 3: "satellite" };
    if (modes[e.key]) canary.setMode(modes[e.key]);
    else if (e.key === "d" || e.key === "D") document.getElementById("toggle-3d")?.click();
    else if (e.key === "?") openShortcuts();
  });

  attachMap();
  initLive(canary);
  getJSON("/api/countries").then((geo) => map.getSource("countries").setData(geo)).catch(() => {});
  canary.setTrend(state.variable, { keepSpin: true });
  await update();
}

window.canaryStart = { state, update, playDemo, DEMOS, openGuide };
main().catch((error) => {
  $("verdict").replaceChildren(el("div", { class: "error" }, el("strong", { text: "Canary could not start. " }), error.message));
});
