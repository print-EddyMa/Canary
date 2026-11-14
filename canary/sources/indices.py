"""Monthly climate-mode indices from NOAA: the planet-wide rhythms that make
distant places change together (or in opposite directions).

All files are plain text at stable public URLs and need no login.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
import numpy as np

from .cache import cached_text


@dataclass(frozen=True)
class ClimateMode:
    id: str
    name: str
    description: str
    url: str
    layout: str  # "wide" = year + 12 monthly columns, "long" = year month value


MODES: tuple[ClimateMode, ...] = (
    ClimateMode(
        "enso", "El Niño / La Niña",
        "Warming and cooling of the tropical Pacific (Niño 3.4 sea surface "
        "temperature anomaly) that reshuffles rainfall worldwide.",
        "https://psl.noaa.gov/data/timeseries/month/data/nino34.long.anom.data",
        "wide",
    ),
    ClimateMode(
        "pdo", "Pacific Decadal Oscillation",
        "A slow, decades-long swing in North Pacific ocean temperatures.",
        "https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.pdo.dat",
        "wide",
    ),
    ClimateMode(
        "iod", "Indian Ocean Dipole",
        "The temperature difference between the western and eastern Indian "
        "Ocean, a strong control on East African and Australian rain.",
        "https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data",
        "wide",
    ),
    ClimateMode(
        "nao", "North Atlantic Oscillation",
        "The pressure see-saw between Iceland and the Azores that steers "
        "storms into Europe and eastern North America.",
        "https://psl.noaa.gov/data/correlation/nao.data",
        "wide",
    ),
    ClimateMode(
        "amo", "Atlantic Multidecadal Variability",
        "Slow warming and cooling of the North Atlantic over decades.",
        "https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.amo.dat",
        "long",
    ),
)

BY_ID = {m.id: m for m in MODES}


def _is_missing(value: float) -> bool:
    # The files mark gaps with -99.99, 99.99, -99.9 or -9999; real index
    # values never leave single digits.
    return abs(value) > 90


def parse(text: str, layout: str) -> dict[tuple[int, int], float]:
    """Parse an index file into {(year, month): value}, skipping headers,
    footers and missing-value markers."""
    out: dict[tuple[int, int], float] = {}
    for line in text.splitlines():
        parts = line.split()
        try:
            numbers = [float(p) for p in parts]
        except ValueError:
            continue
        if not numbers or not 1800 <= numbers[0] <= 2100 or numbers[0] != int(numbers[0]):
            continue
        year = int(numbers[0])
        if layout == "wide" and len(numbers) == 13:
            for month, value in enumerate(numbers[1:], start=1):
                if not _is_missing(value):
                    out[(year, month)] = value
        elif layout == "long" and len(numbers) == 3 and 1 <= numbers[1] <= 12:
            if not _is_missing(numbers[2]):
                out[(year, int(numbers[1]))] = numbers[2]
    return out


def _fetch(url: str) -> str:
    response = httpx.get(url, timeout=60.0, follow_redirects=True,
                         headers={"User-Agent": "canary-earth-monitor"})
    response.raise_for_status()
    return response.text


def load(mode_id: str) -> dict[tuple[int, int], float]:
    mode = BY_ID[mode_id]
    text = cached_text("indices", f"{mode.id}.txt", lambda: _fetch(mode.url), max_age_days=7)
    return parse(text, mode.layout)


def aligned(mode_id: str, years: np.ndarray, months: np.ndarray) -> np.ndarray:
    """Index values on the given monthly time axis, NaN where unavailable."""
    table = load(mode_id)
    return np.array([table.get((int(y), int(m)), np.nan) for y, m in zip(years, months)])
