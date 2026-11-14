"""Briefing, the rule-based detective, number tracing, and the Claude pipeline
driven by a scripted stand-in for the API (no network, no key)."""

import json
from types import SimpleNamespace

import pytest

from canary import briefing, detective, llm
from canary.sources import planet


# ---------- briefing ----------

def test_severity_puts_different_hazards_on_one_scale():
    quake = briefing.severity({"kind": "earthquakes", "magnitude_value": 7.5, "magnitude_unit": "M"})
    small = briefing.severity({"kind": "earthquakes", "magnitude_value": 4.6, "magnitude_unit": "M"})
    storm = briefing.severity({"kind": "severeStorms", "magnitude_value": 120, "magnitude_unit": "kts"})
    fire = briefing.severity({"kind": "wildfires", "magnitude_value": 250_000, "magnitude_unit": "acres", "title": "Wildfire X"})
    burn = briefing.severity({"kind": "wildfires", "magnitude_value": 5_000, "magnitude_unit": "acres", "title": "Prescribed Fire Y"})
    assert quake[0] == 1.0 and quake[1] == "Major"
    assert small[0] < 0.1
    assert storm[1] == "Category 4" and "km/h" in storm[2]
    assert fire[1] == "Very large" and fire[0] > 0.9
    assert burn[1] == "Planned burn" and burn[0] < small[0] + 0.1


def test_saffir_simpson_boundaries():
    assert briefing.saffir_simpson(33) == "Tropical depression"
    assert briefing.saffir_simpson(64) == "Category 1"
    assert briefing.saffir_simpson(137) == "Category 5"


def test_planet_parsers():
    gistemp = "Land-Ocean: Global Means\nYear,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,J-D\n2026,1.08,1.23,***,***,***,***,***,***,***,***,***,***,***\n"
    assert planet.parse_gistemp(gistemp) == {(2026, 1): 1.08, (2026, 2): 1.23}
    co2 = "# header\n 2026    9   2026.7083      426.07      429.55     18    0.51    0.23\n 1958    1   1958.04   -99.99  -99.99 -1 -9.99 -0.99\n"
    assert planet.parse_co2(co2) == {(2026, 9): 426.07}
    ice = "year, mo,source_dataset, region, extent,   area\n2026,  9,    NSIDC-0803,      N,   4.81,   3.12\n1988,  9, x, N, -9999, -9999\n"
    assert planet.parse_sea_ice(ice) == {2026: 4.81}
    assert planet.enso_state(2.63) == "Very strong El Niño"
    assert planet.enso_state(-0.7) == "Weak La Niña"
    assert planet.enso_state(0.2) == "Neutral"
    assert planet._ranked(1, "warmest") == "warmest" and planet._ranked(13, "lowest") == "13th lowest"


# ---------- number tracing ----------

EVIDENCE = [{"id": "E1", "tool": "t", "title": "x", "facts": {"rate": 0.691, "total": 3.11, "note": "covers 58.9% of area", "n": 2341}}]


def test_numbers_are_traced_at_the_precision_written():
    ok = detective.trace_numbers(["Warming of 0.69 °C per decade, +3.11 °C in all, over 58.9% (see E1) and 2,341 m."], EVIDENCE)
    assert ok == {"numbers_checked": 4, "numbers_traced": 4, "untraced": []}


def test_invented_numbers_are_caught():
    bad = detective.trace_numbers(["Warming of 0.75 °C per decade since 1981, 3 times faster."], EVIDENCE)
    assert bad["numbers_checked"] == 1  # the year and the small count are not treated as figures
    assert bad["untraced"] == ["0.75"]


def test_minus_signs_and_evidence_ids_are_handled():
    out = detective.trace_numbers(["Fell by −0.691 units (E12, E3)."], EVIDENCE)
    assert out["numbers_traced"] == out["numbers_checked"] == 1


# ---------- the rule-based detective on real data ----------

@pytest.mark.network
def test_rule_case_for_svalbard_is_complete_and_fully_traced():
    result = detective.investigate(78.2, 15.6, "Svalbard")
    assert result["written_by"] == "rules"
    case = result["case"]
    assert "Svalbard" in case["headline"]
    assert any("Air temperature" in f["claim"] for f in case["findings"])
    ids = {e["id"] for e in result["evidence"]}
    assert all(set(f["evidence"]) <= ids for f in case["findings"])
    assert result["checks"]["untraced"] == []
    assert result["checks"]["numbers_checked"] >= 10
    assert result["skeptic"]["objections"]
    json.dumps(result, allow_nan=False)


# ---------- the Claude pipeline, with the API scripted ----------

def test_tool_definitions_match_the_case_methods():
    for tool in llm.TOOLS:
        assert callable(getattr(detective.Case, tool["name"]))
        assert tool["strict"] is True
        assert tool["input_schema"]["additionalProperties"] is False


def text_response(text, stop="end_turn"):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason=stop,
                           stop_details=None, model="scripted-model")


def tool_response(*calls):
    blocks = [SimpleNamespace(type="tool_use", id=f"tu_{i}", name=name, input=args) for i, (name, args) in enumerate(calls)]
    return SimpleNamespace(content=blocks, stop_reason="tool_use", stop_details=None, model="scripted-model")


class ScriptedClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.requests.append(kwargs)
        return self.responses.pop(0)


class FakeCase(detective.Case):
    """A case whose tools return fixed facts instead of calling NASA."""

    def read_vital_signs(self):
        return self._log("read_vital_signs", "Vital signs", {"vital_signs": [{"vital_sign": "Air temperature", "change_per_decade": 0.691}]})

    def compare_with_place(self, lat, lon):
        return self._log("compare_with_place", "Comparison", {"distance_km": 300, "there_change_per_decade": 0.52})

    def read_outlook(self):
        raise RuntimeError("source is down")


def test_pipeline_runs_tools_drafts_criticises_and_revises(monkeypatch):
    draft = {"headline": "Warming fast", "summary": "s", "outlook": "o", "suspects": [], "what_would_change_the_verdict": [],
             "findings": [{"claim": "Warming of 0.691 per decade, certain.", "evidence": ["E1"], "confidence": "high", "why_it_matters": "w"}]}
    critique = {"objections": [{"finding": 1, "problem": "Overstated.", "severity": "major", "fix": "Say likely."}], "overall": "ok"}
    final = json.loads(json.dumps(draft))
    final["findings"][0]["claim"] = "Warming of 0.691 per decade, against 0.52 at a neighbour 300 km away."
    final["findings"][0]["confidence"] = "medium"
    client = ScriptedClient([
        tool_response(("read_vital_signs", {}), ("read_outlook", {})),
        tool_response(("compare_with_place", {"lat": 76.0, "lon": 20.0}), ("no_such_tool", {})),
        text_response("Notes: warming is regional."),
        text_response(json.dumps(draft)),
        text_response(json.dumps(critique)),
        text_response(json.dumps({"case": final, "answers": [{"objection": 1, "action": "accepted", "what_changed": "Lowered confidence."}]})),
    ])
    monkeypatch.setattr(llm, "_client", lambda: client)
    monkeypatch.setattr(detective, "Case", FakeCase)

    result = llm.investigate(78.2, 15.6, "Svalbard")

    assert result["written_by"] == "ai" and "scripted-model" in result["author"]
    assert [e["tool"] for e in result["evidence"]] == ["read_vital_signs", "compare_with_place"]
    assert result["case"]["findings"][0]["confidence"] == "medium"
    assert result["skeptic"]["objections"][0]["answer"]["action"] == "accepted"
    assert result["checks"] == {"numbers_checked": 3, "numbers_traced": 3, "untraced": []}

    # Every tool call got a result in a single user message; failures were reported, not dropped.
    # (The investigator's message list grows in place: brief, calls, results, calls, results, notes.)
    conversation = client.requests[2]["messages"]
    first, second = conversation[2]["content"], conversation[4]["content"]
    assert [r["tool_use_id"] for r in first] == ["tu_0", "tu_1"]
    assert first[0]["is_error"] is False and first[1]["is_error"] is True and "source is down" in first[1]["content"]
    assert second[1]["is_error"] is True and "Unknown tool" in second[1]["content"]
    # The skeptic starts a fresh conversation and never sees the investigator's notes.
    skeptic_request = client.requests[4]
    assert len(skeptic_request["messages"]) == 1 and "Notes:" not in skeptic_request["messages"][0]["content"]
    # Request shape: adaptive thinking, explicit effort, structured output where a schema is wanted.
    assert all(r["thinking"] == {"type": "adaptive"} and r["output_config"]["effort"] for r in client.requests)
    assert "format" not in client.requests[0]["output_config"]
    assert client.requests[3]["output_config"]["format"]["schema"] is llm.CASE_SCHEMA


def test_refusal_is_raised(monkeypatch):
    refusal = SimpleNamespace(content=[], stop_reason="refusal", model="m",
                              stop_details=SimpleNamespace(explanation="declined"))
    monkeypatch.setattr(llm, "_client", lambda: ScriptedClient([refusal]))
    with pytest.raises(llm.Refused):
        llm.investigate(0.0, 0.0)


def test_daily_brief_maps_items_to_events(monkeypatch):
    facts = {"date": "2026-11-14", "planet": [{"id": "x", "series": {"x": [1], "y": [1]}}], "event_counts": {},
             "canary_analysis": None, "events": [{"title": "Typhoon", "lat": 30.2, "lon": 154.1}]}
    reply = {"items": [{"topic": "Storm", "text": "A typhoon.", "event_index": 0}, {"topic": "Planet", "text": "Warm.", "event_index": -1}]}
    client = ScriptedClient([text_response(json.dumps(reply))])
    monkeypatch.setattr(llm, "_client", lambda: client)
    items = llm.daily_brief(facts)
    assert items[0] == {"topic": "Storm", "text": "A typhoon.", "lat": 30.2, "lon": 154.1}
    assert "lat" not in items[1]
    assert "series" not in client.requests[0]["messages"][0]["content"]


def test_api_falls_back_to_rules_without_caching_the_failure(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from canary import api
    from canary.sources import cache

    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(llm, "available", lambda: True)
    calls = {"ai": 0}

    def failing(lat, lon, name=None):
        calls["ai"] += 1
        raise llm.Refused("declined")

    stub = {"written_by": "rules", "author": "rules", "case": {"findings": []}, "skeptic": {"objections": []},
            "evidence": [], "checks": {"numbers_checked": 0, "numbers_traced": 0, "untraced": []}}
    monkeypatch.setattr(llm, "investigate", failing)
    monkeypatch.setattr(detective, "investigate", lambda lat, lon, name=None: dict(stub))
    client = TestClient(api.app)

    first = client.get("/api/case", params={"lat": 10, "lon": 20}).json()
    assert first["written_by"] == "rules" and "declined" in first["ai_error"]
    client.get("/api/case", params={"lat": 10, "lon": 20})
    assert calls["ai"] == 2  # the failure was not cached: the AI was tried again
    assert not list(tmp_path.glob("cases/ai_*"))


def test_explain_gives_actionable_messages():
    assert "declined" in llm.explain(llm.Refused("declined"))
    assert llm.explain(RuntimeError("x" * 500)).__len__() == 200
