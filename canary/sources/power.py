"""Client for the NASA POWER monthly point API.

POWER (Prediction Of Worldwide Energy Resources) needs no login. One request
returns every month from 1981 for up to 20 parameters at a point.
Docs: https://power.larc.nasa.gov/docs/services/api/temporal/monthly/
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import httpx
import numpy as np

from .cache import cached_text

URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
FIRST_YEAR = 1981
# POWER publishes monthly values only for complete calendar years.
LAST_YEAR = 2025
MAX_PARAMETERS = 20
FILL = -999.0


@dataclass
class MonthlySeries:
    """Monthly values for several parameters on one shared time axis."""

    years: np.ndarray  # int, one entry per month
    months: np.ndarray  # int 1..12
    values: dict[str, np.ndarray]  # parameter -> float array, NaN where missing
    lat: float
    lon: float
    elevation: float | None

    @property
    def time(self) -> np.ndarray:
        """Decimal years at mid-month."""
        return self.years + (self.months - 0.5) / 12.0


def _fetch(lat: float, lon: float, parameters: tuple[str, ...]) -> str:
    response = httpx.get(
        URL,
        params={
            "parameters": ",".join(parameters),
            "community": "AG",
            "longitude": f"{lon:.2f}",
            "latitude": f"{lat:.2f}",
            "start": FIRST_YEAR,
            "end": LAST_YEAR,
            "format": "JSON",
        },
        timeout=60.0,
        headers={"User-Agent": "canary-earth-monitor"},
    )
    response.raise_for_status()
    return response.text


def parse(text: str) -> MonthlySeries:
    doc = json.loads(text)
    lon, lat, *rest = doc["geometry"]["coordinates"]
    raw = doc["properties"]["parameter"]
    # Keys are YYYYMM; month "13" is POWER's annual mean, which we drop.
    keys = sorted(k for k in next(iter(raw.values())) if not k.endswith("13"))
    years = np.array([int(k[:4]) for k in keys])
    months = np.array([int(k[4:]) for k in keys])
    values = {}
    for name, series in raw.items():
        arr = np.array([series.get(k, FILL) for k in keys], dtype=float)
        arr[arr == FILL] = np.nan
        values[name] = arr
    return MonthlySeries(years, months, values, lat, lon, rest[0] if rest else None)


def monthly(lat: float, lon: float, parameters: tuple[str, ...]) -> MonthlySeries:
    """Monthly series for a point. Coordinates are snapped to 0.01 degree."""
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError("latitude must be in [-90, 90] and longitude in [-180, 180]")
    if len(parameters) > MAX_PARAMETERS:
        raise ValueError(f"POWER accepts at most {MAX_PARAMETERS} parameters per request")
    lat, lon = round(lat, 2), round(lon, 2)
    key = f"{lat:+.2f}_{lon:+.2f}_{'-'.join(sorted(parameters))}.json"
    text = cached_text("power", key, lambda: _fetch(lat, lon, parameters), max_age_days=30)
    return parse(text)
