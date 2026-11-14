/* Canary front end: the globe, its layers, and the place dossier. */

import { conditionCard, nowTab, silence, terrainTab, vitalsTab } from "./dossier.js";
import { coordText, el, fixed, getJSON, kmBetween, sig, thousands } from "./util.js";
import { WindLayer } from "./wind.js";

const HOME = { center: [15, 20], zoom: 1.7, pitch: 0, bearing: 0 };
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const WORLD = [[-180, 85.051129], [180, 85.051129], [180, -85.051129], [-180, -85.051129]];
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  ["earthquakes", "Earthquake", "#c98500"],
];
const OTHER_EVENT = "#d55181";

const state = {
  overlay: null, // null | {type: "alarm"} | {type: "trend", id} | {type: "gibs", key}
  opacity: 0.85,
  base: "blue_marble",
  date: null, // null = latest available, else "YYYY-MM-DD"
  wind: !REDUCED_MOTION,
  events: true,
  quakes: true,
  terrain: false,
  borders: true,
  labels: true,
  streams: true,
  place: null, // {lat, lon, name}
  tab: "vitals",
};

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
      events: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      raindrop: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      drop: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#05070c" } },
      { id: "base", type: "raster", source: "base" },
      { id: "borders", type: "raster", source: "borders", paint: { "raster-opacity": 0.55 } },
      { id: "labels", type: "raster", source: "labels", minzoom: 2.5 },
      { id: "storm-tracks", type: "line", source: "events", filter: ["==", ["get", "track"], true],
        paint: { "line-color": "#3987e5", "line-width": 2, "line-opacity": 0.8 } },
      { id: "raindrop-glow", type: "line", source: "raindrop",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#3987e5", "line-width": 9, "line-opacity": 0.35, "line-blur": 4 } },
      { id: "raindrop-line", type: "line", source: "raindrop",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#cde2fb", "line-width": 2.5 } },
      { id: "events", type: "circle", source: "events", filter: ["!=", ["get", "track"], true],
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "earthquakes"],
            ["interpolate", ["linear"], ["coalesce", ["get", "mag"], 4.5], 4.5, 4, 7.5, 13], 5.5],
          "circle-color": ["match", ["get", "kind"], ...EVENT_KINDS.flatMap(([k, , c]) => [k, c]), OTHER_EVENT],
          "circle-stroke-color": "#0d0d0d",
          "circle-stroke-width": 2,
          "circle-opacity": 0.95,
        } },
      { id: "drop", type: "circle", source: "drop",
        paint: { "circle-radius": 6, "circle-color": "#ffffff", "circle-stroke-color": "#3987e5", "circle-stroke-width": 3 } },
    ],
  },
});
// Keep the globe clear of the layer dock on wide screens.
const WIDE = window.matchMedia("(min-width: 821px)");
const framePadding = () => ({ left: WIDE.matches ? 290 : 0, right: 0, top: 0, bottom: 0 });
map.setPadding(framePadding());
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
  if (o) {
    if (o.type === "gibs") {
      const layer = layerInfo(o.key);
      map.addSource("overlay", {
        type: "raster", tiles: [tileUrl(layer)], tileSize: 256, maxzoom: layer.maxzoom,
        attribution: `${layer.label}: NASA GIBS (${layer.sensor})`,
      });
    } else {
      const image = o.type === "alarm" ? maps.alarm.image : maps.layers.find((l) => l.id === o.id).image;
      map.addSource("overlay", { type: "image", url: image, coordinates: WORLD });
    }
    map.addLayer({
      id: "overlay", type: "raster", source: "overlay",
      paint: {
        "raster-opacity": state.opacity,
        "raster-fade-duration": 0,
        "raster-resampling": o.type === "gibs" ? "linear" : "nearest",
      },
    }, map.getLayer("drainage") ? "drainage" : "borders");
  }
  applyBase();
  renderLegend();
}

function applyToggles() {
  map.setLayoutProperty("borders", "visibility", state.borders ? "visible" : "none");
  map.setLayoutProperty("labels", "visibility", state.labels ? "visible" : "none");
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
    const { blue_arm: blue, red_arm: red } = maps.colors;
    const negative = l.red_when_rising ? blue : red;
    const positive = l.red_when_rising ? red : blue;
    parts.push(el("div", { class: "legend-block" },
      el("h3", { text: `${l.label}: change per decade` }),
      el("div", { class: "ramp", style: `background:${gradient([...negative].reverse().concat(positive.slice(1)))}` }),
      el("div", { class: "ramp-labels" },
        el("span", { text: `−${sig(l.scale_max)} or less` }), el("span", { text: "0" }),
        el("span", { text: `+${sig(l.scale_max)} ${l.unit} or more` })),
      el("p", { text: `${l.period[0]}–${l.period[1]}. A trend unlikely to be chance covers ${fixed(l.percent_significant, 1)}% of `
        + `the mapped area: ${fixed(l.percent_rising, 1)}% rising, ${fixed(l.percent_falling, 1)}% falling. Faint cells could be chance.` }),
      el("p", { class: "fine", text: `${l.source}. Click any cell for its full chart.` })));
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
      el("p", { class: "fine", text: "Click any cell to see which ones, and why." })));
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

function setOverlay(overlay) {
  state.overlay = overlay;
  spinning = false;
  applyOverlay();
  renderDock();
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
    sections.push(section("analysis", "Canary analysis, 1981–2025", true,
      pick(null, "None", "Show the globe without a data overlay"),
      pick({ type: "alarm" }, "Alarm map", "How many vital signs have left their normal range"),
      ...maps.layers.map((l) => pick({ type: "trend", id: l.id }, `${l.label} trend`, l.definition))));
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

const welcome = document.getElementById("welcome");
const placeBox = document.getElementById("place");
const panes = {
  vitals: document.getElementById("pane-vitals"),
  terrain: document.getElementById("pane-terrain"),
  now: document.getElementById("pane-now"),
};
let dropTimer = null;

function setTab(tab) {
  state.tab = tab;
  for (const [name, pane] of Object.entries(panes)) {
    pane.hidden = name !== tab;
    document.getElementById(`tab-${name}`).setAttribute("aria-selected", String(name === tab));
  }
  silence();
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

function showWelcome() {
  silence();
  requestId++;
  state.place = null;
  placeBox.hidden = true;
  welcome.hidden = false;
  marker.remove();
  popup.remove();
  clearPlaceLayers();
  history.replaceState(null, "", location.pathname);
  map.flyTo({ ...HOME, duration: 1500 });
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
      paint: { "raster-fade-duration": 0, "raster-resampling": "nearest", "raster-opacity": 0.9 } }, "borders");
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

async function select(lat, lon, name, { fly = true } = {}) {
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const id = ++requestId;
  spinning = false;
  silence();
  popup.remove();
  state.place = { lat, lon, name };
  marker.setLngLat([lon, lat]).addTo(map);
  if (fly) map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 4), duration: 1600 });
  welcome.hidden = true;
  placeBox.hidden = false;
  clearPlaceLayers();
  const head = document.getElementById("place-head");
  const coords = el("p", { class: "place-coords", text: coordText(lat, lon) });
  head.replaceChildren(
    el("button", { class: "back", type: "button", text: "← Overview", onclick: showWelcome }),
    el("h1", { text: name || "Selected location" }),
    coords);
  const loading = (text) => el("p", { class: "loading-note", text });
  panes.vitals.replaceChildren(loading("Reading 45 years of NASA records…"));
  panes.terrain.replaceChildren(loading("Reading the terrain and tracing the raindrop…"));
  panes.now.replaceChildren(loading("Fetching live conditions…"));
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

map.on("click", (e) => {
  const hits = map.queryRenderedFeatures(e.point, { layers: ["events"] });
  if (hits.length) { showEventPopup(hits[0], e.lngLat); return; }
  select(e.lngLat.lat, e.lngLat.lng, null, { fly: false });
});
map.on("mouseenter", "events", () => { map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", "events", () => { map.getCanvas().style.cursor = ""; });

const hud = document.getElementById("hud");
map.on("mousemove", (e) => {
  hud.textContent = `${coordText(e.lngLat.lat, e.lngLat.lng)}  ·  zoom ${map.getZoom().toFixed(1)}`;
});
map.on("mouseout", () => { hud.textContent = ""; });

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

/* ---------- welcome panel ---------- */

function fillWelcome() {
  const views = document.getElementById("views");
  const view = (title, note, action) =>
    views.append(el("li", {}, el("button", { type: "button", onclick: action }, title, el("small", { text: note }))));
  const home = () => map.flyTo({ ...HOME, center: map.getCenter(), duration: 1200 });
  if (maps) {
    view("Where is Earth changing most?", "The alarm map: places where several vital signs have left their normal range",
      () => { setOverlay({ type: "alarm" }); home(); });
    view("Where is it warming?", `A real warming trend covers ${fixed(maps.layers[0].percent_rising, 0)}% of Earth's surface`,
      () => { setOverlay({ type: "trend", id: "temperature" }); home(); });
    view("Where is rain changing?", "Wetter in blue, drier in red; most of the map is too noisy to call",
      () => { setOverlay({ type: "trend", id: "precipitation" }); home(); });
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

map.on("load", async () => {
  // Phones start with the layer list folded away.
  if (window.matchMedia("(max-width: 820px)").matches) document.getElementById("dock-toggle").click();
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
  renderDock();
  applyToggles();
  fillWelcome();

  // Deep link: #lat,lon,name
  const parts = decodeURIComponent(location.hash.slice(1)).split(",");
  if (parts.length >= 2 && parts[0] !== "" && isFinite(parts[0]) && isFinite(parts[1])) {
    select(Number(parts[0]), Number(parts[1]), parts.slice(2).join(",") || null);
  } else {
    spin();
  }
});

// For tests and the console.
window.canary = { map, state, select, setOverlay, setTab, wind, thousands };
