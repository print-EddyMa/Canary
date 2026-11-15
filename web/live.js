/* Live: disasters, warnings and super-emitters as they are reported, built into the page in
   real time. The server pushes each new alert over a server-sent event stream; the feed, the
   globe and the tab badge update the moment it arrives. */

import { el, getJSON } from "./util.js";
import { icon, statusShape } from "./ui.js";

const RANK = { critical: 0, serious: 1, watch: 2 };
const LABEL = { critical: "Critical", serious: "Serious", watch: "Watch" };
const COLOUR = { critical: "#f0525c", serious: "#f0743f", watch: "#f5a524" };
const METHANE = "#ac7fdd"; // the air family's "more in the air" pole
const FILTERS = [
  ["all", "All"], ["disaster", "Disasters"], ["weather", "Weather"], ["quake", "Earthquakes"], ["methane", "Methane"],
];
const group = (a) => (a.kind === "Methane plume" ? "methane" : a.source === "NWS" ? "weather"
  : a.kind === "Earthquake" ? "quake" : "disaster");

const live = { alerts: new Map(), filter: "all", connected: false, polled: null, map: null, canary: null, fresh: new Set() };
const $ = (id) => document.getElementById(id);

function ago(iso) {
  if (!iso) return "";
  const m = (Date.now() - Date.parse(iso)) / 6e4;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/* ---------- the globe ---------- */

function geojson() {
  return { type: "FeatureCollection", features: [...live.alerts.values()].map((a) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] },
    properties: { id: a.id, severity: a.severity, methane: a.kind === "Methane plume", rank: RANK[a.severity], rate: a.value || 0 },
  })) };
}

function addLayers(map) {
  map.addSource("alerts", { type: "geojson", data: geojson() });
  const colour = ["case", ["get", "methane"], METHANE, ["match", ["get", "severity"], "critical", COLOUR.critical, "serious", COLOUR.serious, COLOUR.watch]];
  // Methane symbols are proportional: area grows with the emission rate (kg/h).
  const methaneRadius = ["interpolate", ["linear"], ["sqrt", ["get", "rate"]], 30, 4, 100, 9, 200, 15];
  const radius = ["case", ["get", "methane"], methaneRadius, ["match", ["get", "severity"], "critical", 6.5, "serious", 5.5, 4.5]];
  map.addLayer({ id: "alerts-halo", type: "circle", source: "alerts",
    paint: { "circle-radius": ["case", ["get", "methane"], ["*", methaneRadius, 1.7], ["match", ["get", "severity"], "critical", 16, "serious", 12, 8]],
      "circle-color": colour, "circle-opacity": 0.18, "circle-blur": 0.4 } });
  map.addLayer({ id: "alerts", type: "circle", source: "alerts",
    paint: { "circle-radius": radius, "circle-color": colour,
      "circle-opacity": ["case", ["get", "methane"], 0.78, 1],
      "circle-stroke-color": ["case", ["get", "methane"], "#e9dcfa", "#0b0e13"], "circle-stroke-width": ["case", ["get", "methane"], 1, 1.5] } });
  map.on("click", "alerts", (e) => { e.originalEvent.stopPropagation(); focus(e.features[0].properties.id); });
  map.on("mouseenter", "alerts", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "alerts", () => { map.getCanvas().style.cursor = ""; });
}

/** A ring that spreads from an alert on the globe when it arrives or is chosen. */
function pulse(a) {
  const map = live.map;
  const marker = el("span", { class: `alert-pulse sev-${a.severity}${a.kind === "Methane plume" ? " methane" : ""}` });
  const m = new maplibregl.Marker({ element: marker }).setLngLat([a.lon, a.lat]).addTo(map);
  setTimeout(() => m.remove(), 6000);
}

/** Lay a methane plume's enhancement image on the ground where the instrument saw it. */
function showPlume(a) {
  const map = live.map;
  if (map.getLayer("plume")) map.removeLayer("plume");
  if (map.getSource("plume")) map.removeSource("plume");
  if (!a || !a.image || !a.bounds) return false;
  const [w, s, e, n] = a.bounds;
  const url = a.image.startsWith("/") && window.CANARY_PREVIEW ? a.image.slice(1) : a.image;
  map.addSource("plume", { type: "image", url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
  map.addLayer({ id: "plume", type: "raster", source: "plume",
    paint: { "raster-opacity": 0.95, "raster-resampling": "nearest", "raster-fade-duration": 300 } }, "alerts-halo");
  return true;
}

function focus(id) {
  const a = live.alerts.get(id);
  if (!a) return;
  live.canary.stopSpin();
  live.canary.showPane("today");
  const plume = a.kind === "Methane plume" && showPlume(a);
  if (plume) {
    const [w, s, e, n] = a.bounds;
    live.map.fitBounds([[w, s], [e, n]], { padding: 160, maxZoom: 13.5, duration: 1800 });
  } else {
    live.map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(live.map.getZoom(), 4.5), duration: 1400 });
  }
  pulse(a);
  const card = document.querySelector(`[data-alert="${CSS.escape(id)}"]`);
  if (card) {
    document.querySelectorAll(".alert.is-focus").forEach((n) => n.classList.remove("is-focus"));
    card.classList.add("is-focus");
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

/* ---------- the feed ---------- */

function card(a) {
  const node = el("li", { class: `alert sev-${a.severity}${live.fresh.has(a.id) ? " is-new" : ""}`, "data-alert": a.id },
    el("button", { type: "button", class: "alert-main", onclick: () => focus(a.id) },
      el("span", { class: "alert-sev", title: LABEL[a.severity] }, a.kind === "Methane plume" ? methaneIcon() : statusShape(a.severity)),
      el("span", { class: "alert-text" },
        el("span", { class: "alert-kind" }, a.kind, el("span", { class: "alert-dot", text: "·" }), el("time", { datetime: a.time || "", text: ago(a.time) })),
        el("strong", { class: "alert-title", text: a.title }),
        a.where ? el("span", { class: "alert-where", text: a.where }) : null)),
    el("details", { class: "alert-more" },
      el("summary", { "aria-label": "More about this alert" }, icon("chevron")),
      el("div", {},
        a.image ? el("figure", { class: "plume-figure" },
          el("img", { src: window.CANARY_PREVIEW ? a.image.slice(1) : a.image, alt: "Methane enhancement image", loading: "lazy", width: 96, height: 96 }),
          el("figcaption", {}, el("strong", { text: `${a.value.toLocaleString()} kg/h` }),
            a.uncertainty ? el("span", { text: `± ${a.uncertainty.toLocaleString()} (1σ)` }) : null,
            el("span", { text: `${(a.value * 24 * 365 / 1e6).toFixed(1)} kt CH₄/yr if continuous` }))) : null,
        a.detail ? el("p", { text: a.detail }) : null,
        el("p", { class: "alert-source" }, `Reported by ${a.source}. `,
          a.url ? el("a", { href: a.url, target: "_blank", rel: "noopener", text: "Full report" }) : null),
        el("button", { type: "button", class: "btn small",
          onclick: () => live.canary.select(a.lat, a.lon, a.where || a.title, { tab: "vitals" }) }, "Open this place"))));
  return node;
}

function methaneIcon() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.innerHTML = '<path d="M8 2c2 3 4 4.6 4 7.2A4 4 0 0 1 4 9.2C4 6.6 6 5 8 2z" fill="currentColor"/>';
  s.style.color = METHANE;
  return s;
}

/** Every current plume ranked by emission rate with its 1σ uncertainty: which few sources dominate. */
function rateChart(plumes) {
  const rows = plumes.filter((a) => a.value).sort((p, q) => q.value - p.value).slice(0, 15);
  if (rows.length < 2) return null;
  const NS = "http://www.w3.org/2000/svg";
  const W = 330, row = 15, m = { l: 108, r: 40, t: 18, b: 6 }, H = m.t + rows.length * row + m.b;
  const top = Math.max(...rows.map((a) => a.value + (a.uncertainty || 0)));
  const sx = (v) => m.l + (v / top) * (W - m.l - m.r);
  const total = rows.reduce((t, a) => t + a.value, 0);
  const node = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; return n; };
  const root = node("svg", { viewBox: `0 0 ${W} ${H}`, class: "sci rate-chart", role: "img", "aria-label": "Methane plumes ranked by emission rate" });
  root.append(node("text", { x: m.l, y: 10, class: "axis-title" }, "Emission rate, kg/h (±1σ)"));
  let running = 0;
  rows.forEach((a, i) => {
    const y = m.t + i * row + row / 2;
    running += a.value;
    const g = node("g", { class: "rate-row", tabindex: 0 });
    g.append(node("text", { x: m.l - 6, y: y + 3.5, class: "tick", "text-anchor": "end" }, `${i + 1}  ${(a.where || "Unknown").slice(0, 15)}`));
    g.append(node("title", {}, `${a.where || ""}: ${a.value.toLocaleString()} kg/h${a.uncertainty ? ` ± ${a.uncertainty.toLocaleString()}` : ""}`));
    g.append(node("line", { x1: sx(0), x2: sx(a.value), y1: y, y2: y, class: "rate-stem" }));
    if (a.uncertainty) g.append(node("line", { x1: sx(Math.max(0, a.value - a.uncertainty)), x2: sx(a.value + a.uncertainty), y1: y, y2: y, class: "rate-err" }));
    g.append(node("circle", { cx: sx(a.value), cy: y, r: 3.2, fill: METHANE }));
    g.append(node("text", { x: W - 2, y: y + 3.5, class: "tick", "text-anchor": "end" }, `${Math.round((100 * running) / total)}%`));
    g.addEventListener("click", () => focus(a.id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter") focus(a.id); });
    root.append(g);
  });
  root.append(node("text", { x: W - 2, y: 10, class: "axis-title", "text-anchor": "end" }, "cum."));
  return el("div", { class: "rate-wrap" }, root);
}

function renderFeed() {
  const list = $("live-feed");
  if (!list) return;
  const shown = [...live.alerts.values()]
    .filter((a) => live.filter === "all" || group(a) === live.filter)
    .sort(live.filter === "methane" ? (a, b) => (b.value || 0) - (a.value || 0)
      : (a, b) => RANK[a.severity] - RANK[b.severity] || Date.parse(b.time || 0) - Date.parse(a.time || 0));
  list.replaceChildren(...shown.map(card));
  const chart = $("live-chart");
  if (chart) {
    const c = live.filter === "methane" ? rateChart(shown) : null;
    chart.replaceChildren(...(c ? [c] : []));
    chart.hidden = !c;
  }
  $("live-empty").hidden = shown.length > 0;
  const counts = { critical: 0, serious: 0 };
  for (const a of live.alerts.values()) if (a.severity in counts) counts[a.severity]++;
  $("live-summary").replaceChildren(
    ...["critical", "serious"].filter((k) => counts[k]).map((k) => el("span", { class: `live-count sev-${k}` }, statusShape(k), `${counts[k]} ${LABEL[k].toLowerCase()}`)),
    el("span", { class: "live-total", text: `${live.alerts.size} alerts` }));
  const badge = $("live-badge");
  const urgent = counts.critical + counts.serious;
  badge.textContent = urgent ? String(urgent) : "";
  badge.hidden = !urgent;
  if (live.map && live.map.getSource("alerts")) live.map.getSource("alerts").setData(geojson());
}

function renderFilters() {
  $("live-filters").replaceChildren(...FILTERS.map(([key, label]) => el("button", {
    type: "button", "aria-pressed": String(live.filter === key), text: label,
    onclick: () => { live.filter = key; renderFilters(); renderFeed(); },
  })));
}

function setStatus() {
  const s = $("live-status");
  if (window.CANARY_PREVIEW) { s.dataset.state = "polling"; s.textContent = "Snapshot: not live"; return; }
  s.dataset.state = live.connected ? "live" : "polling";
  s.textContent = live.connected ? `Live · updated ${live.polled ? ago(new Date(live.polled * 1000).toISOString()) : "now"}` : "Reconnecting…";
}

/* ---------- arrival ---------- */

function announce(a) {
  const box = $("alert-banner");
  const close = () => { box.hidden = true; };
  box.className = `alert-banner sev-${a.severity}`;
  box.replaceChildren(
    el("span", { class: "alert-sev" }, a.kind === "Methane plume" ? methaneIcon() : statusShape(a.severity)),
    el("span", { class: "alert-text" }, el("span", { class: "alert-kind", text: `New · ${a.kind}` }), el("strong", { text: a.title }),
      a.where ? el("span", { class: "alert-where", text: a.where }) : null),
    el("button", { type: "button", class: "btn small", text: "Show", onclick: () => { close(); focus(a.id); } }),
    el("button", { type: "button", class: "btn small quiet icon-only", "aria-label": "Dismiss", onclick: close }, icon("close")));
  box.hidden = false;
  clearTimeout(announce.timer);
  announce.timer = setTimeout(close, 14000);
}

function receive(a, { quiet = false } = {}) {
  const isNew = !live.alerts.has(a.id);
  live.alerts.set(a.id, a);
  if (!isNew || quiet) return;
  live.fresh.add(a.id);
  setTimeout(() => { live.fresh.delete(a.id); }, 8000);
  renderFeed();
  pulse(a);
  if (a.severity !== "watch") announce(a);
}

/* ---------- connection ---------- */

async function load() {
  const data = await getJSON("/api/alerts");
  live.polled = data.polled;
  // Build the feed one card at a time, newest severity first: the page assembles as you watch.
  const ordered = data.alerts;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (let i = 0; i < ordered.length; i++) {
    live.fresh.add(ordered[i].id);
    receive(ordered[i], { quiet: true });
    if (!reduce && i < 12) { renderFeed(); await new Promise((r) => setTimeout(r, 70)); }
  }
  renderFeed();
  setTimeout(() => { live.fresh.clear(); renderFeed(); }, 1500);
}

function connect() {
  if (window.CANARY_PREVIEW || !window.EventSource) return;
  const source = new EventSource("/api/alerts/stream");
  source.addEventListener("open", () => { live.connected = true; setStatus(); });
  source.addEventListener("alert", (e) => { live.polled = Date.now() / 1000; receive(JSON.parse(e.data)); setStatus(); });
  source.addEventListener("error", () => { live.connected = false; setStatus(); });
}

// For the console and tests: push an alert through the same path a live one takes.
window.canaryLive = { receive: (a) => receive(a), alerts: live.alerts };

export async function initLive(canary) {
  live.canary = canary;
  live.map = canary.map;
  renderFilters();
  addLayers(live.map);
  try {
    await load();
  } catch (error) {
    $("live-empty").hidden = false;
    $("live-empty").textContent = `Live alerts did not load: ${error.message}`;
  }
  connect();
  setStatus();
  // Keep "5 min ago" honest.
  setInterval(() => { renderFeed(); setStatus(); }, 60000);
}
