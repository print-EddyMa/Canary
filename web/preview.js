/* Snapshot build: answers the app's API calls from precomputed files, so it works with no
   backend. Written by `python -m canary.snapshot`; not loaded by the live app. */
(() => {
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
      case "/api/layers": return []; // NASA imagery cannot load inside the snapshot
      case "/api/weather": return file("data/weather.json");
      case "/api/satellite": throw new Error("The satellite loop needs the running app.");
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

  window.CANARY_PREVIEW = { getJSON, bytes };

  document.addEventListener("DOMContentLoaded", async () => {
    const meta = await file("data/snapshot.json").catch(() => null);
    if (!meta) return;
    const note = document.createElement("p");
    note.className = "preview-note";
    note.textContent = `Snapshot of ${meta.date}: every result is real, computed for each variable's full record. `
      + "The running app also takes any years, boxes drawn on the globe, any place, and NASA's satellite imagery.";
    document.getElementById("trend").prepend(note);
  });
})();
