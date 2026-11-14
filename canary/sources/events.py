"""What is happening on Earth right now.

- NASA EONET (Earth Observatory Natural Event Tracker): open wildfires,
  severe storms with their tracks, volcanoes, icebergs and more.
- USGS: earthquakes of magnitude 4.5 and above in the past week.

Both are public feeds with no login.
"""

from __future__ import annotations

import json

import httpx

from .cache import cached_text

EONET = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30"
USGS = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"
HEADERS = {"User-Agent": "canary-earth-monitor"}

CATEGORY_LABEL = {
    "wildfires": "Wildfire",
    "severeStorms": "Severe storm",
    "volcanoes": "Volcano",
    "seaLakeIce": "Iceberg or sea ice",
    "floods": "Flood",
    "drought": "Drought",
    "dustHaze": "Dust or haze",
    "landslides": "Landslide",
    "earthquakes": "Earthquake",
    "tempExtremes": "Temperature extreme",
    "snow": "Snow",
    "waterColor": "Water colour",
    "manmade": "Human-caused",
}


def _get(url: str) -> str:
    response = httpx.get(url, timeout=60.0, headers=HEADERS, follow_redirects=True)
    response.raise_for_status()
    return response.text


def simplify_eonet(doc: dict) -> list[dict]:
    """EONET events as GeoJSON features: one point at the latest position,
    plus a line for events that moved (storm tracks)."""
    features = []
    for event in doc.get("events", []):
        points = [g for g in event.get("geometry", []) if g.get("type") == "Point"]
        if not points:
            continue
        category = (event.get("categories") or [{}])[0].get("id", "other")
        latest = points[-1]
        magnitude = None
        if latest.get("magnitudeValue") is not None:
            magnitude = f"{latest['magnitudeValue']:g} {latest.get('magnitudeUnit') or ''}".strip()
        props = {
            "kind": category,
            "kind_label": CATEGORY_LABEL.get(category, category),
            "title": event.get("title", ""),
            "date": latest.get("date", ""),
            "magnitude": magnitude,
            "magnitude_value": latest.get("magnitudeValue"),
            "magnitude_unit": latest.get("magnitudeUnit"),
            "link": (event.get("sources") or [{}])[0].get("url") or event.get("link"),
            "source": "NASA EONET",
        }
        features.append({"type": "Feature", "properties": props,
                         "geometry": {"type": "Point", "coordinates": latest["coordinates"][:2]}})
        if len(points) > 1:
            features.append({"type": "Feature", "properties": {**props, "track": True},
                             "geometry": {"type": "LineString",
                                          "coordinates": [g["coordinates"][:2] for g in points]}})
    return features


def simplify_usgs(doc: dict) -> list[dict]:
    features = []
    for quake in doc.get("features", []):
        p = quake.get("properties", {})
        lon, lat, depth = (quake["geometry"]["coordinates"] + [None])[:3]
        features.append({
            "type": "Feature",
            "properties": {
                "kind": "earthquakes",
                "kind_label": "Earthquake",
                "title": p.get("title", ""),
                "date": p.get("time"),
                "magnitude": f"M {p.get('mag'):.1f}" if p.get("mag") is not None else None,
                "mag": p.get("mag"),
                "magnitude_value": p.get("mag"),
                "magnitude_unit": "M",
                "depth_km": depth,
                "link": p.get("url"),
                "source": "USGS",
            },
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
        })
    return features


def current() -> dict:
    """All current events as one GeoJSON FeatureCollection. A feed that is
    down is skipped rather than failing the whole response."""
    features: list[dict] = []
    errors: list[str] = []
    for name, url, simplify, minutes in (("eonet", EONET, simplify_eonet, 30), ("usgs", USGS, simplify_usgs, 10)):
        try:
            text = cached_text("events", f"{name}.json", lambda u=url: _get(u), max_age_days=minutes / 1440)
            features.extend(simplify(json.loads(text)))
        except Exception as exc:  # noqa: BLE001 - report and carry on
            errors.append(f"{name}: {exc}")
    return {"type": "FeatureCollection", "features": features, "errors": errors}
