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
 * fit         optional [{x, y}, {x, y}] straight line; fitStrong draws it bold
 * zeroLine    draw and label a zero baseline (anomaly charts)
 * area        fill under the line (profiles)
 * xTicks      "decades" or "auto"; xFormat formats auto ticks
 * rows(i)     tooltip lines for point i (first line is the heading)
 * onHover(i)  called with the hovered index, or null when the pointer leaves
 */
export function lineChart({ x, y, fit, fitStrong, zeroLine, area, xTicks = "decades", xFormat, rows, label, onHover, height = 150 }) {
  const W = 400, H = height, m = { l: 42, r: 12, t: 8, b: 20 };
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
    root.append(svg("line", {
      class: fitStrong ? "fit" : "fit weak",
      x1: sx(fit[0].x), y1: sy(fit[0].y), x2: sx(fit[1].x), y2: sy(fit[1].y),
    }));
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
