"""Live weather from NASA GEOS-FP, the Goddard Earth Observing System
forward-processing analysis: the same model family that produces MERRA-2,
run in near real time. Served by NASA's NCCS over OPeNDAP with no login.

One product is used: a coarse global grid of the latest wind, temperature and
pressure. It drives the animated wind layer and the "now" readout for a place.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

from .cache import cached_text

BASE = "https://opendap.nccs.nasa.gov/dods/GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx"
NLAT, NLON = 721, 1152  # 0.25 x 0.3125 degree grid, lat -90..90, lon -180..179.6875
STEP_HOURS = 3
GRID_STRIDE = 6  # 1.5 x 1.875 degrees: plenty for a global wind animation
HEADERS = {"User-Agent": "canary-earth-monitor"}


def _get(url: str) -> str:
    response = httpx.get(url, timeout=120.0, headers=HEADERS)
    response.raise_for_status()
    return response.text


def _time_axis() -> tuple[int, datetime]:
    """(number of time steps, time of step 0)."""
    das = cached_text("geos", "das.txt", lambda: _get(BASE + ".das"), max_age_days=1 / 24)
    block = das[das.index("    time {"):]
    size = int(re.search(r'grads_size "(\d+)"', block).group(1))
    start = datetime.strptime(re.search(r'minimum "([^"]+)"', block).group(1), "%Hz%d%b%Y")
    return size, start.replace(tzinfo=timezone.utc)


def parse_ascii(text: str) -> dict[str, np.ndarray]:
    """Parse an OPeNDAP .ascii response into {variable: array}."""
    out: dict[str, np.ndarray] = {}
    name, shape, values = None, None, []

    def flush():
        if name is not None:
            out[name] = np.array(values, dtype=float).reshape(shape)

    for line in text.splitlines():
        header = re.match(r"^([A-Za-z0-9_]+), ((?:\[\d+\])+)$", line)
        if header:
            flush()
            name = header.group(1)
            shape = tuple(int(n) for n in re.findall(r"\[(\d+)\]", header.group(2)))
            values = []
        elif name is not None and line.strip():
            body = line.split(", ", 1)[1] if line.startswith("[") else line
            values.extend(float(v) for v in body.split(","))
    flush()
    return out


def _clean(a: np.ndarray, digits: int) -> list:
    a = np.where(np.abs(a) > 1e14, np.nan, a)  # GEOS fill value is 1e15
    return [None if not np.isfinite(v) else round(float(v), digits) for v in a.ravel()]


def _fetch_grid() -> str:
    size, start = _time_axis()
    last = size - 1
    sel = f"[{last}][0:{GRID_STRIDE}:{NLAT - 1}][0:{GRID_STRIDE}:{NLON - 1}]"
    data = parse_ascii(_get(f"{BASE}.ascii?" + ",".join(f"{v}{sel}" for v in ("u10m", "v10m", "t2m", "slp"))))
    u, v = data["u10m"][0], data["v10m"][0]
    return json.dumps({
        "time": (start + timedelta(hours=STEP_HOURS * last)).isoformat().replace("+00:00", "Z"),
        "source": "NASA GEOS-FP analysis (GMAO), 10 m wind, 2 m temperature, sea-level pressure",
        "nlat": u.shape[0],
        "nlon": u.shape[1],
        "lat0": -90.0,
        "dlat": 0.25 * GRID_STRIDE,
        "lon0": -180.0,
        "dlon": 0.3125 * GRID_STRIDE,
        "u": _clean(u, 1),
        "v": _clean(v, 1),
        "t": _clean(data["t2m"][0] - 273.15, 1),
        "p": _clean(data["slp"][0] / 100.0, 0),
    })


def wind_grid() -> dict:
    """Latest global wind, temperature (deg C) and pressure (hPa) on a coarse grid."""
    return json.loads(cached_text("geos", "grid.json", _fetch_grid, max_age_days=1.5 / 24))


def sample(lat: float, lon: float) -> dict:
    """Current conditions at a point, interpolated from the coarse global grid.

    (A full 0.25-degree time series for one point takes NASA's server about a
    second per time step, too slow for an interactive panel.)
    """
    g = wind_grid()
    nlat, nlon = g["nlat"], g["nlon"]
    fy = float(np.clip((lat - g["lat0"]) / g["dlat"], 0, nlat - 1))
    fx = ((lon - g["lon0"]) / g["dlon"]) % nlon
    y0, x0 = min(int(fy), nlat - 2), int(fx)
    wy, wx = fy - y0, fx - x0
    x1 = (x0 + 1) % nlon

    def at(name: str) -> float | None:
        field = g[name]
        corners = [field[y0 * nlon + x0], field[y0 * nlon + x1],
                   field[(y0 + 1) * nlon + x0], field[(y0 + 1) * nlon + x1]]
        if any(c is None for c in corners):
            return None
        top = corners[0] * (1 - wx) + corners[1] * wx
        bottom = corners[2] * (1 - wx) + corners[3] * wx
        return top * (1 - wy) + bottom * wy

    u, v = at("u"), at("v")
    out = {"time": g["time"], "source": g["source"], "grid_km": 170,
           "temperature_c": None, "pressure_hpa": None, "wind_ms": None, "wind_from_deg": None}
    if at("t") is not None:
        out["temperature_c"] = round(at("t"), 1)
    if at("p") is not None:
        out["pressure_hpa"] = round(at("p"))
    if u is not None and v is not None:
        out["wind_ms"] = round(float(np.hypot(u, v)), 1)
        # Meteorological convention: the direction the wind blows FROM.
        out["wind_from_deg"] = round((float(np.degrees(np.arctan2(-u, -v))) + 360) % 360)
    return out
