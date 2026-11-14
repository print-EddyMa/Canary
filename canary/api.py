"""HTTP API and static front end.

Run with:  uvicorn canary.api:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

import anthropic
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import json

from . import __version__, briefing, catalogue, cube, detective, investigate, llm, regions, terrain
from .chart import place_chart
from .sources import events, geos, gibs, indices
from .sources.cache import cached_text
from .stats import forecast
from .vitals import VITALS

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
GEOCODER = "https://geocoding-api.open-meteo.com/v1/search"

@asynccontextmanager
async def _lifespan(_: FastAPI):
    # Fetch any global grids not on disk yet, without holding up the first page.
    cube.warm_in_background()
    yield


app = FastAPI(title="Canary", version=__version__, lifespan=_lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2000)


@app.get("/api/catalogue")
def variable_catalogue() -> dict:
    """Variables, themes, regions and the guide's questions."""
    return {
        "themes": [{"id": t[0], "name": t[1], "about": t[2]} for t in catalogue.THEMES],
        "variables": [{"id": v.id, "label": v.label, "unit": v.unit, "theme": v.theme, "definition": v.definition,
                       "source": v.source, "parameter": v.parameter, "ready": cube.ready(v.id),
                       "record_from": v.start_year or 1981} for v in catalogue.VARIABLES],
        "regions": regions.catalogue(),
        "interests": [{"id": k, "question": q} for k, (q, _) in catalogue.INTERESTS.items()],
        "place_kinds": [{"id": k, "name": name} for k, (name, _, _) in catalogue.PLACE_KINDS.items()],
    }


@app.get("/api/countries")
def country_outlines() -> dict:
    """Country outlines (Natural Earth 1:110m) for the region map."""
    try:
        return regions.countries_geojson()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Country outlines did not load: {exc}") from exc


@lru_cache(maxsize=512)
def _investigate(variable: str, region: str, start: int | None, end: int | None) -> dict:
    return investigate.analyse(variable, region, start, end)


@app.get("/api/investigate")
def investigate_region(
    variable: str = Query(..., max_length=40),
    region: str = Query("world", max_length=80),
    start: int | None = Query(None, ge=1981, le=2025),
    end: int | None = Query(None, ge=1981, le=2025),
) -> dict:
    """What is changing, how much, and is it significant: one variable, one region."""
    try:
        return _investigate(variable, region, start, end)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"A data source did not answer: {exc}") from exc


@lru_cache(maxsize=128)
def _scan(region: str, start: int | None, end: int | None, ready_count: int) -> dict:
    return investigate.scan(region, start, end)


@app.get("/api/scan")
def scan_region(
    region: str = Query("world", max_length=80),
    start: int | None = Query(None, ge=1981, le=2025),
    end: int | None = Query(None, ge=1981, le=2025),
) -> dict:
    """Every variable tested in one region, ranked: which are trending here?"""
    try:
        ready = sum(cube.ready(v.id) for v in catalogue.VARIABLES)  # part of the cache key while grids arrive
        return _scan(region, start, end, ready)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/suggest")
def suggest_variables(interest: str | None = Query(None, max_length=20),
                      place: str | None = Query(None, max_length=20)) -> list[dict]:
    """The guide: variables worth a first look for an interest and a kind of place."""
    return investigate.suggest(interest, place)


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
            result["brief_error"] = llm.explain(exc)
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
        return json.dumps(llm.investigate(lat, lon, name) if use_ai else detective.investigate(lat, lon, name))

    try:
        try:
            result = json.loads(cached_text("cases", key, build, max_age_days=1))
        except (anthropic.AnthropicError, llm.Refused, RuntimeError, ValueError) as exc:
            if not use_ai:
                raise
            # A failed AI run still owes the reader a case file. It is not cached,
            # so the next request tries the AI again.
            result = detective.investigate(lat, lon, name)
            result["ai_error"] = f"The AI detective could not finish ({llm.explain(exc)}), so this case was written by rules."
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"A data source did not answer: {exc}") from exc
    result["ai_available"] = llm.available()
    return result


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
