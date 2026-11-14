"""Claude-powered detective and skeptic.

Three roles, three separate conversations, so that no role marks its own work:

1. Investigator. Given a place and a set of tools, it decides which evidence
   to read and in what order, and can compare the place with others to test
   whether a change is local. Every tool call is logged as numbered evidence.
2. Skeptic. A fresh Claude instance that sees only the evidence and the draft
   case file, and is asked to find what is overstated, unsupported or
   explained equally well by something duller (a data artefact, chance, a
   short record).
3. Revision. The investigator must answer each objection: fix the case file
   or say why the objection fails.

Afterwards the code, not the model, traces every number in the final text
back to the evidence (detective.trace_numbers).

Needs an Anthropic API key (ANTHROPIC_API_KEY). Without one, Canary falls
back to the rule-based author in detective.py and says so.
"""

from __future__ import annotations

import json
import os

import anthropic

from . import detective

MODEL = os.environ.get("CANARY_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("CANARY_EFFORT", "medium")
MAX_TOOL_ROUNDS = 8
# If the model declines a request, let the API retry it on a fallback model.
BETAS = ["server-side-fallback-2026-07-01"]


def available() -> bool:
    """True when credentials for the Claude API are configured."""
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                or os.environ.get("CANARY_AI") == "1")


def _client() -> anthropic.Anthropic:
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return anthropic.Anthropic()
    # CANARY_AI=1: a gateway in front of the API supplies the real credential.
    return anthropic.Anthropic(api_key="supplied-by-gateway")


# ---------- schemas ----------

def _obj(properties: dict) -> dict:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


_IDS = {"type": "array", "items": {"type": "string"}, "description": "Evidence ids such as E1, E4."}

CASE_SCHEMA = _obj({
    "headline": {"type": "string", "description": "One line a newspaper could print. No hedging words, no hype."},
    "summary": {"type": "string", "description": "Two or three sentences: what is changing here and how sure we are."},
    "findings": {"type": "array", "items": _obj({
        "claim": {"type": "string", "description": "One specific, checkable statement with its numbers."},
        "evidence": _IDS,
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "why_it_matters": {"type": "string"},
    })},
    "suspects": {"type": "array", "items": _obj({
        "name": {"type": "string", "description": "A possible driver of what is seen."},
        "case_for": {"type": "string"},
        "case_against": {"type": "string"},
        "evidence": _IDS,
    })},
    "outlook": {"type": "string", "description": "What the tested outlook says, with its measured skill."},
    "what_would_change_the_verdict": {"type": "array", "items": {"type": "string"}},
})

CRITIQUE_SCHEMA = _obj({
    "objections": {"type": "array", "items": _obj({
        "finding": {"type": "integer", "description": "1-based number of the finding objected to; 0 for the case as a whole."},
        "problem": {"type": "string"},
        "severity": {"type": "string", "enum": ["minor", "major"]},
        "fix": {"type": "string", "description": "What the case file should say instead."},
    })},
    "overall": {"type": "string", "description": "Two sentences: how far the case can be trusted."},
})

REVISION_SCHEMA = _obj({
    "case": CASE_SCHEMA,
    "answers": {"type": "array", "items": _obj({
        "objection": {"type": "integer", "description": "1-based number of the objection answered."},
        "action": {"type": "string", "enum": ["accepted", "partly accepted", "rejected"]},
        "what_changed": {"type": "string"},
    })},
})

BRIEF_SCHEMA = _obj({
    "items": {"type": "array", "items": _obj({
        "topic": {"type": "string", "description": "One or two words."},
        "text": {"type": "string", "description": "One or two plain sentences."},
        "event_index": {"type": "integer", "description": "0-based index into the events list this item is about, or -1."},
    })},
})

TOOLS = [
    {"name": "read_vital_signs", "description": "Long-term trend of every vital sign at the place under investigation: "
     "rate per decade with a 95% range, total change, size against ordinary year-to-year swings, and whether the trend "
     "survives corrections for memory in the data and for testing many variables at once. Start here.",
     "input_schema": _obj({})},
    {"name": "read_climate_links", "description": "Which planet-wide climate rhythms (El Niño, Pacific Decadal Oscillation, "
     "Indian Ocean Dipole, North Atlantic Oscillation, Atlantic variability) each vital sign here follows, how strongly, "
     "and where each rhythm stands today.", "input_schema": _obj({})},
    {"name": "read_stability_check", "description": "Early-warning test for lost stability (rising memory and variability) "
     "on slow variables such as soil wetness.", "input_schema": _obj({})},
    {"name": "read_outlook", "description": "24-month outlook for each vital sign with skill measured against assuming a "
     "normal year in a rolling backtest.", "input_schema": _obj({})},
    {"name": "read_terrain_and_water", "description": "Elevation, slope and relief at the place, and where rain falling "
     "there flows: route length, descent, rivers joined, sea or closed basin.", "input_schema": _obj({})},
    {"name": "read_current_conditions", "description": "Air temperature, wind and pressure at the place right now from "
     "NASA's GEOS weather analysis.", "input_schema": _obj({})},
    {"name": "read_nearby_events", "description": "Natural events currently reported near the place: wildfires, storms, "
     "volcanoes, icebergs (NASA EONET) and earthquakes of the past week (USGS).",
     "input_schema": _obj({"radius_km": {"type": "number", "description": "Search radius in kilometres, 50 to 5000."}})},
    {"name": "read_planet_context", "description": "Planet-wide indicators (global temperature, carbon dioxide, Arctic sea "
     "ice, El Niño) and the average trend of each vital sign over the mapped world, to set this place against.",
     "input_schema": _obj({})},
    {"name": "compare_with_place", "description": "Run the same trend analysis at another point and set it beside this one. "
     "Use it to test an explanation: a change shared by neighbours 200-500 km away is regional; one confined to this cell "
     "is local or an artefact. Also useful for an upwind, upstream or coastal-versus-inland contrast.",
     "input_schema": _obj({"lat": {"type": "number", "description": "Latitude in degrees, -90 to 90."},
                           "lon": {"type": "number", "description": "Longitude in degrees, -180 to 180."}})},
]
for _tool in TOOLS:
    _tool["strict"] = True

INVESTIGATOR = """You are the investigator for Canary, a monitor of Earth's vital signs built on NASA data. \
You are given a place. Work out what is changing there, how sure that is, what is likely driving it, and what \
comes next, so that a regional planner, a journalist or a resident could act on your case file.

How to work
- Read the evidence with the tools. You choose which and in what order. Start with the vital signs; let what you \
find decide the rest.
- Test at least one explanation instead of accepting the first. If a vital sign has changed sharply, compare \
with one or two other places to see whether the change is regional or confined to this grid cell, and check \
whether a climate rhythm or the planet-wide trend accounts for it.
- If the place is the site of a current event (a storm, fire or earthquake), report the event, then say what the \
long-term record at that location does and does not tell us about it. A trend at the site is background; it is \
not evidence that the trend caused the event.
- Stop when further tools would not change the case.

What counts as knowledge here
- Only the tool results are evidence. Every figure you state must appear in a tool result; do not bring numbers \
from memory, and do not compute new ones beyond simple comparison of two evidence figures.
- General scientific background (what El Niño is, why the Arctic warms faster) may be used to interpret the \
evidence, in words, without figures.
- The climate figures describe one grid cell about 50 km across from a weather-model reanalysis, not a weather \
station. Precipitation, soil wetness, evaporation and wind from it are the least trustworthy, because the mix of \
satellites feeding the model changed over the decades.
- A correlation with a climate rhythm marks a suspect, not a cause. The correlations were computed after removing \
trends, so they explain swings from year to year, not the long-term trend itself.
- An outlook with zero skill carries no information; say so instead of quoting it.

When you have finished investigating, write your working notes in plain prose: what you found, what you ruled \
out and why, and what remains uncertain. A separate step turns the notes into the case file."""

WRITER = """Turn the investigator's notes and the evidence into a case file for a general reader.

- Lead with what matters most to someone living at or responsible for this place.
- Each finding is one specific, checkable claim with its numbers and units, citing the evidence ids it rests on.
- Copy figures exactly as they appear in the evidence, with the same precision. Do not round further, convert \
units or derive new figures.
- Confidence: high only when the trend is far outside ordinary swings, survives the corrections, and is not one \
of the weakly trusted reanalysis variables; low for single warning flags and weak correlations.
- For each suspect give the case for and the case against.
- Plain words. Spell out what a term means the first time. No hype, no reassurance, no advice."""

SKEPTIC = """You are the skeptic for Canary. Another analyst has written a case file about a place from the \
evidence below. Your job is to protect readers from being misled: find every claim that the evidence does not \
support as strongly as the case file says.

Look for
- claims stated more confidently than the statistics allow (p-values near the threshold, change inside ordinary \
year-to-year swings, a single early-warning flag);
- dull explanations that fit as well: a change in the observing system, a spliced or short record, chance among \
many tests, one grid cell standing in for a region;
- trends in precipitation, soil wetness, evaporation or wind taken from the reanalysis at face value;
- cause claimed from correlation, or a correlation that explains year-to-year swings offered as the reason for a \
long-term trend;
- figures in the text that do not appear in the evidence, or appear with a different meaning or unit;
- an outlook quoted without its measured skill, or quoted when the skill is zero;
- a current event tied to a long-term trend without evidence;
- something important in the evidence that the case file leaves out.

Mark an objection major if a reader would take away something false or act differently because of it, minor \
otherwise. If a finding is sound, do not invent an objection to it. Be specific: say what the case file should \
say instead."""

REVISER = """You wrote the draft case file below. A skeptic has raised numbered objections. Produce the final \
case file and answer every objection.

- Where the skeptic is right, change the case file: lower the confidence, reword the claim, add the caveat to \
the finding itself, or remove the finding.
- Where the skeptic is wrong, keep the text and say in your answer which evidence settles it.
- Do not add figures that are not in the evidence. Copy figures exactly as they appear there."""

EDITOR = """You are the editor of Canary's daily brief on the state of the Earth. From the facts below, write \
four to six items for a general reader, most important first.

- Each item is one or two plain sentences that say what is happening and why a reader should care.
- Use only the facts given. Copy figures exactly as they appear; do not round, convert or derive figures.
- Lead with what is unusual today, not with what is always true.
- The event ranking is by physical size, not by harm; do not say or imply that an event has caused damage or \
casualties, which the facts do not cover.
- For an item about one listed event, give its position in the events list as event_index; otherwise -1."""


class Refused(RuntimeError):
    """The model declined the request."""


def explain(exc: Exception) -> str:
    """A failure of the Claude API in words a reader can act on."""
    if isinstance(exc, anthropic.AuthenticationError):
        return "the API key was rejected; check ANTHROPIC_API_KEY"
    if isinstance(exc, anthropic.PermissionDeniedError):
        return "the API key is not allowed to use this model"
    if isinstance(exc, anthropic.NotFoundError):
        return f"the model {MODEL} was not found for this account"
    if isinstance(exc, anthropic.RateLimitError):
        return "the API rate limit was reached; try again shortly"
    if isinstance(exc, anthropic.APIStatusError):
        return f"the API returned an error ({exc.status_code})"
    if isinstance(exc, anthropic.APIConnectionError):
        return "the API could not be reached"
    if isinstance(exc, Refused):
        return f"the model declined the request: {exc}"
    return str(exc)[:200]


def _call(client: anthropic.Anthropic, *, system: str, messages: list, schema: dict | None = None,
          tools: list | None = None):
    output_config: dict = {"effort": EFFORT}
    if schema is not None:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    kwargs = {}
    if tools:
        kwargs["tools"] = tools
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=system,
        messages=messages,
        thinking={"type": "adaptive"},
        output_config=output_config,
        cache_control={"type": "ephemeral"},
        betas=BETAS,
        fallbacks="default",
        **kwargs,
    )
    if response.stop_reason == "refusal":
        raise Refused(getattr(response.stop_details, "explanation", None) or "request declined")
    return response


def _text(response) -> str:
    return "".join(block.text for block in response.content if block.type == "text")


def _json(response) -> dict:
    if response.stop_reason == "max_tokens":
        raise RuntimeError("the model's answer was cut off before the JSON was complete")
    return json.loads(_text(response))


def _evidence_block(evidence: list[dict]) -> str:
    return json.dumps([{"id": e["id"], "title": e["title"], "facts": e["facts"]} for e in evidence],
                      ensure_ascii=False, indent=1)


def _run_tool(case: detective.Case, name: str, arguments: dict) -> tuple[str, bool]:
    """Run one tool. Returns (result text, is_error)."""
    known = {t["name"] for t in TOOLS}
    if name not in known:
        return f"Unknown tool {name!r}.", True
    try:
        item = getattr(case, name)(**arguments)
    except Exception as exc:  # noqa: BLE001 - report to the model so it can route around a dead source
        return f"{name} failed: {exc}", True
    return json.dumps({"evidence_id": item["id"], **item["facts"]}, ensure_ascii=False), False


def investigate(lat: float, lon: float, name: str | None = None) -> dict:
    """Run the three roles and return the finished case with its audit trail."""
    client = _client()
    case = detective.Case(lat, lon, name)
    where = f"{name} " if name else ""
    brief = (f"Investigate {where}at latitude {lat:.3f}, longitude {lon:.3f}. "
             "All tools already know the place; only compare_with_place takes coordinates.")

    # 1. Investigation: the model drives the tools.
    messages: list = [{"role": "user", "content": brief}]
    served_by = MODEL
    for _ in range(MAX_TOOL_ROUNDS):
        response = _call(client, system=INVESTIGATOR, messages=messages, tools=TOOLS)
        served_by = response.model
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "pause_turn":
            continue
        calls = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason != "tool_use" or not calls:
            break
        results = []
        for call in calls:  # all results go back in one message
            text, is_error = _run_tool(case, call.name, dict(call.input or {}))
            results.append({"type": "tool_result", "tool_use_id": call.id, "content": text, "is_error": is_error})
        messages.append({"role": "user", "content": results})
    else:
        # Out of rounds: ask for the notes with what has been gathered.
        messages.append({"role": "user", "content": "That is enough evidence. Write your working notes now."})
        response = _call(client, system=INVESTIGATOR, messages=messages, tools=TOOLS)
        messages.append({"role": "assistant", "content": response.content})
    notes = _text(response)
    if not case.evidence:
        raise RuntimeError("the investigator gathered no evidence")
    evidence_text = _evidence_block(case.evidence)
    place_line = f"Place: {name or 'unnamed location'} ({lat:.3f}, {lon:.3f})."

    # 2. Draft case file.
    draft = _json(_call(client, system=WRITER, schema=CASE_SCHEMA, messages=[{"role": "user", "content":
        f"{place_line}\n\n<evidence>\n{evidence_text}\n</evidence>\n\n<investigator_notes>\n{notes}\n</investigator_notes>"}]))

    # 3. Skeptic: a fresh conversation that never sees the investigator's reasoning.
    critique = _json(_call(client, system=SKEPTIC, schema=CRITIQUE_SCHEMA, messages=[{"role": "user", "content":
        f"{place_line}\n\n<evidence>\n{evidence_text}\n</evidence>\n\n<case_file>\n"
        f"{json.dumps(draft, ensure_ascii=False, indent=1)}\n</case_file>"}]))

    # 4. Revision: every objection must be answered.
    final, answers = draft, []
    if critique["objections"]:
        numbered = "\n".join(f"{i}. [{o['severity']}] finding {o['finding']}: {o['problem']} Suggested: {o['fix']}"
                             for i, o in enumerate(critique["objections"], 1))
        revised = _json(_call(client, system=REVISER, schema=REVISION_SCHEMA, messages=[{"role": "user", "content":
            f"{place_line}\n\n<evidence>\n{evidence_text}\n</evidence>\n\n<draft_case_file>\n"
            f"{json.dumps(draft, ensure_ascii=False, indent=1)}\n</draft_case_file>\n\n<objections>\n{numbered}\n</objections>"}]))
        final, answers = revised["case"], revised["answers"]
        for answer in answers:
            index = answer["objection"] - 1
            if 0 <= index < len(critique["objections"]):
                critique["objections"][index]["answer"] = {"action": answer["action"], "what_changed": answer["what_changed"]}

    return {
        "place": {"lat": lat, "lon": lon, "name": name},
        "written_by": "ai",
        "author": f"Claude ({served_by}): investigator, independent skeptic, and revision",
        "case": final,
        "skeptic": critique,
        "evidence": case.evidence,
        "checks": detective.trace_numbers(detective.case_texts(final), case.evidence),
        "investigator_notes": notes,
    }


def daily_brief(facts: dict) -> list[dict]:
    """The dashboard brief, written by Claude from the same facts the rules use."""
    client = _client()
    slim = {k: facts[k] for k in ("date", "planet", "events", "event_counts", "canary_analysis")}
    slim["planet"] = [{k: v for k, v in tile.items() if k != "series"} for tile in slim["planet"]]
    response = _call(client, system=EDITOR, schema=BRIEF_SCHEMA, messages=[{"role": "user", "content":
        f"<facts>\n{json.dumps(slim, ensure_ascii=False, indent=1)}\n</facts>"}])
    items = []
    for item in _json(response)["items"]:
        line = {"topic": item["topic"], "text": item["text"]}
        index = item["event_index"]
        if 0 <= index < len(facts["events"]):
            line["lat"], line["lon"] = facts["events"][index]["lat"], facts["events"][index]["lon"]
        items.append(line)
    return items
