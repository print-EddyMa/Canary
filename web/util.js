/* Small DOM and formatting helpers shared by the front-end modules. */

export const SVG_NS = "http://www.w3.org/2000/svg";
export const MINUS = "−";

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

export function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Two significant digits, at most four decimals, no sign. */
export function sig(x) {
  const a = Math.abs(x);
  if (a === 0) return "0";
  const decimals = Math.max(0, Math.min(4, 1 - Math.floor(Math.log10(a))));
  return a.toFixed(decimals);
}
export const signed = (x) => (x > 0 ? "+" : x < 0 ? MINUS : "") + sig(x);
export const fixed = (x, d) => x.toFixed(d).replace("-", MINUS);
export const signedFixed = (x, d) => (x > 0 ? "+" : "") + fixed(x, d);
export const pText = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
export const pEquals = (p) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
export const thousands = (x) => Math.round(x).toLocaleString("en-US").replace("-", MINUS);

/** Format related numbers (an estimate and its range) with the same decimals. */
export function together(...values) {
  const top = Math.max(...values.map(Math.abs));
  const decimals = top === 0 ? 0 : Math.max(0, Math.min(4, 1 - Math.floor(Math.log10(top))));
  return values.map((v) => ({
    plain: Math.abs(v).toFixed(decimals),
    signed: (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v).toFixed(decimals),
  }));
}

export function coordText(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export function kmBetween(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Shape encodes severity, so status never rests on colour alone. */
export function statusIcon(level) {
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

export async function getJSON(url) {
  // A snapshot build (no backend) answers API calls from precomputed files.
  if (window.CANARY_PREVIEW) return window.CANARY_PREVIEW.getJSON(url);
  const response = await fetch(url);
  if (!response.ok) {
    let detail = response.statusText;
    try { detail = (await response.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return response.json();
}
