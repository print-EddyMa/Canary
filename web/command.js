/* The command palette (Cmd-K / Ctrl-K or "/"): one box to reach every variable, region, place,
   view and action, in the manner of cmdk-style palettes in professional tools.
   Sources register groups; each group returns items for the current query. */

import { el, getJSON } from "./util.js";

const groups = [];
let dialog, input, list, empty, items = [], active = -1, searchTimer = null, places = [], placeQuery = "";

/** Register a group: { name, limit, items: (query) => [{ label, detail, meta, keywords, run }] }. */
export function addGroup(group) { groups.push(group); }

/** Fuzzy score: every query letter in order, rewarding word starts and runs. 0 = no match. */
export function score(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase(), t = text.toLowerCase();
  if (t.startsWith(q)) return 100 - t.length / 100;
  const at = t.indexOf(q);
  if (at >= 0) return (/[\s,(-]/.test(t[at - 1] || " ") ? 80 : 60) - at / 100;
  let i = 0, run = 0, total = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) { i++; run++; total += run + (j === 0 || /[\s,(-]/.test(t[j - 1]) ? 3 : 0); } else run = 0;
  }
  return i === q.length ? Math.min(50, total) : 0;
}

function build() {
  input = el("input", { type: "text", class: "cmd-input", role: "combobox", "aria-expanded": "true", "aria-controls": "cmd-list",
    "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false",
    placeholder: "Search variables, regions, places and actions", "aria-label": "Search Canary" });
  list = el("ul", { class: "cmd-list", id: "cmd-list", role: "listbox", "aria-label": "Results" });
  empty = el("p", { class: "cmd-empty", text: "Nothing matches. Try a place name, a country or a variable.", hidden: "" });
  const foot = el("div", { class: "cmd-foot" },
    el("span", {}, el("kbd", { text: "↑" }), el("kbd", { text: "↓" }), " move"),
    el("span", {}, el("kbd", { text: "Enter" }), " choose"),
    el("span", {}, el("kbd", { text: "Esc" }), " close"));
  const glass = el("span", { class: "cmd-glass", "aria-hidden": "true" });
  glass.innerHTML = '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/>'
    + '<path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  dialog = el("dialog", { class: "cmd", "aria-label": "Command palette" },
    el("div", { class: "cmd-head" }, glass, input), list, empty, foot);
  document.body.append(dialog);
  input.addEventListener("input", () => { draw(); searchPlaces(); });
  input.addEventListener("keydown", onKey);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener("close", () => { input.value = ""; });
}

function setActive(i, scroll = true) {
  if (items[active]) items[active].node.classList.remove("is-active");
  active = i;
  const item = items[active];
  if (!item) { input.removeAttribute("aria-activedescendant"); return; }
  item.node.classList.add("is-active");
  input.setAttribute("aria-activedescendant", item.node.id);
  if (scroll) item.node.scrollIntoView({ block: "nearest" });
}

function draw() {
  const q = input.value.trim();
  items = [];
  const nodes = [];
  let serial = 0;
  const scored = groups.map((group) => {
    const pool = group.name === "Places" ? places : group.items(q);
    return { group, ranked: pool.map((it) => ({ it, s: group.name === "Places" ? 70 : score(q, `${it.label} ${it.keywords || ""}`) }))
      .filter((r) => r.s > 0).sort((a, b) => b.s - a.s) };
  });
  // When something contains the query as typed, loose letter-by-letter matches are noise.
  const best = Math.max(0, ...scored.flatMap(({ group, ranked }) => (group.name === "Places" ? [] : ranked.map((r) => r.s))));
  const floor = best >= 60 ? 60 : 1;
  // Groups with the strongest match come first.
  scored.sort((a, b) => (b.ranked[0]?.s || 0) - (a.ranked[0]?.s || 0) || groups.indexOf(a.group) - groups.indexOf(b.group));
  for (const { group, ranked: all } of q ? scored : scored.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group))) {
    const ranked = all.filter((r) => r.s >= floor).slice(0, q ? group.limit || 6 : group.idle ?? group.limit ?? 6);
    if (!ranked.length) continue;
    nodes.push(el("li", { class: "cmd-group", role: "presentation", text: group.name }));
    for (const { it } of ranked) {
      const index = items.length;
      const node = el("li", { class: "cmd-item", role: "option", id: `cmd-${++serial}` },
        it.icon ? el("span", { class: "cmd-icon", "aria-hidden": "true", text: it.icon }) : el("span", { class: "cmd-icon" }),
        el("span", { class: "cmd-label" }, it.label, it.detail ? el("small", { text: it.detail }) : null),
        it.meta ? el("span", { class: "cmd-meta", text: it.meta }) : null,
        it.keys ? el("span", { class: "cmd-keys" }, ...it.keys.map((k) => el("kbd", { text: k }))) : null);
      node.addEventListener("click", () => choose(index));
      node.addEventListener("mousemove", () => { if (active !== index) setActive(index, false); });
      items.push({ ...it, node });
      nodes.push(node);
    }
  }
  list.replaceChildren(...nodes);
  empty.hidden = items.length > 0 || (q.length >= 2 && placeQuery !== q);
  setActive(items.length ? 0 : -1);
}

function searchPlaces() {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (q.length < 3 || window.CANARY_PREVIEW) { places = []; placeQuery = q; return; }
  searchTimer = setTimeout(async () => {
    try {
      const found = await getJSON(`/api/search?q=${encodeURIComponent(q)}`);
      if (q !== input.value.trim()) return;
      places = found.slice(0, 5).map((p) => ({
        icon: "⌖", label: p.name, detail: p.region, meta: "Open place",
        run: () => window.canary.select(p.lat, p.lon, p.region ? `${p.name}, ${p.region.split(", ").pop()}` : p.name),
      }));
    } catch { places = []; }
    placeQuery = q;
    draw();
  }, 220);
}

function choose(i) {
  const item = items[i];
  if (!item) return;
  close();
  item.run();
}

function onKey(e) {
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (step && items.length) { e.preventDefault(); setActive((active + step + items.length) % items.length); }
  else if (e.key === "Enter") { e.preventDefault(); choose(active); }
}

export function open(prefill = "") {
  if (!dialog) build();
  input.value = prefill;
  places = [];
  draw();
  if (!dialog.open) dialog.showModal();
  input.focus();
}

export function close() { if (dialog && dialog.open) dialog.close(); }

/** Cmd-K, Ctrl-K and "/" open the palette from anywhere. */
export function bindKeys() {
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest("input, textarea, select, [contenteditable]");
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); open(); }
    else if (e.key === "/" && !typing && !document.querySelector("dialog[open]")) { e.preventDefault(); open(); }
  });
}
