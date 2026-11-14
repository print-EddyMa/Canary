/* The start page: pick a variable and a region, and get a verdict.
   Answers the four questions of a trend detective: what is changing, where,
   how much, and is it significant. */

import { compareChart, lineChart, sparkline } from "./charts.js";
import { el, fixed, getJSON, sig, statusIcon, thousands } from "./util.js";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const WORLD = [[-180, 85.051129], [180, 85.051129], [180, -85.051129], [-180, -85.051129]];
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FIRST_YEAR = 1981, LAST_YEAR = 2025, MIN_SPAN = 15;
const SERIES = ["#3987e5", "#d95926"];

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
let map = null;
let results = { a: null, b: null };
let requestId = 0;
let pickingFor = "region"; // which region a click on the map sets
let drawing = null; // {corner} while a box is being drawn
let tour = null;

const $ = (id) => document.getElementById(id);
const variable = () => cat.variables.find((v) => v.id === state.variable);
const signedFix = (x, d) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}`;
const digits = (x) => (x === 0 ? 0 : Math.max(0, Math.min(4, 1 - Math.floor(Math.log10(Math.abs(x))))));

function regionName(id) {
  if (id === "world") return "the whole world";
  const all = [...cat.regions.presets, ...cat.regions.continents, ...cat.regions.countries];
  const hit = all.find((r) => r.id === id);
  if (hit) return hit.name.replace(/^The /, "the ");
  if (id.startsWith("box:")) return "the drawn box";
  return id;
}

/* ---------- URL ---------- */

function writeHash() {
  if ($("start").hidden) return; // Explore mode owns the address while it is showing
  const parts = ["investigate", state.variable, state.region, `${state.start}-${state.end}`];
  if (state.compare) parts.push("vs", state.compare);
  history.replaceState(null, "", `#${parts.join("/")}`);
}

function readHash() {
  const parts = decodeURIComponent(location.hash.slice(1)).split("/");
  if (parts[0] !== "investigate" || parts.length < 4) return;
  const [from, to] = parts[3].split("-").map(Number);
  Object.assign(state, { variable: parts[1], region: parts[2] });
  if (from >= FIRST_YEAR && to <= LAST_YEAR && to - from + 1 >= MIN_SPAN) Object.assign(state, { start: from, end: to });
  state.compare = parts[4] === "vs" && parts[5] ? parts[5] : null;
}

/* ---------- the sentence ---------- */

function renderSentence() {
  const v = variable();
  $("pick-variable").textContent = v.label.toLowerCase();
  $("pick-region").textContent = regionName(state.region);
  $("definition").replaceChildren(
    el("strong", { text: `${v.label}: ` }), `${v.definition} `,
    el("span", { class: "muted", text: `Measured in ${v.unit}. ${v.source}, from ${v.record_from}.` }));
  const compareBox = $("compare-slot");
  if (state.compare) {
    compareBox.replaceChildren(" compared with ",
      el("button", { type: "button", class: "slot slot-b", text: regionName(state.compare), onclick: () => openRegions("compare") }),
      el("button", { type: "button", class: "slot-x", "aria-label": "Stop comparing", text: "×",
        onclick: () => { state.compare = null; update(); } }));
    $("add-compare").hidden = true;
  } else {
    compareBox.replaceChildren();
    $("add-compare").hidden = false;
  }
  for (const [id, lo, hi] of [["year-start", FIRST_YEAR, LAST_YEAR - MIN_SPAN + 1], ["year-end", FIRST_YEAR + MIN_SPAN - 1, LAST_YEAR]]) {
    const select = $(id);
    if (!select.options.length) for (let y = lo; y <= hi; y++) select.append(el("option", { value: y, text: y }));
    // Some records start later (satellite radiation data begin in 2001): grey out years before that.
    for (const option of select.options) option.disabled = id === "year-start" && Number(option.value) < v.record_from;
    select.value = id === "year-start" ? Math.max(state.start, Math.min(v.record_from, hi)) : state.end;
  }
}

/* ---------- verdict ---------- */

function verdictCard(r, key) {
  const up = r.trend.direction === "rising";
  const icon = el("span", { class: "verdict-arrow", "aria-hidden": "true",
    text: !r.significant ? "≈" : up ? "↗" : "↘" });
  return el("article", { class: `verdict ${r.significant ? "is-significant" : "not-significant"}${key ? ` key-${key}` : ""}` },
    icon,
    el("div", {},
      key ? el("p", { class: "verdict-region" }, el("i", { class: `key series-${key === "a" ? 1 : 2}` }), r.region.name) : null,
      el("h2", { class: "verdict-headline", text: r.headline }),
      el("p", { class: "verdict-detail", text: r.detail }),
      el("p", { class: "chips" },
        el("span", { class: "chip" }, statusIcon(r.significant ? "watch" : "stable"), r.significant ? "Significant" : "Not significant"),
        el("span", { class: "chip", text: `Mann-Kendall ${pEq(r.tests.mann_kendall.p)}` }),
        el("span", { class: "chip", text: `t-test ${pEq(r.tests.t_test.p)}` }),
        el("span", { class: "chip", text: `${r.tests.years} years, ${r.period[0]}–${r.period[1]}` }))));
}

const pShort = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const pEq = (p) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
/** A region's name as it reads mid-sentence: "the Arctic", "Kenya". */
const nm = (r) => r.region.name.replace(/^The /, "the ");

function comparisonLine(a, b) {
  const dir = (r) => (r.trend.direction === "rising" ? "rising" : "falling");
  const both = a.significant && b.significant;
  let text;
  if (both && dir(a) !== dir(b)) {
    text = `Opposite trends. ${a.variable.label} is ${dir(a)} in ${nm(a)} and ${dir(b)} in ${nm(b)}, and both `
      + "are significant. The same variable can move in opposite directions in two places, sometimes for the same underlying reason.";
  } else if (both) {
    const ratio = Math.abs(a.trend.per_decade) / Math.abs(b.trend.per_decade || 1);
    const faster = ratio >= 1 ? a : b;
    text = `Same direction. Both are ${dir(a)} and significant; ${nm(faster)} is changing `
      + `${sig(Math.max(ratio, 1 / ratio))} times as fast.`;
  } else if (a.significant !== b.significant) {
    const yes = a.significant ? a : b, no = a.significant ? b : a;
    text = `Only ${nm(yes)} shows a significant trend. In ${nm(no)} the change could be chance.`;
  } else {
    text = "Neither region shows a significant trend over this period.";
  }
  return el("p", { class: "comparison", text });
}

/* ---------- cards ---------- */

function seriesCard(a, b) {
  const v = a.variable;
  const body = [];
  if (!b) {
    body.push(el("div", { class: "legend" },
      el("span", {}, el("i"), `Yearly average, ${nm(a)}`),
      el("span", {}, el("i", { class: "trend" }), a.significant ? "Trend" : "Trend (not significant)")));
    body.push(lineChart({
      x: a.years, y: a.values, width: 600, height: 250,
      fit: [{ x: a.period[0], y: a.trend.line[0] }, { x: a.period[1], y: a.trend.line[1] }],
      fitStrong: a.significant,
      label: `${v.label} in ${nm(a)}, yearly averages ${a.period[0]} to ${a.period[1]}, with trend line`,
      rows: (i) => [String(a.years[i]), `${fixed(a.values[i], v.decimals)} ${v.unit}`,
        `${signedFix(a.values[i] - a.normal, v.decimals)} against the 1991–2020 average`],
    }));
    body.push(el("p", { class: "plot-caption",
      text: `Each point is one year, averaged over ${thousands(a.region.cells)} grid cells and weighted by their area. `
        + `The straight line is the Theil-Sen trend. Unit: ${v.unit}.` }));
  } else {
    const prep = (r) => ({
      name: r.region.name, x: r.years, y: r.values.map((val) => (val == null ? null : val - r.normal)),
      fit: [{ x: r.period[0], y: r.trend.line[0] - r.normal }, { x: r.period[1], y: r.trend.line[1] - r.normal }],
      strong: r.significant,
    });
    body.push(el("div", { class: "legend" },
      el("span", {}, el("i", { class: "key series-1" }), a.region.name),
      el("span", {}, el("i", { class: "key series-2" }), b.region.name)));
    body.push(compareChart({ series: [prep(a), prep(b)], unit: v.unit, decimals: v.decimals,
      label: `${v.label}: ${a.region.name} and ${b.region.name}, each as the difference from its own 1991 to 2020 average` }));
    body.push(el("p", { class: "plot-caption",
      text: `Each region is shown as its difference from its own 1991–2020 average, so that places with different climates share one axis. Unit: ${v.unit}.` }));
  }
  body.push(tableDetails(a, b));
  return body;
}

function tableDetails(a, b) {
  const v = a.variable;
  const details = el("details", {}, el("summary", { text: "Data table" }));
  details.addEventListener("toggle", () => {
    if (!details.open || details.querySelector("table")) return;
    const table = el("table", {}, el("tr", {}, el("th", { text: "Year" }),
      el("th", { text: `${a.region.name} (${v.unit})` }), b ? el("th", { text: `${b.region.name} (${v.unit})` }) : null));
    a.years.forEach((year, i) => table.append(el("tr", {}, el("td", { text: year }),
      el("td", { text: a.values[i] == null ? "" : fixed(a.values[i], v.decimals) }),
      b ? el("td", { text: b.values[b.years.indexOf(year)] == null ? "" : fixed(b.values[b.years.indexOf(year)], v.decimals) }) : null)));
    details.append(el("div", { class: "table-scroll" }, table),
      el("button", { type: "button", class: "ghost", text: "Download as CSV", onclick: () => downloadCsv(a, b) }));
  });
  return details;
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

function tile(label, value, note) {
  return el("div", { class: "stat" }, el("div", { class: "stat-label", text: label }),
    el("div", { class: "stat-value", text: value }), note ? el("div", { class: "stat-note", text: note }) : null);
}

function evidenceCard(r) {
  const v = r.variable, t = r.trend, mk = r.tests.mann_kendall, tt = r.tests.t_test;
  const d = digits(t.per_decade);
  const rows = [
    ["Mann-Kendall", `Counts how often later years are higher than earlier ones. Kendall τ = ${signedFix(mk.tau, 2)}.`, pShort(mk.p)],
    ["t-test on the slope", `Fits a straight line by least squares: ${signedFix(tt.per_decade, d)} ${v.unit} per decade.`, pShort(tt.p)],
  ];
  return [
    el("div", { class: "stats four" },
      tile("Rate of change", `${signedFix(t.per_decade, d)}`, `${v.unit} per decade`),
      tile("95% range", `${signedFix(t.range_per_decade[0], d)} to ${signedFix(t.range_per_decade[1], d)}`, "where the true rate very likely lies"),
      tile(`Total since ${r.period[0]}`, `${signedFix(t.total_change, digits(t.total_change))}`,
        t.percent_change == null ? v.unit : `${v.unit} (${signedFix(t.percent_change, 0)}%)`),
      tile("Against normal swings", t.signal_to_noise == null ? "n/a" : `${t.signal_to_noise.toFixed(1)}×`,
        t.signal_to_noise >= 1 ? "bigger than a usual year-to-year swing" : "smaller than a usual year-to-year swing")),
    el("table", { class: "tests" },
      el("tr", {}, el("th", { text: "Test" }), el("th", { text: "What it does" }), el("th", { text: "p-value" })),
      ...rows.map(([name, what, p]) => el("tr", {}, el("td", { text: name }), el("td", { text: what }), el("td", { text: p })))),
    el("p", { class: "plot-caption", text:
      `A p-value below 0.05 is the usual line for “significant”. The two tests ${r.tests.agree ? "agree" : "disagree, so treat the verdict with care"}. `
      + (mk.variance_inflation > 1.05 ? `Years are not independent of each other here, so the uncertainty was widened ${mk.variance_inflation.toFixed(1)} times before testing. ` : "")
      + `Source: ${v.source}, parameter ${v.parameter}.` }),
  ];
}

function whyCard(r) {
  const v = r.variable;
  const items = [];
  if (r.split) {
    const s = r.split;
    items.push(el("li", {}, el("strong", { text: "Inside the region: " }),
      `${fixed(s.rising_percent, 0)}% of the area has a significant rise, ${fixed(s.falling_percent, 0)}% a significant fall, `
      + `and ${fixed(s.unclear_percent, 0)}% no clear trend. `
      + (s.rising_percent > 10 && s.falling_percent > 10 ? "The average hides opposite trends: look at the map." : "")));
  }
  const world = maps && maps.layers.find((l) => l.id === v.id);
  if (world && r.region.kind !== "world") {
    const w = world.mean_trend_per_decade;
    items.push(el("li", {}, el("strong", { text: "Against the world: " }),
      `the mapped world as a whole is changing by ${signedFix(w, digits(w))} ${v.unit} per decade; `
      + `this region by ${signedFix(r.trend.per_decade, digits(r.trend.per_decade))}.`));
  }
  for (const link of r.links.slice(0, 2)) {
    items.push(el("li", {}, el("strong", { text: `${link.name}: ` }),
      `the region's ups and downs from year to year follow it (correlation ${signedFix(link.r, 2)}, about ${link.share_of_swings_percent}% of the swings). `
      + "That explains good and bad years, not the long-term trend."));
  }
  if (!r.links.length) {
    items.push(el("li", {}, el("strong", { text: "Climate rhythms: " }),
      "the yearly ups and downs here do not follow El Niño or the four other ocean and pressure rhythms tested."));
  }
  if (v.caution) items.push(el("li", {}, el("strong", { text: "Caution: " }), v.caution));
  items.push(el("li", {}, el("strong", { text: "Remember: " }),
    "a significant trend says that something is changing, not why. The cause has to be argued from other evidence."));
  const centre = r.region.bounds && r.region.kind !== "world"
    ? [(r.region.bounds[0] + r.region.bounds[2]) / 2, (r.region.bounds[1] + r.region.bounds[3]) / 2] : null;
  const out = [el("ul", { class: "why" }, ...items)];
  if (centre) {
    out.push(el("button", { type: "button", class: "ghost", text: "Have the detective investigate a place in this region",
      onclick: () => openExplore({ lat: centre[0], lon: centre[1], name: `Centre of ${nm(r)}`, tab: "case" }) }));
  }
  return out;
}

async function renderScan(id) {
  const box = $("scan-body");
  $("scan-title").textContent = `What else is changing in ${regionName(state.region)}?`;
  box.replaceChildren(el("p", { class: "loading-note", text: "Testing every variable…" }));
  let data;
  try {
    data = await getJSON(`/api/scan?region=${encodeURIComponent(state.region)}&start=${state.start}&end=${state.end}`);
  } catch (error) {
    if (id === requestId) box.replaceChildren(el("p", { class: "plot-caption", text: `The scan could not run: ${error.message}` }));
    return;
  }
  if (id !== requestId) return;
  const top = Math.max(...data.variables.map((r) => r.signal_to_noise || 0), 1);
  const rows = data.variables.map((r) => {
    const arrow = !r.significant ? "≈" : r.direction === "rising" ? "↗" : "↘";
    return el("tr", { class: r.id === state.variable ? "current" : "" },
      el("td", {}, el("button", { type: "button", class: "link", text: r.label,
        onclick: () => { state.variable = r.id; update(); window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? "auto" : "smooth" }); } })),
      el("td", { class: "num", text: `${arrow} ${signedFix(r.per_decade, digits(r.per_decade))} ${r.unit}` }),
      el("td", {}, el("span", { class: "meter", role: "img", "aria-label": `${(r.signal_to_noise || 0).toFixed(1)} times the usual swing` },
        el("i", { style: `width:${Math.round(100 * (r.signal_to_noise || 0) / top)}%` }))),
      el("td", {}, el("span", { class: "chip" }, statusIcon(r.significant ? "watch" : "stable"), r.significant ? "Significant" : "Not significant")));
  });
  const table = el("table", { class: "scan" },
    el("tr", {}, el("th", { text: "Variable" }), el("th", { class: "num", text: "Change per decade" }),
      el("th", { text: "Size against normal swings" }), el("th", { text: "Verdict" })), ...rows);
  box.replaceChildren(
    el("p", { class: "plot-caption", text:
      `${data.significant} of ${data.tested} variables show a significant trend here. Testing many at once invites flukes, so these verdicts `
      + "use a stricter test (false-discovery control) than a single investigation. Click a variable to investigate it."
      + (data.still_loading.length ? ` ${data.still_loading.length} more are still being fetched from NASA.` : "") }),
    el("div", { class: "table-wrap" }, table));
}

/* ---------- map ---------- */

function initMap() {
  map = new maplibregl.Map({
    container: "start-map", center: [10, 25], zoom: 0.9, maxZoom: 6, attributionControl: { compact: true },
    dragRotate: false,
    style: {
      version: 8,
      projection: { type: "globe" },
      sky: { "atmosphere-blend": 0.6 },
      sources: {
        base: { type: "raster", tileSize: 256, maxzoom: 8, attribution: "Imagery: NASA GIBS",
          tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`] },
        countries: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        shapes: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      },
      layers: [
        { id: "space", type: "background", paint: { "background-color": "#0d0d0d" } },
        { id: "base", type: "raster", source: "base", paint: { "raster-saturation": -0.8, "raster-brightness-max": 0.42 } },
        { id: "country-hit", type: "fill", source: "countries", paint: { "fill-color": "#ffffff", "fill-opacity": 0 } },
        { id: "country-lines", type: "line", source: "countries", paint: { "line-color": "rgba(240,239,236,0.35)", "line-width": 0.6 } },
        { id: "country-hover", type: "line", source: "countries", filter: ["==", ["get", "code"], ""],
          paint: { "line-color": "#f0efec", "line-width": 1.5 } },
        { id: "sel-a", type: "line", source: "countries", filter: ["==", ["get", "code"], ""],
          paint: { "line-color": SERIES[0], "line-width": 2.5 } },
        { id: "sel-b", type: "line", source: "countries", filter: ["==", ["get", "code"], ""],
          paint: { "line-color": SERIES[1], "line-width": 2.5 } },
        { id: "shapes", type: "line", source: "shapes",
          paint: { "line-color": ["match", ["get", "key"], "b", SERIES[1], "draw", "#f0efec", SERIES[0]], "line-width": 2.5 } },
      ],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: "country-tip" });
  map.on("mousemove", "country-hit", (e) => {
    if (drawing) return;
    const p = e.features[0].properties;
    map.getCanvas().style.cursor = "pointer";
    map.setFilter("country-hover", ["==", ["get", "code"], p.code]);
    tip.setLngLat(e.lngLat).setText(p.name).addTo(map);
  });
  map.on("mouseleave", "country-hit", () => {
    map.getCanvas().style.cursor = drawing ? "crosshair" : "";
    map.setFilter("country-hover", ["==", ["get", "code"], ""]);
    tip.remove();
  });
  map.on("mousemove", (e) => {
    if (drawing && drawing.corner) drawShapes([boxFeature(drawing.corner, e.lngLat, "draw")]);
  });
  map.on("click", (e) => {
    if (drawing) {
      if (!drawing.corner) { drawing.corner = e.lngLat; return; }
      const a = drawing.corner, b = e.lngLat;
      const target = drawing.target;
      stopDrawing();
      const id = `box:${Math.min(a.lat, b.lat).toFixed(1)},${Math.min(a.lng, b.lng).toFixed(1)},${Math.max(a.lat, b.lat).toFixed(1)},${Math.max(a.lng, b.lng).toFixed(1)}`;
      setRegion(target, id);
      return;
    }
    const hit = map.queryRenderedFeatures(e.point, { layers: ["country-hit"] })[0];
    if (hit) setRegion(state.compare ? pickingFor : "region", `country:${hit.properties.code}`);
  });
  return new Promise((resolve) => map.on("load", resolve));
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
  drawing = { target, corner: null };
  map.getCanvas().style.cursor = "crosshair";
  $("map-hint").textContent = "Click two opposite corners of the box on the map.";
  $("card-map").scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
}

function stopDrawing() {
  drawing = null;
  map.getCanvas().style.cursor = "";
  drawShapes();
  $("map-hint").textContent = "Click a country to investigate it, or draw a box.";
}

function setRegion(target, id) {
  if (target === "compare") state.compare = id; else state.region = id;
  update();
}

function showRegionsOnMap(a, b) {
  const filterFor = (r) => {
    if (!r) return ["==", ["get", "code"], ""];
    if (r.region.kind === "country") return ["==", ["get", "code"], r.region.id.split(":")[1]];
    if (r.region.kind === "continent") return ["==", ["get", "continent"], r.region.name];
    return ["==", ["get", "code"], ""];
  };
  map.setFilter("sel-a", filterFor(a));
  map.setFilter("sel-b", filterFor(b));
  regionShapes = [];
  for (const [r, key] of [[a, "a"], [b, "b"]]) {
    if (r && (r.region.kind === "preset" || r.region.kind === "box")) {
      const [s, w, n, e] = r.region.bounds;
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

  // Trend map for this variable.
  const layer = maps && maps.layers.find((l) => l.id === state.variable);
  if (map.getLayer("trend")) map.removeLayer("trend");
  if (map.getSource("trend")) map.removeSource("trend");
  if (layer) {
    map.addSource("trend", { type: "image", url: layer.image, coordinates: WORLD });
    map.addLayer({ id: "trend", type: "raster", source: "trend",
      paint: { "raster-opacity": 0.9, "raster-fade-duration": 0, "raster-resampling": "nearest" } }, "country-hit");
  }

  // Frame the regions.
  const boxes = [a, b].filter((r) => r && r.region.bounds && r.region.kind !== "world").map((r) => r.region.bounds);
  if (!boxes.length) { map.easeTo({ center: [10, 25], zoom: 0.9, duration: 900 }); return; }
  const s = Math.min(...boxes.map((x) => x[0])), n = Math.max(...boxes.map((x) => x[2]));
  const w = Math.min(...boxes.map((x) => x[1])), e = Math.max(...boxes.map((x) => x[3]));
  const span = Math.max(n - s, (e - w) * 0.6, 8);
  const centreLon = e - w > 300 ? 10 : (w + e) / 2;
  map.easeTo({ center: [centreLon, Math.max(-70, Math.min(70, (s + n) / 2))],
    zoom: Math.max(0.6, Math.min(4.2, Math.log2(170 / span) + 0.6)), duration: 1100 });
}

function mapLegend(a) {
  const layer = maps && maps.layers.find((l) => l.id === state.variable);
  if (!layer) return [];
  const { blue_arm: blue, red_arm: red } = maps.colors;
  const negative = layer.red_when_rising ? blue : red, positive = layer.red_when_rising ? red : blue;
  const partial = a.period[0] !== layer.period[0] || a.period[1] !== layer.period[1];
  return [
    el("div", { class: "ramp", style: `background:linear-gradient(90deg, ${[...negative].reverse().concat(positive.slice(1)).join(", ")})` }),
    el("div", { class: "ramp-labels" },
      el("span", { text: `falling ${sig(layer.scale_max)} or more` }), el("span", { text: "no change" }),
      el("span", { text: `rising ${sig(layer.scale_max)} ${layer.unit} per decade or more` })),
    el("p", { class: "plot-caption", text:
      `Change per decade in every grid cell, ${layer.period[0]}–${layer.period[1]}. Bright cells have a significant trend; faint cells could be chance. `
      + `Across the mapped world, ${fixed(layer.percent_rising, 0)}% of the area has a significant rise and ${fixed(layer.percent_falling, 0)}% a significant fall.`
      + (partial ? " The map always shows the full record, whatever years you choose above." : "") }),
  ];
}

/* ---------- pickers ---------- */

function openDialog(title, body) {
  const dialog = $("picker");
  dialog.replaceChildren(
    el("div", { class: "dialog-head" }, el("h2", { text: title }),
      el("button", { type: "button", class: "slot-x", "aria-label": "Close", text: "×", onclick: () => dialog.close() })),
    el("div", { class: "dialog-body" }, ...body));
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function openVariables() {
  const search = el("input", { type: "search", placeholder: "Search variables", "aria-label": "Search variables" });
  const list = el("div", { class: "pick-list" });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren(...cat.themes.flatMap((theme) => {
      const vars = cat.variables.filter((v) => v.theme === theme.id
        && (!q || `${v.label} ${v.definition}`.toLowerCase().includes(q)));
      if (!vars.length) return [];
      return [el("h3", {}, theme.name, el("small", { text: ` ${theme.about}` })),
        ...vars.map((v) => el("button", { type: "button", class: `pick${v.id === state.variable ? " current" : ""}`,
          onclick: () => { state.variable = v.id; $("picker").close(); update(); } },
          el("strong", { text: v.label }), el("span", { text: v.definition }),
          el("small", { text: `${v.unit} · from ${v.record_from}` })))];
    }));
  };
  search.addEventListener("input", draw);
  draw();
  openDialog("Choose a variable", [search, list]);
  search.focus();
}

function openRegions(target) {
  pickingFor = target;
  const search = el("input", { type: "search", placeholder: "Search countries and regions", "aria-label": "Search regions" });
  const list = el("div", { class: "pick-list" });
  const choose = (id) => { $("picker").close(); setRegion(target, id); };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const match = (r) => !q || r.name.toLowerCase().includes(q);
    const group = (title, rows) => (rows.length ? [el("h3", { text: title }),
      el("div", { class: "pick-grid" }, ...rows.map((r) => el("button", { type: "button", class: "pick small", title: r.about || "",
        onclick: () => choose(r.id) }, el("strong", { text: r.name }), r.about ? el("span", { text: r.about }) : null)))] : []);
    list.replaceChildren(
      ...(q ? [] : [el("div", { class: "pick-grid" },
        el("button", { type: "button", class: "pick small", onclick: () => choose("world") },
          el("strong", { text: "The whole world" }), el("span", { text: "Every grid cell on Earth." })),
        el("button", { type: "button", class: "pick small", onclick: () => { $("picker").close(); startDrawing(target); } },
          el("strong", { text: "Draw a box on the map" }), el("span", { text: "Any rectangle of at least 1 degree." })))]),
      ...group("Named regions", cat.regions.presets.filter(match)),
      ...group("Continents", cat.regions.continents.filter(match)),
      ...group("Countries", cat.regions.countries.filter(match)));
  };
  search.addEventListener("input", draw);
  draw();
  openDialog(target === "compare" ? "Compare with which region?" : "Choose a region", [search, list]);
  search.focus();
}

function openGuide() {
  const answers = { interest: null, place: null };
  const step = (n) => {
    if (n === 1) {
      openDialog("1 of 3. What are you curious about?", [el("div", { class: "pick-grid" },
        ...cat.interests.map((i) => el("button", { type: "button", class: "pick small",
          onclick: () => { answers.interest = i.id; step(2); } }, el("strong", { text: i.question }))))]);
    } else if (n === 2) {
      openDialog("2 of 3. What kind of place?", [el("div", { class: "pick-grid" },
        ...cat.place_kinds.map((k) => el("button", { type: "button", class: "pick small",
          onclick: () => { answers.place = k.id; step(3); } }, el("strong", { text: k.name }))),
        el("button", { type: "button", class: "pick small", onclick: () => { answers.place = null; step(3); } },
          el("strong", { text: "No particular kind" })))]);
    } else {
      getJSON(`/api/suggest?interest=${answers.interest}${answers.place ? `&place=${answers.place}` : ""}`).then((picks) => {
        openDialog("3 of 3. Start with one of these", [
          el("p", { class: "plot-caption", text: "Pick a variable. You can choose the exact place next, or click it on the map." }),
          el("div", { class: "pick-list" }, ...picks.map((p) => el("button", { type: "button", class: "pick",
            onclick: () => { state.variable = p.id; $("picker").close(); update(); openRegions("region"); } },
            el("strong", { text: p.label }), el("span", { text: p.definition }), el("small", { text: p.why }))))]);
      });
    }
  };
  step(1);
}

/* ---------- demos: watch a case ---------- */

function tourSteps(demo, a, b) {
  const v = a.variable;
  const steps = [
    { target: "ask", text: `Step 1: choose what and where. Here: ${v.label.toLowerCase()} in ${nm(a)}${b ? `, compared with ${nm(b)}` : ""}.` },
    { target: "card-series", text: b
      ? "Step 2: look at the record. Each line is one region, shown against its own normal so that they share an axis."
      : `Step 2: look at the record. Each point is one year's average for the whole region. The straight line is the trend.` },
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
  steps.push({ target: "card-map", text: "Then ask where. The map shows the trend in every grid cell: bright where it is significant, faint where it could be chance." });
  steps.push({ target: "card-why", text: "Last, ask why. A trend says something is changing, not what causes it. Now try your own: change the variable or click a country." });
  return steps;
}

async function playDemo(demo) {
  endTour();
  Object.assign(state, { start: FIRST_YEAR, end: LAST_YEAR }, demo.state);
  await update();
  if (!results.a) return;
  const steps = tourSteps(demo, results.a, results.b);
  const bar = $("tour");
  let index = 0, timer = null, paused = false;
  const show = () => {
    document.querySelectorAll(".tour-focus").forEach((n) => n.classList.remove("tour-focus"));
    const s = steps[index];
    const target = $(s.target);
    target.classList.add("tour-focus");
    target.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
    bar.replaceChildren(
      el("div", { class: "tour-text" }, el("strong", { text: `${demo.title} · ${index + 1} of ${steps.length}` }), el("p", { text: s.text })),
      el("div", { class: "tour-actions" },
        el("button", { type: "button", class: "ghost", text: paused ? "Resume" : "Pause",
          onclick: () => { paused = !paused; show(); } }),
        el("button", { type: "button", class: "ghost", text: index === steps.length - 1 ? "Finish" : "Next",
          onclick: () => next() }),
        el("button", { type: "button", class: "slot-x", "aria-label": "Close the walkthrough", text: "×", onclick: endTour })));
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

/* ---------- events strip ---------- */

async function renderStrip() {
  const box = $("strip-body");
  try {
    const data = await getJSON("/api/briefing?ai=false");
    const tiles = data.planet.map((t) => el("div", { class: "strip-card planet" },
      el("div", { class: "stat-label", text: t.label }),
      el("div", { class: "planet-row" },
        el("div", { class: "stat-value" }, `${t.signed && t.value > 0 ? "+" : ""}${fixed(t.value, Math.abs(t.value) >= 100 ? 1 : 2)}`,
          el("small", { text: ` ${t.unit}` })),
        sparkline(t.series.x, t.series.y, `${t.label} over time`)),
      el("div", { class: "stat-note", text: `${t.when}: ${t.note}` })));
    const events = data.events.slice(0, 8).map((e) => el("div", { class: "strip-card" },
      el("div", { class: "strip-kind" }, el("span", { class: `event-dot kind-${e.kind}` }), `${e.kind_label} · ${e.level}`),
      el("strong", { text: e.title }),
      el("div", { class: "stat-note", text: e.size }),
      el("span", { class: "meter", role: "img", "aria-label": `Severity ${Math.round(e.severity * 100)} out of 100` },
        el("i", { style: `width:${Math.max(4, Math.round(e.severity * 100))}%` })),
      el("button", { type: "button", class: "ghost", text: "Investigate this place",
        onclick: () => openExplore({ lat: e.lat, lon: e.lon, name: e.title, tab: "case" }) })));
    box.replaceChildren(...tiles, ...events);
    $("strip-note").textContent = `${data.event_total} natural events are being tracked (NASA EONET, USGS). `
      + "Events are ranked by physical size, not harm. An event is not a trend: one storm says nothing about whether storms are changing.";
  } catch (error) {
    box.replaceChildren(el("p", { class: "plot-caption", text: `Live events could not load: ${error.message}` }));
  }
}

/* ---------- update ---------- */

async function update() {
  const id = ++requestId;
  if (state.end - state.start + 1 < MIN_SPAN) state.end = Math.min(LAST_YEAR, state.start + MIN_SPAN - 1);
  if (state.compare === state.region) state.compare = null;
  renderSentence();
  writeHash();
  document.querySelector(".results").classList.add("loading");
  const ask = (region) => getJSON(`/api/investigate?variable=${state.variable}&region=${encodeURIComponent(region)}&start=${state.start}&end=${state.end}`);
  let a, b = null;
  try {
    [a, b] = await Promise.all([ask(state.region), state.compare ? ask(state.compare) : null]);
  } catch (error) {
    if (id !== requestId) return;
    results = { a: null, b: null };
    document.querySelector(".results").classList.remove("loading");
    $("verdict").replaceChildren(el("div", { class: "error" },
      el("strong", { text: "This combination cannot be analysed. " }), error.message,
      " Try another variable or region."));
    return;
  }
  if (id !== requestId) return;
  results = { a, b };
  document.querySelector(".results").classList.remove("loading");
  $("verdict").replaceChildren(...(b ? [el("div", { class: "verdict-pair" }, verdictCard(a, "a"), verdictCard(b, "b")), comparisonLine(a, b)]
    : [verdictCard(a)]));
  $("series-body").replaceChildren(...seriesCard(a, b));
  $("numbers-body").replaceChildren(...(b
    ? [el("h3", { class: "sub" }, el("i", { class: "key series-1" }), a.region.name), ...evidenceCard(a),
       el("h3", { class: "sub" }, el("i", { class: "key series-2" }), b.region.name), ...evidenceCard(b)]
    : evidenceCard(a)));
  $("why-body").replaceChildren(...whyCard(a));
  $("map-legend").replaceChildren(...mapLegend(a));
  showRegionsOnMap(a, b);
  renderScan(id);
}

/* ---------- Explore mode ---------- */

let exploreLoaded = null;

async function openExplore(place) {
  endTour();
  $("start").hidden = true;
  $("explore").hidden = false;
  document.documentElement.classList.add("exploring");
  if (!exploreLoaded) {
    if (!place) history.replaceState(null, "", "#explore");
    exploreLoaded = import("./app.js");
  }
  await exploreLoaded;
  await window.canary.ready;
  window.canary.map.resize();
  if (place) window.canary.select(place.lat, place.lon, place.name, { tab: place.tab });
  else if (!/^#-?\d/.test(location.hash)) history.replaceState(null, "", "#explore");
}

function openStart() {
  $("explore").hidden = true;
  $("start").hidden = false;
  document.documentElement.classList.remove("exploring");
  writeHash();
  if (map) map.resize();
}

/* ---------- start ---------- */

async function main() {
  $("go-explore").addEventListener("click", () => openExplore());
  $("to-start").addEventListener("click", openStart);
  const hash = location.hash;
  const wantsExplore = hash === "#explore" || /^#-?\d/.test(hash);

  [cat, maps] = await Promise.all([getJSON("/api/catalogue"), getJSON("maps/index.json").catch(() => null)]);
  readHash();
  if (!cat.variables.some((v) => v.id === state.variable)) state.variable = "temperature";

  $("pick-variable").addEventListener("click", openVariables);
  $("pick-region").addEventListener("click", () => openRegions("region"));
  $("add-compare").addEventListener("click", () => openRegions("compare"));
  $("open-guide").addEventListener("click", openGuide);
  $("draw-box").addEventListener("click", () => startDrawing(state.compare ? pickingFor : "region"));
  $("year-start").addEventListener("change", (e) => { state.start = Number(e.target.value); update(); });
  $("year-end").addEventListener("change", (e) => { state.end = Number(e.target.value); update(); });
  $("picker").addEventListener("click", (e) => { if (e.target === $("picker")) $("picker").close(); });
  $("demo-list").replaceChildren(...DEMOS.map((d) => el("article", { class: "card demo" },
    el("h3", { text: d.title }), el("p", { text: d.blurb }),
    el("button", { type: "button", class: "primary", text: "Watch (1 minute)", onclick: () => playDemo(d) }))));

  await initMap();
  getJSON("/api/countries").then((geo) => map.getSource("countries").setData(geo)).catch(() => {});
  renderStrip();
  if (wantsExplore) {
    renderSentence();
    openExplore();
    update();
  } else {
    update();
  }
}

main().catch((error) => {
  document.querySelector(".results").replaceChildren(
    el("div", { class: "error", text: `Canary could not start: ${error.message}` }));
});

window.canaryStart = { state, update, playDemo, DEMOS, openExplore, openStart };
