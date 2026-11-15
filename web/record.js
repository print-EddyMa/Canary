/* The one object Canary draws everywhere: a record, one cell per year, coloured by how far
   that year sat from normal in the variable's colour family. Also the two bars that go with
   every rate: how strong the evidence is, and the 95% range around zero. */

import { el, svg } from "./util.js";

const MINUS = "−";
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

let cache = null;
let cacheKey = "";
/** The family's nine steps in the current theme, read from the CSS tokens. */
function ramp(family) {
  const key = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (!cache || cacheKey !== key) { cache = {}; cacheKey = key; }
  if (!cache[family]) cache[family] = Array.from({ length: 9 }, (_, i) => hex(css(`--${family}-${i}`) || "#808080"));
  return cache[family];
}

/** Colour for t in [-1, 1], where +1 is the family's b pole. */
export function familyColour(family, t) {
  const r = ramp(family);
  const x = (Math.max(-1, Math.min(1, t)) + 1) * 4;
  const i = Math.min(7, Math.floor(x)), f = x - i;
  const c = [0, 1, 2].map((k) => Math.round(r[i][k] + (r[i + 1][k] - r[i][k]) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** +1 when an increase in this variable points to its family's b pole. */
const sense = (v) => (v.up === "a" ? -1 : 1);

/**
 * The text colour for a change, as a CSS value. Colour is earned: a change that could be
 * chance stays graphite.
 */
export function claimColour(v, change, earned) {
  if (!earned || !change || !v.family) return "var(--ink-3)";
  return `var(--${v.family}-${change * sense(v) > 0 ? "b" : "a"})`;
}

function anomalyScale(anomalies) {
  const ok = anomalies.filter((a) => a != null);
  const mean = ok.reduce((x, y) => x + y, 0) / (ok.length || 1);
  const sd = Math.sqrt(ok.reduce((x, y) => x + (y - mean) ** 2, 0) / (ok.length || 1)) || 1;
  return 2.4 * sd;
}

/**
 * Draw a record.
 *   v        { family, up, label } of the variable
 *   years    the years
 *   anomaly  each year's difference from normal (null for gaps)
 *   size     "full" (verdict), "row" (tables, vital signs) or "glyph" (pickers)
 *   more     years still needed to settle the trend, drawn as dashed cells (full size only)
 *   trend    [start, end] of the trend line as anomalies, drawn through a full record
 *   strong   whether that trend is significant (solid) or could be chance (dashed)
 */
export function record({ v, years, anomaly, size = "full", more = 0, trend = null, strong = false, label }) {
  const n = years.length;
  const scale = anomalyScale(anomaly);
  const colour = (a) => familyColour(v.family, (a / scale) * sense(v));
  if (size === "glyph") {
    const bins = 9, root = svg("svg", { class: "record-glyph", viewBox: `0 0 ${bins * 4} 12`, width: bins * 4, height: 12, "aria-hidden": "true" });
    for (let b = 0; b < bins; b++) {
      const part = anomaly.slice(Math.floor((b * n) / bins), Math.floor(((b + 1) * n) / bins)).filter((a) => a != null);
      const mean = part.reduce((x, y) => x + y, 0) / (part.length || 1);
      root.append(svg("rect", { x: b * 4, y: 0, width: 3.4, height: 12, fill: part.length ? colour(mean * 1.4) : "transparent" }));
    }
    return root;
  }
  const ghosts = size === "full" ? Math.min(more || 0, 24) : 0;
  // Full size is drawn close to its usual width in the panel so the year labels stay readable.
  const W = size === "row" ? 132 : 400, H = size === "row" ? 14 : 52, axis = size === "row" ? 0 : 16;
  const cw = W / (n + ghosts);
  const root = svg("svg", { class: `record record-${size}`, viewBox: `0 0 ${W} ${H + axis}`, role: "img",
    "aria-label": label || `${v.label}: one cell per year from ${years[0]} to ${years[n - 1]}, coloured by the difference from normal` });
  anomaly.forEach((a, i) => {
    if (a == null) return;
    const cell = svg("rect", { x: (i * cw).toFixed(2), y: 0, width: (cw + 0.4).toFixed(2), height: H, fill: colour(a) });
    if (size === "full") {
      const title = svg("title");
      title.textContent = `${years[i]}: ${a > 0 ? "+" : a < 0 ? MINUS : ""}${Math.abs(a).toPrecision(2)} against normal`;
      cell.append(title);
    }
    root.append(cell);
  });
  for (let j = 0; j < ghosts; j++) {
    root.append(svg("rect", { class: "ghost", x: ((n + j) * cw + 1).toFixed(2), y: 1, width: Math.max(1, cw - 2).toFixed(2), height: H - 2 }));
  }
  if (trend && size === "full") {
    const vals = anomaly.filter((a) => a != null).concat(trend);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const y = (a) => H - 6 - ((a - lo) / (hi - lo || 1)) * (H - 12);
    root.append(svg("line", { class: strong ? "record-trend" : "record-trend weak",
      x1: (cw / 2).toFixed(1), x2: ((n - 0.5) * cw).toFixed(1), y1: y(trend[0]).toFixed(1), y2: y(trend[1]).toFixed(1) }));
  }
  if (axis) {
    const ticks = [0, ...years.map((yr, i) => (yr % 10 === 0 && i > 2 && i < n - 3 ? i : -1)).filter((i) => i > 0), n - 1];
    // The last year's label sits under its own cell when dashed cells follow it.
    for (const i of ticks) {
      const last = i === n - 1 && !ghosts;
      const text = svg("text", { class: "tick", x: i === 0 ? 0 : last ? n * cw : (i + 0.5) * cw, y: H + 12,
        "text-anchor": i === 0 ? "start" : last ? "end" : "middle" });
      text.textContent = years[i];
      root.append(text);
    }
  }
  return root;
}

/** Strength of evidence: −log10(p) on a bar, with the 5% line marked. */
export function evidenceBar(v, p, significant, change) {
  const W = 240, max = 4, x = (val) => (Math.min(val, max) / max) * W;
  const e = -Math.log10(Math.max(p, 1e-6)), line = -Math.log10(0.05);
  const root = svg("svg", { class: "meter", viewBox: `0 0 ${W} 24`, role: "img",
    "aria-label": `Evidence: p ${p < 0.001 ? "below 0.001" : `= ${p.toFixed(3)}`}; the significance line is p = 0.05` });
  root.append(svg("rect", { class: "meter-track", x: 0, y: 4, width: W, height: 6 }));
  const fill = svg("rect", { x: 0, y: 4, width: x(e).toFixed(1), height: 6 });
  fill.style.fill = significant ? claimColour(v, change, true) : "var(--faint)";
  root.append(fill);
  root.append(svg("line", { class: "meter-mark", x1: x(line), x2: x(line), y1: 0, y2: 14 }));
  for (const [text, at, anchor] of [["chance", 0, "start"], ["5%", x(line), "middle"], ["very unlikely to be chance", W, "end"]]) {
    const t = svg("text", { class: "tick", x: at, y: 23, "text-anchor": anchor });
    t.textContent = text;
    root.append(t);
  }
  return root;
}

/** The 95% range of a rate on an axis with zero marked. */
export function rangeBar(v, rate, range, significant) {
  const W = 240, [lo, hi] = range, span = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(rate)) * 1.25 || 1;
  const x = (val) => W / 2 + (val / span) * (W / 2);
  const root = svg("svg", { class: "meter", viewBox: `0 0 ${W} 24`, role: "img",
    "aria-label": `95% range of the rate: ${lo.toPrecision(2)} to ${hi.toPrecision(2)} per decade` });
  root.append(svg("line", { class: "meter-axis", x1: 0, x2: W, y1: 8, y2: 8 }));
  root.append(svg("line", { class: "meter-zero", x1: x(0), x2: x(0), y1: 2, y2: 14 }));
  const zero = svg("text", { class: "tick", x: x(0), y: 23, "text-anchor": "middle" });
  zero.textContent = "0";
  root.append(zero);
  const colour = significant ? claimColour(v, rate, true) : "var(--ink-3)";
  const bar = svg("line", { x1: x(lo), x2: x(hi), y1: 8, y2: 8, "stroke-width": 4, "stroke-linecap": "round" });
  bar.style.stroke = colour;
  const dot = svg("circle", { cx: x(rate), cy: 8, r: 4.5, "stroke-width": 2 });
  dot.style.stroke = colour;
  dot.style.fill = "var(--surface)";
  root.append(bar, dot);
  return root;
}

/** A labelled pair of bars, as used under every verdict. */
export function meters(v, { p, significant, rate, range }) {
  return el("div", { class: "meters" },
    el("span", { class: "meters-label", text: "Evidence" }), evidenceBar(v, p, significant, rate),
    el("span", { class: "meters-label", text: "95% range" }), rangeBar(v, rate, range, significant));
}
