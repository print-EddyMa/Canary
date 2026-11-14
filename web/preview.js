/* Snapshot build: answers the start page's API calls from precomputed files, so the page
   works with no backend. Written by `python -m canary.snapshot`; not loaded by the live app. */
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

  async function getJSON(url) {
    const [path, query = ""] = url.split("?");
    const q = new URLSearchParams(query);
    if (path === "/api/catalogue") return file("data/catalogue.json");
    if (path === "/api/countries") return file("data/countries.json");
    if (path === "/api/briefing") return file("data/briefing.json");
    if (path === "/api/suggest") {
      return (await file("data/suggest.json"))[`${q.get("interest") || ""}|${q.get("place") || ""}`] || [];
    }
    if (path === "/api/scan") {
      const hit = (await file("data/scan.json"))[q.get("region")];
      if (!hit) throw new Error("This snapshot has no scan for that region.");
      return hit;
    }
    if (path === "/api/investigate") {
      const hit = (await file(`data/investigate/${q.get("variable")}.json`))[q.get("region")];
      if (!hit) throw new Error("This snapshot covers the built-in regions only.");
      if (hit.error) throw new Error(hit.error);
      return hit;
    }
    return file(url);
  }

  const make = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") node.textContent = v; else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  };

  /** Explore mode needs the live server, so the snapshot shows pictures of it instead. */
  let gallery = null;
  async function explore() {
    if (!gallery) {
      const shots = await file("shots/index.json").catch(() => []);
      const close = make("button", { type: "button", class: "btn small", text: "Close" });
      gallery = make("dialog", { class: "picker shots" },
        make("div", { class: "dialog-head" }, make("h2", { text: "Explore the live globe" }), close),
        make("div", { class: "dialog-body" },
          make("p", { class: "steps-note",
            text: "The globe streams NASA imagery, wind and events and computes each place on request, so it needs "
              + "the running app. These are pictures of it." }),
          ...shots.map((s) => make("figure", {},
            make("img", { src: s.image, alt: s.title, loading: "lazy", width: s.width, height: s.height }),
            make("figcaption", {}, make("strong", { text: s.title }), ` ${s.caption}`)))));
      close.addEventListener("click", () => gallery.close());
      gallery.addEventListener("click", (e) => { if (e.target === gallery) gallery.close(); });
      document.getElementById("start").append(gallery);
    }
    gallery.showModal();
  }

  window.CANARY_PREVIEW = { getJSON, explore };

  document.addEventListener("DOMContentLoaded", async () => {
    const meta = await file("data/snapshot.json").catch(() => null);
    if (!meta) return;
    document.getElementById("start").prepend(make("p", { class: "preview-note",
      text: `Snapshot of ${meta.date}. Every result is real and was computed for the full record of each variable. `
        + "The running app also takes any range of years and any box drawn on the map, and opens the live globe." }));
  });
})();
