/* The place dossier: what Canary knows about one point, in three tabs. */

import { lineChart, outlookChart } from "./charts.js";
import { claimColour, record } from "./record.js";
import {
  el, sig, signed, fixed, signedFixed, pText, pEquals, together, thousands, compass, statusIcon, MINUS,
} from "./util.js";

const STATUS_LABEL = {
  stable: "No clear trend",
  shifting: "within normal range",
  emerged: "outside normal range",
  extreme: "far outside normal range",
};
const CONDITION_LABEL = { stable: "Stable", watch: "Watch", serious: "Serious", critical: "Critical" };
// Percent change only makes sense for quantities with a true zero.
const NO_PERCENT = new Set(["temperature", "cloud"]);

/* ---------- sound ---------- */

let audio = null;
let stopSound = null;

export function silence() {
  if (stopSound) stopSound();
}

/** Play a yearly series like a bedside monitor: one beep per year, pitch = value. */
function listen(values, button) {
  if (stopSound) { const wasThis = stopSound.button === button; stopSound(); if (wasThis) return; }
  audio ??= new AudioContext();
  const points = values.filter((v) => v != null);
  const lo = Math.min(...points), hi = Math.max(...points);
  const step = 0.13;
  const start = audio.currentTime + 0.05;
  const master = audio.createGain();
  master.connect(audio.destination);
  points.forEach((v, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 220 * 2 ** (2 * ((v - lo) / (hi - lo || 1))); // two octaves
    const t = start + i * step;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + step * 0.9);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + step);
  });
  const label = button.textContent;
  button.textContent = "Stop";
  const timer = setTimeout(() => stopSound && stopSound(), (points.length * step + 0.2) * 1000);
  stopSound = () => {
    clearTimeout(timer);
    master.disconnect();
    button.textContent = label;
    stopSound = null;
  };
  stopSound.button = button;
}

/* ---------- condition headline ---------- */

export function conditionCard(c) {
  const icon = statusIcon(c.level);
  icon.classList.add("condition-icon");
  return el("div", { class: `condition status-${c.level}` },
    icon,
    el("div", { class: "condition-level", text: CONDITION_LABEL[c.level] }),
    el("p", { class: "condition-summary",
      text: c.summary.replace(/^\w+: /, "").replace(/^./, (ch) => ch.toUpperCase()) }),
    el("p", { class: "condition-counts",
      text: `${c.changing} of ${c.monitored} vital signs have a trend unlikely to be chance; `
        + `${c.emerged} ${c.emerged === 1 ? "has" : "have"} left the normal range`
        + (c.early_warnings ? `; ${c.early_warnings} shows an early-warning sign of lost stability.` : ".") }),
  );
}

/* ---------- tab 1: vital signs ---------- */

function reading(v) {
  const t = v.trend;
  const p = el("p", { class: "vital-reading" });
  const [slope, low, high] = together(t.slope_per_decade, ...t.ci_per_decade);
  const range = `95% range ${low.signed} to ${high.signed}`;
  if (!t.significant) {
    p.append(el("strong", { text: "No trend distinguishable from chance." }),
      ` Best estimate ${slope.signed} ${v.unit} per decade (${range}).`);
    return p;
  }
  const verb = t.direction === "rising" ? "Rising" : "Falling";
  p.append(el("strong", { text: `${verb} by ${slope.plain} ${v.unit} per decade` }), ` (${range}). `);
  let since = `Since ${v.period[0]}: ${signed(t.total_change)} ${v.unit}`;
  if (t.percent_change != null && !NO_PERCENT.has(v.id)) since += ` (${signed(t.percent_change)}%)`;
  if (t.signal_to_noise != null) since += `, ${sig(t.signal_to_noise)} times the usual year-to-year swing`;
  p.append(since + ".");
  return p;
}

const lagText = (months) => (months === 0 ? "same month" : `${months} month${months > 1 ? "s" : ""} later`);

/** The place's record for this vital sign, from its first year with data. */
function vitalRecord(v) {
  const first = Math.max(0, v.annual_anomaly.findIndex((a) => a != null));
  const years = v.years.slice(first), anomaly = v.annual_anomaly.slice(first);
  return el("div", { class: "vital-record" }, record({ v, years, anomaly, size: "row" }),
    el("span", { class: "vital-record-span", text: `${years[0]}–${years[years.length - 1]}` }));
}

function vitalCard(v) {
  const t = v.trend;
  const chipText = v.status === "stable"
    ? STATUS_LABEL.stable
    : `${t.direction === "rising" ? "Rising" : "Falling"}, ${STATUS_LABEL[v.status]}`;
  // At a glance: the name, its status, the record and one sentence. Everything else opens on request.
  const more = el("div", { class: "vital-more-body" });
  const card = el("article", { class: `vital status-${v.status}` },
    el("div", { class: "vital-head" },
      el("h3", { class: "vital-title" }, v.label, " ", el("span", { class: "vital-unit", text: `(${v.unit})` })),
      el("span", { class: "chip" }, statusIcon(v.status), chipText)),
    v.family ? vitalRecord(v) : null,
    reading(v),
    el("details", { class: "vital-more" }, el("summary", { text: "Chart and details" }), more));
  more.append(
    el("p", { class: "vital-definition", text: v.definition }),
    lineChart({
      x: v.years,
      y: v.annual_anomaly,
      fit: [{ x: v.years[0], y: t.line[0] }, { x: v.years[v.years.length - 1], y: t.line[1] }],
      fitStrong: t.significant,
      fitColour: claimColour(v, t.slope_per_decade, t.significant),
      zeroLine: true,
      label: `${v.label}, yearly difference from the 1991 to 2020 average, ${v.period[0]} to ${v.period[1]}`,
      rows: (i) => [
        String(v.years[i]),
        `${signedFixed(v.annual_anomaly[i], v.decimals)} ${v.unit} vs average`,
        `Year's average: ${fixed(v.annual_mean[i], v.decimals)} ${v.unit}`,
      ],
    }),
    el("p", { class: "plot-caption",
      text: `Yearly difference from the 1991–2020 average (${fixed(v.baseline_mean, v.decimals)} ${v.unit}).` }),
  );

  if (v.suspects.length) {
    const s = v.suspects[0];
    const sense = s.r > 0 ? "rises and falls with" : "moves opposite to";
    more.append(el("p", { class: "vital-extra",
      text: `Suspect: ${sense} ${s.name} (r = ${signedFixed(s.r, 2)}, ${lagText(s.lag_months)}), `
        + `which accounts for about ${Math.round(s.variance_explained * 100)}% of the month-to-month swings.` }));
  }
  const ew = v.early_warning;
  if (ew) {
    more.append(el("p", { class: "vital-extra", text: ew.warning
      ? `Warning sign: this record's memory and variability have both risen (${pEquals(ew.p_ar1)}), `
        + "the statistical pattern seen in systems losing stability."
      : `Stability check: no sign of lost stability (memory trend τ = ${signedFixed(ew.tau_ar1, 2)}, ${pEquals(ew.p_ar1)}).` }));
  }

  if (v.forecast) more.append(outlookDetails(v));

  const listenButton = el("button", { type: "button", text: "Listen" });
  listenButton.addEventListener("click", () => listen(v.annual_anomaly, listenButton));
  more.append(el("div", { class: "vital-actions" }, listenButton));

  const dl = el("dl");
  const add = (k, val) => dl.append(el("dt", { text: k }), el("dd", { text: val }));
  add("Record", `${v.period[0]}–${v.period[1]}, ${t.n_months} months`);
  add("Kendall τ", signedFixed(t.tau, 3));
  add("p, plain Mann-Kendall", pText(t.p_uncorrected));
  add("p, corrected for memory", `${pText(t.p)} (uncertainty widened ×${sig(t.variance_inflation)})`);
  add("p, after false-discovery control", pText(t.p_fdr));
  const [ls, lsLow, lsHigh] = together(t.linear.slope_per_decade, ...t.linear.ci_per_decade);
  add("Second opinion (least squares)",
    `${ls.signed} per decade, 95% range ${lsLow.signed} to ${lsHigh.signed}, ${pEquals(t.linear.p)}`);
  for (const s of v.suspects.slice(1)) {
    add("Also linked to", `${s.name} (r = ${signedFixed(s.r, 2)}, ${lagText(s.lag_months)})`);
  }
  if (ew) add("Early-warning test", `variance trend τ = ${signedFixed(ew.tau_variance, 2)} (${pEquals(ew.p_variance)}); `
    + `${ew.surrogates} surrogates, ${ew.window_months / 12}-year window`);
  add("Source", `${v.source}, parameter ${v.parameter}`);
  if (v.note) add("Note", v.note);
  more.append(el("details", {}, el("summary", { text: "Statistics" }), dl));

  const tableDetails = el("details", {}, el("summary", { text: "Data table" }));
  tableDetails.addEventListener("toggle", () => {
    if (!tableDetails.open || tableDetails.querySelector("table")) return;
    const table = el("table", {}, el("tr", {},
      el("th", { text: "Year" }), el("th", { text: `Average (${v.unit})` }), el("th", { text: "vs 1991–2020" })));
    v.years.forEach((year, i) => {
      if (v.annual_mean[i] == null) return;
      table.append(el("tr", {}, el("td", { text: year }),
        el("td", { text: fixed(v.annual_mean[i], v.decimals) }),
        el("td", { text: signedFixed(v.annual_anomaly[i], v.decimals) })));
    });
    tableDetails.append(el("div", { class: "table-scroll" }, table));
  });
  more.append(tableDetails);
  return card;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function outlookDetails(v) {
  const f = v.forecast;
  const d = v.decimals;
  const skilled = f.skill > 0;
  const details = el("details", { class: "outlook" }, el("summary", {},
    skilled ? `Outlook to ${f.years[f.years.length - 1]}: ${Math.round(100 * f.skill)}% better than assuming a normal year`
      : `Outlook to ${f.years[f.years.length - 1]}: a normal year (nothing tested did better)`));
  details.addEventListener("toggle", () => {
    if (!details.open || details.querySelector(".plot")) return;
    const dec = (years, months) => years.map((y, i) => y + (months[i] - 0.5) / 12);
    const vs = f.next_year_vs_normal;
    details.append(
      el("div", { class: "legend" },
        el("span", {}, el("i"), "Observed"),
        el("span", {}, el("i", { class: "trend" }), "Outlook"),
        el("span", {}, el("i", { class: "band-key" }), "80% range")),
      outlookChart({
        observed: { t: dec(f.recent.years, f.recent.months), y: f.recent.values },
        outlook: { t: dec(f.years, f.months), y: f.median, low: f.low, high: f.high },
        unit: v.unit, decimals: d, monthName: (m) => MONTH[m - 1],
        label: `${v.label}: monthly values for five years and the outlook for the following two`,
      }),
      el("p", { class: "vital-extra" },
        el("strong", { text: `${f.years[0]} is expected to average ${fixed(f.next_year_mean, d)} ${v.unit}` }),
        ` (80% range ${fixed(f.next_year_range[0], d)} to ${fixed(f.next_year_range[1], d)}), `
        + `${signedFixed(vs, d)} against the 1991\u20132020 average. ${f.summary}`),
      el("p", { class: "plot-caption",
        text: `Method: ${f.method_label}. Chosen because it had the lowest error when forecasting from `
          + `${f.backtest_origins.length} past start dates (${f.backtest_origins[0]}\u2013${f.backtest_origins[f.backtest_origins.length - 1]}). `
          + (f.coverage == null ? "" : `The 80% range held ${Math.round(100 * f.coverage)}% of the outcomes it was not fitted to. `)
          + "The record ends in December 2025, so the outlook starts there." }));
  });
  return details;
}

export function vitalsTab(data) {
  const order = { extreme: 0, emerged: 1, shifting: 2, stable: 3 };
  const vitals = [...data.vitals].sort((a, b) =>
    order[a.status] - order[b.status] || (b.trend.signal_to_noise ?? 0) - (a.trend.signal_to_noise ?? 0));
  return [
    ...vitals.map(vitalCard),
    el("details", { class: "methods" }, el("summary", { text: "How to read this, and its limits" }),
      el("ul", {},
        el("li", { text: `Trend: ${data.methods.trend}` }),
        el("li", { text: `Stability check: ${data.methods.early_warning}` }),
        el("li", { text: `Suspects: ${data.methods.suspects}` }),
        el("li", { text: `Outlook: ${data.methods.forecast}` }),
        ...data.methods.caveats.map((text) => el("li", { text })))),
  ];
}

/* ---------- tab 2: terrain and water ---------- */

function tile(label, value, note) {
  return el("div", { class: "stat" },
    el("div", { class: "stat-label", text: label }),
    el("div", { class: "stat-value", text: value }),
    note ? el("div", { class: "stat-note", text: note }) : null);
}

/**
 * hooks: { onProfileHover(i | null), showRoute(), setStreams(on), streamsOn }
 */
export function terrainTab(data, hooks) {
  const s = data.shape;
  const out = [];
  const facing = s.aspect_deg == null ? "level ground" : `faces ${compass(s.aspect_deg)}`;
  out.push(el("div", { class: "stats" },
    tile("Elevation", `${thousands(s.elevation_m)} m`, "above sea level"),
    tile("Slope", `${fixed(s.slope_deg, 1)}°`, facing),
    tile("Relief within 10 km", `${thousands(s.relief_10km_m)} m`,
      `${thousands(s.lowest_10km_m)} to ${thousands(s.highest_10km_m)} m`),
    tile("Position", `${s.height_rank_percent}%`, "of the land within 10 km is lower"),
  ));

  const drop = data.raindrop;
  const card = el("article", { class: "vital" },
    el("h3", { class: "vital-title", text: "Where a raindrop goes from here" }));
  if (!drop || !drop.path) {
    card.append(el("p", { class: "vital-reading", text: drop ? drop.summary : "No route could be traced here." }));
    out.push(card);
  } else {
    card.append(el("p", { class: "vital-reading" }, el("strong", { text: drop.summary })));
    if (drop.via.length) {
      card.append(el("p", { class: "vital-extra", text: `Mapped rivers on the way: ${drop.via.join(" → ")}.` }));
    }
    const p = drop.profile;
    card.append(lineChart({
      x: p.distance_km,
      y: p.elevation_m,
      area: true,
      xTicks: "auto",
      xFormat: (t) => thousands(t),
      height: 140,
      label: `Elevation along the raindrop's route, ${thousands(drop.distance_km)} kilometres`,
      rows: (i) => [`${thousands(p.distance_km[i])} km downstream`, `${thousands(p.elevation_m[i])} m above sea level`],
      onHover: hooks.onProfileHover,
    }));
    card.append(el("p", { class: "plot-caption",
      text: "Water-surface elevation (m) against distance travelled (km). Hover to follow the drop on the map." }));
    const streams = el("input", { type: "checkbox" });
    streams.checked = hooks.streamsOn;
    streams.addEventListener("change", () => hooks.setStreams(streams.checked));
    card.append(el("div", { class: "vital-actions" },
      el("button", { type: "button", text: "Show the whole route", onclick: hooks.showRoute }),
      el("button", { type: "button", text: "Back to this place", onclick: hooks.showPlace }),
      data.drainage && data.drainage.image
        ? el("label", { class: "inline-check" }, streams, "Local streams") : null));
    out.push(card);
  }

  const notes = el("details", { class: "methods" }, el("summary", { text: "How this is worked out, and its limits" }),
    el("ul", {},
      el("li", { text: data.method }),
      el("li", { text: data.caveat }),
      el("li", { text: "Shallow inland basins (Lake Chad, Lake Eyre) are sometimes routed onward to the sea when "
        + "in reality their water evaporates." }),
      data.drainage ? el("li", { text: `Local streams are drawn for a ${data.drainage.window_km} km window `
        + `around the point at ${s.cell_m} m resolution.` }) : null,
      el("li", { text: `Elevation: ${data.source}.` })));
  out.push(notes);
  return out;
}

/* ---------- tab 3: now ---------- */

export function nowTab(now, nearby, hooks) {
  const out = [];
  if (now && now.temperature_c != null) {
    const when = new Date(now.time);
    const stamp = `${when.toISOString().slice(0, 10)} ${when.toISOString().slice(11, 16)} UTC`;
    out.push(el("div", { class: "stats" },
      tile("Air temperature", `${fixed(now.temperature_c, 1)} °C`, "2 m above ground"),
      tile("Wind", `${fixed(now.wind_ms, 1)} m/s`, `from the ${compass(now.wind_from_deg)}`),
      tile("Pressure", `${thousands(now.pressure_hpa)} hPa`, "at sea level"),
      tile("Analysis time", stamp.slice(11), stamp.slice(0, 10))));
    out.push(el("p", { class: "plot-caption",
      text: `${now.source}. Interpolated from a ${now.grid_km} km grid, so mountains and coasts are smoothed.` }));
  } else {
    out.push(el("p", { class: "vital-reading", text: "Live conditions are not available right now." }));
  }

  const card = el("article", { class: "vital" },
    el("h3", { class: "vital-title", text: "Natural events within 1,000 km" }));
  if (!nearby.length) {
    card.append(el("p", { class: "vital-reading", text: "None reported in the last 30 days." }));
  } else {
    const list = el("ul", { class: "event-list" });
    for (const e of nearby.slice(0, 12)) {
      const p = e.properties;
      list.append(el("li", {},
        el("button", { type: "button", onclick: () => hooks.showEvent(e) },
          el("span", { class: `event-dot kind-${p.kind}` }),
          el("span", { class: "event-text" },
            el("strong", { text: p.title }),
            el("small", { text: `${p.kind_label}${p.magnitude ? ` · ${p.magnitude}` : ""} · ${thousands(e.distance_km)} km away` })))));
    }
    card.append(list);
  }
  out.push(card);
  out.push(el("div", { class: "vital-actions" },
    el("button", { type: "button", text: "See today's satellite view here", onclick: hooks.satelliteView })));
  out.push(el("p", { class: "plot-caption",
    text: "Events: NASA EONET (wildfires, storms, volcanoes, ice) and USGS (earthquakes of magnitude 4.5 and above, past week)." }));
  return out;
}

export { MINUS };
