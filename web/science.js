/* Scientific charts for a regional record, drawn the way climate assessments draw them.

   anomalyChart  yearly anomalies against the 1991-2020 normal as bars in the variable's colour
                 family, the record year labelled. No fitted line is drawn over the data: the rate,
                 its interval and the test are reported beside the chart.
   shiftChart    how the distribution of years moved: the first and last 15 years as smoothed
                 densities, with their means (the "shifting bell curve").
   forestPlot    every variable in a region on one axis: change per decade in units of each
                 variable's own year-to-year variability, with its 95% range. */

import { el, svg } from "./util.js";
import { claimColour, familyColour } from "./record.js";

const MINUS = "−";
const fmt = (x, d) => `${x > 0 ? "+" : x < 0 ? MINUS : ""}${Math.abs(x).toFixed(d)}`;
const digits = (x) => (!x ? 1 : Math.max(0, Math.min(4, 1 - Math.floor(Math.log10(Math.abs(x))))));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const resolve = (value) => (value.startsWith("var(") ? css(value.slice(4, -1)) : value);

function ticks(lo, hi, count = 4) {
  const span = hi - lo || 1, raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return { out, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) + (step / mag === 2.5 ? 1 : 0) };
}

function text(root, x, y, value, attrs = {}) {
  const t = svg("text", { x, y, ...attrs });
  t.textContent = value;
  root.append(t);
  return t;
}

function hover(root, wrap, W, xs, onShow) {
  const tip = el("div", { class: "tooltip", hidden: "" });
  wrap.append(tip);
  const cross = svg("line", { class: "cross", visibility: "hidden" });
  root.append(cross);
  root.addEventListener("pointermove", (e) => {
    const box = root.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    xs.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i; });
    const lines = onShow(best, cross);
    if (!lines) return;
    tip.replaceChildren(el("strong", { text: lines[0] }), ...lines.slice(1).map((l) => el("div", { text: l })));
    tip.hidden = false;
    const left = (xs[best] / W) * box.width;
    const flip = left > box.width * 0.6;
    tip.style.left = flip ? "" : `${left + 12}px`;
    tip.style.right = flip ? `${box.width - left + 12}px` : "";
  });
  root.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
}

/** r: an /api/investigate result. */
export function anomalyChart(r, { width = 440, height = 248 } = {}) {
  const v = r.variable, n = r.years.length;
  const a = r.values.map((x) => (x == null ? null : x - r.normal));
  const sense = v.up === "a" ? -1 : 1;
  const ok = a.filter((x) => x != null);
  const sd = Math.sqrt(ok.reduce((s, x) => s + x * x, 0) / ok.length) || 1;
  const x0 = r.period[0], x1 = r.period[1];
  const all = ok.concat([0]);
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const W = width, H = height, m = { l: 40, r: 12, t: 16, b: 22 };
  const sx = (year) => m.l + ((year - x0 + 0.5) / (n || 1)) * (W - m.l - m.r);
  const sy = (val) => H - m.b - ((val - lo) / (hi - lo)) * (H - m.t - m.b);
  const bw = Math.max(1, ((W - m.l - m.r) / n) * 0.78);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "sci", role: "img", tabindex: 0,
    "aria-label": `${v.label} anomaly in ${r.region.name}, ${x0} to ${x1}, relative to 1991 to 2020` });
  const yt = ticks(lo, hi);
  for (const t of yt.out) {
    root.append(svg("line", { class: t === 0 ? "zero" : "grid", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }));
    text(root, m.l - 6, sy(t) + 3.5, t === 0 ? "0" : fmt(t, yt.decimals), { class: "tick", "text-anchor": "end" });
  }
  for (let year = Math.ceil(x0 / 10) * 10; year <= x1; year += 10) text(root, sx(year), H - 6, year, { class: "tick", "text-anchor": "middle" });
  text(root, m.l, 10, `Anomaly (${v.unit}), base 1991–2020`, { class: "axis-title" });
  // Bars: one per year, from the normal, coloured by how far from normal.
  a.forEach((val, i) => {
    if (val == null) return;
    const y = sy(Math.max(val, 0)), h = Math.max(0.5, Math.abs(sy(val) - sy(0)));
    root.append(svg("rect", { x: sx(r.years[i]) - bw / 2, y, width: bw, height: h, rx: 0.8,
      fill: familyColour(v.family, (val / (2.4 * sd)) * sense) }));
  });
  let rec = -1;
  a.forEach((val, i) => { if (val != null && (rec < 0 || val * sense > a[rec] * sense)) rec = i; });
  if (rec >= 0) {
    const above = a[rec] >= 0;
    const ry = above ? sy(a[rec]) - 6 : sy(a[rec]) + 13;
    const anchor = rec > n * 0.8 ? "end" : rec < n * 0.2 ? "start" : "middle";
    text(root, sx(r.years[rec]), ry, `${r.years[rec]}: ${fmt(a[rec], v.decimals)}`, { class: "rec-label", "text-anchor": anchor });
  }
  const wrap = el("div", { class: "plot sci-wrap" }, root);
  const xs = r.years.map((y) => sx(y));
  hover(root, wrap, W, xs, (i, cross) => {
    if (a[i] == null) return null;
    cross.setAttribute("x1", xs[i]); cross.setAttribute("x2", xs[i]);
    cross.setAttribute("y1", m.t); cross.setAttribute("y2", H - m.b); cross.setAttribute("visibility", "visible");
    return [String(r.years[i]), `${r.values[i].toFixed(v.decimals)} ${v.unit}`, `anomaly ${fmt(a[i], v.decimals)}`];
  });
  return wrap;
}

/** Gaussian kernel density of xs on a grid. */
function density(xs, grid) {
  const n = xs.length, mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1)) || 1;
  const h = 1.06 * sd * n ** -0.2;
  return grid.map((g) => xs.reduce((s, x) => s + Math.exp(-0.5 * ((g - x) / h) ** 2), 0) / (n * h * Math.sqrt(2 * Math.PI)));
}

export function shiftChart(r, { width = 440, height = 248, span = 15 } = {}) {
  const v = r.variable;
  const pairs = r.years.map((y, i) => [y, r.values[i]]).filter(([, x]) => x != null);
  const k = Math.min(span, Math.floor(pairs.length / 2));
  const early = pairs.slice(0, k), late = pairs.slice(-k);
  const ev = early.map(([, x]) => x - r.normal), lv = late.map(([, x]) => x - r.normal);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const all = ev.concat(lv);
  const spread = Math.max(...all) - Math.min(...all) || 1;
  const lo = Math.min(...all) - spread * 0.35, hi = Math.max(...all) + spread * 0.35;
  const grid = Array.from({ length: 120 }, (_, i) => lo + ((hi - lo) * i) / 119);
  const de = density(ev, grid), dl = density(lv, grid);
  const top = Math.max(...de, ...dl) * 1.15;
  const W = width, H = height, m = { l: 14, r: 14, t: 34, b: 24 };
  const sx = (x) => m.l + ((x - lo) / (hi - lo)) * (W - m.l - m.r);
  const sy = (d) => H - m.b - (d / top) * (H - m.t - m.b);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "sci", role: "img",
    "aria-label": `How the years shifted: ${early[0][0]} to ${early[k - 1][0]} against ${late[0][0]} to ${late[k - 1][0]}` });
  const xt = ticks(lo, hi, 5);
  for (const t of xt.out) {
    root.append(svg("line", { class: "grid", x1: sx(t), x2: sx(t), y1: m.t, y2: H - m.b }));
    text(root, sx(t), H - 7, t === 0 ? "0" : fmt(t, xt.decimals), { class: "tick", "text-anchor": "middle" });
  }
  const area = (d) => `M${sx(grid[0])} ${sy(0)}` + grid.map((g, i) => `L${sx(g).toFixed(1)} ${sy(d[i]).toFixed(1)}`).join("") + `L${sx(grid[grid.length - 1])} ${sy(0)}Z`;
  const shift = mean(lv) - mean(ev);
  const colour = resolve(claimColour(v, shift, r.significant)) || css("--ink-2");
  root.append(svg("path", { d: area(de), fill: css("--ink-3"), "fill-opacity": 0.22, stroke: css("--ink-3"), "stroke-width": 1.2 }));
  root.append(svg("path", { d: area(dl), fill: r.significant ? colour : css("--ink-2"), "fill-opacity": 0.28,
    stroke: r.significant ? colour : css("--ink-2"), "stroke-width": 1.6 }));
  for (const [val, cls] of [[mean(ev), "mean early"], [mean(lv), "mean late"]]) {
    root.append(svg("line", { class: cls, x1: sx(val), x2: sx(val), y1: m.t - 4, y2: H - m.b, stroke: cls.includes("late") && r.significant ? colour : css("--ink-2") }));
  }
  const d = Math.max(v.decimals, digits(shift));
  text(root, sx(mean(ev)), m.t - 9, `${early[0][0]}–${early[k - 1][0]}`, { class: "end-sub", "text-anchor": "middle" });
  text(root, sx(mean(lv)), m.t - 9, `${late[0][0]}–${late[k - 1][0]}`, { class: "end-sub strong", "text-anchor": "middle" });
  text(root, W - m.r, 12, `Δ mean ${fmt(shift, d)} ${v.unit}`, { class: "end-label small", "text-anchor": "end", fill: r.significant ? colour : css("--ink-2") });
  text(root, m.l, 12, `Anomaly (${v.unit}), kernel density`, { class: "axis-title" });
  return el("div", { class: "plot sci-wrap" }, root);
}

/** Residual year-to-year spread of a record around a straight line. */
function wiggle(years, values) {
  const pts = years.map((y, i) => [y, values[i]]).filter(([, x]) => x != null);
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const b = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / (pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0) || 1);
  return Math.sqrt(pts.reduce((s, p) => s + (p[1] - my - b * (p[0] - mx)) ** 2, 0) / Math.max(1, n - 2)) || 1;
}

/** rows: scan rows with range; onPick(row). */
export function forestPlot(rows, current, onPick) {
  const items = rows.map((r) => {
    const s = wiggle(r.years, r.values);
    return { r, z: r.per_decade / s, lo: r.range[0] / s, hi: r.range[1] / s };
  }).sort((a, b) => Math.abs(b.z) * (b.r.significant ? 10 : 1) - Math.abs(a.z) * (a.r.significant ? 10 : 1));
  const lim = Math.min(3, Math.max(0.6, ...items.map((i) => Math.max(Math.abs(i.lo), Math.abs(i.hi))))) * 1.05;
  const W = 150, rowH = 26;
  const sx = (z) => 8 + ((Math.max(-lim, Math.min(lim, z)) + lim) / (2 * lim)) * (W - 16);
  const axis = svg("svg", { viewBox: `0 0 ${W} 20`, class: "forest-axis", "aria-hidden": "true" });
  for (const t of [-lim, -lim / 2, 0, lim / 2, lim].map((x) => +x.toFixed(1))) {
    text(axis, sx(t), 13, t === 0 ? "0" : fmt(t, 1), { class: "tick", "text-anchor": "middle" });
  }
  const list = el("ol", { class: "forest" });
  for (const { r, z, lo, hi } of items) {
    const plot = svg("svg", { viewBox: `0 0 ${W} ${rowH}`, class: "forest-plot", role: "img",
      "aria-label": `${r.label}: ${fmt(r.per_decade, digits(r.per_decade))} ${r.unit} per decade, ${r.significant ? "significant" : "could be chance"}` });
    plot.append(svg("line", { class: "zero", x1: sx(0), x2: sx(0), y1: 0, y2: rowH }));
    const colour = r.significant ? resolve(claimColour(r, r.per_decade, true)) : css("--ink-3");
    plot.append(svg("line", { x1: sx(lo), x2: sx(hi), y1: rowH / 2, y2: rowH / 2, stroke: colour, "stroke-width": 2, "stroke-linecap": "round", opacity: r.significant ? 1 : 0.6 }));
    plot.append(svg("circle", { cx: sx(z), cy: rowH / 2, r: 4.5, fill: r.significant ? colour : css("--surface"), stroke: colour, "stroke-width": 1.6 }));
    list.append(el("li", { class: r.id === current ? "current" : "" },
      el("button", { type: "button", class: "forest-name", onclick: () => onPick(r) }, r.label),
      plot,
      el("span", { class: "forest-rate", style: `color:${colour}` }, fmt(r.per_decade, digits(r.per_decade)), el("small", { text: ` ${r.unit}` }))));
  }
  return el("div", { class: "forest-wrap" },
    el("div", { class: "forest-head" }, el("span", { text: "Variable" }), axis, el("span", { text: "Per decade" })),
    list);
}

/** A latitude-time diagram (Hovmöller): one cell per year and latitude band, coloured by the
 *  anomaly against that band's own 1991-2020 normal. It shows where a change began and how it
 *  spread: Arctic amplification, a drying belt, a band of snow loss. */
export function latitudeTime(r, { width = 440, height = 290 } = {}) {
  const z = r.zonal, v = r.variable;
  if (!z || !z.lat.length) return el("p", { class: "note-text", text: "Too few latitude rows in this region for a latitude–time view." });
  const nb = z.lat.length, ny = r.years.length;
  const sense = v.up === "a" ? -1 : 1;
  const mags = z.anomaly.flat().filter((x) => x != null).map(Math.abs).sort((p, q) => p - q);
  const vmax = mags[Math.floor(mags.length * 0.98)] || mags[mags.length - 1] || 1;
  const W = width, H = height, PW = 86, m = { l: 34, r: PW + 14, t: 18, b: 44 };
  const lat0 = z.lat[0][0], lat1 = z.lat[nb - 1][1];
  const cw = (W - m.l - m.r) / ny;
  const sx = (i) => m.l + i * cw;
  const sy = (lat) => H - m.b - ((lat - lat0) / (lat1 - lat0)) * (H - m.t - m.b);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "sci hovmoller", role: "img", tabindex: 0,
    "aria-label": `${v.label} anomaly by latitude and year in ${r.region.name}, base ${z.baseline[0]} to ${z.baseline[1]}` });
  const cells = svg("g", { "shape-rendering": "crispEdges" });
  z.anomaly.forEach((row, i) => row.forEach((val, j) => {
    if (val == null) return;
    const [a, b] = z.lat[j];
    cells.append(svg("rect", { x: sx(i), y: sy(b), width: cw + 0.4, height: sy(a) - sy(b) + 0.4,
      fill: familyColour(v.family, (val / vmax) * sense) }));
  }));
  root.append(cells);
  const span = lat1 - lat0;
  const step = span > 120 ? 30 : span > 50 ? 15 : span > 20 ? 5 : span > 8 ? 2 : 1;
  for (let lat = Math.ceil(lat0 / step) * step; lat <= lat1; lat += step) {
    root.append(svg("line", { class: lat === 0 ? "zero" : "grid", x1: m.l, x2: W - m.r, y1: sy(lat), y2: sy(lat), opacity: 0.55 }));
    text(root, m.l - 5, sy(lat) + 3.5, lat === 0 ? "EQ" : `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`, { class: "tick", "text-anchor": "end" });
  }
  for (let year = Math.ceil(r.years[0] / 10) * 10; year <= r.years[ny - 1]; year += 10) {
    const i = r.years.indexOf(year);
    if (i >= 0) text(root, sx(i) + cw / 2, H - m.b + 13, year, { class: "tick", "text-anchor": "middle" });
  }
  text(root, m.l, 10, `Zonal-mean anomaly (${v.unit}), base ${z.baseline[0]}–${z.baseline[1]}`, { class: "axis-title" });
  // Colour bar, under the year axis.
  const bw = Math.min(180, W - m.l - m.r), bx = m.l + (W - m.l - m.r - bw) / 2, by = H - 11, steps = 48;
  for (let k = 0; k < steps; k++) {
    const t = (2 * k) / (steps - 1) - 1;
    root.append(svg("rect", { x: bx + (k * bw) / steps, y: by, width: bw / steps + 0.5, height: 6, fill: familyColour(v.family, t * sense) }));
  }
  const d = digits(vmax);
  text(root, bx - 4, by + 6, fmt(-vmax, d), { class: "tick", "text-anchor": "end" });
  text(root, bx + bw + 4, by + 6, `${fmt(vmax, d)} ${v.unit}`, { class: "tick" });
  // Zonal trend profile: Theil-Sen slope per decade in each band, with its 95% range.
  const tr = z.trend || [];
  const vals = tr.filter(Boolean).flatMap((q) => [q[1], q[2]]).concat([0]);
  if (vals.length > 1) {
    const px0 = W - PW, px1 = W - 4;
    let plo = Math.min(...vals), phi = Math.max(...vals);
    const pp = (phi - plo) * 0.08 || 1; plo -= pp; phi += pp;
    const px = (q) => px0 + ((q - plo) / (phi - plo)) * (px1 - px0);
    const mid = (j) => sy((z.lat[j][0] + z.lat[j][1]) / 2);
    root.append(svg("line", { class: "zero", x1: px(0), x2: px(0), y1: m.t, y2: H - m.b }));
    const band = tr.map((q, j) => (q ? [j, q] : null)).filter(Boolean);
    if (band.length > 1) {
      const up = band.map(([j, q]) => `${px(q[2]).toFixed(1)} ${mid(j).toFixed(1)}`);
      const dn = band.slice().reverse().map(([j, q]) => `${px(q[1]).toFixed(1)} ${mid(j).toFixed(1)}`);
      root.append(svg("path", { d: `M${up.join("L")}L${dn.join("L")}Z`, class: "profile-band" }));
      root.append(svg("path", { d: "M" + band.map(([j, q]) => `${px(q[0]).toFixed(1)} ${mid(j).toFixed(1)}`).join("L"), class: "profile-line" }));
    }
    band.forEach(([j, q]) => {
      const sig = z.significant && z.significant[j];
      root.append(svg("circle", { cx: px(q[0]), cy: mid(j), r: sig ? 2.4 : 1.8,
        fill: sig ? familyColour(v.family, Math.sign(q[0]) * sense * 0.85) : "var(--surface)",
        stroke: sig ? "none" : "var(--ink-3)", "stroke-width": 1 }));
    });
    const pt = ticks(plo, phi, 3);
    for (const t of pt.out) text(root, px(t), H - m.b + 12, t === 0 ? "0" : fmt(t, pt.decimals), { class: "tick", "text-anchor": "middle" });
    text(root, px0, 10, "Trend /decade", { class: "axis-title" });
  }
  const wrap = el("div", { class: "plot sci-wrap" }, root);
  const tip = el("div", { class: "tooltip", hidden: "" });
  const box = svg("rect", { class: "cell-focus", visibility: "hidden", fill: "none" });
  root.append(box);
  wrap.append(tip);
  root.addEventListener("pointermove", (e) => {
    const b = root.getBoundingClientRect();
    const x = ((e.clientX - b.left) / b.width) * W, y = ((e.clientY - b.top) / b.height) * H;
    const i = Math.floor((x - m.l) / cw);
    const lat = lat0 + ((H - m.b - y) / (H - m.t - m.b)) * (lat1 - lat0);
    const j = z.lat.findIndex(([a, c]) => lat >= a && lat < c);
    const val = i >= 0 && i < ny && j >= 0 ? z.anomaly[i][j] : null;
    if (val == null) { tip.hidden = true; box.setAttribute("visibility", "hidden"); return; }
    const [a, c] = z.lat[j];
    const ll = (q) => `${Math.abs(q).toFixed(1)}°${q >= 0 ? "N" : "S"}`;
    box.setAttribute("x", sx(i)); box.setAttribute("width", cw);
    box.setAttribute("y", sy(c)); box.setAttribute("height", sy(a) - sy(c)); box.setAttribute("visibility", "visible");
    const q = z.trend && z.trend[j];
    tip.replaceChildren(el("strong", { text: String(r.years[i]) }), el("div", { text: `${ll(a)} to ${ll(c)}` }),
      el("div", { text: `anomaly ${fmt(val, v.decimals)} ${v.unit}` }),
      q ? el("div", { text: `band trend ${fmt(q[0], v.decimals + 1)} /decade${z.significant[j] ? "" : " (n.s.)"}` }) : null);
    tip.hidden = false;
    const left = ((sx(i) + cw / 2) / W) * b.width, flip = left > b.width * 0.6;
    tip.style.left = flip ? "" : `${left + 12}px`;
    tip.style.right = flip ? `${b.width - left + 12}px` : "";
    tip.style.top = `${(y / H) * b.height}px`;
  });
  root.addEventListener("pointerleave", () => { tip.hidden = true; box.setAttribute("visibility", "hidden"); });
  return wrap;
}

/** Shifting distributions (after Hansen, Sato and Ruedy 2012): every cell-year in the region as a
 *  standardised local anomaly, one density per decade, stacked as a ridgeline. The curve moving
 *  right or left is the change in the mean; its tails are the extremes. */
export function decadeRidges(r, { width = 440, height = 290 } = {}) {
  const sp = r.spread, v = r.variable;
  if (!sp) return shiftChart(r, { width, height });
  const sense = v.up === "a" ? -1 : 1;
  const ds = sp.decades, n = ds.length, e = sp.edges;
  const mids = e.slice(0, -1).map((x, i) => (x + e[i + 1]) / 2);
  const W = width, H = height, m = { l: 74, r: 64, t: 22, b: 24 };
  const lo = -4.5, hi = 4.5;
  const sx = (x) => m.l + ((x - lo) / (hi - lo)) * (W - m.l - m.r);
  const row = (H - m.t - m.b) / (n + 0.6);
  const top = Math.max(...ds.flatMap((d) => d.density));
  const amp = row * 1.55 / top;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "sci ridges", role: "img", tabindex: 0,
    "aria-label": `Distribution of local ${v.label.toLowerCase()} anomalies in ${r.region.name} by decade, in standard deviations of ${sp.baseline[0]} to ${sp.baseline[1]}` });
  for (const t of [-3, -2, -1, 0, 1, 2, 3]) {
    root.append(svg("line", { class: t === 0 ? "zero" : "grid", x1: sx(t), x2: sx(t), y1: m.t - 6, y2: H - m.b }));
    text(root, sx(t), H - 8, t === 0 ? "0" : `${fmt(t, 0)}σ`, { class: "tick", "text-anchor": "middle" });
  }
  text(root, m.l, 10, `Local anomaly in σ of ${sp.baseline[0]}–${sp.baseline[1]}`, { class: "axis-title" });
  text(root, W - 4, 10, "> +2σ", { class: "axis-title", "text-anchor": "end" });
  const defs = svg("defs", {});
  root.append(defs);
  ds.forEach((d, k) => {
    const base = m.t + row * (k + 1.4);
    const id = `ridge-${Math.random().toString(36).slice(2, 8)}`;
    // Colour runs along the anomaly axis, in user space, so every ridge shares one scale.
    const grad = svg("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: sx(lo), x2: sx(hi), y1: 0, y2: 0 });
    for (let s = 0; s <= 8; s++) {
      const x = lo + (s / 8) * (hi - lo);
      grad.append(svg("stop", { offset: s / 8, "stop-color": familyColour(v.family, (x / 3) * sense) }));
    }
    defs.append(grad);
    const pts = mids.map((x, i) => [sx(Math.max(lo, Math.min(hi, x))), base - d.density[i] * amp]);
    const line = "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L");
    root.append(svg("path", { d: `${line}L${sx(hi)} ${base}L${sx(lo)} ${base}Z`, fill: `url(#${id})`, class: "ridge-fill" }));
    root.append(svg("path", { d: line, class: "ridge-line" }));
    root.append(svg("line", { class: "ridge-mean", x1: sx(d.mean), x2: sx(d.mean), y1: base, y2: base - row * 0.9 }));
    const label = d.years[0] === d.years[1] ? `${d.years[0]}` : `${d.years[0]}–${String(d.years[1]).slice(2)}`;
    text(root, m.l - 8, base - 2, label, { class: "tick", "text-anchor": "end" });
    text(root, W - 4, base - 2, `${d.above_2sd.toFixed(1)}%`, { class: "end-sub", "text-anchor": "end" });
  });
  const first = ds[0], last = ds[n - 1];
  const wrap = el("div", { class: "plot sci-wrap" }, root,
    el("p", { class: "fig-caption" }, `Mean ${fmt(first.mean, 2)}σ → ${fmt(last.mean, 2)}σ · area > +2σ ${first.above_2sd}% → ${last.above_2sd}% · `
      + `area < −2σ ${first.below_2sd}% → ${last.below_2sd}% · ${sp.cells.toLocaleString()} cells`));
  return wrap;
}
