/* Scientific charts for a regional record, drawn the way climate assessments draw them.

   anomalyChart  yearly anomalies against the 1991-2020 normal as bars in the variable's colour
                 family, the Theil-Sen trend, and its 95% uncertainty fan (the range of slopes,
                 pivoting on the centre of the data); the record year and the rate labelled directly.
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
  // The trend and its fan, as anomalies; the fan pivots on the centre of the data.
  const x0 = r.period[0], x1 = r.period[1], xc = (x0 + x1) / 2;
  const line = (x) => r.trend.line[0] - r.normal + ((r.trend.line[1] - r.trend.line[0]) / (x1 - x0 || 1)) * (x - x0);
  const yc = line(xc);
  const [sLo, sHi] = r.trend.range_per_decade.map((s) => s / 10);
  const fan = (x, s) => yc + s * (x - xc);
  const all = ok.concat([fan(x0, sLo), fan(x0, sHi), fan(x1, sLo), fan(x1, sHi), 0]);
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const W = width, H = height, m = { l: 40, r: 64, t: 16, b: 22 };
  const sx = (year) => m.l + ((year - x0 + 0.5) / (n || 1)) * (W - m.l - m.r);
  const sy = (val) => H - m.b - ((val - lo) / (hi - lo)) * (H - m.t - m.b);
  const bw = Math.max(1, ((W - m.l - m.r) / n) * 0.78);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "sci", role: "img", tabindex: 0,
    "aria-label": `${v.label} in ${r.region.name}: yearly difference from the 1991 to 2020 normal, ${x0} to ${x1}, with the trend and its 95% range` });
  const yt = ticks(lo, hi);
  for (const t of yt.out) {
    root.append(svg("line", { class: t === 0 ? "zero" : "grid", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }));
    text(root, m.l - 6, sy(t) + 3.5, t === 0 ? "0" : fmt(t, yt.decimals), { class: "tick", "text-anchor": "end" });
  }
  for (let year = Math.ceil(x0 / 10) * 10; year <= x1; year += 10) text(root, sx(year), H - 6, year, { class: "tick", "text-anchor": "middle" });
  text(root, m.l, 10, `${v.unit}, against the 1991–2020 normal`, { class: "axis-title" });
  // Bars: one per year, from the normal, coloured by how far from normal.
  a.forEach((val, i) => {
    if (val == null) return;
    const y = sy(Math.max(val, 0)), h = Math.max(0.5, Math.abs(sy(val) - sy(0)));
    root.append(svg("rect", { x: sx(r.years[i]) - bw / 2, y, width: bw, height: h, rx: 0.8,
      fill: familyColour(v.family, (val / (2.4 * sd)) * sense) }));
  });
  // The 95% fan and the trend line.
  const colour = resolve(claimColour(v, r.trend.per_decade, r.significant));
  const band = `M${sx(x0)} ${sy(fan(x0, sLo))}L${sx(x1)} ${sy(fan(x1, sLo))}L${sx(x1)} ${sy(fan(x1, sHi))}L${sx(x0)} ${sy(fan(x0, sHi))}Z`;
  root.append(svg("path", { class: "fan", d: band, fill: r.significant ? colour : css("--ink-3"), "fill-opacity": r.significant ? 0.16 : 0.12 }));
  root.append(svg("line", { class: r.significant ? "trend" : "trend weak", x1: sx(x0), x2: sx(x1), y1: sy(line(x0)), y2: sy(line(x1)),
    stroke: r.significant ? colour : css("--ink-3") }));
  // Direct labels: the rate at the end of the line, the record year at its bar.
  const d = digits(r.trend.per_decade);
  text(root, sx(x1) + 8, sy(line(x1)) + 4, `${fmt(r.trend.per_decade, d)}`, { class: "end-label", fill: r.significant ? colour : css("--ink-3") });
  text(root, sx(x1) + 8, sy(line(x1)) + 17, "per decade", { class: "end-sub" });
  let rec = -1;
  a.forEach((val, i) => { if (val != null && (rec < 0 || val * sense > a[rec] * sense)) rec = i; });
  if (rec >= 0) {
    const above = a[rec] >= 0;
    const ry = above ? sy(a[rec]) - 6 : sy(a[rec]) + 13;
    const anchor = rec > n * 0.8 ? "end" : rec < n * 0.2 ? "start" : "middle";
    text(root, sx(r.years[rec]), ry, `${r.years[rec]} record`, { class: "rec-label", "text-anchor": anchor });
  }
  const wrap = el("div", { class: "plot sci-wrap" }, root);
  const xs = r.years.map((y) => sx(y));
  hover(root, wrap, W, xs, (i, cross) => {
    if (a[i] == null) return null;
    cross.setAttribute("x1", xs[i]); cross.setAttribute("x2", xs[i]);
    cross.setAttribute("y1", m.t); cross.setAttribute("y2", H - m.b); cross.setAttribute("visibility", "visible");
    return [String(r.years[i]), `${r.values[i].toFixed(v.decimals)} ${v.unit}`, `${fmt(a[i], v.decimals)} against normal`];
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
  text(root, W - m.r, 12, `Typical year moved ${fmt(shift, d)} ${v.unit}`, { class: "end-label small", "text-anchor": "end", fill: r.significant ? colour : css("--ink-2") });
  text(root, m.l, 12, `${v.unit}, against the 1991–2020 normal`, { class: "axis-title" });
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
