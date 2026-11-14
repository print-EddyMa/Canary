/* The world dashboard (what matters on Earth today) and the detective's case file. */

import { sparkline } from "./charts.js";
import { el, fixed, sig, statusIcon, thousands } from "./util.js";

const CONFIDENCE = { high: ["High confidence", "stable"], medium: ["Medium confidence", "watch"], low: ["Low confidence", "serious"] };

/* ---------- dashboard ---------- */

function planetTile(t) {
  const sign = t.signed && t.value > 0 ? "+" : "";
  const decimals = Math.abs(t.value) >= 100 ? 1 : 2;
  const rate = t.trend_per_decade == null ? null
    : `${t.trend_per_decade > 0 ? "+" : "−"}${sig(t.trend_per_decade)} ${t.unit} per decade since ${t.trend_since}`;
  return el("div", { class: "stat planet" },
    el("div", { class: "stat-label", text: t.label }),
    el("div", { class: "planet-row" },
      el("div", { class: "stat-value" }, `${sign}${fixed(t.value, decimals)}`, el("small", { text: ` ${t.unit}` })),
      sparkline(t.series.x, t.series.y, `${t.label}, ${t.series.x[0]} to ${Math.floor(t.series.x[t.series.x.length - 1])}`)),
    el("div", { class: "stat-note", text: `${t.when}: ${t.note}` }),
    rate ? el("div", { class: "stat-note", text: rate }) : null,
    el("div", { class: "stat-source", text: t.source }));
}

function writtenBy(kind, aiAvailable) {
  return kind === "ai" ? "Written by Claude from the figures on this page"
    : `Written by fixed rules from the figures on this page${aiAvailable ? "" : " (add a Claude API key for an AI-written brief)"}`;
}

/** hooks: { flyTo(lat, lon), investigate(event), showEvent(event) } */
export function renderDashboard(box, data, hooks) {
  const date = new Date(`${data.date}T00:00:00Z`).toLocaleDateString("en-GB",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const parts = [
    el("h1", { text: "Earth today" }),
    el("p", { class: "place-coords", text: `${date} · ${data.event_total} events being tracked` }),
  ];
  if (data.planet.length) parts.push(el("div", { class: "stats" }, ...data.planet.map(planetTile)));

  if (data.brief.length) {
    parts.push(el("h2", { text: "The brief" }));
    parts.push(el("ul", { class: "brief" }, ...data.brief.map((item) => {
      const body = [el("span", { class: "brief-topic", text: item.topic }), el("span", { text: item.text })];
      return el("li", {}, item.lat == null ? el("div", { class: "brief-item" }, ...body)
        : el("button", { type: "button", class: "brief-item", title: "Show on the globe",
            onclick: () => hooks.flyTo(item.lat, item.lon) }, ...body));
    })));
    parts.push(el("p", { class: "plot-caption", text: writtenBy(data.brief_written_by, data.ai_available) }));
  }

  if (data.events.length) {
    parts.push(el("h2", { text: "Biggest events now" }));
    parts.push(el("ol", { class: "ranked" }, ...data.events.slice(0, 8).map((e) =>
      el("li", {},
        el("button", { type: "button", class: "ranked-main", title: "Show on the globe", onclick: () => hooks.showEvent(e) },
          el("span", { class: `event-dot kind-${e.kind}` }),
          el("span", { class: "event-text" },
            el("strong", { text: e.title }),
            el("small", { text: `${e.kind_label} · ${e.level} · ${e.size}` }),
            el("span", { class: "meter", role: "img", "aria-label": `Severity ${Math.round(e.severity * 100)} out of 100` },
              el("i", { style: `width:${Math.max(4, Math.round(e.severity * 100))}%` })))),
        el("button", { type: "button", class: "ranked-go", onclick: () => hooks.investigate(e) }, "Investigate")))));
    parts.push(el("p", { class: "plot-caption",
      text: "Ranked by physical size (magnitude, wind speed, area burned), not by harm: the ranking knows nothing about who lives nearby." }));
  }
  if (data.errors && data.errors.length) {
    parts.push(el("p", { class: "plot-caption", text: `Some sources did not answer: ${data.errors.join("; ")}` }));
  }
  box.replaceChildren(...parts);
}

/* ---------- case file ---------- */

function factsView(facts) {
  const pre = el("pre", { class: "facts" });
  pre.textContent = JSON.stringify(facts, null, 1)
    .replace(/^[{[]\n|\n[}\]]$/g, "").replace(/^ /gm, "").replace(/[{}[\]",]/g, (ch) => (ch === "," ? "" : ch === '"' ? "" : ch));
  return pre;
}

export function caseView(result, hooks) {
  const c = result.case;
  const checks = result.checks;
  const allTraced = checks.numbers_traced === checks.numbers_checked;
  const out = [];
  if (result.ai_error) out.push(el("div", { class: "error", text: result.ai_error }));
  out.push(el("article", { class: "vital case-head" },
    el("p", { class: "byline", text: result.author }),
    el("h2", { class: "case-headline", text: c.headline }),
    el("p", { class: "vital-reading", text: c.summary }),
    el("p", { class: `trace ${allTraced ? "status-stable" : "status-serious"}` },
      statusIcon(allTraced ? "stable" : "serious"),
      `${checks.numbers_traced} of ${checks.numbers_checked} figures in this case file were traced to the evidence`
      + (allTraced ? "." : `. Not traced: ${checks.untraced.join(", ")}.`))));

  const evidenceLink = (id) => el("button", { type: "button", class: "evidence-chip", text: id, onclick: () => hooks.showEvidence(id) });
  out.push(el("h2", { text: "Findings" }));
  c.findings.forEach((f, i) => {
    const [label, level] = CONFIDENCE[f.confidence] || CONFIDENCE.medium;
    const objections = result.skeptic.objections.filter((o) => o.finding === i + 1);
    out.push(el("article", { class: `vital finding status-${level}` },
      el("div", { class: "vital-head" },
        el("span", { class: "finding-number", text: `Finding ${i + 1}` }),
        el("span", { class: "chip" }, statusIcon(level), label)),
      el("p", { class: "finding-claim", text: f.claim }),
      el("p", { class: "vital-extra", text: f.why_it_matters }),
      el("div", { class: "evidence-row" }, "Evidence ", ...f.evidence.map(evidenceLink)),
      ...objections.map(objectionView)));
  });

  if (c.suspects.length) {
    out.push(el("h2", { text: "Suspects" }));
    for (const s of c.suspects) {
      out.push(el("article", { class: "vital" },
        el("h3", { class: "vital-title", text: s.name }),
        el("p", { class: "vital-extra" }, el("strong", { text: "For: " }), s.case_for),
        el("p", { class: "vital-extra" }, el("strong", { text: "Against: " }), s.case_against),
        el("div", { class: "evidence-row" }, "Evidence ", ...s.evidence.map(evidenceLink))));
    }
  }

  out.push(el("h2", { text: "Outlook" }), el("article", { class: "vital" }, el("p", { class: "vital-reading", text: c.outlook })));

  const general = result.skeptic.objections.filter((o) => o.finding === 0 || o.finding > c.findings.length);
  out.push(el("h2", { text: "The skeptic" }),
    el("article", { class: "vital" },
      el("p", { class: "vital-reading", text: result.skeptic.overall }),
      ...general.map(objectionView),
      el("p", { class: "plot-caption", text: result.written_by === "ai"
        ? "A second Claude instance read only the evidence and the draft, and was asked to knock the case down. Its objections to single findings are shown under them."
        : "These are the standing objections a careful scientist would raise, applied by rule. Objections to single findings are shown under them." })));

  if (c.what_would_change_the_verdict.length) {
    out.push(el("h2", { text: "What would change the verdict" }),
      el("ul", { class: "plain-list" }, ...c.what_would_change_the_verdict.map((text) => el("li", { text }))));
  }

  out.push(el("h2", { text: "Evidence locker" }));
  for (const e of result.evidence) {
    out.push(el("details", { class: "evidence", id: `evidence-${e.id}` },
      el("summary", {}, el("span", { class: "evidence-chip", text: e.id }), ` ${e.title}`),
      factsView(e.facts)));
  }
  if (result.written_by !== "ai") {
    out.push(el("p", { class: "plot-caption", text: result.ai_available
      ? "An AI detective is available for this case."
      : "This case was written by fixed rules. With a Claude API key (ANTHROPIC_API_KEY) Canary instead runs an AI investigator that chooses its own evidence, an independent AI skeptic, and a revision that must answer every objection." }));
  }
  return out;
}

function objectionView(o) {
  const major = o.severity === "major";
  const node = el("div", { class: `objection status-${major ? "serious" : "watch"}` },
    el("span", { class: "chip" }, statusIcon(major ? "serious" : "watch"), major ? "Major objection" : "Minor objection"),
    el("p", { text: o.problem }));
  if (o.answer) {
    node.append(el("p", { class: "answer" }, el("strong", { text: `${o.answer.action[0].toUpperCase()}${o.answer.action.slice(1)}: ` }), o.answer.what_changed));
  } else if (o.fix) {
    node.append(el("p", { class: "answer" }, el("strong", { text: "Handling: " }), o.fix));
  }
  return node;
}

export { thousands };
