/* Snapshot build: answers the app's API calls from precomputed files, so it works with no
   backend. Written by `python -m canary.snapshot`; not loaded by the live app.

   The web build (`--web`, for GitHub Pages) is also live where the browser can reach the source:
   NASA imagery, the geostationary satellite loop, and the GDACS, USGS, NWS and EONET alert feeds
   are read straight from those services. Trend results stay precomputed. */
(() => {
  const WEB = Boolean(window.CANARY_WEB);
  const files = new Map();
  const file = (path) => {
    if (!files.has(path)) {
      files.set(path, fetch(path).then((r) => {
        if (!r.ok) throw new Error(`${path} did not load`);
        return r.json();
      }));
    }
    return files.get(path);
  };
  const LIVE_ONLY = "This snapshot has the four example places only. The running app reads any point on Earth.";

  async function getJSON(url) {
    const [path, query = ""] = url.split("?");
    const q = new URLSearchParams(query);
    switch (path) {
      case "/api/catalogue": return file("data/catalogue.json");
      case "/api/countries": return file("data/countries.json");
      case "/api/briefing": return file("data/briefing.json");
      case "/api/events": return file("data/events.json");
      case "/api/wind": return file("data/wind.json");
      case "/api/layers": return WEB ? file("data/layers.json") : []; // the sandboxed snapshot cannot reach NASA imagery
      case "/api/weather": return file("data/weather.json");
      case "/api/alerts": return WEB ? liveAlerts() : file("data/alerts.json");
      case "/api/satellite":
        if (WEB) return satellite();
        throw new Error("The satellite loop needs the running app.");
      case "/api/search": throw new Error("Search needs the running app.");
      case "/api/suggest":
        return (await file("data/suggest.json"))[`${q.get("interest") || ""}|${q.get("place") || ""}`] || [];
      case "/api/scan": {
        const hit = (await file("data/scan.json"))[q.get("region")];
        if (!hit) throw new Error("This snapshot has no scan for that region.");
        return hit;
      }
      case "/api/investigate": {
        const hit = (await file(`data/investigate/${q.get("variable")}.json`))[q.get("region")];
        if (!hit) throw new Error("This snapshot covers the built-in regions only.");
        if (hit.error) throw new Error(hit.error);
        return hit;
      }
      case "/api/chart": case "/api/terrain": case "/api/now": case "/api/case": {
        const key = `${Number(q.get("lat")).toFixed(2)},${Number(q.get("lon")).toFixed(2)}`;
        const places = await file("data/places.json");
        const hit = places[key] && places[key][path.slice(5)];
        if (!hit) throw new Error(LIVE_ONLY);
        return hit;
      }
      default: return file(url);
    }
  }

  /** Binary grids are published as base64 text, the one form every file host serves. */
  async function bytes(url) {
    const path = url.startsWith("/api/weather/") ? `data/weather/${url.slice(13)}.b64.txt` : url.replace(/\.bin$/, ".b64.txt");
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path} did not load`);
    const text = atob((await response.text()).trim());
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out.buffer;
  }

  /* ---------- live in the browser (web build) ---------- */

  const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
  const GEOSTATIONARY = [
    ["goes_east", "GOES-East_ABI_GeoColor", 7, "GOES-East GeoColor", "NOAA GOES-East ABI: true colour by day, infrared and city lights by night"],
    ["goes_west", "GOES-West_ABI_GeoColor", 7, "GOES-West GeoColor", "NOAA GOES-West ABI: true colour by day, infrared and city lights by night"],
    ["himawari", "Himawari_AHI_Band13_Clean_Infrared", 6, "Himawari infrared", "JMA Himawari AHI band 13 (10.4 µm): cold cloud tops are bright"],
  ];
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

  /** The latest image times of a GIBS layer, from its time domain (start/end/PT10M intervals). */
  async function latestTimes(layer, level, count) {
    const now = new Date(), from = new Date(now - 864e5);
    const url = `${GIBS}/1.0.0/${layer}/default/GoogleMapsCompatible_Level${level}/all/${iso(from)}--${iso(now)}.xml`;
    const text = await (await fetch(url)).text();
    const domain = (text.match(/<Domain>(.*?)<\/Domain>/) || [])[1] || "";
    const times = [];
    for (const part of domain.split(",").reverse()) {
      const [start, end, period] = part.split("/");
      const step = (Number((period || "").match(/PT(\d+)M/)?.[1]) || 10) * 6e4;
      for (let t = Date.parse(end.length > 10 ? end : `${end}T00:00:00Z`); t >= Date.parse(start.length > 10 ? start : `${start}T00:00:00Z`) && times.length < count; t -= step) times.push(iso(new Date(t)));
      if (times.length >= count) break;
    }
    return times.reverse();
  }

  async function satellite() {
    const out = await Promise.all(GEOSTATIONARY.map(async ([key, layer, level, label, about]) => {
      try {
        const times = (await latestTimes(layer, level, 19)).slice(0, -1); // the newest frame is listed before all its tiles exist
        return times.length ? { key, label, about, maxzoom: level, times,
          tiles: `${GIBS}/${layer}/default/{time}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.png` } : null;
      } catch (e) { return null; }
    }));
    return out.filter(Boolean);
  }

  const KIND = { TC: "Tropical cyclone", EQ: "Earthquake", FL: "Flood", DR: "Drought", VO: "Volcano", WF: "Wildfire", TS: "Tsunami" };
  const EONET_KIND = { severeStorms: "Severe storm", volcanoes: "Volcano", floods: "Flood" };
  const json = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
  const isoTime = (v) => (v == null ? null : new Date(typeof v === "number" ? v : /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`).toISOString());

  async function gdacs() {
    const since = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
    const data = await json(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Orange;Red&fromDate=${since}`);
    const out = [];
    for (const f of data.features || []) {
      const p = f.properties, [lon, lat] = f.geometry.coordinates, kind = KIND[p.eventtype] || p.eventtype;
      const ended = p.todate ? Date.parse(`${p.todate}Z`) : null;
      if (p.iscurrent !== "true" && (ended == null || Date.now() - ended > 3 * 864e5)) continue;
      let name = p.name.replace(/(,\s*)+/g, ", ").replace(/ ,/g, ",").replace(/^[,\s]+|[,\s]+$/g, "");
      if (["DR", "FL"].includes(p.eventtype) && (name.match(/,/g) || []).length > 2) {
        const [head, rest] = name.includes(" in ") ? [name.slice(0, name.indexOf(" in ")), name.slice(name.indexOf(" in ") + 4)] : [kind, name];
        const places = rest.split(",").map((x) => x.trim()).filter(Boolean);
        name = `${head} in ${places.slice(0, 3).join(", ")} and ${places.length - 3} more`;
      }
      out.push({ id: `gdacs-${p.eventtype}-${p.eventid}`, source: "GDACS", kind, severity: p.alertlevel === "Red" ? "critical" : "serious",
        title: name, detail: (p.severitydata || {}).severitytext || p.description || "",
        where: ["DR", "FL"].includes(p.eventtype) ? "" : p.country || "", lat, lon,
        time: isoTime(p.datemodified || p.fromdate), url: (p.url || {}).report });
    }
    return out;
  }

  async function usgs() {
    const data = await json("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson");
    return (data.features || []).map((f) => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      const severe = (p.mag || 0) >= 7 || ["orange", "red"].includes(p.alert) || p.tsunami;
      return { id: `usgs-${f.id}`, source: "USGS", kind: "Earthquake", severity: severe ? "critical" : "serious",
        title: `Magnitude ${p.mag.toFixed(1)} earthquake`, where: p.place || "",
        detail: (p.tsunami ? "Tsunami warning issued. " : "") + (p.mmi ? `Shaking intensity ${p.mmi.toFixed(1)} (MMI).` : ""),
        lat, lon, time: isoTime(p.time), url: p.url };
    });
  }

  const centre = (coords) => {
    const flat = [];
    const walk = (c) => (typeof c[0] === "number" ? flat.push(c) : c.forEach(walk));
    walk(coords);
    return flat.length ? [flat.reduce((s, c) => s + c[1], 0) / flat.length, flat.reduce((s, c) => s + c[0], 0) / flat.length] : null;
  };

  async function nws() {
    const data = await json("https://api.weather.gov/alerts/active?status=actual&message_type=alert&severity=Extreme,Severe");
    const groups = new Map();
    for (const f of data.features || []) {
      const p = f.properties;
      if (!/(Warning|Emergency)$/.test(p.event) || p.event.includes("Test")) continue;
      const key = `${p.event}|${p.senderName || ""}|${(p.sent || "").slice(0, 13)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    const out = await Promise.all([...groups.values()].slice(0, 15).map(async (members) => {
      const f = members[0], p = f.properties;
      let c = f.geometry ? centre(f.geometry.coordinates[0]) : null;
      if (!c && p.affectedZones && p.affectedZones[0]) {
        try { c = centre(((await json(p.affectedZones[0])).geometry || {}).coordinates || []); } catch (e) { c = null; }
      }
      if (!c) return null;
      const extra = members.length > 1 ? ` and ${members.length - 1} more area${members.length > 2 ? "s" : ""}` : "";
      const id = p.id.split("/").pop();
      return { id: `nws-${id}`, source: "NWS", kind: "US weather warning", severity: p.severity === "Extreme" ? "critical" : "watch",
        title: p.event, where: (p.areaDesc || "").split(";")[0].slice(0, 80) + extra, detail: (p.headline || "").slice(0, 220),
        lat: c[0], lon: c[1], time: isoTime(p.sent), url: `https://alerts.weather.gov/search?id=${id}` };
    }));
    return out.filter(Boolean);
  }

  async function eonet() {
    const data = await json("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=2");
    const out = [];
    for (const e of data.events || []) {
      const cat = e.categories[0].id;
      if (!EONET_KIND[cat]) continue;
      const g = e.geometry[e.geometry.length - 1];
      const [lon, lat] = g.type === "Point" ? g.coordinates : g.coordinates[0][0];
      out.push({ id: `eonet-${e.id}`, source: "NASA EONET", kind: EONET_KIND[cat], severity: "watch", title: e.title,
        where: "", detail: "", lat, lon, time: isoTime(g.date), url: e.link });
    }
    return out;
  }

  let outlines = null;
  async function countryAt(lat, lon) {
    if (!outlines) {
      outlines = [];
      for (const f of (await file("data/countries.json")).features) {
        const g = f.geometry, polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
        for (const poly of polys) {
          const ring = poly[0], xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1]);
          outlines.push([f.properties.name, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), ring]);
        }
      }
    }
    for (const [name, x0, y0, x1, y1, ring] of outlines) {
      if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[j], [bx, by] = ring[i];
        if ((ay > lat) !== (by > lat) && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
      }
      if (inside) return name;
    }
    return "";
  }

  const FEEDS = { gdacs: ["GDACS", gdacs], usgs: ["USGS", usgs], nws: ["NWS", nws], eonet: ["NASA EONET", eonet] };

  /** The snapshot's alerts, with every feed the browser can reach replaced by what it says now.
      Carbon Mapper does not allow browser requests, so methane plumes come from the snapshot. */
  async function liveAlerts() {
    const base = await file("data/alerts.json");
    const results = await Promise.allSettled(Object.values(FEEDS).map(([, feed]) => feed()));
    let alerts = base.alerts.slice(), errors = {};
    Object.entries(FEEDS).forEach(([name, [source]], k) => {
      if (results[k].status !== "fulfilled") { errors[name] = String(results[k].reason).slice(0, 160); return; }
      alerts = alerts.filter((a) => a.source !== source).concat(results[k].value);
    });
    alerts = alerts.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));
    for (const a of alerts) if (!a.where) a.where = (await countryAt(a.lat, a.lon).catch(() => "")) || "At sea";
    return { alerts, polled: Date.now() / 1000, errors, sources: base.sources, live: true };
  }

  window.CANARY_PREVIEW = { getJSON, bytes, web: WEB };

  document.addEventListener("DOMContentLoaded", async () => {
    const meta = await file("data/snapshot.json").catch(() => null);
    if (!meta) return;
    const note = document.createElement("p");
    note.className = "preview-note";
    note.textContent = WEB
      ? `Live imagery and alerts · trends precomputed ${meta.date} for every variable and region, 1981–2025.`
      : `Snapshot of ${meta.date}: every result is real, computed for each variable's full record. `
        + "The running app also takes any years, boxes drawn on the globe, any place, and NASA's satellite imagery.";
    document.getElementById("trend").prepend(note);
  });
})();
