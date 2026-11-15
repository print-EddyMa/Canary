"""Live alerts: disasters, warnings and super-emitters as they are reported.

Polled in the background every few minutes and merged into one list, each alert with a
severity on Canary's status scale (critical, serious, watch):

    GDACS          UN / EC Global Disaster Alert and Coordination System: orange and red
                   alerts for cyclones, earthquakes, floods, droughts, volcanoes, wildfires
    USGS           significant earthquakes of the past week
    NWS            extreme warnings from the US National Weather Service
    Carbon Mapper  methane plumes above 1,000 kg per hour seen from orbit (super-emitters)
    NASA EONET     natural events opened in the last two days

New alerts are pushed to browsers as they arrive (see `api.alert_stream`).
"""

from __future__ import annotations

import json
import math
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx

from .cache import CACHE_DIR

HEADERS = {"User-Agent": "canary-earth-monitor"}
POLL_SECONDS = 300
GDACS = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
USGS = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson"
NWS = "https://api.weather.gov/alerts/active"
CARBON_MAPPER = "https://api.carbonmapper.org/api/v1/catalog/plumes/annotated"
EONET = "https://eonet.gsfc.nasa.gov/api/v3/events"

KIND = {"TC": "Tropical cyclone", "EQ": "Earthquake", "FL": "Flood", "DR": "Drought", "VO": "Volcano",
        "WF": "Wildfire", "TS": "Tsunami"}
EONET_KIND = {"wildfires": "Wildfire", "severeStorms": "Severe storm", "volcanoes": "Volcano",
              "seaLakeIce": "Iceberg", "floods": "Flood", "earthquakes": "Earthquake"}

_lock = threading.Lock()
_alerts: dict[str, dict] = {}
_version = 0
_status = {"polled": None, "errors": {}}
_thread: threading.Thread | None = None


def _get(url: str, **params) -> dict:
    return httpx.get(url, params=params, headers=HEADERS, timeout=40, follow_redirects=True).raise_for_status().json()


def _iso(value: str | datetime | float | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        value = datetime.fromtimestamp(value / 1000, timezone.utc)
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def gdacs() -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=21)).strftime("%Y-%m-%d")
    data = _get(GDACS, alertlevel="Orange;Red", fromDate=since)
    out = []
    for f in data.get("features", []):
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        kind = KIND.get(p["eventtype"], p["eventtype"])
        # Only events still under way, or ended in the last three days, are news.
        ended = datetime.fromisoformat(p["todate"]).replace(tzinfo=timezone.utc) if p.get("todate") else None
        if p.get("iscurrent") != "true" and (ended is None or datetime.now(timezone.utc) - ended > timedelta(days=3)):
            continue
        name = re.sub(r"(,\s*)+", ", ", p["name"]).replace(" ,", ",").strip(", ")
        if p["eventtype"] in ("DR", "FL") and name.count(",") > 2:
            head, rest = name.split(" in ", 1) if " in " in name else (kind, name)
            places = [x.strip() for x in rest.split(",") if x.strip()]
            name = f"{head} in {', '.join(places[:3])} and {len(places) - 3} more"
        out.append({
            "id": f"gdacs-{p['eventtype']}-{p['eventid']}", "source": "GDACS", "kind": kind,
            "severity": "critical" if p["alertlevel"] == "Red" else "serious",
            "title": name, "detail": (p.get("severitydata") or {}).get("severitytext") or p.get("description", ""),
            "where": "" if p["eventtype"] in ("DR", "FL") else (p.get("country") or ""), "lat": lat, "lon": lon,
            "time": _iso(p.get("datemodified") or p.get("fromdate")), "url": (p.get("url") or {}).get("report"),
        })
    return out


def usgs() -> list[dict]:
    out = []
    for f in _get(USGS).get("features", []):
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        severe = (p.get("mag") or 0) >= 7 or p.get("alert") in ("orange", "red") or p.get("tsunami")
        out.append({
            "id": f"usgs-{f['id']}", "source": "USGS", "kind": "Earthquake",
            "severity": "critical" if severe else "serious",
            "title": f"Magnitude {p['mag']:.1f} earthquake", "where": p.get("place") or "",
            "detail": ("Tsunami warning issued. " if p.get("tsunami") else "")
                      + (f"Shaking intensity {p['mmi']:.1f} (MMI)." if p.get("mmi") else ""),
            "lat": lat, "lon": lon, "time": _iso(p.get("time")), "url": p.get("url"),
        })
    return out


_zone_cache: dict[str, tuple[float, float] | None] = {}


def _zone_centre(url: str) -> tuple[float, float] | None:
    if url not in _zone_cache:
        try:
            geom = _get(url).get("geometry") or {}
            coords = geom.get("coordinates") or []
            flat = []

            def walk(c):
                if c and isinstance(c[0], (int, float)):
                    flat.append(c)
                else:
                    for x in c:
                        walk(x)
            walk(coords)
            _zone_cache[url] = (sum(c[1] for c in flat) / len(flat), sum(c[0] for c in flat) / len(flat)) if flat else None
        except (httpx.HTTPError, ValueError, KeyError):
            _zone_cache[url] = None
    return _zone_cache[url]


def nws() -> list[dict]:
    out = []
    features = _get(NWS, status="actual", message_type="alert", severity="Extreme,Severe").get("features", [])
    groups: dict[tuple, list] = {}
    for f in features:
        p = f["properties"]
        # Warnings and emergencies only: advisories and statements are routine.
        if not p["event"].endswith(("Warning", "Emergency")) or "Test" in p["event"]:
            continue
        # One warning is often issued for many zones at once: show it once.
        groups.setdefault((p["event"], (p.get("senderName") or ""), (p.get("sent") or "")[:13]), []).append(f)
    for members in list(groups.values())[:15]:
        f = members[0]
        p = f["properties"]
        extra = f" and {len(members) - 1} more area{'s' if len(members) > 2 else ''}" if len(members) > 1 else ""
        centre = None
        if f.get("geometry"):
            ring = f["geometry"]["coordinates"][0]
            centre = (sum(c[1] for c in ring) / len(ring), sum(c[0] for c in ring) / len(ring))
        elif p.get("affectedZones"):
            centre = _zone_centre(p["affectedZones"][0])
        if centre is None:
            continue
        out.append({
            "id": f"nws-{p['id'].rsplit('/', 1)[-1]}", "source": "NWS", "kind": "US weather warning",
            # Extreme warnings (tornado, hurricane, flash-flood emergency) are critical; the rest are routine.
            "severity": "critical" if p.get("severity") == "Extreme" else "watch",
            "title": p["event"], "where": p.get("areaDesc", "").split(";")[0][:80] + extra,
            "detail": (p.get("headline") or "")[:220], "lat": centre[0], "lon": centre[1],
            "time": _iso(p.get("sent")), "url": f"https://alerts.weather.gov/search?id={p['id'].rsplit('/', 1)[-1]}",
        })
    return out


PLUME_DIR = CACHE_DIR / "plumes"
_plume_urls: dict[str, str] = {}  # signed image links expire, so they stay on the server


def plume_image(plume_id: str) -> bytes | None:
    """A plume's methane enhancement image as a PNG with a transparent background, cached on disk."""
    if not re.fullmatch(r"[A-Za-z0-9_\-]{6,80}", plume_id):
        return None
    path = PLUME_DIR / f"{plume_id}.png"
    if path.exists():
        return path.read_bytes()
    url = _plume_urls.get(plume_id)
    if not url:
        return None
    import io

    import numpy as np
    from PIL import Image
    r = httpx.get(url, timeout=20, follow_redirects=True)
    r.raise_for_status()
    rgb = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"))
    # Black is "no enhancement": make it transparent and let the colour carry the concentration.
    alpha = np.clip(rgb.max(axis=2).astype(np.int32) * 3, 0, 235).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(buf, "PNG", optimize=True)
    PLUME_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf.getvalue())
    return buf.getvalue()


def methane() -> list[dict]:
    data = _get(CARBON_MAPPER, limit=200, sort="desc")
    out = []
    for p in data.get("items", []):
        rate = p.get("emission_auto")
        if p.get("gas") != "CH4" or rate is None or rate < 1000 or p.get("hide_emission"):
            continue
        lon, lat = p["geometry_json"]["coordinates"][:2]
        pid = str(p["plume_id"])
        try:
            raw = p.get("plume_bounds")
            bounds = [float(x) for x in (json.loads(raw) if isinstance(raw, str) else raw)][:4] if raw else None
        except (TypeError, ValueError):
            bounds = None
        if p.get("plume_png") and bounds:
            _plume_urls[pid] = p["plume_png"]
        out.append({
            "id": f"cm-{p['plume_id']}", "source": "Carbon Mapper", "kind": "Methane plume",
            "severity": "serious" if rate >= 5000 else "watch",
            "title": f"Methane plume, about {rate:,.0f} kg per hour",
            "detail": f"Seen by {p.get('platform', 'satellite')}"
                      + (f"; uncertainty ±{p['emission_uncertainty_auto']:,.0f} kg/h" if p.get("emission_uncertainty_auto") else "")
                      + ". A super-emitter: one source releasing as much as thousands of cars' worth of warming.",
            "where": "Offshore" if p.get("is_offshore") else "", "lat": lat, "lon": lon,
            "time": _iso(p.get("scene_timestamp")), "url": f"https://data.carbonmapper.org/#plume={p['plume_id']}",
            "value": round(rate), "uncertainty": round(p["emission_uncertainty_auto"]) if p.get("emission_uncertainty_auto") else None,
            "image": f"/api/plume/{pid}.png" if pid in _plume_urls else None, "bounds": bounds,
        })
    out = out[:25]
    for a in out:  # fetch the images while their links are still valid
        if a["image"]:
            try:
                plume_image(a["id"][3:])
            except Exception:  # noqa: BLE001 - the plume still shows as a point
                a["image"] = None
    return out


def eonet() -> list[dict]:
    out = []
    for e in _get(EONET, status="open", days=2).get("events", []):
        cat = e["categories"][0]["id"]
        if cat not in ("severeStorms", "volcanoes", "floods"):
            continue  # wildfires and ice are many and small; they stay on the map
        g = e["geometry"][-1]
        lon, lat = g["coordinates"][:2] if g["type"] == "Point" else g["coordinates"][0][0][:2]
        out.append({
            "id": f"eonet-{e['id']}", "source": "NASA EONET", "kind": EONET_KIND.get(cat, cat),
            "severity": "watch", "title": e["title"], "where": "", "detail": "",
            "lat": lat, "lon": lon, "time": _iso(g["date"]), "url": e.get("link"),
        })
    return out


_countries: list | None = None


def country_at(lat: float, lon: float) -> str:
    """The country containing a point (Natural Earth outlines), or "" at sea."""
    global _countries
    if _countries is None:
        from .. import regions
        _countries = []
        for f in regions.countries_geojson()["features"]:
            g = f["geometry"]
            polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            for poly in polys:
                ring = poly[0]
                xs, ys = [c[0] for c in ring], [c[1] for c in ring]
                _countries.append((f["properties"]["name"], (min(xs), min(ys), max(xs), max(ys)), ring))
    for name, (x0, y0, x1, y1), ring in _countries:
        if not (x0 <= lon <= x1 and y0 <= lat <= y1):
            continue
        inside = False
        for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
            if (ay > lat) != (by > lat) and lon < (bx - ax) * (lat - ay) / (by - ay) + ax:
                inside = not inside
        if inside:
            return name
    return ""


FEEDS = {"GDACS": gdacs, "USGS": usgs, "NWS": nws, "Carbon Mapper": methane, "NASA EONET": eonet}
RANK = {"critical": 0, "serious": 1, "watch": 2}


def poll() -> None:
    """Read every feed once and merge what is new."""
    global _version
    found, errors = [], {}
    for name, feed in FEEDS.items():
        try:
            found.extend(feed())
        except Exception as exc:  # noqa: BLE001 - one feed failing must not stop the others
            errors[name] = str(exc)[:160]
    now = time.time()
    with _lock:
        seen = set(_alerts)
        for a in found:
            if not all(math.isfinite(v) for v in (a["lat"], a["lon"])):
                continue
            if not a["where"]:
                try:
                    a["where"] = country_at(a["lat"], a["lon"]) or "At sea"
                except Exception:  # noqa: BLE001 - a name is a nicety
                    pass
            previous = _alerts.get(a["id"])
            a["first_seen"] = previous["first_seen"] if previous else now
            _alerts[a["id"]] = a
        # Forget alerts that have left every feed.
        for gone in seen - {a["id"] for a in found} - set(errors and seen):
            _alerts.pop(gone, None)
        _version += 1
        _status.update(polled=now, errors=errors)


def _loop() -> None:
    while True:
        poll()
        time.sleep(POLL_SECONDS)


def start() -> None:
    global _thread
    if _thread is None:
        _thread = threading.Thread(target=_loop, daemon=True, name="alerts")
        _thread.start()


def current() -> dict:
    with _lock:
        items = sorted(_alerts.values(), key=lambda a: (RANK[a["severity"]], -(datetime.fromisoformat(
            a["time"].replace("Z", "+00:00")).timestamp() if a["time"] else 0)))
        return {"alerts": items, "version": _version, "polled": _status["polled"], "errors": _status["errors"],
                "sources": list(FEEDS)}


def since(first_seen_after: float) -> list[dict]:
    with _lock:
        return [a for a in _alerts.values() if a["first_seen"] > first_seen_after]
