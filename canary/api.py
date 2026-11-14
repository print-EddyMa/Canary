"""HTTP API and static front end.

Run with:  uvicorn canary.api:app --reload
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import json

from . import __version__, briefing, detective, llm, terrain
from .chart import place_chart
from .sources import events, geos, gibs, indices
from .sources.cache import cached_text
from .stats import forecast
from .vitals import VITALS

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
GEOCODER = "https://geocoding-api.open-meteo.com/v1/search"

app = FastAPI(title="Canary", version=__version__)
app.add_middleware(GZipMiddleware, minimum_size=2000)


@lru_cache(maxsize=512)
def _chart(lat: float, lon: float) -> dict:
    return place_chart(lat, lon)


@app.get("/api/chart")
def chart(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
) -> dict:
    """Vital signs, trends, early warnings and suspects for one point."""
    try:
        return _chart(round(lat, 2), round(lon, 2))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"NASA POWER did not answer: {exc}") from exc


@app.get("/api/search")
def search(q: str = Query(..., min_length=2, max_length=100)) -> list[dict]:
    """Find a place by name (Open-Meteo geocoding, GeoNames data)."""
    try:
        response = httpx.get(GEOCODER, params={"name": q, "count": 6, "language": "en"}, timeout=15.0)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Place search did not answer: {exc}") from exc
    return [
        {
            "name": r["name"],
            "region": ", ".join(p for p in (r.get("admin1"), r.get("country")) if p),
            "lat": r["latitude"],
            "lon": r["longitude"],
        }
        for r in response.json().get("results", [])
    ]


@app.get("/api/vitals")
def vitals() -> dict:
    """What Canary monitors, with plain-language definitions."""
    return {
        "vitals": [
            {"id": v.id, "label": v.label, "unit": v.unit, "definition": v.definition,
             "source": v.source, "parameter": v.parameter}
            for v in VITALS
        ],
        "climate_modes": [
            {"id": m.id, "name": m.name, "description": m.description, "url": m.url}
            for m in indices.MODES
        ],
    }


@app.get("/api/layers")
def layers() -> list[dict]:
    """Curated NASA GIBS satellite layers with live dates and legends."""
    try:
        return gibs.catalogue()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"NASA GIBS did not answer: {exc}") from exc


@app.get("/api/wind")
def wind() -> dict:
    """Latest global wind, temperature and pressure grid from NASA GEOS."""
    try:
        return geos.wind_grid()
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(502, f"NASA GEOS did not answer: {exc}") from exc


@app.get("/api/now")
def now(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
) -> dict:
    """Current conditions at a point, from the NASA GEOS analysis."""
    try:
        return geos.sample(lat, lon)
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(502, f"NASA GEOS did not answer: {exc}") from exc


@app.get("/api/events")
def current_events() -> dict:
    """Open natural events (NASA EONET) and recent earthquakes (USGS) as GeoJSON."""
    return events.current()


@lru_cache(maxsize=256)
def _terrain(lat: float, lon: float) -> dict:
    return terrain.analyse(lat, lon)


@app.get("/api/terrain")
def terrain_at(
    lat: float = Query(..., ge=-85, le=85),
    lon: float = Query(..., ge=-180, le=180),
) -> dict:
    """Terrain shape, local stream network and the raindrop's path from a point."""
    try:
        return _terrain(round(lat, 3), round(lon, 3))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Elevation tiles did not answer: {exc}") from exc


@app.get("/api/status")
def status() -> dict:
    """Which optional capabilities are switched on."""
    return {"ai": llm.available(), "model": llm.MODEL if llm.available() else None,
            "pretrained_forecast": forecast._chronos() is not None}


@app.get("/api/briefing")
def world_briefing(ai: bool = Query(True)) -> dict:
    """The dashboard: planet indicators, ranked events and a short brief."""
    result = briefing.briefing()
    result["ai_available"] = llm.available()
    if ai and llm.available():
        try:
            # One AI-written brief per day and per set of top events.
            top = "|".join(e["title"] for e in result["events"][:5])
            key = f"{result['date']}_{sum(map(ord, top)) % 10**6}.json"
            text = cached_text("brief", key, lambda: json.dumps(llm.daily_brief(result)), max_age_days=1)
            result["brief"], result["brief_written_by"] = json.loads(text), "ai"
        except Exception as exc:  # noqa: BLE001 - fall back to the rule-written brief
            result["brief_error"] = str(exc)
    return result


@app.get("/api/case")
def case_file(
    lat: float = Query(..., ge=-85, le=85),
    lon: float = Query(..., ge=-180, le=180),
    name: str | None = Query(None, max_length=120),
    author: str = Query("auto", pattern="^(auto|rules|ai)$"),
) -> dict:
    """Investigate a place and return a case file with its evidence and critique."""
    lat, lon = round(lat, 2), round(lon, 2)
    if author == "ai" and not llm.available():
        raise HTTPException(503, "No Claude API key is configured, so only the rule-based detective is available.")
    use_ai = author != "rules" and llm.available()
    key = f"{'ai' if use_ai else 'rules'}_{lat:+.2f}_{lon:+.2f}.json"

    def build() -> str:
        if use_ai:
            try:
                return json.dumps(llm.investigate(lat, lon, name))
            except Exception as exc:  # noqa: BLE001 - a failed AI run still owes the reader a case file
                fallback = detective.investigate(lat, lon, name)
                fallback["ai_error"] = f"The AI detective could not finish ({exc}); this case was written by rules."
                return json.dumps(fallback)
        return json.dumps(detective.investigate(lat, lon, name))

    try:
        result = json.loads(cached_text("cases", key, build, max_age_days=1))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"A data source did not answer: {exc}") from exc
    result["ai_available"] = llm.available()
    return result


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
