"""The detective: gathers evidence about a place and writes a case file.

Every statement in a case file must rest on numbered evidence. Evidence is
produced only by the tools in this module, which wrap Canary's own analysis:
the detective, whether it is Claude or the rule-based fallback, can read the
numbers but cannot invent them. After a case is written, every number in its
text is traced back to the evidence, and the share that could be traced is
shown to the reader.

Two authors share the same tools and the same output shape:
- canary.llm: a Claude investigator that chooses which tools to call, then a
  second Claude instance (the skeptic) that tries to knock the case down,
  then a revision that has to answer the objections;
- this module's `rule_case`: fixed rules, used when no API key is configured,
  with a fixed list of the objections a careful scientist would raise.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

from . import briefing, terrain
from .chart import place_chart
from .sources import events, geos, indices, planet

MAPS_INDEX = Path(__file__).resolve().parent.parent / "web" / "maps" / "index.json"


def _r(value, digits: int = 3):
    """Round for evidence: enough digits to cite, few enough to read."""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            return None
        if value == 0:
            return 0
        magnitude = math.floor(math.log10(abs(value)))
        return round(value, max(digits - 1 - magnitude, 0))
    return value


class Case:
    """One investigation: a place and the evidence gathered about it so far."""

    def __init__(self, lat: float, lon: float, name: str | None = None):
        self.lat, self.lon, self.name = lat, lon, name
        self.evidence: list[dict] = []
        self._chart: dict | None = None

    # ---- bookkeeping ----

    def _log(self, tool: str, title: str, facts) -> dict:
        item = {"id": f"E{len(self.evidence) + 1}", "tool": tool, "title": title, "facts": facts}
        self.evidence.append(item)
        return item

    def chart(self) -> dict:
        if self._chart is None:
            self._chart = place_chart(self.lat, self.lon)
        return self._chart

    # ---- tools (each returns one evidence item) ----

    def read_vital_signs(self) -> dict:
        """Long-term trend of each vital sign here, with significance and size."""
        c = self.chart()
        rows = []
        for v in c["vitals"]:
            t = v["trend"]
            rows.append({
                "vital_sign": v["label"], "unit": v["unit"], "record": v["period"],
                "status": v["status"], "direction": t["direction"],
                "change_per_decade": _r(t["slope_per_decade"]),
                "range_95_per_decade": [_r(t["ci_per_decade"][0]), _r(t["ci_per_decade"][1])],
                "total_change_over_record": _r(t["total_change"]),
                "percent_change": _r(t["percent_change"]) if v["id"] not in ("temperature", "cloud") else None,
                "times_usual_year_to_year_swing": _r(t["signal_to_noise"]),
                "p_after_corrections": _r(t["p_fdr"], 2),
                "p_before_corrections": _r(t["p_uncorrected"], 2),
                "unlikely_to_be_chance": t["significant"],
                "average_1991_2020": _r(v["baseline_mean"]),
                "source": v["source"],
                "note": v["note"] or None,
            })
        return self._log("read_vital_signs", "Vital signs: long-term trends", {
            "condition": c["condition"]["level"],
            "condition_meaning": c["condition"]["summary"],
            "grid_cell": c["place"]["grid"],
            "vital_signs": rows,
            "status_key": {"stable": "no trend distinguishable from chance",
                           "shifting": "real trend, still inside ordinary year-to-year swings",
                           "emerged": "change larger than ordinary year-to-year swings",
                           "extreme": "change more than twice ordinary year-to-year swings"},
        })

    def read_climate_links(self) -> dict:
        """Which planet-wide climate rhythms this place follows, and their state now."""
        links = []
        modes_seen = set()
        for v in self.chart()["vitals"]:
            for s in v["suspects"]:
                links.append({"vital_sign": v["label"], "rhythm": s["name"], "correlation": s["r"],
                              "rhythm_leads_by_months": s["lag_months"],
                              "share_of_monthly_swings_explained_percent": round(100 * s["variance_explained"])})
                modes_seen.add(s["id"])
        now = {}
        for mode_id in sorted(modes_seen | {"enso"}):
            try:
                table = indices.load(mode_id)
            except Exception:  # noqa: BLE001 - an index server being down is not fatal
                continue
            (year, month), value = max(table.items())
            entry = {"latest_value": _r(value), "month": f"{year}-{month:02d}"}
            if mode_id == "enso":
                entry["state"] = planet.enso_state(value)
            now[indices.BY_ID[mode_id].name] = entry
        return self._log("read_climate_links", "Links to planet-wide climate rhythms", {
            "links": links, "state_of_rhythms_now": now,
            "caution": "A correlation marks a suspect, not a proven cause. Trends were removed from both "
                       "series before correlating.",
        })

    def read_stability_check(self) -> dict:
        """Early-warning signs of lost stability (critical slowing down)."""
        rows = []
        for v in self.chart()["vitals"]:
            ew = v["early_warning"]
            if ew:
                rows.append({"vital_sign": v["label"], "warning": ew["warning"],
                             "memory_trend_tau": _r(ew["tau_ar1"], 2), "p_memory": _r(ew["p_ar1"], 2),
                             "variability_trend_tau": _r(ew["tau_variance"], 2), "p_variability": _r(ew["p_variance"], 2)})
        return self._log("read_stability_check", "Stability check", {
            "checked": rows,
            "caution": "Run only on slow, memory-bearing variables. About 1 place in 20 raises a flag by chance. "
                       "A flag is a warning sign, not a forecast of collapse.",
        })

    def read_outlook(self) -> dict:
        """Backtested 24-month outlook for each vital sign."""
        rows = []
        for v in self.chart()["vitals"]:
            f = v["forecast"]
            if not f:
                continue
            rows.append({
                "vital_sign": v["label"], "unit": v["unit"], "method": f["method"],
                "more_accurate_than_normal_year_percent": round(100 * f["skill"]),
                "next_12_months_mean": _r(f["next_year_mean"]),
                "next_12_months_range_80": [_r(f["next_year_range"][0]), _r(f["next_year_range"][1])],
                "next_12_months_vs_1991_2020": _r(f["next_year_vs_normal"]),
                "share_of_past_outcomes_inside_range_percent": None if f["coverage"] is None else round(100 * f["coverage"]),
            })
        return self._log("read_outlook", "Outlook for the next two years", {
            "outlooks": rows,
            "starts": "January 2026 (the record ends December 2025)",
            "range_percent": 80,
            "caution": "Skill of 0% means no method beat assuming a normal year when tested on the past.",
        })

    def read_terrain_and_water(self) -> dict:
        """Shape of the land and where rain falling here goes."""
        t = terrain.analyse(self.lat, self.lon)
        drop = t["raindrop"] or {}
        return self._log("read_terrain_and_water", "Land and water", {
            "elevation_m": t["shape"]["elevation_m"], "slope_degrees": t["shape"]["slope_deg"],
            "relief_within_10km_m": t["shape"]["relief_10km_m"],
            "percent_of_surroundings_lower": t["shape"]["height_rank_percent"],
            "raindrop_outcome": drop.get("outcome"), "raindrop_distance_km": drop.get("distance_km"),
            "raindrop_descent_m": drop.get("drop_m"), "rivers_on_the_way": drop.get("via"),
            "summary": drop.get("summary"), "caution": t["caveat"],
        })

    def read_current_conditions(self) -> dict:
        """Temperature, wind and pressure right now."""
        now = geos.sample(self.lat, self.lon)
        return self._log("read_current_conditions", "Conditions right now", {
            "time_utc": now["time"], "air_temperature_c": now["temperature_c"],
            "wind_m_per_s": now["wind_ms"], "wind_from_degrees": now["wind_from_deg"],
            "pressure_hpa": now["pressure_hpa"],
            "caution": f"Interpolated from a {now['grid_km']} km grid: one moment in time, not climate.",
        })

    def read_nearby_events(self, radius_km: float = 1000.0) -> dict:
        """Natural events reported near this place."""
        radius_km = float(min(max(radius_km, 50.0), 5000.0))
        rows = []
        for f in events.current()["features"]:
            if f["geometry"]["type"] != "Point":
                continue
            lon, lat = f["geometry"]["coordinates"][:2]
            distance = float(terrain.haversine_km(self.lon, self.lat, lon, lat))
            if distance <= radius_km:
                score, level, size = briefing.severity(f["properties"])
                rows.append({"event": f["properties"]["title"], "kind": f["properties"]["kind_label"],
                             "level": level, "size": size, "distance_km": round(distance),
                             "source": f["properties"]["source"]})
        rows.sort(key=lambda r: r["distance_km"])
        return self._log("read_nearby_events", f"Natural events within {radius_km:,.0f} km", {
            "radius_km": round(radius_km), "count": len(rows), "events": rows[:15],
        })

    def read_planet_context(self) -> dict:
        """How the planet as a whole is doing, to set this place against."""
        tiles = [{"indicator": t["label"], "value": t["value"], "unit": t["unit"], "when": t["when"],
                  "note": t["note"], "change_per_decade": _r(t["trend_per_decade"])} for t in planet.status()["tiles"]]
        world = None
        try:
            index = json.loads(MAPS_INDEX.read_text())
            world = [{"vital_sign": l["label"], "unit": l["unit"],
                      "average_change_per_decade_over_mapped_area": _r(l["mean_trend_per_decade"]),
                      "percent_of_mapped_area_with_real_trend": l["percent_significant"]} for l in index["layers"]]
        except (OSError, ValueError):
            pass
        return self._log("read_planet_context", "The planet as a whole", {"indicators": tiles, "world_trends": world})

    def compare_with_place(self, lat: float, lon: float) -> dict:
        """The same trend analysis at another point, to test whether a change is local or regional."""
        lat, lon = float(min(max(lat, -90), 90)), float(((lon + 180) % 360) - 180)
        other = place_chart(lat, lon)
        distance = float(terrain.haversine_km(self.lon, self.lat, lon, lat))
        here = {v["label"]: v for v in self.chart()["vitals"]}
        rows = []
        for v in other["vitals"]:
            mine = here.get(v["label"])
            rows.append({"vital_sign": v["label"], "unit": v["unit"],
                         "there_change_per_decade": _r(v["trend"]["slope_per_decade"]),
                         "there_status": v["status"],
                         "here_change_per_decade": _r(mine["trend"]["slope_per_decade"]) if mine else None,
                         "here_status": mine["status"] if mine else None})
        return self._log("compare_with_place", f"Comparison with {abs(lat):.2f}°{'N' if lat >= 0 else 'S'}, "
                         f"{abs(lon):.2f}°{'E' if lon >= 0 else 'W'}", {
            "distance_km": round(distance), "condition_there": other["condition"]["level"], "vital_signs": rows,
        })

    def gather_all(self) -> None:
        """Every standing tool once, in a fixed order (used by the rule-based author)."""
        for tool in (self.read_vital_signs, self.read_climate_links, self.read_stability_check,
                     self.read_outlook, self.read_terrain_and_water, self.read_current_conditions,
                     self.read_nearby_events, self.read_planet_context):
            try:
                tool()
            except Exception as exc:  # noqa: BLE001 - one source being down must not sink the case
                self._log(tool.__name__, f"{tool.__name__} failed", {"error": str(exc)})

    def find(self, tool: str) -> dict | None:
        return next((e for e in self.evidence if e["tool"] == tool and "error" not in e["facts"]), None)


# ---------- number tracing ----------

_NUMBER = re.compile(r"(?<![A-Za-z0-9])[-+−]?\d[\d,]*(?:\.\d+)?")


def _numbers_in(obj) -> set[float]:
    found: set[float] = set()
    if isinstance(obj, bool) or obj is None:
        return found
    if isinstance(obj, (int, float)):
        found.add(abs(float(obj)))
    elif isinstance(obj, str):
        for m in _NUMBER.findall(obj):
            try:
                found.add(abs(float(m.replace(",", "").replace("−", "-"))))
            except ValueError:
                pass
    elif isinstance(obj, dict):
        for value in obj.values():
            found |= _numbers_in(value)
    elif isinstance(obj, (list, tuple)):
        for value in obj:
            found |= _numbers_in(value)
    return found


def trace_numbers(texts: list[str], evidence: list[dict]) -> dict:
    """Check that every figure in the case text appears in the evidence.

    A written figure matches an evidence number if they agree when the
    evidence number is rounded to the precision the text used. Years, small
    counts (up to 12) and evidence ids are not treated as figures.
    """
    known = _numbers_in([e["facts"] for e in evidence])
    checked, untraced = 0, []
    for text in texts:
        cleaned = re.sub(r"\bE\d+\b", " ", text)
        for raw in _NUMBER.findall(cleaned):
            token = raw.replace(",", "").replace("−", "-")
            try:
                value = abs(float(token))
            except ValueError:
                continue
            decimals = len(token.split(".")[1]) if "." in token else 0
            if decimals == 0 and (value <= 12 or 1850 <= value <= 2100):
                continue
            checked += 1
            tolerance = 0.5 * 10 ** (-decimals) + 1e-9
            if not any(abs(k - value) <= tolerance for k in known):
                untraced.append(raw)
    return {"numbers_checked": checked, "numbers_traced": checked - len(untraced), "untraced": untraced[:20]}


def case_texts(case: dict) -> list[str]:
    texts = [case.get("headline", ""), case.get("summary", ""), case.get("outlook", "")]
    for f in case.get("findings", []):
        texts += [f.get("claim", ""), f.get("why_it_matters", "")]
    for s in case.get("suspects", []):
        texts += [s.get("case_for", ""), s.get("case_against", "")]
    return texts


# ---------- the rule-based author ----------

def _num(x) -> str:
    """Format a number exactly as it appears in the evidence, with a true minus sign."""
    return f"{x:,}".replace("-", "−") if isinstance(x, (int, float)) else str(x)


def _signed(x) -> str:
    return ("+" if x > 0 else "") + _num(x)


def rule_case(case: Case) -> tuple[dict, dict]:
    """Write a case file and a critique from fixed rules. Returns (case_file, critique)."""
    place = case.name or "this place"
    vit = case.find("read_vital_signs")
    links = case.find("read_climate_links")
    stab = case.find("read_stability_check")
    look = case.find("read_outlook")
    land = case.find("read_terrain_and_water")
    near = case.find("read_nearby_events")
    world = case.find("read_planet_context")

    findings, suspects, objections = [], [], []
    rows = vit["facts"]["vital_signs"] if vit else []
    changed = sorted((r for r in rows if r["status"] in ("emerged", "extreme")),
                     key=lambda r: -(r["times_usual_year_to_year_swing"] or 0))
    shifting = [r for r in rows if r["status"] == "shifting"]
    world_rows = {w["vital_sign"]: w for w in (world["facts"]["world_trends"] or [])} if world else {}

    for r in changed[:4]:
        verb = "risen" if r["direction"] == "rising" else "fallen"
        claim = (f"{r['vital_sign']} has {verb} by {_num(abs(r['change_per_decade']))} {r['unit']} per decade since "
                 f"{r['record'][0]}, a total of {_signed(r['total_change_over_record'])} {r['unit']}, which is "
                 f"{_num(r['times_usual_year_to_year_swing'])} times the usual year-to-year swing.")
        why = "The change is larger than the variation people and ecosystems here are used to."
        evidence = [vit["id"]]
        w = world_rows.get(r["vital_sign"])
        if w and w["average_change_per_decade_over_mapped_area"] and w["percent_of_mapped_area_with_real_trend"] >= 30:
            ratio = r["change_per_decade"] / w["average_change_per_decade_over_mapped_area"]
            if ratio > 1.5:
                why = (f"That is faster than the average over the mapped world "
                       f"({_signed(w['average_change_per_decade_over_mapped_area'])} {r['unit']} per decade).")
                evidence.append(world["id"])
        findings.append({"claim": claim, "evidence": evidence,
                         "confidence": "high" if (r["p_after_corrections"] or 1) < 0.01 else "medium",
                         "why_it_matters": why})
        n = len(findings)
        reanalysis = "MERRA-2" in (r["source"] or "")
        if r["vital_sign"] in ("Precipitation", "Root-zone soil wetness", "Wind speed", "Evaporation from land") and reanalysis:
            objections.append({"finding": n, "severity": "major",
                               "problem": f"{r['vital_sign']} comes from a weather model constrained by observations. "
                                          "The mix of satellites feeding it changed over the decades, which can leave "
                                          "artificial steps that look like a trend.",
                               "fix": "Confirm against an independent record (rain gauges, GRACE, a second reanalysis) "
                                      "before acting on this."})
        if r["record"][0] >= 2001:
            objections.append({"finding": n, "severity": "minor",
                               "problem": f"The record starts in {r['record'][0]}: about 25 years is short for separating "
                                          "a lasting trend from a slow natural swing.",
                               "fix": "Treat the direction as likely and the rate as provisional."})
        if (r["p_after_corrections"] or 0) >= 0.01:
            objections.append({"finding": n, "severity": "minor",
                               "problem": f"After corrections p = {_num(r['p_after_corrections'])}: unlikely to be chance, "
                                          "but not overwhelmingly so.",
                               "fix": "Confidence is held at medium."})

    if not changed and shifting:
        r = shifting[0]
        findings.append({"claim": f"{r['vital_sign']} shows a trend unlikely to be chance "
                                  f"({_signed(r['change_per_decade'])} {r['unit']} per decade), still inside ordinary "
                                  "year-to-year swings.",
                         "evidence": [vit["id"]], "confidence": "medium",
                         "why_it_matters": "It is detectable but not yet outside what the place normally experiences."})
    if not changed and not shifting and vit:
        findings.append({"claim": "No vital sign here shows a trend distinguishable from chance.",
                         "evidence": [vit["id"]], "confidence": "medium",
                         "why_it_matters": "Absence of a detectable trend is not proof of no change: a noisy record can hide one."})

    if stab:
        for s in stab["facts"]["checked"]:
            if s["warning"]:
                findings.append({"claim": f"{s['vital_sign']} shows an early-warning sign of lost stability: its memory and "
                                          f"variability have both risen (p = {_num(s['p_memory'])}).",
                                 "evidence": [stab["id"]], "confidence": "low",
                                 "why_it_matters": "Systems approaching a tipping point recover more slowly from shocks."})
                objections.append({"finding": len(findings), "severity": "major",
                                   "problem": "About 1 place in 20 raises this flag by chance, and changes in the observing "
                                              "system can also raise a record's memory.",
                                   "fix": "Treat as a prompt to look closer, not as a prediction."})

    if links:
        seen = set()
        for l in sorted(links["facts"]["links"], key=lambda x: -abs(x["correlation"])):
            if l["rhythm"] in seen or len(suspects) >= 3:
                continue
            seen.add(l["rhythm"])
            state = links["facts"]["state_of_rhythms_now"].get(l["rhythm"], {})
            now = f" It currently stands at {_signed(state['latest_value'])}" + (
                f" ({state['state']})." if state.get("state") else ".") if state else ""
            suspects.append({
                "name": l["rhythm"],
                "case_for": f"{l['vital_sign']} here moves with it (correlation {_signed(l['correlation'])}), which accounts "
                            f"for about {_num(l['share_of_monthly_swings_explained_percent'])}% of the month-to-month swings.{now}",
                "case_against": "It explains swings from year to year, not the long-term trend: trends were removed before "
                                "correlating, and a correlation is not proof of cause.",
                "evidence": [links["id"]]})
    if changed and any(r["vital_sign"] == "Air temperature" and r["direction"] == "rising" for r in changed) and world:
        t = next((i for i in world["facts"]["indicators"] if i["indicator"] == "Global temperature"), None)
        if t:
            suspects.append({
                "name": "Global warming",
                "case_for": f"The planet as a whole is warming by {_num(t['change_per_decade'])} {t['unit']} per decade, and "
                            "this place is warming with it.",
                "case_against": "Global warming sets the background; how much of the local rate is due to local factors "
                                "(land use, irrigation, a growing city) cannot be told from one grid cell.",
                "evidence": [world["id"], vit["id"]]})

    outlook = "No outlook could be tested here."
    if look and look["facts"]["outlooks"]:
        skilled = sorted((o for o in look["facts"]["outlooks"] if o["more_accurate_than_normal_year_percent"] > 0),
                         key=lambda o: -o["more_accurate_than_normal_year_percent"])
        if skilled:
            o = skilled[0]
            outlook = (f"{o['vital_sign']} has the most predictable outlook: the next 12 months are expected to average "
                       f"{_num(o['next_12_months_mean'])} {o['unit']} (80% range {_num(o['next_12_months_range_80'][0])} to "
                       f"{_num(o['next_12_months_range_80'][1])}), {_signed(o['next_12_months_vs_1991_2020'])} against the "
                       f"1991–2020 average. Tested on the past, that method was "
                       f"{_num(o['more_accurate_than_normal_year_percent'])}% more accurate than assuming a normal year.")
            unskilled = [x["vital_sign"] for x in look["facts"]["outlooks"] if x["more_accurate_than_normal_year_percent"] <= 0]
            if unskilled:
                outlook += f" For {len(unskilled)} other vital signs no method beat assuming a normal year."
        else:
            outlook = "No method beat assuming a normal year for any vital sign here, so no outlook is offered."

    if look and links and outlook.startswith(("No outlook", "No method")) is False:
        enso_now = links["facts"]["state_of_rhythms_now"].get("El Niño / La Niña", {})
        tied = [l for l in links["facts"]["links"] if l["rhythm"] == "El Niño / La Niña" and abs(l["correlation"]) >= 0.4]
        if tied and enso_now.get("state", "Neutral") != "Neutral":
            outlook += (f" Caution: the outlook starts from December 2025 and does not know about the "
                        f"{enso_now['state'].lower()} now under way, which this place follows closely "
                        f"(correlation {_signed(tied[0]['correlation'])}); expect larger departures than stated.")

    if land and land["facts"].get("summary") and land["facts"].get("raindrop_outcome") != "water":
        findings.append({"claim": land["facts"]["summary"], "evidence": [land["id"]], "confidence": "medium",
                         "why_it_matters": "It shows who is downstream: what happens to water here travels along that route."})
        objections.append({"finding": len(findings), "severity": "minor",
                           "problem": "The route is computed from elevation and mapped rivers; it ignores dams, canals and "
                                      "evaporation.",
                           "fix": "Read it as an informed sketch."})
    if near and near["facts"]["count"]:
        e = near["facts"]["events"][0]
        findings.append({"claim": f"{_num(near['facts']['count'])} natural events are reported within "
                                  f"{_num(near['facts']['radius_km'])} km; the nearest is {e['event']} "
                                  f"({e['kind'].lower()}, {_num(e['distance_km'])} km away).",
                         "evidence": [near["id"]], "confidence": "high",
                         "why_it_matters": "Current events show what the place is exposed to right now."})
        objections.append({"finding": len(findings), "severity": "minor",
                           "problem": "One event cannot be attributed to a long-term trend from this evidence.",
                           "fix": "The case file does not make that link."})

    objections.append({"finding": 0, "severity": "minor",
                       "problem": "All climate figures describe one grid cell about 50 km across, not a single town or field.",
                       "fix": "Local features such as a city or a valley are averaged out."})

    level = vit["facts"]["condition"] if vit else "unknown"
    lead = changed[0] if changed else None
    on_site = None
    if near:
        on_site = next((e for e in near["facts"]["events"] if e["distance_km"] <= 60), None)
    if on_site:
        findings.insert(0, {
            "claim": f"{on_site['event']} is in progress at this location: {on_site['kind'].lower()}, "
                     f"{on_site['level'].lower()}, {on_site['size']}.",
            "evidence": [near["id"]], "confidence": "high",
            "why_it_matters": "This case was opened on the event. The findings below describe the long-term record at "
                              "its location, which is background, not an explanation of the event."})
        for o in objections:
            if o["finding"] > 0:
                o["finding"] += 1
        objections.append({"finding": 1, "severity": "major",
                           "problem": "Nothing in this evidence shows that the long-term trends here caused or worsened "
                                      "this event.",
                           "fix": "The case file reports the event and the background side by side without linking them."})
    if on_site:
        outside = (f"{len(changed)} vital sign{'s' if len(changed) != 1 else ''} outside the normal range"
                   if changed else "no vital sign outside its normal range")
        headline = f"{on_site['event']}: {on_site['size']}; the long record at this location shows {outside}"
    elif lead:
        headline = (f"{place}: {lead['vital_sign'].lower()} has {'risen' if lead['direction'] == 'rising' else 'fallen'} "
                    f"beyond its normal range" + (f", with {len(changed) - 1} more vital sign"
                                                  f"{'s' if len(changed) > 2 else ''} following" if len(changed) > 1 else ""))
    else:
        headline = f"{place}: no vital sign has left its normal range"
    summary = (f"Condition: {level}. {len(changed)} of {len(rows)} vital signs have changed by more than the usual "
               f"year-to-year swing" + (f", led by {lead['vital_sign'].lower()}." if lead else "."))
    case_file = {
        "headline": headline, "summary": summary, "findings": findings, "suspects": suspects, "outlook": outlook,
        "what_would_change_the_verdict": [
            "An independent record (station data, a second reanalysis, a satellite instrument) that disagrees with these trends.",
            "A documented change in the observing system at the time a trend begins.",
            "A longer record showing the change to be one phase of a slow natural cycle.",
        ],
    }
    critique = {"objections": objections,
                "overall": "The direction of the main changes is well supported. The exact rates, and anything involving "
                           "water or wind from the reanalysis, deserve an independent check before decisions rest on them."}
    return case_file, critique


def investigate(lat: float, lon: float, name: str | None = None) -> dict:
    """A complete rule-based case: evidence, case file, critique and number trace."""
    case = Case(lat, lon, name)
    case.gather_all()
    case_file, critique = rule_case(case)
    return {
        "place": {"lat": lat, "lon": lon, "name": name},
        "written_by": "rules",
        "author": "Canary's rule-based detective (no AI model was used)",
        "case": case_file,
        "skeptic": critique,
        "evidence": case.evidence,
        "checks": trace_numbers(case_texts(case_file), case.evidence),
    }
