/* Canary front end: the globe, its layers, and the place dossier. */

import { caseView, renderDashboard } from "./dashboard.js";
import { conditionCard, nowTab, silence, terrainTab, vitalsTab } from "./dossier.js";
import { coordText, el, fixed, getJSON, kmBetween, sig, thousands } from "./util.js";
import { TrendField, WeatherField } from "./fields.js";
import { WindLayer } from "./wind.js";

const HOME = { center: [15, 20], zoom: 1.7, pitch: 0, bearing: 0 };
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const WORLD = [[-180, 85.051129], [180, 85.051129], [180, -85.051129], [-180, -85.051129]];
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Snapshot build (no backend, no outside imagery): the globe shows Canary's own maps only.
const PREVIEW = Boolean(window.CANARY_PREVIEW);

const DEMOS = [
  { name: "Svalbard, Arctic Norway", lat: 78.2, lon: 15.6, note: "Among the fastest-warming places on Earth" },
  { name: "Equatorial Pacific", lat: 0, lon: -150, note: "Home of El Niño: big swings, no lasting trend" },
  { name: "Denver, Colorado", lat: 39.74, lon: -104.99, note: "Its rain travels 3,200 km to the Gulf of Mexico" },
  { name: "Nairobi, Kenya", lat: -1.28, lon: 36.82, note: "A tropical highland city: warmer and more humid" },
];

// Event kinds, in fixed colour order (identity is also given by the legend and the popup).
const EVENT_KINDS = [
  ["wildfires", "Wildfire", "#d95926"],
  ["severeStorms", "Severe storm", "#3987e5"],
  ["volcanoes", "Volcano", "#e66767"],
  ["seaLakeIce", "Iceberg or sea ice", "#199e70"],
  ["earthquakes", "Earthquake", "#e87ba4"],
];
const OTHER_EVENT = "#b8bcc1";
// Canary yellow is never data: it marks where you are looking (the chosen place, a click).
const CANARY = "#ffd21f";

const state = {
  overlay: null, // null | {type: "alarm"} | {type: "trend", id} | {type: "gibs", key}
  opacity: 0.85,
  base: "blue_marble",
  date: null, // null = latest available, else "YYYY-MM-DD"
  wind: false,
  events: true,
  quakes: true,
  terrain: false,
  borders: true,
  labels: true,
  streams: true,
  place: null, // {lat, lon, name}
  tab: "vitals",
  pane: "trend", // which side-panel tab is showing: trend | place | today
  trendId: "temperature", // the variable chosen in the header; its trend map is the default overlay
  mode: "trends", // what the globe shows: trends | weather | satellite
  weather: { temp: false, precip: true, cloud: true },
};
// Data layers sit under the outlines, routes and events.
const UNDER = ["drainage", "borders", "country-hit", "storm-tracks"];

let catalogue = []; // NASA GIBS layers
let maps = null; // global trend maps index
let eventFeatures = [];
let requestId = 0;
let spinning = !REDUCED_MOTION;

/* ---------- map ---------- */

const map = new maplibregl.Map({
  container: "map",
  ...HOME,
  maxZoom: 12,
  maxPitch: 75,
  attributionControl: { compact: true },
  style: {
    version: 8,
    projection: { type: "globe" },
    sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] },
    sources: {
      ...(PREVIEW ? {} : {
        base: {
          type: "raster",
          tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
          tileSize: 256,
          maxzoom: 8,
          attribution: "Imagery: NASA GIBS",
        },
        borders: {
          type: "raster",
          tiles: [`${GIBS}/Reference_Features/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`],
          tileSize: 256,
          maxzoom: 9,
        },
        labels: {
          type: "raster",
          tiles: [`${GIBS}/Reference_Labels/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`],
          tileSize: 256,
          maxzoom: 9,
          attribution: "Labels: OpenStreetMap contributors",
        },
      }),
      events: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      raindrop: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      drop: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#05070c" } },
      ...(PREVIEW ? [] : [
        { id: "base", type: "raster", source: "base" },
        { id: "borders", type: "raster", source: "borders", paint: { "raster-opacity": 0.55 } },
        { id: "labels", type: "raster", source: "labels", minzoom: 2.5 },
      ]),
      { id: "storm-tracks", type: "line", source: "events", filter: ["==", ["get", "track"], true],
        paint: { "line-color": "#3987e5", "line-width": 2, "line-opacity": 0.8 } },
      { id: "raindrop-glow", type: "line", source: "raindrop",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#07aeaa", "line-width": 9, "line-opacity": 0.35, "line-blur": 4 } },
      { id: "raindrop-line", type: "line", source: "raindrop",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2dd8d3", "line-width": 2.5 } },
      { id: "events", type: "circle", source: "events", filter: ["!=", ["get", "track"], true],
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "earthquakes"],
            ["interpolate", ["linear"], ["coalesce", ["get", "mag"], 4.5], 4.5, 4, 7.5, 13], 5.5],
          "circle-color": ["match", ["get", "kind"], ...EVENT_KINDS.flatMap(([k, , c]) => [k, c]), OTHER_EVENT],
          // A white ring keeps events apart from the data cells underneath.
          "circle-stroke-color": "rgba(255,255,255,0.85)",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        } },
      { id: "drop", type: "circle", source: "drop",
        paint: { "circle-radius": 6, "circle-color": "#ffffff", "circle-stroke-color": "#07aeaa", "circle-stroke-width": 3 } },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

const markerEl = el("div", { class: "place-marker" });
const marker = new maplibregl.Marker({ element: markerEl });
const wind = new WindLayer(map);
const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "280px", offset: 10 });

/* ---------- layers on the map ---------- */

function layerInfo(key) {
  return catalogue.find((c) => c.key === key);
}

/** The date actually shown for a timed NASA layer, given the chosen date. */
function effectiveDate(layer) {
  if (!layer.timed) return null;
  if (!state.date || state.date > layer.end) return layer.default_date;
  return state.date < layer.start ? layer.start : state.date;
}

const tileUrl = (layer) => layer.tiles.replace("{date}", effectiveDate(layer) ?? "");

let baseShown = "blue_marble|";

/** The lowest layer that sits above the globe's surface imagery. */
const aboveBase = () => ["hillshade", "overlay", "drainage", "borders"].find((id) => map.getLayer(id));

function applyBase() {
  if (!map.getLayer("base")) return;
  const layer = layerInfo(state.base);
  if (layer) {
    const signature = `${layer.key}|${effectiveDate(layer) ?? ""}`;
    if (signature !== baseShown) {
      // Sources cannot change their zoom range, so swap the whole source.
      baseShown = signature;
      map.removeLayer("base");
      map.removeSource("base");
      map.addSource("base", { type: "raster", tiles: [tileUrl(layer)], tileSize: 256, maxzoom: layer.maxzoom,
        attribution: `Imagery: NASA GIBS (${layer.sensor})` });
      map.addLayer({ id: "base", type: "raster", source: "base" }, aboveBase());
    }
  }
  // Dim the globe under a data overlay so the data, not the scenery, is what you read.
  const analysis = state.overlay && state.overlay.type !== "gibs";
  map.setPaintProperty("base", "raster-saturation", state.overlay ? (analysis ? -0.8 : -0.45) : 0);
  map.setPaintProperty("base", "raster-brightness-max", state.overlay ? (analysis ? 0.42 : 0.7) : 1);
}

function applyOverlay() {
  if (map.getLayer("overlay")) map.removeLayer("overlay");
  if (map.getSource("overlay")) map.removeSource("overlay");
  const o = state.overlay;
  if (o && o.type === "trend" && trendField) {
    const layer = maps.layers.find((l) => l.id === o.id);
    trendField.show(layer, state.opacity).catch((error) => console.warn(error.message));
  } else if (trendField) {
    trendField.hide();
  }
  if (o && o.type !== "trend") {
    if (o.type === "gibs") {
      const layer = layerInfo(o.key);
      map.addSource("overlay", {
        type: "raster", tiles: [tileUrl(layer)], tileSize: 256, maxzoom: layer.maxzoom,
        attribution: `${layer.label}: NASA GIBS (${layer.sensor})`,
      });
    } else {
      map.addSource("overlay", { type: "image", url: maps.alarm.image, coordinates: WORLD });
    }
    map.addLayer({
      id: "overlay", type: "raster", source: "overlay",
      paint: {
        "raster-opacity": state.opacity,
        "raster-fade-duration": 0,
        "raster-resampling": "linear",
      },
    }, UNDER.find((id) => map.getLayer(id)));
  }
  applyBase();
  renderLegend();
}

function applyToggles() {
  if (map.getLayer("borders")) map.setLayoutProperty("borders", "visibility", state.borders ? "visible" : "none");
  if (map.getLayer("labels")) map.setLayoutProperty("labels", "visibility", state.labels ? "visible" : "none");
  const kinds = [];
  if (state.events) kinds.push(["!=", ["get", "kind"], "earthquakes"]);
  if (state.quakes) kinds.push(["==", ["get", "kind"], "earthquakes"]);
  map.setLayoutProperty("events", "visibility", kinds.length ? "visible" : "none");
  if (kinds.length) map.setFilter("events", ["all", ["!=", ["get", "track"], true], ["any", ...kinds]]);
  map.setLayoutProperty("storm-tracks", "visibility", state.events ? "visible" : "none");
  if (state.wind && wind.grid) wind.start(); else wind.stop();
  renderLegend();
}

function applyTerrain() {
  if (state.terrain) {
    if (!map.getSource("dem")) {
      const dem = { type: "raster-dem", tiles: [TERRAIN_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 12,
        attribution: "Elevation: Terrain Tiles (NASA SRTM and others)" };
      map.addSource("dem", dem);
      map.addSource("dem-shade", dem);
    }
    if (!map.getLayer("hillshade")) {
      map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-shade",
        paint: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "rgba(5,7,12,0.7)",
          "hillshade-highlight-color": "rgba(255,255,255,0.25)", "hillshade-accent-color": "rgba(5,7,12,0.5)" } },
      ["overlay", "drainage", "borders"].find((id) => map.getLayer(id)));
    }
    map.setTerrain({ source: "dem", exaggeration: 1.5 });
    // Blue Marble is too coarse to drape over mountains; use the 30 m mosaic.
    if (state.base === "blue_marble" && layerInfo("landsat")) { state.base = "landsat"; applyBase(); renderDock(); }
    if (map.getZoom() >= 5 && map.getPitch() < 30) map.easeTo({ pitch: 62, duration: 900 });
  } else {
    map.setTerrain(null);
    if (map.getLayer("hillshade")) map.removeLayer("hillshade");
    if (map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  }
}

/* ---------- legend ---------- */

function gradient(stops) {
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function renderLegend() {
  const box = document.getElementById("legend");
  const parts = [];
  const o = state.overlay;

  if (o && o.type === "trend") {
    const l = maps.layers.find((x) => x.id === o.id);
    const fam = maps.families && maps.families[l.family];
    const [lowEnd, highEnd] = fam ? (l.up === "b" ? [fam.a, fam.b] : [fam.b, fam.a]) : ["", ""];
    parts.push(el("div", { class: "legend-block" },
      el("h3", { text: `${l.label}: change per decade` }),
      el("div", { class: "ramp", style: `background:${gradient(l.stops)}` }),
      el("div", { class: "ramp-labels" },
        el("span", { text: `−${sig(l.scale_max)} or less` }), el("span", { text: "0" }),
        el("span", { text: `+${sig(l.scale_max)} ${l.unit} or more` })),
      fam ? el("div", { class: "ramp-labels" }, el("span", { text: lowEnd }), el("span", { text: highEnd })) : null,
      el("p", { text: `${l.period[0]}–${l.period[1]}. A trend unlikely to be chance covers ${fixed(l.percent_significant, 1)}% of `
        + `the mapped area: ${fixed(l.percent_rising, 1)}% rising, ${fixed(l.percent_falling, 1)}% falling. Faint cells could be chance.` }),
      el("p", { class: "fine", text: `${l.source}. Click a country for its trend.` })));
  } else if (o && o.type === "alarm") {
    const swatches = el("div", { class: "steps" });
    const ramp = maps.colors.alarm;
    for (let n = 1; n <= maps.alarm.scale_max; n++) {
      const t = (n - 1) / (maps.alarm.scale_max - 1) * (ramp.length - 1);
      const lo = Math.floor(t);
      const mixed = lo >= ramp.length - 1 ? ramp[ramp.length - 1]
        : `color-mix(in srgb, ${ramp[lo]} ${Math.round((1 - (t - lo)) * 100)}%, ${ramp[lo + 1]})`;
      swatches.append(el("span", {}, el("i", { style: `background:${mixed}` }), n === maps.alarm.scale_max ? `${n}+` : String(n)));
    }
    parts.push(el("div", { class: "legend-block" },
      el("h3", { text: "Alarm map: vital signs outside their normal range" }),
      swatches,
      el("p", { text: "Number of the ten vital signs whose long-term change is both unlikely to be chance and larger than "
        + `ordinary year-to-year swings. At least one: ${fixed(maps.alarm.percent_any, 1)}% of Earth's surface. `
        + `Three or more: ${fixed(maps.alarm.percent_three_plus, 1)}%.` }),
      el("p", { class: "fine", text: "Open the Place tab at any point to see which ones, and why." })));
  } else if (o && o.type === "gibs") {
    const l = layerInfo(o.key);
    const date = effectiveDate(l);
    parts.push(el("div", { class: "legend-block" },
      el("h3", { text: l.label }),
      l.legend ? el("img", { class: "gibs-legend", src: l.legend, alt: `Colour scale for ${l.label}` }) : null,
      el("p", { text: l.about }),
      el("p", { class: "fine", text: `${l.sensor}${date ? ` · ${date}` : ""}${l.period && l.period !== "P1D" && l.timed ? " · multi-day product" : ""}` })));
  }
  if (o) {
    const slider = el("input", { type: "range", min: 0.2, max: 1, step: 0.05, value: state.opacity, "aria-label": "Overlay opacity" });
    slider.addEventListener("input", () => {
      state.opacity = Number(slider.value);
      if (map.getLayer("overlay")) map.setPaintProperty("overlay", "raster-opacity", state.opacity);
      if (trendField && state.overlay && state.overlay.type === "trend") trendField.setOpacity(state.opacity);
    });
    parts.push(el("label", { class: "opacity" }, "Opacity", slider));
  }

  if (state.events || state.quakes) {
    const kinds = EVENT_KINDS.filter(([k]) => (k === "earthquakes" ? state.quakes : state.events))
      .filter(([k]) => eventFeatures.some((f) => f.properties.kind === k));
    if (kinds.length) {
      parts.push(el("div", { class: "legend-block" },
        el("h3", { text: "Happening now" }),
        el("div", { class: "steps wrap" }, ...kinds.map(([, label, colour]) =>
          el("span", {}, el("i", { class: "round", style: `background:${colour}` }), label)))));
    }
  }
  if (state.mode === "weather" && weatherField && weatherField.meta) {
    const w = state.weather;
    const blocks = [];
    if (w.temp) blocks.push(el("div", {}, el("div", { class: "ramp", style: `background:${gradient(thermalStops())}` }),
      el("div", { class: "ramp-labels" }, el("span", { text: "−40 °C" }), el("span", { text: "0" }), el("span", { text: "+40 °C" }))));
    if (w.precip) blocks.push(el("div", { class: "steps wrap" }, ...[["0.1", RAIN[0]], ["1", RAIN[1]], ["5", RAIN[2]], ["20 mm/h", RAIN[3]]]
      .map(([label, colour]) => el("span", {}, el("i", { style: `background:${colour}` }), label))));
    if (w.cloud) blocks.push(el("p", { text: "White: cloud, from thin to overcast. Grey where it is night." }));
    parts.push(el("div", { class: "legend-block" },
      el("h3", { text: "Weather, last 24 hours" }), ...blocks,
      el("p", { class: "fine", text: `${weatherField.meta.source}. Each hour is an average; the animation blends between hours.` })));
  }
  if (state.mode === "satellite" && loop.sats.length) {
    parts.push(el("div", { class: "legend-block" },
      el("h3", { text: "Satellite loop, last 3 hours" }),
      el("p", { text: loop.sats.map((s) => s.label).join(", ") + ". A new image every 10 minutes." }),
      el("p", { class: "fine", text: "NOAA GOES and JMA Himawari, served by NASA GIBS. Europe and Africa are not covered." })));
  }
  if (state.wind && wind.grid) {
    parts.push(el("div", { class: "legend-block" },
      el("h3", { text: "Wind at 10 m" }),
      el("div", { class: "steps wrap" },
        el("span", {}, el("i", { class: "streak s1" }), "under 5 m/s"),
        el("span", {}, el("i", { class: "streak s2" }), "5–12"),
        el("span", {}, el("i", { class: "streak s3" }), "over 12")),
      el("p", { class: "fine", text: `NASA GEOS-FP analysis, ${wind.grid.time.slice(0, 16).replace("T", " ")} UTC` })));
  }
  box.replaceChildren(...parts);
  box.hidden = parts.length === 0;
}

/* ---------- layer dock ---------- */

function radio(name, checked, label, title, onchange) {
  const input = el("input", { type: "radio", name });
  input.checked = checked;
  input.addEventListener("change", onchange);
  return el("label", { class: "row", title }, input, el("span", { text: label }));
}

function check(checked, label, title, onchange) {
  const input = el("input", { type: "checkbox" });
  input.checked = checked;
  input.addEventListener("change", () => onchange(input.checked));
  return el("label", { class: "row", title }, input, el("span", { text: label }));
}

const sameOverlay = (a, b) => (a === b) || Boolean(a && b && a.type === b.type && a.id === b.id && a.key === b.key);

function setOverlay(overlay, { keepSpin = false } = {}) {
  state.overlay = overlay;
  if (!keepSpin) spinning = false;
  applyOverlay();
  renderDock();
}

/** Show the trend map of the variable chosen in the header. */
function setTrend(id, options) {
  state.trendId = id;
  if (state.mode !== "trends") { setMode("trends", { keepSpin: options && options.keepSpin }); return; }
  if (maps && maps.layers.some((l) => l.id === id)) setOverlay({ type: "trend", id }, options);
  else renderDock();
}

function renderDock() {
  const body = document.getElementById("dock-body");
  const open = new Set([...body.querySelectorAll("details[open]")].map((d) => d.dataset.id));
  const known = new Set([...body.querySelectorAll("details")].map((d) => d.dataset.id));
  const section = (id, title, defaultOpen, ...rows) => {
    const d = el("details", { "data-id": id }, el("summary", { text: title }), ...rows);
    d.open = known.has(id) ? open.has(id) : defaultOpen;
    return d;
  };
  const pick = (overlay, label, title) =>
    radio("overlay", sameOverlay(state.overlay, overlay), label, title, () => setOverlay(overlay));

  const sections = [];
  if (maps) {
    const chosen = maps.layers.find((l) => l.id === state.trendId);
    sections.push(section("analysis", "Canary analysis", true,
      chosen ? pick({ type: "trend", id: chosen.id }, `Trend: ${chosen.label.toLowerCase()}`,
        "The trend map of the variable chosen at the top") : null,
      pick({ type: "alarm" }, "Alarm map", "How many vital signs have left their normal range"),
      pick(null, "None", "Show the globe without a data overlay")));
  }
  if (weatherField) {
    const w = state.weather;
    const toggle = (key, label, title) => check(w[key], label, title, (v) => { w[key] = v; if (state.mode === "weather") drawWeather(); renderLegend(); });
    sections.push(section("weather", "Weather, last 24 hours", state.mode === "weather",
      toggle("cloud", "Clouds", "Total cloud cover, NASA GEOS-FP"),
      toggle("precip", "Rain and snow", "Precipitation rate, NASA GEOS-FP"),
      toggle("temp", "Air temperature", "Temperature 2 m above the ground, NASA GEOS-FP")));
  }
  sections.push(section("live", "Happening now", true,
    check(state.wind, "Wind (live, animated)", "Wind from NASA's GEOS weather analysis", (v) => { state.wind = v; applyToggles(); }),
    check(state.events, "Fires, storms, volcanoes, ice", "Open events from NASA EONET", (v) => { state.events = v; applyToggles(); }),
    check(state.quakes, "Earthquakes, past week", "Magnitude 4.5 and above, from USGS", (v) => { state.quakes = v; applyToggles(); })));

  const overlays = catalogue.filter((c) => c.kind === "overlay");
  if (overlays.length) {
    const today = new Date().toISOString().slice(0, 10);
    const dateInput = el("input", { type: "date", max: today, value: state.date ?? today, "aria-label": "Date for satellite layers" });
    const setDate = (value) => {
      state.date = !value || value >= today ? null : value;
      applyOverlay();
      renderDock();
    };
    dateInput.addEventListener("change", () => setDate(dateInput.value));
    const shift = (days) => {
      const d = new Date(`${state.date ?? today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      setDate(d.toISOString().slice(0, 10));
    };
    const groups = [...new Set(overlays.map((c) => c.group))];
    sections.push(section("satellite", "NASA satellite data", false,
      el("div", { class: "date-row" },
        el("button", { type: "button", "aria-label": "Previous day", text: "‹", onclick: () => shift(-1) }),
        dateInput,
        el("button", { type: "button", "aria-label": "Next day", text: "›", onclick: () => shift(1), disabled: state.date ? null : "" }),
        el("button", { type: "button", text: "Latest", onclick: () => setDate(null), disabled: state.date ? null : "" })),
      ...groups.flatMap((g) => [
        el("div", { class: "group", text: g }),
        ...overlays.filter((c) => c.group === g).map((c) => pick({ type: "gibs", key: c.key }, c.label, `${c.about} (${c.sensor})`)),
      ])));
  }

  const bases = catalogue.filter((c) => c.kind === "base");
  sections.push(section("view", "Globe and terrain", false,
    ...bases.map((c) => radio("base", state.base === c.key, c.label, `${c.about} (${c.sensor})`, () => { state.base = c.key; applyBase(); })),
    el("div", { class: "group", text: "Display" }),
    check(state.terrain, "3D terrain", "Raise mountains and shade relief. Zoom in and tilt to see it.",
      (v) => { state.terrain = v; applyTerrain(); }),
    check(state.borders, "Borders and coastlines", "", (v) => { state.borders = v; applyToggles(); }),
    check(state.labels, "Place names", "", (v) => { state.labels = v; applyToggles(); })));

  body.replaceChildren(...sections);
}

document.getElementById("dock-toggle").addEventListener("click", (e) => {
  const body = document.getElementById("dock-body");
  body.hidden = !body.hidden;
  e.currentTarget.setAttribute("aria-expanded", String(!body.hidden));
});

/* ---------- place dossier ---------- */

const paneBoxes = {
  trend: document.getElementById("trend"),
  place: document.getElementById("place"),
  today: document.getElementById("welcome"),
};

/** Switch the side panel between the trend, the selected place, and today's overview. */
function showPane(name) {
  state.pane = name;
  for (const [key, box] of Object.entries(paneBoxes)) {
    box.hidden = key !== name;
    document.getElementById(`pane-tab-${key}`).setAttribute("aria-selected", String(key === name));
  }
  silence();
  document.getElementById("panel").scrollTop = 0;
  window.dispatchEvent(new CustomEvent("canary-pane", { detail: name }));
}
for (const key of Object.keys(paneBoxes)) {
  document.getElementById(`pane-tab-${key}`).addEventListener("click", () => showPane(key));
}
const panes = {
  vitals: document.getElementById("pane-vitals"),
  terrain: document.getElementById("pane-terrain"),
  now: document.getElementById("pane-now"),
  case: document.getElementById("pane-case"),
};
let caseFor = null; // "lat,lon" of the case file already requested
let dropTimer = null;

function setTab(tab) {
  state.tab = tab;
  for (const [name, pane] of Object.entries(panes)) {
    pane.hidden = name !== tab;
    document.getElementById(`tab-${name}`).setAttribute("aria-selected", String(name === tab));
  }
  silence();
  if (tab === "case") openCase();
}

/** Ask the detective for this place's case file, once. */
function openCase() {
  const place = state.place;
  if (!place) return;
  const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
  if (caseFor === key) return;
  caseFor = key;
  if (Math.abs(place.lat) > 85) {
    panes.case.replaceChildren(el("p", { class: "vital-reading", text: "The detective does not cover the area this close to the pole." }));
    return;
  }
  const id = requestId;
  panes.case.replaceChildren(el("p", { class: "loading-note",
    text: "The detective is gathering evidence. With an AI key this takes about a minute: it investigates, a skeptic attacks the draft, and the case is revised." }));
  const name = place.name ? `&name=${encodeURIComponent(place.name)}` : "";
  getJSON(`/api/case?lat=${place.lat.toFixed(2)}&lon=${place.lon.toFixed(2)}${name}`).then((result) => {
    if (id !== requestId) return;
    panes.case.replaceChildren(...caseView(result, {
      showEvidence: (evidenceId) => {
        const node = document.getElementById(`evidence-${evidenceId}`);
        if (!node) return;
        node.open = true;
        node.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
      },
    }));
  }).catch((error) => {
    if (id !== requestId) return;
    caseFor = null;
    panes.case.replaceChildren(el("div", { class: "error", text: `The detective could not finish: ${error.message}` }));
  });
}
for (const name of Object.keys(panes)) {
  document.getElementById(`tab-${name}`).addEventListener("click", () => setTab(name));
}

function clearPlaceLayers() {
  map.getSource("raindrop").setData({ type: "FeatureCollection", features: [] });
  map.getSource("drop").setData({ type: "FeatureCollection", features: [] });
  if (map.getLayer("drainage")) map.removeLayer("drainage");
  if (map.getSource("drainage")) map.removeSource("drainage");
  cancelAnimationFrame(dropTimer);
}

function setDropAt(coordinate) {
  map.getSource("drop").setData(coordinate
    ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coordinate } }
    : { type: "FeatureCollection", features: [] });
}

/** Run a drop down the route once, so the eye catches which way the water goes. */
function animateDrop(coordinates) {
  cancelAnimationFrame(dropTimer);
  if (REDUCED_MOTION || coordinates.length < 2) return;
  const started = performance.now(), duration = 4200;
  const tick = (now) => {
    const t = Math.min((now - started) / duration, 1);
    const eased = t * t * (3 - 2 * t);
    setDropAt(coordinates[Math.min(Math.floor(eased * (coordinates.length - 1)), coordinates.length - 1)]);
    if (t < 1) dropTimer = requestAnimationFrame(tick); else setTimeout(() => setDropAt(null), 900);
  };
  dropTimer = requestAnimationFrame(tick);
}

function setStreams(on) {
  state.streams = on;
  if (map.getLayer("drainage")) map.setLayoutProperty("drainage", "visibility", on ? "visible" : "none");
}

function showTerrain(data) {
  const drop = data.raindrop;
  if (data.drainage && data.drainage.image) {
    map.addSource("drainage", { type: "image", url: data.drainage.image, coordinates: data.drainage.coordinates });
    map.addLayer({ id: "drainage", type: "raster", source: "drainage",
      layout: { visibility: state.streams ? "visible" : "none" },
      paint: { "raster-fade-duration": 0, "raster-resampling": "nearest", "raster-opacity": 0.9 } },
      ["borders", "country-hit", "storm-tracks"].find((id) => map.getLayer(id)));
  }
  const coordinates = drop && drop.path ? drop.path.geometry.coordinates : [];
  if (coordinates.length) map.getSource("raindrop").setData(drop.path);
  panes.terrain.replaceChildren(...terrainTab(data, {
    streamsOn: state.streams,
    setStreams,
    onProfileHover: (i) => { cancelAnimationFrame(dropTimer); setDropAt(i == null ? null : coordinates[i]); },
    showRoute: () => {
      if (!coordinates.length) return;
      const bounds = coordinates.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
      const wide = window.innerWidth > 820;
      map.fitBounds(bounds, { padding: { top: 90, bottom: 90, left: wide ? 330 : 30, right: wide ? 70 : 30 },
        pitch: 0, bearing: 0, maxZoom: 9, duration: 1800 });
      map.once("moveend", () => animateDrop(coordinates));
    },
    showPlace: () => map.flyTo({ center: [state.place.lon, state.place.lat], zoom: 9.5, pitch: state.terrain ? 62 : 0, duration: 1500 }),
  }));
}

function nearbyEvents(lat, lon) {
  return eventFeatures
    .filter((f) => f.geometry.type === "Point")
    .map((f) => ({ ...f, distance_km: kmBetween(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) }))
    .filter((f) => f.distance_km <= 1000)
    .sort((a, b) => a.distance_km - b.distance_km);
}

function showEventPopup(feature, lngLat) {
  const p = feature.properties;
  const when = p.date ? new Date(p.date).toISOString().slice(0, 10) : "";
  const body = el("div", { class: "popup" },
    el("strong", { text: p.title }),
    el("div", { text: [p.kind_label, p.magnitude, when].filter(Boolean).join(" · ") }),
    el("div", { class: "fine", text: `Source: ${p.source}` }),
    p.link ? el("a", { href: p.link, target: "_blank", rel: "noopener", text: "Details" }) : null);
  popup.setLngLat(lngLat ?? feature.geometry.coordinates).setDOMContent(body).addTo(map);
}

async function select(lat, lon, name, { fly = true, tab = null } = {}) {
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const id = ++requestId;
  caseFor = null;
  spinning = false;
  silence();
  popup.remove();
  state.place = { lat, lon, name };
  marker.setLngLat([lon, lat]).addTo(map);
  if (fly) map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 4), duration: 1600 });
  document.getElementById("place-empty").hidden = true;
  document.getElementById("place-body").hidden = false;
  showPane("place");
  clearPlaceLayers();
  const head = document.getElementById("place-head");
  const coords = el("p", { class: "place-coords", text: coordText(lat, lon) });
  head.replaceChildren(
    el("h1", { text: name || "Selected location" }),
    coords);
  const loading = (text) => el("p", { class: "loading-note", text });
  panes.vitals.replaceChildren(loading("Reading 45 years of NASA records…"));
  panes.terrain.replaceChildren(loading("Reading the terrain and tracing the raindrop…"));
  panes.now.replaceChildren(loading("Fetching live conditions…"));
  panes.case.replaceChildren();
  // A case file belongs to one place: reopen it if that tab is showing, or was asked for.
  if (tab) setTab(tab); else if (state.tab === "case") openCase();
  history.replaceState(null, "", `#${lat.toFixed(2)},${lon.toFixed(2)}${name ? "," + encodeURIComponent(name) : ""}`);
  document.getElementById("panel").scrollTop = 0;

  const q = `lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
  const failed = (pane, what) => (error) => {
    if (id === requestId) pane.replaceChildren(el("div", { class: "error", text: `Could not load ${what}: ${error.message}` }));
  };

  getJSON(`/api/chart?${q}`).then((data) => {
    if (id !== requestId) return;
    head.append(conditionCard(data.condition));
    coords.textContent = `${coordText(data.place.lat, data.place.lon)} · climate from one grid cell, ${data.place.grid.split(" (")[0]}`;
    panes.vitals.replaceChildren(...vitalsTab(data));
  }).catch(failed(panes.vitals, "the vital signs"));

  if (Math.abs(lat) <= 85) {
    getJSON(`/api/terrain?${q}`).then((data) => { if (id === requestId) showTerrain(data); })
      .catch(failed(panes.terrain, "the terrain"));
  } else {
    panes.terrain.replaceChildren(el("p", { class: "vital-reading", text: "Terrain is not mapped this close to the pole." }));
  }

  getJSON(`/api/now?${q}`).catch(() => null).then((now) => {
    if (id !== requestId) return;
    panes.now.replaceChildren(...nowTab(now, nearbyEvents(lat, lon), {
      showEvent: (e) => {
        map.flyTo({ center: e.geometry.coordinates, zoom: Math.max(map.getZoom(), 5), duration: 1400 });
        showEventPopup(e);
      },
      satelliteView: () => {
        state.base = "true_color";
        state.overlay = null;
        applyOverlay();
        renderDock();
        map.flyTo({ center: [lon, lat], zoom: 6.5, pitch: 0, duration: 1600 });
      },
    }));
  });
}

/* ---------- map interaction ---------- */

/** Rings spreading from where you clicked: the "you asked here" signal. */
function ripple(point) {
  if (REDUCED_MOTION) return;
  for (const delay of [0, 220, 440]) {
    const ring = el("span", { class: "ripple", style: `left:${point.x}px;top:${point.y}px;animation-delay:${delay}ms` });
    map.getContainer().append(ring);
    setTimeout(() => ring.remove(), 2200 + delay);
  }
}

map.on("click", (e) => {
  ripple(e.point);
  const hits = map.queryRenderedFeatures(e.point, { layers: ["events"] });
  if (hits.length) { showEventPopup(hits[0], e.lngLat); return; }
  // The trend view decides what a click means (a country, a box corner, or a place).
  if (window.canary.onMapClick) window.canary.onMapClick(e);
  else select(e.lngLat.lat, e.lngLat.lng, null, { fly: false });
});
map.on("mouseenter", "events", () => { map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", "events", () => { map.getCanvas().style.cursor = ""; });

/* ---------- status bar: where the cursor is and what is there ---------- */

const statusWhere = document.getElementById("status-where");
const statusValue = document.getElementById("status-value");
const statusTime = document.getElementById("status-time");
const compassName = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];

function readout(lat, lon) {
  if (state.mode === "weather" && weatherField && weatherField.meta) {
    const w = weatherField.probe(lat, lon);
    return [`${w.temp.toFixed(1)} °C`, `cloud ${Math.round(w.cloud)}%`,
      w.precip >= 0.05 ? `${w.precip.toFixed(1)} mm/h` : "dry", `wind ${w.wind.toFixed(0)} m/s from ${compassName(w.windFrom)}`].join("  ·  ");
  }
  if (state.overlay && state.overlay.type === "trend" && trendField) {
    const t = trendField.probe(lat, lon);
    const l = trendField.layer;
    if (!t || !l) return "";
    if (t.value == null) return `${l.label}: no data here`;
    const d = Math.max(0, Math.min(3, 1 - Math.floor(Math.log10(Math.abs(t.value) || 1))));
    return `${l.label}: ${t.value > 0 ? "+" : t.value < 0 ? "−" : ""}${Math.abs(t.value).toFixed(d)} ${l.unit} per decade  ·  ${t.significant ? "significant" : "could be chance"}`;
  }
  return "";
}

map.on("mousemove", (e) => {
  statusWhere.textContent = `${coordText(e.lngLat.lat, e.lngLat.lng)}  ·  z ${map.getZoom().toFixed(1)}`;
  statusValue.textContent = readout(e.lngLat.lat, e.lngLat.lng);
});
map.on("mouseout", () => { statusValue.textContent = ""; });

// A slow turn of the globe until the visitor takes over.
for (const type of ["mousedown", "touchstart", "wheel", "keydown"]) {
  map.getCanvas().addEventListener(type, () => { spinning = false; }, { passive: true });
}
function spin() {
  // The turn is slow enough that wind trails need not be wiped every frame.
  wind.keepTrails = spinning;
  if (!spinning) return;
  const c = map.getCenter();
  map.jumpTo({ center: [c.lng + 0.04, c.lat] });
  requestAnimationFrame(spin);
}

/* ---------- modes: trends, weather, satellite ---------- */

let trendField = null;
let weatherField = null;
// Rain from light to heavy: the water family's wet side, brightening to white.
const RAIN = ["#0a8481", "#07aeaa", "#2dd8d3", "#d4fbf8"];
const thermalStops = () => {
  const t = maps && maps.layers.find((l) => l.id === "temperature");
  return t ? t.stops : ["#89c3fe", "#399cf6", "#2e76ba", "#225382", "#2e3133", "#7c3a31", "#b15246", "#ea6a5b", "#ffa193"];
};

const timeline = {
  box: document.getElementById("timeline"),
  play: document.getElementById("timeline-play"),
  range: document.getElementById("timeline-range"),
  label: document.getElementById("timeline-label"),
  note: document.getElementById("timeline-note"),
  frames: 0,
  time: 0,
  playing: false,
  last: 0,
  speed: 1, // frames per second
  onTime: null,
};

function setTimeline({ frames, time, speed, label, note, onTime }) {
  Object.assign(timeline, { frames, time, speed, onTime });
  timeline.labelFor = label;
  timeline.range.max = String(frames - 1);
  timeline.range.step = "0.01";
  timeline.range.value = String(time);
  timeline.note.textContent = note;
  timeline.box.hidden = false;
  showTime(time);
}

function showTime(time) {
  timeline.time = time;
  timeline.range.value = String(time);
  if (timeline.onTime) timeline.onTime(time);
  timeline.label.textContent = timeline.labelFor(time);
}

function setPlaying(on) {
  timeline.playing = on;
  timeline.play.setAttribute("aria-label", on ? "Pause" : "Play");
  timeline.play.dataset.state = on ? "playing" : "paused";
  if (weatherField) weatherField.setPlaying(on && state.mode === "weather");
  if (on) { timeline.last = performance.now(); requestAnimationFrame(tick); }
}

function tick(now) {
  if (!timeline.playing) return;
  const dt = Math.min(0.1, (now - timeline.last) / 1000);
  timeline.last = now;
  let t = timeline.time + dt * timeline.speed;
  if (t > timeline.frames - 1) t = 0; // loop
  showTime(t);
  requestAnimationFrame(tick);
}

timeline.play.addEventListener("click", () => setPlaying(!timeline.playing));
timeline.range.addEventListener("input", () => { setPlaying(false); showTime(Number(timeline.range.value)); });
document.addEventListener("keydown", (e) => {
  if (timeline.box.hidden || e.target.closest("input, textarea, select, [contenteditable], dialog")) return;
  if (e.key === " ") { e.preventDefault(); setPlaying(!timeline.playing); }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    setPlaying(false);
    showTime(Math.max(0, Math.min(timeline.frames - 1, Math.round(timeline.time) + (e.key === "ArrowRight" ? 1 : -1))));
  }
});

const fmtUTC = (d) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
const ago = (d) => {
  const h = (Date.now() - d) / 3.6e6;
  return h < 1 ? `${Math.round(h * 60)} min ago` : `${Math.round(h)} h ago`;
};

let windFrame = -1;
function drawWeather(time = timeline.time) {
  if (!weatherField || !weatherField.meta) return;
  weatherField.show = { ...state.weather };
  weatherField.draw(time);
  const f = Math.round(time);
  if (f !== windFrame) {
    windFrame = f;
    wind.grid = weatherField.windGrid(f);
  }
  statusTime.textContent = `NASA GEOS-FP · ${fmtUTC(weatherField.dateAt(time))}`;
}

async function startWeather() {
  timeline.box.hidden = false;
  timeline.label.textContent = "Loading the last 24 hours from NASA GEOS-FP…";
  timeline.note.textContent = "";
  timeline.range.disabled = timeline.play.disabled = true;
  let meta;
  try {
    meta = await weatherField.load(getJSON);
  } catch (error) {
    timeline.label.textContent = `Weather did not load: ${error.message}`;
    return;
  }
  if (state.mode !== "weather") return;
  if (meta.status !== "ready") {
    timeline.label.textContent = meta.status === "failed"
      ? `NASA GEOS-FP did not answer (${meta.error || "unknown error"}). Trying again shortly.`
      : "Fetching the last 24 hours from NASA GEOS-FP. This takes a minute or two the first time…";
    setTimeout(() => { if (state.mode === "weather") startWeather(); }, 8000);
    return;
  }
  timeline.range.disabled = timeline.play.disabled = false;
  state.wind = true;
  windFrame = -1;
  setTimeline({
    frames: meta.frames, time: meta.frames - 1, speed: 2.5,
    label: (t) => { const d = weatherField.dateAt(t); return `${fmtUTC(d)} · ${ago(d)}`; },
    note: `Hourly analysis, ${meta.frames - 1} hours`,
    onTime: (t) => drawWeather(t),
  });
  applyToggles();
  renderLegend();
  if (!REDUCED_MOTION) setPlaying(true);
}

/* The satellite loop: one raster layer per satellite and image time; the timeline shows one.
   Images load newest first, one time step at a time, so the loop is usable while it fills. */
const loop = { sats: [], frames: 0, shown: -1, loaded: new Set(), run: 0 };
const LOOP_FRAMES = 9; // every 20 minutes over about 3 hours
const HIDDEN = 0.003;
const loopId = (s, k) => `sat-${s.key}-${k}`;

async function startLoop() {
  timeline.box.hidden = false;
  timeline.label.textContent = "Finding the latest satellite images…";
  timeline.range.disabled = timeline.play.disabled = true;
  let sats;
  try {
    sats = await getJSON("/api/satellite");
  } catch (error) {
    timeline.label.textContent = `Satellite images are unavailable: ${error.message}`;
    return;
  }
  if (state.mode !== "satellite") return;
  stopLoop();
  const run = ++loop.run;
  loop.sats = sats.map((s) => ({ ...s, times: s.times.filter((_, i, all) => (all.length - 1 - i) % 2 === 0).slice(-LOOP_FRAMES) }));
  loop.frames = Math.min(...loop.sats.map((s) => s.times.length));
  for (const s of loop.sats) {
    s.times = s.times.slice(-loop.frames);
    for (let k = 0; k < loop.frames; k++) {
      map.addSource(loopId(s, k), { type: "raster", tileSize: 256, maxzoom: s.maxzoom,
        attribution: "Imagery: NOAA GOES, JMA Himawari via NASA GIBS", tiles: [s.tiles.replace("{time}", s.times[k])] });
      map.addLayer({ id: loopId(s, k), type: "raster", source: loopId(s, k),
        layout: { visibility: "none" },
        // Hidden frames keep a sliver of opacity: a fully transparent layer lets MapLibre drop its tiles.
        // Himawari's infrared comes with a rainbow enhancement; shown in grey, cold cloud tops are white.
        paint: { "raster-opacity": HIDDEN, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0,
          "raster-saturation": s.key === "himawari" ? -1 : 0 } },
      UNDER.find((l) => map.getLayer(l)));
    }
  }
  timeline.range.disabled = timeline.play.disabled = false;
  setTimeline({
    frames: loop.frames, time: loop.frames - 1, speed: 2,
    label: (t) => { const d = new Date(loop.sats[0].times[loop.shown >= 0 ? loop.shown : Math.round(t)]); return `${fmtUTC(d)} · ${ago(d)}`; },
    note: "Loading images…",
    onTime: (t) => showLoopFrame(Math.round(t)),
  });
  renderLegend();
  // Load the newest image first, then the earlier ones in turn.
  for (let k = loop.frames - 1; k >= 0; k--) {
    if (run !== loop.run) return;
    for (const s of loop.sats) map.setLayoutProperty(loopId(s, k), "visibility", "visible");
    const started = performance.now();
    while (run === loop.run && performance.now() - started < 20000
      && !loop.sats.every((s) => map.isSourceLoaded(loopId(s, k)))) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (run !== loop.run) return;
    loop.loaded.add(k);
    timeline.note.textContent = loop.loaded.size < loop.frames
      ? `Loading images ${loop.loaded.size} of ${loop.frames}…` : `${loop.frames} images, 20 minutes apart`;
    if (k === loop.frames - 1) showLoopFrame(k, true);
    if (loop.loaded.size === 2 && !REDUCED_MOTION && !timeline.playing) setPlaying(true);
  }
}

function showLoopFrame(k, force = false) {
  // Show the nearest image whose tiles for this view have arrived; otherwise keep the one shown.
  const ready = [...loop.loaded].filter((i) => loop.sats.every((s) => map.isSourceLoaded(loopId(s, i))));
  if (!ready.length) return;
  const pick = ready.reduce((a, b) => (Math.abs(b - k) < Math.abs(a - k) ? b : a));
  if (pick === loop.shown && !force) return;
  for (const s of loop.sats) {
    for (const i of loop.loaded) {
      if (map.getLayer(loopId(s, i))) map.setPaintProperty(loopId(s, i), "raster-opacity", i === pick ? 1 : HIDDEN);
    }
  }
  loop.shown = pick;
  statusTime.textContent = `GOES · Himawari · ${fmtUTC(new Date(loop.sats[0].times[pick]))}`;
}

function stopLoop() {
  loop.run++;
  loop.loaded = new Set();
  for (const s of loop.sats) {
    for (let k = 0; k < loop.frames; k++) {
      const id = loopId(s, k);
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
  }
  loop.sats = [];
  loop.shown = -1;
}

const modeButtons = [...document.querySelectorAll("[data-mode]")];
modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

/** Switch what the globe shows. */
function setMode(mode, { keepSpin = false } = {}) {
  if (mode === "weather" && !weatherField) mode = "trends";
  const previous = state.mode;
  state.mode = mode;
  modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  setPlaying(false);
  if (previous === "weather" && mode !== "weather") {
    weatherField.hide();
    state.wind = false;
    if (lastWind) wind.grid = lastWind;
  }
  if (previous === "satellite" && mode !== "satellite") stopLoop();
  timeline.box.hidden = mode === "trends";
  statusTime.textContent = "";
  if (mode === "trends") {
    setOverlay(maps && maps.layers.some((l) => l.id === state.trendId) ? { type: "trend", id: state.trendId } : null, { keepSpin });
  } else {
    state.overlay = null;
    applyOverlay();
    if (mode === "weather") { lastWind = wind.grid; startWeather(); }
    if (mode === "satellite") { spinning = false; startLoop(); }
  }
  applyToggles();
  renderDock();
}
let lastWind = null;

/* ---------- world dashboard ---------- */

async function loadDashboard() {
  const box = document.getElementById("dashboard");
  const hooks = {
    flyTo: (lat, lon) => { spinning = false; map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 4), duration: 1500 }); },
    showEvent: (e) => {
      spinning = false;
      map.flyTo({ center: [e.lon, e.lat], zoom: Math.max(map.getZoom(), 4.5), duration: 1500 });
      showEventPopup({ properties: { title: e.title, kind_label: `${e.kind_label} · ${e.level}`, magnitude: e.size,
        date: e.date, source: e.source, link: e.link }, geometry: { coordinates: [e.lon, e.lat] } });
    },
    investigate: (e) => select(e.lat, e.lon, e.title, { tab: "case" }),
  };
  try {
    // Show the rule-written brief at once, then replace it with the AI-written one if there is a key.
    const quick = await getJSON("/api/briefing?ai=false");
    renderDashboard(box, quick, hooks);
    if (quick.ai_available) {
      const full = await getJSON("/api/briefing?ai=true");
      renderDashboard(box, full, hooks);
    }
  } catch (error) {
    box.replaceChildren(el("h1", { text: "Earth today" }),
      el("div", { class: "error", text: `The dashboard could not load: ${error.message}` }));
  }
}

/* ---------- welcome panel ---------- */

function fillWelcome() {
  const views = document.getElementById("views");
  const view = (title, note, action) =>
    views.append(el("li", {}, el("button", { type: "button", onclick: action }, title, el("small", { text: note }))));
  const home = () => map.flyTo({ ...HOME, center: map.getCenter(), duration: 1200 });
  if (maps) {
    view("Where is Earth changing most?", "The alarm map: places where several vital signs have left their normal range",
      () => { setOverlay({ type: "alarm" }); home(); });
  }
  if (layerInfo("rain")) {
    view("What did satellites see?", "The latest day of rain and snowfall measured from orbit, under live wind",
      () => { setOverlay({ type: "gibs", key: "rain" }); home(); });
  }
  const demos = document.getElementById("demos");
  for (const demo of DEMOS) {
    demos.append(el("li", {}, el("button", { type: "button", onclick: () => select(demo.lat, demo.lon, demo.name) },
      demo.name, el("small", { text: demo.note }))));
  }
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
    const places = await getJSON(`/api/search?q=${encodeURIComponent(q)}`);
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
  if (first && !searchResults.hidden) first.click(); else runSearch();
});
document.addEventListener("click", (e) => { if (!searchForm.contains(e.target)) searchResults.hidden = true; });

/* ---------- start ---------- */

let markReady;
const ready = new Promise((resolve) => { markReady = resolve; });

map.on("load", async () => {
  renderDock();

  const [layersResult, mapsResult, eventsResult, windResult] = await Promise.allSettled([
    getJSON("/api/layers"), getJSON("maps/index.json"), getJSON("/api/events"), getJSON("/api/wind"),
  ]);
  if (layersResult.status === "fulfilled") catalogue = layersResult.value;
  if (mapsResult.status === "fulfilled") maps = mapsResult.value;
  if (eventsResult.status === "fulfilled") {
    eventFeatures = eventsResult.value.features;
    map.getSource("events").setData(eventsResult.value);
  }
  if (windResult.status === "fulfilled") wind.setGrid(windResult.value);
  try {
    trendField = new TrendField(map, UNDER);
    weatherField = new WeatherField(map, UNDER, { thermal: thermalStops(), rain: RAIN });
  } catch (error) {
    console.warn(`Smooth map layers are off: ${error.message}`);
  }
  renderDock();
  applyToggles();
  fillWelcome();
  loadDashboard();

  // Deep link: #lat,lon,name
  const parts = decodeURIComponent(location.hash.slice(1)).split(",");
  if (parts.length >= 2 && parts[0] !== "" && isFinite(parts[0]) && isFinite(parts[1])) {
    select(Number(parts[0]), Number(parts[1]), parts.slice(2).join(",") || null);
  } else {
    spin();
  }
  markReady();
});

// For tests and the console.
window.canary = { map, state, select, setOverlay, setTrend, setTab, showPane, setMode, wind, thousands, ready, onMapClick: null,
  stopSpin: () => { spinning = false; }, fields: () => ({ trendField, weatherField }) };
