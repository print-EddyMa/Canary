/* Line charts with a crosshair and tooltip, drawn as SVG. */

import { el, svg, fixed } from "./util.js";

export function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
  return { ticks, step, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) + (step / mag === 2.5 ? 1 : 0) };
}

/**
 * One series against a numeric x axis.
 *
 * x, y        arrays (y may contain null gaps)
 * fit         optional [{x, y}, {x, y}] straight line; fitStrong draws it bold, in fitColour if given
 * zeroLine    draw and label a zero baseline (anomaly charts)
 * area        fill under the line (profiles)
 * xTicks      "decades" or "auto"; xFormat formats auto ticks
 * rows(i)     tooltip lines for point i (first line is the heading)
 * onHover(i)  called with the hovered index, or null when the pointer leaves
 */
export function lineChart({ x, y, fit, fitStrong, fitColour, zeroLine, area, xTicks = "decades", xFormat, rows, label, onHover, height = 150, width = 400 }) {
  const W = width, H = height, m = { l: 46, r: 14, t: 8, b: 20 };
  const valid = y.map((v, i) => (v == null ? null : i)).filter((i) => i != null);
  const values = valid.map((i) => y[i]).concat(fit ? fit.map((p) => p.y) : [], zeroLine || area ? [0] : []);
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo || 1) * 0.08;
  lo = area ? Math.min(lo, 0) : lo - pad;
  hi += pad;
  const x0 = x[0], x1 = x[x.length - 1];
  const sx = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0, "aria-label": label });
  const yt = niceTicks(lo, hi);
  for (const t of yt.ticks) {
    root.append(svg("line", { class: t === 0 && (zeroLine || area) ? "zero" : "grid", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }));
    const text = svg("text", { class: "tick", x: m.l - 6, y: sy(t) + 3.5, "text-anchor": "end" });
    text.textContent = (zeroLine && t > 0 ? "+" : "") + (Math.abs(t) >= 10000 ? `${fixed(t / 1000, 0)}K` : fixed(t, yt.decimals));
    root.append(text);
  }
  if (xTicks === "decades") {
    for (let year = Math.ceil(x0 / 10) * 10; year <= x1; year += 10) {
      const text = svg("text", { class: "tick", x: sx(year), y: H - 5, "text-anchor": "middle" });
      text.textContent = year;
      root.append(text);
    }
  } else {
    const xt = niceTicks(x0, x1, 5);
    for (const t of xt.ticks) {
      const text = svg("text", { class: "tick", x: sx(t), y: H - 5, "text-anchor": t === x0 ? "start" : "middle" });
      text.textContent = xFormat ? xFormat(t) : fixed(t, xt.decimals);
      root.append(text);
    }
  }

  let d = "", pen = false;
  y.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${sx(x[i]).toFixed(1)} ${sy(v).toFixed(1)}`;
    pen = true;
  });
  if (area && valid.length) {
    const first = valid[0], last = valid[valid.length - 1];
    root.append(svg("path", { class: "area", d: `${d}L${sx(x[last]).toFixed(1)} ${sy(lo)}L${sx(x[first]).toFixed(1)} ${sy(lo)}Z` }));
  }
  root.append(svg("path", { class: "data", d }));
  if (fit) {
    const line = svg("line", {
      class: fitStrong ? "fit" : "fit weak",
      x1: sx(fit[0].x), y1: sy(fit[0].y), x2: sx(fit[1].x), y2: sy(fit[1].y),
    });
    // Colour is earned: a significant trend takes its family colour.
    if (fitStrong && fitColour) line.style.stroke = fitColour;
    root.append(line);
  }
  const last = valid[valid.length - 1];
  if (!area) root.append(svg("circle", { class: "end-dot", cx: sx(x[last]), cy: sy(y[last]), r: 4 }));

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
    const left = px * (wrap.clientWidth / W);
    const flip = left > wrap.clientWidth * 0.6;
    tooltip.style.left = flip ? "" : `${left + 10}px`;
    tooltip.style.right = flip ? `${wrap.clientWidth - left + 10}px` : "";
    if (onHover) onHover(i);
  }
  function hide() {
    current = -1;
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
    if (onHover) onHover(null);
  }
  function nearest(clientX) {
    const box = root.getBoundingClientRect();
    const value = x0 + (((clientX - box.left) / box.width) * W - m.l) / (W - m.l - m.r) * (x1 - x0);
    let best = null, gap = Infinity;
    for (const i of valid) {
      const g = Math.abs(x[i] - value);
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
    const stride = Math.max(1, Math.round(valid.length / 60));
    const pos = current < 0 ? valid.length - 1 : valid.indexOf(current) + (e.key === "ArrowRight" ? stride : -stride);
    show(valid[Math.max(0, Math.min(valid.length - 1, pos))]);
  });
  return wrap;
}

/** A tiny line with an end dot, for stat tiles. No axes: the tile's number is the value. */
export function sparkline(x, y, label) {
  const W = 120, H = 32, pad = 3;
  const lo = Math.min(...y), hi = Math.max(...y);
  const sx = (v) => pad + ((v - x[0]) / (x[x.length - 1] - x[0] || 1)) * (W - 2 * pad - 4);
  const sy = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark", role: "img", "aria-label": label });
  root.append(svg("path", { class: "spark-line", d: y.map((v, i) => `${i ? "L" : "M"}${sx(x[i]).toFixed(1)} ${sy(v).toFixed(1)}`).join("") }));
  root.append(svg("circle", { class: "spark-dot", cx: sx(x[x.length - 1]), cy: sy(y[y.length - 1]), r: 3 }));
  return root;
}

/**
 * Observed months followed by an outlook with its range.
 * observed / outlook: {t: [decimal years], y: [...]}; outlook also has low and high.
 */
export function outlookChart({ observed, outlook, unit, decimals, label, monthName }) {
  const W = 400, H = 150, m = { l: 42, r: 12, t: 8, b: 20 };
  const all = observed.y.filter((v) => v != null).concat(outlook.low, outlook.high);
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo || 1) * 0.08;
  lo -= pad; hi += pad;
  const x0 = observed.t[0], x1 = outlook.t[outlook.t.length - 1];
  const sx = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0, "aria-label": label });

  const yt = niceTicks(lo, hi);
  for (const t of yt.ticks) {
    root.append(svg("line", { class: "grid", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }));
    const text = svg("text", { class: "tick", x: m.l - 6, y: sy(t) + 3.5, "text-anchor": "end" });
    text.textContent = fixed(t, yt.decimals);
    root.append(text);
  }
  for (let year = Math.ceil(x0); year <= x1; year += 1) {
    root.append(svg("line", { class: "grid", x1: sx(year), x2: sx(year), y1: H - m.b, y2: H - m.b + 3 }));
    const text = svg("text", { class: "tick", x: sx(year + 0.5), y: H - 5, "text-anchor": "middle" });
    text.textContent = year;
    if (year + 0.5 < x1) root.append(text);
  }
  // Where the record ends and the outlook begins.
  const seam = (observed.t[observed.t.length - 1] + outlook.t[0]) / 2;
  root.append(svg("line", { class: "zero", x1: sx(seam), x2: sx(seam), y1: m.t, y2: H - m.b }));

  const path = (t, y) => {
    let d = "", pen = false;
    y.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${sx(t[i]).toFixed(1)} ${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const band = outlook.t.map((t, i) => `${i ? "L" : "M"}${sx(t).toFixed(1)} ${sy(outlook.high[i]).toFixed(1)}`).join("")
    + outlook.t.map((t, i) => [t, outlook.low[i]]).reverse().map(([t, v]) => `L${sx(t).toFixed(1)} ${sy(v).toFixed(1)}`).join("") + "Z";
  root.append(svg("path", { class: "band", d: band }));
  root.append(svg("path", { class: "data", d: path(observed.t, observed.y) }));
  root.append(svg("path", { class: "outlook-line", d: path(outlook.t, outlook.y) }));

  const cross = svg("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" });
  const dot = svg("circle", { class: "hover-dot", r: 4, visibility: "hidden" });
  root.append(cross, dot);
  const tooltip = el("div", { class: "tooltip", hidden: "" });
  const wrap = el("div", { class: "plot" }, root, tooltip);
  const points = observed.t.map((t, i) => ({ t, y: observed.y[i], kind: "observed" }))
    .concat(outlook.t.map((t, i) => ({ t, y: outlook.y[i], low: outlook.low[i], high: outlook.high[i], kind: "outlook" })))
    .filter((p) => p.y != null);
  let current = -1;
  const show = (i) => {
    current = i;
    const p = points[i], px = sx(p.t);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", sy(p.y)); dot.setAttribute("visibility", "visible");
    dot.setAttribute("class", p.kind === "observed" ? "hover-dot" : "hover-dot outlook-dot");
    const year = Math.floor(p.t), month = Math.round((p.t - year) * 12 + 0.5);
    tooltip.replaceChildren(el("strong", { text: `${monthName(month)} ${year}` }),
      el("div", { text: `${p.kind === "observed" ? "Observed" : "Outlook"}: ${fixed(p.y, decimals)} ${unit}` }));
    if (p.kind === "outlook") tooltip.append(el("div", { text: `80% range ${fixed(p.low, decimals)} to ${fixed(p.high, decimals)}` }));
    tooltip.hidden = false;
    const left = px * (wrap.clientWidth / W), flip = left > wrap.clientWidth * 0.6;
    tooltip.style.left = flip ? "" : `${left + 10}px`;
    tooltip.style.right = flip ? `${wrap.clientWidth - left + 10}px` : "";
  };
  const hide = () => {
    current = -1;
    cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tooltip.hidden = true;
  };
  root.addEventListener("pointermove", (e) => {
    const box = root.getBoundingClientRect();
    const t = x0 + (((e.clientX - box.left) / box.width) * W - m.l) / (W - m.l - m.r) * (x1 - x0);
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i; });
    show(best);
  });
  root.addEventListener("pointerleave", hide);
  root.addEventListener("blur", hide);
  root.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = current < 0 ? points.length - 1 : current + (e.key === "ArrowRight" ? 1 : -1);
    show(Math.max(0, Math.min(points.length - 1, next)));
  });
  return wrap;
}


/**
 * Two regions on one axis, each as its difference from its own normal, so
 * that a cold region and a warm one can be compared. Each has its trend line.
 * series: [{name, x, y, fit: [{x, y}, {x, y}], strong}] (exactly two)
 */
export function compareChart({ series, unit, decimals, label, width = 600, height = 250 }) {
  const W = width, H = height, m = { l: 46, r: 14, t: 10, b: 20 };
  const all = series.flatMap((s) => s.y.filter((v) => v != null)).concat([0]);
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo || 1) * 0.08;
  lo -= pad; hi += pad;
  const x0 = Math.min(...series.map((s) => s.x[0])), x1 = Math.max(...series.map((s) => s.x[s.x.length - 1]));
  const sx = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0, "aria-label": label });
  const yt = niceTicks(lo, hi);
  for (const t of yt.ticks) {
    root.append(svg("line", { class: t === 0 ? "zero" : "grid", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }));
    const text = svg("text", { class: "tick", x: m.l - 6, y: sy(t) + 3.5, "text-anchor": "end" });
    text.textContent = (t > 0 ? "+" : "") + fixed(t, yt.decimals);
    root.append(text);
  }
  for (let year = Math.ceil(x0 / 10) * 10; year <= x1; year += 10) {
    const text = svg("text", { class: "tick", x: sx(year), y: H - 5, "text-anchor": "middle" });
    text.textContent = year;
    root.append(text);
  }
  series.forEach((s, k) => {
    let d = "", pen = false;
    s.y.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${sx(s.x[i]).toFixed(1)} ${sy(v).toFixed(1)}`;
      pen = true;
    });
    root.append(svg("path", { class: `data series-${k + 1}`, d }));
  });
  const cross = svg("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" });
  root.append(cross);
  const tooltip = el("div", { class: "tooltip", hidden: "" });
  const wrap = el("div", { class: "plot" }, root, tooltip);
  const years = [...new Set(series.flatMap((s) => s.x))].sort((a, b) => a - b);
  let current = -1;
  const show = (i) => {
    current = i;
    const year = years[i], px = sx(year);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    tooltip.replaceChildren(el("strong", { text: String(year) }));
    series.forEach((s, k) => {
      const v = s.y[s.x.indexOf(year)];
      if (v == null) return;
      tooltip.append(el("div", { class: "tip-row" }, el("i", { class: `key series-${k + 1}` }),
        el("b", { text: `${v > 0 ? "+" : ""}${fixed(v, decimals)} ${unit}` }), ` ${s.name}`));
    });
    tooltip.hidden = false;
    const left = px * (wrap.clientWidth / W), flip = left > wrap.clientWidth * 0.6;
    tooltip.style.left = flip ? "" : `${left + 10}px`;
    tooltip.style.right = flip ? `${wrap.clientWidth - left + 10}px` : "";
  };
  const hide = () => { current = -1; cross.setAttribute("visibility", "hidden"); tooltip.hidden = true; };
  root.addEventListener("pointermove", (e) => {
    const box = root.getBoundingClientRect();
    const v = x0 + (((e.clientX - box.left) / box.width) * W - m.l) / (W - m.l - m.r) * (x1 - x0);
    let best = 0;
    years.forEach((y, i) => { if (Math.abs(y - v) < Math.abs(years[best] - v)) best = i; });
    show(best);
  });
  root.addEventListener("pointerleave", hide);
  root.addEventListener("blur", hide);
  root.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    show(Math.max(0, Math.min(years.length - 1, current < 0 ? years.length - 1 : current + (e.key === "ArrowRight" ? 1 : -1))));
  });
  return wrap;
}
