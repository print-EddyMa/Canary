"""HTTP API and static front end.

Run with:  uvicorn canary.api:app --reload
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .chart import place_chart
from .sources import indices
from .vitals import VITALS

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
GEOCODER = "https://geocoding-api.open-meteo.com/v1/search"

app = FastAPI(title="Canary", version=__version__)


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


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
