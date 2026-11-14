/* Shared interface components: searchable select, sortable table, theme switch, icons.
   Each follows the matching WAI-ARIA Authoring Practices pattern and uses native elements
   where one exists. */

import { el, svg } from "./util.js";

let serial = 0;
const uid = (prefix) => `${prefix}-${++serial}`;

export function icon(name) {
  const paths = {
    chevron: "M4 6l4 4 4-4",
    close: "M4 4l8 8M12 4l-8 8",
    sortUp: "M8 3l4 5H4z",
    sortDown: "M8 13l4-5H4z",
    rising: "M3 12l9-8M6.5 4H12v5.5",
    falling: "M3 4l9 8M6.5 12H12V6.5",
    flat: "M2 8h12",
    play: "M5 3.5v9l7.5-4.5z",
    link: "M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1",
    download: "M8 2.5v7.5M4.5 7L8 10.5 11.5 7M3 13h10",
    globe: "M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4",
    theme: "M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z",
  };
  const node = svg("svg", { viewBox: "0 0 16 16", class: `icon icon-${name}`, "aria-hidden": "true" });
  const filled = name === "sortUp" || name === "sortDown" || name === "play";
  node.append(svg("path", { d: paths[name], fill: filled ? "currentColor" : "none", stroke: filled ? "none" : "currentColor",
    "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  if (name === "theme") node.append(svg("path", { d: "M8 1.8a6.2 6.2 0 010 12.4z", fill: "currentColor" }));
  return node;
}

/**
 * A searchable select: a button that opens a filter box above a grouped list.
 * `groups()` returns [{ name, about, options: [{ value, label, detail, meta }] }] and is read
 * each time the list opens, so options can change. `actions` are extra commands listed
 * first (for example "Draw a box on the map"). Arrow keys move, Enter chooses, Escape closes.
 */
export function combobox({ label, placeholder = "Choose", searchLabel, groups, actions = () => [], onChange, clearLabel, onClear }) {
  const listId = uid("list");
  const trigger = el("button", { type: "button", class: "combo-trigger", "aria-haspopup": "listbox", "aria-expanded": "false" },
    el("span", { class: "combo-value", text: placeholder }), icon("chevron"));
  const clear = clearLabel ? el("button", { type: "button", class: "combo-clear", "aria-label": clearLabel, hidden: "" }, icon("close")) : null;
  const input = el("input", { type: "text", class: "combo-search", role: "combobox", placeholder: searchLabel || "Search",
    "aria-label": searchLabel || `Search ${label}`, "aria-controls": listId, "aria-expanded": "true", "aria-autocomplete": "list",
    autocomplete: "off", spellcheck: "false" });
  const list = el("ul", { class: "combo-list", role: "listbox", id: listId, "aria-label": label });
  const empty = el("p", { class: "combo-empty", text: "Nothing matches. Try a shorter search.", hidden: "" });
  const pop = el("div", { class: "combo-pop", hidden: "" }, input, list, empty);
  const root = el("div", { class: "combo" }, trigger, clear, pop);
  let current = null, items = [], active = -1;

  const setActive = (index, scroll = true) => {
    if (items[active]) items[active].node.classList.remove("is-active");
    active = index;
    const item = items[active];
    if (!item) { input.removeAttribute("aria-activedescendant"); return; }
    item.node.classList.add("is-active");
    input.setAttribute("aria-activedescendant", item.node.id);
    if (scroll) item.node.scrollIntoView({ block: "nearest" });
  };

  const choose = (item) => {
    close();
    if (item.run) item.run(); else onChange(item.value);
  };

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    items = [];
    const nodes = [];
    const add = (item, extraClass = "") => {
      const node = el("li", { role: "option", id: uid("opt"), class: `combo-option ${extraClass}`,
        "aria-selected": String(item.value != null && item.value === current) },
        el("span", { class: "combo-label", text: item.label }),
        item.meta ? el("span", { class: "combo-meta", text: item.meta }) : null,
        item.detail ? el("span", { class: "combo-detail", text: item.detail }) : null);
      const index = items.length;
      node.addEventListener("click", () => choose(item));
      node.addEventListener("mousemove", () => { if (active !== index) setActive(index, false); });
      items.push({ ...item, node });
      nodes.push(node);
    };
    if (!q) for (const action of actions()) add(action, "is-action");
    for (const group of groups()) {
      const hits = group.options.filter((o) => !q || `${o.label} ${o.detail || ""}`.toLowerCase().includes(q));
      if (!hits.length) continue;
      if (group.name) {
        nodes.push(el("li", { role: "presentation", class: "combo-group" }, group.name,
          group.about ? el("small", { text: ` ${group.about}` }) : null));
      }
      hits.forEach((o) => add(o));
    }
    list.replaceChildren(...nodes);
    empty.hidden = items.length > 0;
    const selected = items.findIndex((i) => i.value != null && i.value === current);
    setActive(q ? (items.length ? 0 : -1) : selected, true);
  };

  const onOutside = (event) => { if (!root.contains(event.target)) close(false); };

  function open() {
    if (!pop.hidden) return;
    pop.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    input.value = "";
    draw();
    input.focus();
    document.addEventListener("pointerdown", onOutside, true);
  }

  function close(refocus = true) {
    if (pop.hidden) return;
    pop.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (refocus) trigger.focus();
  }

  trigger.addEventListener("click", () => (pop.hidden ? open() : close()));
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open(); }
  });
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step && items.length) {
      event.preventDefault();
      setActive((active + step + items.length) % items.length);
    } else if (event.key === "Home" && items.length) { event.preventDefault(); setActive(0); }
    else if (event.key === "End" && items.length) { event.preventDefault(); setActive(items.length - 1); }
    else if (event.key === "Enter") { event.preventDefault(); if (items[active]) choose(items[active]); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === "Tab") close(false);
  });
  if (clear) clear.addEventListener("click", () => { close(false); onClear(); });

  return {
    root, trigger, open, close,
    /** Show the chosen option on the button; null shows the placeholder. */
    set(value, text) {
      current = value;
      trigger.querySelector(".combo-value").textContent = value == null ? placeholder : text;
      trigger.classList.toggle("is-empty", value == null);
      if (clear) clear.hidden = value == null;
    },
  };
}

/**
 * A data table whose column headers sort it. `columns`: [{ key, label, numeric, sort, cell }];
 * a column without `sort` is not sortable. `initial`: { key, dir } or null for the given order.
 */
export function sortableTable({ columns, rows, initial = null, rowClass, caption }) {
  let order = initial;
  const table = el("table", { class: "data" });
  if (caption) table.append(el("caption", { class: "visually-hidden", text: caption }));
  const head = el("tr");
  const body = el("tbody");
  table.append(el("thead", {}, head), body);

  const draw = () => {
    head.replaceChildren(...columns.map((c) => {
      const dir = order && order.key === c.key ? order.dir : null;
      const th = el("th", { scope: "col", class: c.numeric ? "num" : "",
        "aria-sort": c.sort ? (dir === 1 ? "ascending" : dir === -1 ? "descending" : "none") : null });
      if (!c.sort) { th.textContent = c.label; return th; }
      th.append(el("button", { type: "button", class: "sort", onclick: () => {
        order = { key: c.key, dir: dir === null ? (c.numeric ? -1 : 1) : -dir };
        draw();
      } }, c.label, icon(dir === 1 ? "sortUp" : "sortDown")));
      if (dir === null) th.querySelector(".icon").classList.add("is-idle");
      return th;
    }));
    const column = order && columns.find((c) => c.key === order.key);
    const sorted = column ? [...rows].sort((a, b) => {
      const x = column.sort(a), y = column.sort(b);
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * order.dir;
    }) : rows;
    body.replaceChildren(...sorted.map((row) => el("tr", { class: rowClass ? rowClass(row) : "" },
      ...columns.map((c) => el("td", { class: c.numeric ? "num" : "" }, c.cell(row))))));
  };
  draw();
  return table;
}

/** Two or three views of one figure: buttons in a tablist, one panel shown at a time. */
export function viewTabs(label, views, onSelect) {
  const buttons = views.map((v, i) => el("button", { type: "button", role: "tab", id: uid("tab"),
    "aria-selected": String(i === 0), tabindex: i === 0 ? "0" : "-1", text: v.label }));
  const select = (index, focus = false) => {
    buttons.forEach((b, i) => { b.setAttribute("aria-selected", String(i === index)); b.tabIndex = i === index ? 0 : -1; });
    if (focus) buttons[index].focus();
    onSelect(views[index].id);
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => select(i));
    b.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (step) { event.preventDefault(); select((i + step + buttons.length) % buttons.length, true); }
    });
  });
  return el("div", { class: "segmented", role: "tablist", "aria-label": label }, ...buttons);
}

/* ---------- theme ---------- */

const THEME_KEY = "canary-theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

export function currentTheme() {
  return document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");
}

/** Apply the saved theme, if any, and wire a button that switches between light and dark. */
export function initTheme(button) {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* storage may be blocked */ }
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  const label = () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", `Switch to the ${next} theme`);
    button.title = `Switch to the ${next} theme`;
  };
  button.replaceChildren(icon("theme"));
  button.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    label();
    window.dispatchEvent(new CustomEvent("canary-theme", { detail: next }));
  });
  systemDark.addEventListener("change", label);
  label();
}
