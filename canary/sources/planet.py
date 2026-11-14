"""Planet-wide indicators: the handful of numbers that say how Earth as a
whole is doing.

- Global temperature: NASA GISTEMP v4 (land and ocean, monthly, from 1880),
  as the difference from the 1951-1980 average.
- Carbon dioxide: NOAA Global Monitoring Laboratory, Mauna Loa monthly means.
- Arctic sea ice: NSIDC Sea Ice Index v4, September extent (the yearly minimum).
- El Niño / La Niña: the Niño 3.4 sea-surface temperature anomaly (NOAA PSL).

All are plain text files at public URLs with no login.
"""

from __future__ import annotations

import csv
import io

import httpx
import numpy as np

from ..stats import trend
from . import indices
from .cache import cached_text

GISTEMP = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
CO2 = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt"
SEA_ICE = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]


def _get(url: str) -> str:
    last = None
    for _ in range(3):
        try:
            response = httpx.get(url, timeout=60.0, follow_redirects=True,
                                 headers={"User-Agent": "canary-earth-monitor"})
            response.raise_for_status()
            return response.text
        except httpx.HTTPError as exc:
            last = exc
    raise last


def parse_gistemp(text: str) -> dict[tuple[int, int], float]:
    """{(year, month): anomaly in deg C}; '***' marks months not yet available."""
    out = {}
    rows = csv.reader(io.StringIO(text))
    for row in rows:
        if not row or not row[0].isdigit():
            continue
        for month, cell in enumerate(row[1:13], start=1):
            try:
                out[(int(row[0]), month)] = float(cell)
            except ValueError:
                pass
    return out


def parse_co2(text: str) -> dict[tuple[int, int], float]:
    out = {}
    for line in text.splitlines():
        parts = line.split()
        if line.startswith("#") or len(parts) < 4:
            continue
        value = float(parts[3])
        if value > 0:
            out[(int(parts[0]), int(parts[1]))] = value
    return out


def parse_sea_ice(text: str) -> dict[int, float]:
    """{year: September extent in million km2}; -9999 marks missing years."""
    out = {}
    for row in csv.reader(io.StringIO(text)):
        try:
            year, extent = int(row[0]), float(row[4])
        except (ValueError, IndexError):
            continue
        if extent > 0:
            out[year] = extent
    return out


def _annual(monthly: dict[tuple[int, int], float], min_months: int = 12) -> tuple[list[int], list[float]]:
    years = sorted({y for y, _ in monthly})
    xs, ys = [], []
    for y in years:
        values = [monthly[(y, m)] for m in range(1, 13) if (y, m) in monthly]
        if len(values) >= min_months:
            xs.append(y)
            ys.append(float(np.mean(values)))
    return xs, ys


def _decade_trend(xs: list[int], ys: list[float], since: int) -> float | None:
    pairs = [(x, y) for x, y in zip(xs, ys) if x >= since]
    if len(pairs) < 10:
        return None
    x, y = (np.array(v, dtype=float) for v in zip(*pairs))
    return float(trend.mann_kendall(y, x).slope * 10)


def enso_state(value: float) -> str:
    strength = abs(value)
    if strength < 0.5:
        return "Neutral"
    name = "El Niño" if value > 0 else "La Niña"
    grade = "Weak" if strength < 1 else "Moderate" if strength < 1.5 else "Strong" if strength < 2 else "Very strong"
    return f"{grade} {name}"


def _temperature() -> dict:
    monthly = parse_gistemp(cached_text("planet", "gistemp.csv", lambda: _get(GISTEMP), max_age_days=1))
    (year, month), value = max(monthly.items())
    xs, ys = _annual(monthly)
    same_month = sorted(((v, y) for (y, m), v in monthly.items() if m == month), reverse=True)
    rank = [y for _, y in same_month].index(year) + 1
    return {
        "id": "temperature",
        "label": "Global temperature",
        "value": round(value, 2),
        "unit": "°C",
        "signed": True,
        "when": f"{MONTHS[month - 1]} {year}",
        "note": f"above the 1951–1980 average; {_ranked(rank, 'warmest')} {MONTHS[month - 1]} since {min(y for y, _ in monthly)}",
        "trend_per_decade": _decade_trend(xs, ys, 1981),
        "trend_since": 1981,
        "series": {"x": xs, "y": [round(v, 2) for v in ys]},
        "source": "NASA GISTEMP v4",
    }


def _co2() -> dict:
    monthly = parse_co2(cached_text("planet", "co2.txt", lambda: _get(CO2), max_age_days=1))
    (year, month), value = max(monthly.items())
    xs, ys = _annual(monthly)
    year_ago = monthly.get((year - 1, month))
    note = "parts per million at Mauna Loa"
    if year_ago:
        note += f"; {value - year_ago:+.1f} ppm in a year".replace("-", "−")
    return {
        "id": "co2",
        "label": "Carbon dioxide",
        "value": round(value, 1),
        "unit": "ppm",
        "signed": False,
        "when": f"{MONTHS[month - 1]} {year}",
        "note": note,
        "trend_per_decade": _decade_trend(xs, ys, 1981),
        "trend_since": 1981,
        "series": {"x": xs, "y": [round(v, 1) for v in ys]},
        "source": "NOAA Global Monitoring Laboratory",
    }


def _sea_ice() -> dict:
    yearly = parse_sea_ice(cached_text("planet", "sea_ice_sep.csv", lambda: _get(SEA_ICE), max_age_days=1))
    xs = sorted(yearly)
    ys = [yearly[y] for y in xs]
    year, value = xs[-1], ys[-1]
    rank = sorted(ys).index(value) + 1
    base = float(np.mean([yearly[y] for y in xs if 1981 <= y <= 2010]))
    return {
        "id": "sea_ice",
        "label": "Arctic sea ice",
        "value": round(value, 2),
        "unit": "million km²",
        "signed": False,
        "when": f"September {year}",
        "note": f"yearly minimum; {_ranked(rank, 'lowest')} since {xs[0]}, "
                f"{abs(100 * (value - base) / base):.0f}% {'below' if value < base else 'above'} the 1981–2010 average",
        "trend_per_decade": _decade_trend(xs, ys, 1979),
        "trend_since": 1979,
        "series": {"x": xs, "y": [round(v, 2) for v in ys]},
        "source": "NSIDC Sea Ice Index v4",
    }


def _enso() -> dict:
    table = indices.load("enso")
    (year, month), value = max(table.items())
    recent = sorted(table.items())[-240:]
    return {
        "id": "enso",
        "label": "El Niño / La Niña",
        "value": round(value, 2),
        "unit": "°C",
        "signed": True,
        "when": f"{MONTHS[month - 1]} {year}",
        "state": enso_state(value),
        "note": f"{enso_state(value)}: tropical Pacific surface temperature against normal",
        "trend_per_decade": None,
        "series": {"x": [round(y + (m - 0.5) / 12, 3) for (y, m), _ in recent], "y": [round(v, 2) for _, v in recent]},
        "source": "NOAA PSL Niño 3.4 (HadISST)",
    }


def _ranked(n: int, word: str) -> str:
    """'warmest', '2nd warmest', '13th lowest', ..."""
    if n == 1:
        return word
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix} {word}"


def status() -> dict:
    """All planet indicators. One that fails to load is skipped, not fatal."""
    tiles, errors = [], []
    for build in (_temperature, _co2, _sea_ice, _enso):
        try:
            tiles.append(build())
        except Exception as exc:  # noqa: BLE001 - a missing tile must not break the dashboard
            errors.append(f"{build.__name__.strip('_')}: {exc}")
    return {"tiles": tiles, "errors": errors}
