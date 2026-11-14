/* Canary front end: a globe, and a vital-signs chart for any place you click. */

const SVG_NS = "http://www.w3.org/2000/svg";

const DEMOS = [
  { name: "Svalbard, Arctic Norway", lat: 78.2, lon: 15.6, note: "Among the fastest-warming places on Earth" },
  { name: "Equatorial Pacific", lat: 0, lon: -150, note: "Home of El Niño: big swings, no lasting trend" },
  { name: "Phoenix, Arizona", lat: 33.45, lon: -112.07, note: "A desert city getting hotter and drier" },
  { name: "Nairobi, Kenya", lat: -1.28, lon: 36.82, note: "A tropical highland city: warmer and more humid" },
];

const STATUS_LABEL = {
  stable: "No clear trend",
  shifting: "within normal range",
  emerged: "outside normal range",
  extreme: "far outside normal range",
};
const CONDITION_LABEL = { stable: "Stable", watch: "Watch", serious: "Serious", critical: "Critical" };
// Percent change only makes sense for quantities with a true zero.
const NO_PERCENT = new Set(["temperature", "cloud"]);

/* ---------- small helpers ---------- */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const MINUS = "−";

/** Two significant digits, at most four decimals, no sign. */
function sig(x) {
  const a = Math.abs(x);
  if (a === 0) return "0";
  const decimals = Math.max(0, Math.min(4, 1 - Math.floor(Math.log10(a))));
  return a.toFixed(decimals);
}
const signed = (x) => (x > 0 ? "+" : x < 0 ? MINUS : "") + sig(x);
const fixed = (x, d) => x.toFixed(d).replace("-", MINUS);
const signedFixed = (x, d) => (x > 0 ? "+" : "") + fixed(x, d);
const pText = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const pEquals = (p) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);

/** Format related numbers (an estimate and its range) with the same decimals. */
function together(...values) {
  const top = Math.max(...values.map(Math.abs));
  const decimals = top === 0 ? 0 : Math.max(0, Math.min(4, 1 - Math.floor(Math.log10(top))));
  return values.map((v) => ({
    plain: Math.abs(v).toFixed(decimals),
    signed: (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v).toFixed(decimals),
  }));
}

function coordText(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}

/** Shape encodes severity, so status never rests on colour alone. */
function statusIcon(level) {
  const icon = svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" });
  const shapes = {
    stable: svg("circle", { cx: 8, cy: 8, r: 6 }),
    watch: svg("path", { d: "M8 1.5 15 14.5H1Z" }),
    serious: svg("path", { d: "M8 1 15 8 8 15 1 8Z" }),
    critical: svg("rect", { x: 2, y: 2, width: 12, height: 12, rx: 1.5 }),
  };
  const alias = { shifting: "watch", emerged: "serious", extreme: "critical", good: "stable" };
  const shape = shapes[alias[level] || level];
  shape.setAttribute("fill", "currentColor");
  icon.append(shape);
  return icon;
}

/* ---------- charts ---------- */

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
  return { ticks, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) + (step / mag === 2.5 ? 1 : 0) };
}

/**
 * Line chart of one yearly series with an optional fitted line, a crosshair
 * and a tooltip. `rows(i)` returns the tooltip lines for point i.
 */
function lineChart({ x, y, fit, fitStrong, zeroLine, rows, label }) {
  const W = 400, H = 150, m = { l: 40, r: 12, t: 8, b: 20 };
  const valid = y.map((v, i) => (v == null ? null : i)).filter((i) => i != null);
  const values = valid.map((i) => y[i]).concat(fit ? fit.map((p) => p.y) : [], zeroLine ? [0] : []);
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo || 1) * 0.08;
  lo -= pad; hi += pad;
  const sx = (v) => m.l + ((v - x[0]) / (x[x.length - 1] - x[0])) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0, "aria-label": label });
  const { ticks, decimals } = niceTicks(lo, hi);
  for (const t of ticks) {
    root.append(svg("line", { class: t === 0 && zeroLine ? "zero" : "grid", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }));
    const text = svg("text", { class: "tick", x: m.l - 6, y: sy(t) + 3.5, "text-anchor": "end" });
    text.textContent = (zeroLine && t > 0 ? "+" : "") + fixed(t, decimals);
    root.append(text);
  }
  const firstDecade = Math.ceil(x[0] / 10) * 10;
  for (let year = firstDecade; year <= x[x.length - 1]; year += 10) {
    const text = svg("text", { class: "tick", x: sx(year), y: H - 5, "text-anchor": "middle" });
    text.textContent = year;
    root.append(text);
  }

  // Data line, broken across gaps.
  let d = "", pen = false;
  y.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${sx(x[i]).toFixed(1)} ${sy(v).toFixed(1)}`;
    pen = true;
  });
  root.append(svg("path", { class: "data", d }));
  if (fit) {
    root.append(svg("line", {
      class: fitStrong ? "fit" : "fit weak",
      x1: sx(fit[0].x), y1: sy(fit[0].y), x2: sx(fit[1].x), y2: sy(fit[1].y),
    }));
  }
  const last = valid[valid.length - 1];
  root.append(svg("circle", { class: "end-dot", cx: sx(x[last]), cy: sy(y[last]), r: 4 }));

  // Hover layer: crosshair snaps to the nearest year.
  const cross = svg("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" });
  const dot = svg("circle", { class: "hover-dot", r: 4, visibility: "hidden" });
  root.append(cross, dot);
  const tooltip = el("div", { class: "tooltip", hidden: "" });
  const wrap = el("div", { class: "plot" }, root, tooltip);

  let current = -1;
  function show(i) {
    if (i == null || y[i] == null) return hide();
    current = i;
    const px = sx(x[i]), py = sy(y[i]);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
    tooltip.replaceChildren();
    const [head, ...rest] = rows(i);
    tooltip.append(el("strong", { text: head }));
    for (const line of rest) tooltip.append(el("div", { text: line }));
    tooltip.hidden = false;
    const scale = wrap.clientWidth / W;
    const left = px * scale;
    const flip = left > wrap.clientWidth * 0.6;
    tooltip.style.left = flip ? "" : `${left + 10}px`;
    tooltip.style.right = flip ? `${wrap.clientWidth - left + 10}px` : "";
  }
  function hide() {
    current = -1;
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  }
  function nearest(clientX) {
    const box = root.getBoundingClientRect();
    const year = x[0] + (((clientX - box.left) / box.width) * W - m.l) / (W - m.l - m.r) * (x[x.length - 1] - x[0]);
    let best = null, gap = Infinity;
    for (const i of valid) {
      const g = Math.abs(x[i] - year);
      if (g < gap) { gap = g; best = i; }
    }
    return best;
  }
  root.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
  root.addEventListener("pointerleave", hide);
  root.addEventListener("blur", hide);
  root.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const pos = current < 0 ? valid.length - 1 : valid.indexOf(current) + (e.key === "ArrowRight" ? 1 : -1);
    show(valid[Math.max(0, Math.min(valid.length - 1, pos))]);
  });
  return wrap;
}

/* ---------- sound ---------- */

let audio = null;
let stopSound = null;

/** Play a yearly series like a bedside monitor: one beep per year, pitch = value. */
function listen(values, button) {
  if (stopSound) { const wasThis = stopSound.button === button; stopSound(); if (wasThis) return; }
  audio ??= new AudioContext();
  const points = values.filter((v) => v != null);
  const lo = Math.min(...points), hi = Math.max(...points);
  const step = 0.13;
  const start = audio.currentTime + 0.05;
  const master = audio.createGain();
  master.connect(audio.destination);
  points.forEach((v, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    // Two octaves, low value = low pitch.
    osc.frequency.value = 220 * 2 ** (2 * ((v - lo) / (hi - lo || 1)));
    const t = start + i * step;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + step * 0.9);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + step);
  });
  const label = button.textContent;
  button.textContent = "Stop";
  const timer = setTimeout(() => stopSound && stopSound(), (points.length * step + 0.2) * 1000);
  stopSound = () => {
    clearTimeout(timer);
    master.disconnect();
    button.textContent = label;
    stopSound = null;
  };
  stopSound.button = button;
}

/* ---------- rendering a place ---------- */

function reading(v) {
  const t = v.trend;
  const unit = v.unit;
  const p = el("p", { class: "vital-reading" });
  const [slope, low, high] = together(t.slope_per_decade, ...t.ci_per_decade);
  const range = `95% range ${low.signed} to ${high.signed}`;
  if (!t.significant) {
    p.append(
      el("strong", { text: "No trend distinguishable from chance." }),
      ` Best estimate ${slope.signed} ${unit} per decade (${range}).`,
    );
    return p;
  }
  const verb = t.direction === "rising" ? "Rising" : "Falling";
  p.append(el("strong", { text: `${verb} by ${slope.plain} ${unit} per decade` }), ` (${range}). `);
  let since = `Since ${v.period[0]}: ${signed(t.total_change)} ${unit}`;
  if (t.percent_change != null && !NO_PERCENT.has(v.id)) since += ` (${signed(t.percent_change)}%)`;
  if (t.signal_to_noise != null) since += `, ${sig(t.signal_to_noise)} times the usual year-to-year swing`;
  p.append(since + ".");
  return p;
}

function lagText(months) {
  return months === 0 ? "same month" : `${months} month${months > 1 ? "s" : ""} later`;
}

function vitalCard(v) {
  const t = v.trend;
  const chipText = v.status === "stable"
    ? STATUS_LABEL.stable
    : `${t.direction === "rising" ? "Rising" : "Falling"}, ${STATUS_LABEL[v.status]}`;
  const card = el("article", { class: `vital status-${v.status}` },
    el("div", { class: "vital-head" },
      el("h3", { class: "vital-title" }, v.label, " ", el("span", { class: "vital-unit", text: `(${v.unit})` })),
      el("span", { class: "chip" }, statusIcon(v.status), chipText),
    ),
    el("p", { class: "vital-definition", text: v.definition }),
  );

  card.append(lineChart({
    x: v.years,
    y: v.annual_anomaly,
    fit: [{ x: v.years[0], y: t.line[0] }, { x: v.years[v.years.length - 1], y: t.line[1] }],
    fitStrong: t.significant,
    zeroLine: true,
    label: `${v.label}, yearly difference from the 1991 to 2020 average, ${v.period[0]} to ${v.period[1]}`,
    rows: (i) => [
      String(v.years[i]),
      `${signedFixed(v.annual_anomaly[i], v.decimals)} ${v.unit} vs average`,
      `Year's average: ${fixed(v.annual_mean[i], v.decimals)} ${v.unit}`,
    ],
  }));
  card.append(el("p", { class: "plot-caption",
    text: `Yearly difference from the 1991–2020 average (${fixed(v.baseline_mean, v.decimals)} ${v.unit}).` }));
  card.append(reading(v));

  if (v.suspects.length) {
    const s = v.suspects[0];
    const sense = s.r > 0 ? "rises and falls with" : "moves opposite to";
    card.append(el("p", { class: "vital-extra",
      text: `Suspect: ${sense} ${s.name} (r = ${signedFixed(s.r, 2)}, ${lagText(s.lag_months)}), `
        + `which accounts for about ${Math.round(s.variance_explained * 100)}% of the month-to-month swings.` }));
  }

  const ew = v.early_warning;
  if (ew) {
    card.append(el("p", { class: "vital-extra", text: ew.warning
      ? `Warning sign: this record's memory and variability have both risen (${pEquals(ew.p_ar1)}), `
        + "the statistical pattern seen in systems losing stability."
      : `Stability check: no sign of lost stability (memory trend τ = ${signedFixed(ew.tau_ar1, 2)}, ${pEquals(ew.p_ar1)}).` }));
  }

  const listenButton = el("button", { type: "button", text: "Listen" });
  listenButton.addEventListener("click", () => listen(v.annual_anomaly, listenButton));
  card.append(el("div", { class: "vital-actions" }, listenButton));

  // Statistics for people who want to check the working.
  const dl = el("dl");
  const add = (k, val) => dl.append(el("dt", { text: k }), el("dd", { text: val }));
  add("Record", `${v.period[0]}–${v.period[1]}, ${t.n_months} months`);
  add("Kendall τ", signedFixed(t.tau, 3));
  add("p, plain Mann-Kendall", pText(t.p_uncorrected));
  add("p, corrected for memory", `${pText(t.p)} (uncertainty widened ×${sig(t.variance_inflation)})`);
  add("p, after false-discovery control", pText(t.p_fdr));
  const [ls, lsLow, lsHigh] = together(t.linear.slope_per_decade, ...t.linear.ci_per_decade);
  add("Second opinion (least squares)",
    `${ls.signed} per decade, 95% range ${lsLow.signed} to ${lsHigh.signed}, ${pEquals(t.linear.p)}`);
  for (const s of v.suspects.slice(1)) {
    add("Also linked to", `${s.name} (r = ${signedFixed(s.r, 2)}, ${lagText(s.lag_months)})`);
  }
  if (ew) add("Early-warning test", `variance trend τ = ${signedFixed(ew.tau_variance, 2)} (${pEquals(ew.p_variance)}); `
    + `${ew.surrogates} surrogates, ${ew.window_months / 12}-year window`);
  add("Source", `${v.source}, parameter ${v.parameter}`);
  if (v.note) add("Note", v.note);
  card.append(el("details", {}, el("summary", { text: "Statistics" }), dl));

  const tableDetails = el("details", {}, el("summary", { text: "Data table" }));
  tableDetails.addEventListener("toggle", () => {
    if (!tableDetails.open || tableDetails.querySelector("table")) return;
    const table = el("table", {}, el("tr", {},
      el("th", { text: "Year" }), el("th", { text: `Average (${v.unit})` }), el("th", { text: "vs 1991–2020" })));
    v.years.forEach((year, i) => {
      if (v.annual_mean[i] == null) return;
      table.append(el("tr", {}, el("td", { text: year }),
        el("td", { text: fixed(v.annual_mean[i], v.decimals) }),
        el("td", { text: signedFixed(v.annual_anomaly[i], v.decimals) })));
    });
    tableDetails.append(el("div", { class: "table-scroll" }, table));
  }, { once: false });
  card.append(tableDetails);
  return card;
}

function renderChart(data, name) {
  const c = data.condition;
  const box = document.getElementById("chart");
  const order = { extreme: 0, emerged: 1, shifting: 2, stable: 3 };
  const vitals = [...data.vitals].sort((a, b) =>
    order[a.status] - order[b.status] || (b.trend.signal_to_noise ?? 0) - (a.trend.signal_to_noise ?? 0));

  const methods = el("details", { class: "methods" }, el("summary", { text: "How to read this, and its limits" }),
    el("ul", {},
      el("li", { text: `Trend: ${data.methods.trend}` }),
      el("li", { text: `Stability check: ${data.methods.early_warning}` }),
      el("li", { text: `Suspects: ${data.methods.suspects}` }),
      ...data.methods.caveats.map((text) => el("li", { text })),
    ));

  box.replaceChildren(
    el("button", { class: "back", type: "button", text: "← All cases", onclick: showWelcome }),
    el("h1", { text: name || "Selected location" }),
    el("p", { class: "place-coords",
      text: `${coordText(data.place.lat, data.place.lon)} · one grid cell, ${data.place.grid.split(" (")[0]}` }),
    el("div", { class: `condition status-${c.level}` },
      statusIcon(c.level),
      el("div", { class: "condition-level", text: CONDITION_LABEL[c.level] }),
      el("p", { class: "condition-summary",
        text: c.summary.replace(/^\w+: /, "").replace(/^./, (ch) => ch.toUpperCase()) }),
      el("p", { class: "condition-counts",
        text: `${c.changing} of ${c.monitored} vital signs have a trend unlikely to be chance; `
          + `${c.emerged} ${c.emerged === 1 ? "has" : "have"} left the normal range.` }),
    ),
    el("div", { class: "legend", "aria-label": "Chart legend" },
      el("span", {}, el("i"), "Yearly average"),
      el("span", {}, el("i", { class: "trend" }), "Trend (Theil-Sen)"),
    ),
    ...vitals.map(vitalCard),
    methods,
  );
  box.querySelector(".condition svg").classList.add("condition-icon");
}

/* ---------- map and app state ---------- */

const map = new maplibregl.Map({
  container: "map",
  center: [15, 20],
  zoom: 1.7,
  maxZoom: 9,
  attributionControl: { compact: true },
  style: {
    version: 8,
    projection: { type: "globe" },
    sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] },
    sources: {
      earth: {
        type: "raster",
        tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"],
        tileSize: 256,
        maxzoom: 8,
        attribution: "Imagery: NASA GIBS Blue Marble",
      },
      borders: {
        type: "raster",
        tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Features/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png"],
        tileSize: 256,
        maxzoom: 9,
      },
      labels: {
        type: "raster",
        tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Labels/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png"],
        tileSize: 256,
        maxzoom: 9,
        attribution: "Labels: NASA GIBS, OpenStreetMap contributors",
      },
    },
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#05070c" } },
      { id: "earth", type: "raster", source: "earth" },
      { id: "borders", type: "raster", source: "borders", paint: { "raster-opacity": 0.55 } },
      { id: "labels", type: "raster", source: "labels", minzoom: 2.5 },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");

const markerEl = el("div", { class: "brand-mark", style: "width:14px;height:14px;border:2px solid #0d0d0d" });
const marker = new maplibregl.Marker({ element: markerEl });

const welcome = document.getElementById("welcome");
const chartBox = document.getElementById("chart");
let requestId = 0;

function showWelcome() {
  if (stopSound) stopSound();
  chartBox.hidden = true;
  welcome.hidden = false;
  marker.remove();
  history.replaceState(null, "", location.pathname);
  map.flyTo({ center: [15, 20], zoom: 1.7 });
}

async function select(lat, lon, name, { fly = true } = {}) {
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const id = ++requestId;
  if (stopSound) stopSound();
  marker.setLngLat([lon, lat]).addTo(map);
  if (fly) map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 3.2) });
  welcome.hidden = true;
  chartBox.hidden = false;
  // Keep the previous chart on screen, dimmed, while the new one loads.
  if (chartBox.childElementCount) chartBox.classList.add("loading");
  else chartBox.replaceChildren(el("p", { text: "Reading 45 years of NASA records…" }));
  try {
    const response = await fetch(`/api/chart?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`);
    if (!response.ok) throw new Error((await response.json()).detail || response.statusText);
    const data = await response.json();
    if (id !== requestId) return;
    renderChart(data, name);
    document.getElementById("panel").scrollTop = 0;
    const hash = `#${lat.toFixed(2)},${lon.toFixed(2)}${name ? "," + encodeURIComponent(name) : ""}`;
    history.replaceState(null, "", hash);
  } catch (error) {
    if (id !== requestId) return;
    chartBox.replaceChildren(
      el("button", { class: "back", type: "button", text: "← All cases", onclick: showWelcome }),
      el("div", { class: "error", text: `Could not read this place: ${error.message}` }),
    );
  } finally {
    if (id === requestId) chartBox.classList.remove("loading");
  }
}

map.on("click", (e) => select(e.lngLat.lat, e.lngLat.lng, null, { fly: false }));

const demoList = document.getElementById("demos");
for (const demo of DEMOS) {
  demoList.append(el("li", {}, el("button", { type: "button", onclick: () => select(demo.lat, demo.lon, demo.name) },
    demo.name, el("small", { text: demo.note }))));
}

/* ---------- search ---------- */

const searchForm = document.getElementById("search");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
let searchTimer = null;

async function runSearch() {
  const q = searchInput.value.trim();
  if (q.length < 2) { searchResults.hidden = true; return; }
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const places = response.ok ? await response.json() : [];
    if (q !== searchInput.value.trim()) return;
    searchResults.replaceChildren(...(places.length
      ? places.map((p) => el("li", {}, el("button", {
          type: "button",
          onclick: () => {
            searchResults.hidden = true;
            searchInput.value = p.name;
            select(p.lat, p.lon, p.region ? `${p.name}, ${p.region.split(", ").pop()}` : p.name);
          },
        }, p.name, el("small", { text: p.region }))))
      : [el("li", {}, el("button", { type: "button", disabled: "" }, "No place found"))]));
    searchResults.hidden = false;
  } catch {
    searchResults.hidden = true;
  }
}
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
});
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const first = searchResults.querySelector("button:not([disabled])");
  if (first && !searchResults.hidden) first.click();
  else runSearch();
});
document.addEventListener("click", (e) => { if (!searchForm.contains(e.target)) searchResults.hidden = true; });

/* ---------- deep link: #lat,lon,name ---------- */

const parts = decodeURIComponent(location.hash.slice(1)).split(",");
if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1]) && parts[0] !== "") {
  select(Number(parts[0]), Number(parts[1]), parts.slice(2).join(",") || null);
}
