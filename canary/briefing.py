"""The world dashboard: which events matter most right now, and a short brief.

Events come from NASA EONET and USGS (see sources/events.py). Each gets a
severity between 0 and 1 from its own physical magnitude, so that a typhoon,
an earthquake and a wildfire can be put in one ranked list:

- earthquakes by moment magnitude (4.5 scores 0, 7.5 and above scores 1);
- storms by maximum sustained wind, with the Saffir-Simpson category;
- wildfires by burned area on a logarithmic scale (100 acres to 500,000);
- volcanoes and other events without a magnitude get a fixed middling score.

The ranking is a triage aid for where to look first, not a measure of harm:
it knows nothing about how many people live nearby.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

from .sources import events, planet

MAPS_INDEX = Path(__file__).resolve().parent.parent / "web" / "maps" / "index.json"
ACRE_KM2 = 0.00404686


def saffir_simpson(knots: float) -> str:
    for limit, name in ((34, "Tropical depression"), (64, "Tropical storm"), (83, "Category 1"),
                        (96, "Category 2"), (113, "Category 3"), (137, "Category 4")):
        if knots < limit:
            return name
    return "Category 5"


def severity(properties: dict) -> tuple[float, str, str]:
    """(score 0-1, level, plain description of the size) for one event."""
    kind = properties.get("kind")
    value = properties.get("magnitude_value")
    unit = (properties.get("magnitude_unit") or "").lower()
    if kind == "earthquakes" and value is not None:
        level = "Major" if value >= 7 else "Strong" if value >= 6 else "Moderate"
        return min(max((value - 4.5) / 3.0, 0.0), 1.0), level, f"magnitude {value:.1f}"
    if kind == "severeStorms" and value is not None and unit == "kts":
        return min(value / 140.0, 1.0), saffir_simpson(value), f"winds of {value * 1.852:.0f} km/h"
    if kind == "wildfires" and value is not None and unit == "acres":
        km2 = value * ACRE_KM2
        level = "Very large" if value >= 100_000 else "Large" if value >= 10_000 else "Active"
        if "prescribed" in (properties.get("title") or "").lower():
            # A planned burn set by land managers is not an emergency.
            size = f"{km2:,.0f} km² planned burn" if km2 >= 10 else f"{km2:.1f} km² planned burn"
            return 0.05, "Planned burn", size
        size = f"{km2:,.0f} km² burned" if km2 >= 10 else f"{km2:.1f} km² burned"
        score = (math.log10(max(value, 100.0)) - 2.0) / (math.log10(500_000) - 2.0)
        return min(max(score, 0.0), 1.0), level, size
    if kind == "volcanoes":
        return 0.6, "Erupting", "eruption in progress"
    if kind == "seaLakeIce":
        return 0.12, "Tracked", "iceberg being tracked"
    return 0.3, "Active", properties.get("magnitude") or ""


def ranked_events(limit: int = 12) -> dict:
    feed = events.current()
    rows = []
    counts: dict[str, int] = {}
    for feature in feed["features"]:
        if feature["geometry"]["type"] != "Point":
            continue
        p = feature["properties"]
        counts[p["kind_label"]] = counts.get(p["kind_label"], 0) + 1
        score, level, size = severity(p)
        lon, lat = feature["geometry"]["coordinates"][:2]
        date = p.get("date")
        if isinstance(date, (int, float)):  # USGS gives milliseconds since 1970
            date = datetime.fromtimestamp(date / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        rows.append({
            "title": p["title"], "kind": p["kind"], "kind_label": p["kind_label"],
            "severity": round(score, 3), "level": level, "size": size,
            "lat": lat, "lon": lon, "date": date, "link": p.get("link"), "source": p.get("source"),
        })
    rows.sort(key=lambda r: -r["severity"])
    return {"events": rows[:limit], "counts": counts, "total": len(rows), "errors": feed["errors"]}


def _maps() -> dict | None:
    try:
        return json.loads(MAPS_INDEX.read_text())
    except (OSError, ValueError):
        return None


def facts() -> dict:
    """Everything the dashboard (and the AI editor) may state, in one place."""
    world = ranked_events()
    earth = planet.status()
    maps = _maps()
    analysis = None
    if maps:
        temperature = next(l for l in maps["layers"] if l["id"] == "temperature")
        analysis = {
            "period": temperature["period"],
            "percent_of_surface_with_real_warming": temperature["percent_rising"],
            "percent_with_at_least_one_vital_sign_outside_normal": maps["alarm"]["percent_any"],
            "percent_with_three_or_more": maps["alarm"]["percent_three_plus"],
        }
    return {"date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "planet": earth["tiles"],
            "events": world["events"], "event_counts": world["counts"], "event_total": world["total"],
            "canary_analysis": analysis, "errors": earth["errors"] + world["errors"]}


def rule_brief(f: dict) -> list[dict]:
    """A short brief written by rules: one line per thing worth knowing."""
    lines = []
    tiles = {t["id"]: t for t in f["planet"]}
    if "temperature" in tiles:
        t = tiles["temperature"]
        lines.append({"topic": "Planet", "text": f"{t['when']}: global temperature {t['value']:+.2f} °C {t['note']}."})
    if "enso" in tiles and abs(tiles["enso"]["value"]) >= 0.5:
        e = tiles["enso"]
        lines.append({"topic": "Ocean", "text": f"{e['state']} under way ({e['value']:+.2f} °C in the tropical "
                      f"Pacific, {e['when']}). It shifts rainfall and temperature across the tropics and beyond."})
    for kind, noun in (("severeStorms", "storm"), ("earthquakes", "earthquake"), ("wildfires", "wildfire"),
                       ("volcanoes", "volcano")):
        of_kind = [e for e in f["events"] if e["kind"] == kind]
        if of_kind:
            top = of_kind[0]
            count = f["event_counts"].get(top["kind_label"], len(of_kind))
            scope = "of magnitude 4.5 or more in the past week" if kind == "earthquakes" else "being tracked"
            more = f" One of {count} {scope}." if count > 1 else ""
            lines.append({"topic": top["kind_label"], "text": f"{top['title']}: {top['level'].lower()} {noun}, "
                          f"{top['size']}.{more}", "lat": top["lat"], "lon": top["lon"]})
    if f["canary_analysis"]:
        a = f["canary_analysis"]
        lines.append({"topic": "Long view", "text": f"Since {a['period'][0]}, a warming trend unlikely to be chance "
                      f"covers {a['percent_of_surface_with_real_warming']:.0f}% of Earth's surface, and "
                      f"{a['percent_with_three_or_more']:.0f}% of it has three or more vital signs outside their "
                      "normal range."})
    return lines


def briefing() -> dict:
    f = facts()
    return {**f, "brief": rule_brief(f), "brief_written_by": "rules"}
