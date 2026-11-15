"""The last 24 hours of global weather from NASA GEOS-FP, hour by hour.

GEOS-FP is NASA GMAO's near-real-time analysis (the model family behind MERRA-2). Its hourly
averaged collections are read over OPeNDAP in binary form, no login:

    tavg1_2d_rad_Nx  cldtot           total cloud fraction
    tavg1_2d_flx_Nx  prectot          total precipitation (rain and snow)
    tavg1_2d_slv_Nx  t2m, u10m, v10m  2 m air temperature, 10 m wind

Each field is kept on a 1 x 1.25 degree grid (every fourth point of the 0.25 x 0.3125 degree
model grid), quantised to one byte per value so that a day of global weather is a few megabytes,
and refreshed in the background every hour. Fetching a fresh day takes NASA's server one to
three minutes; until then the last cached day is served.
"""

from __future__ import annotations

import math
import re
import struct
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

from .cache import CACHE_DIR

ROOT = "https://opendap.nccs.nasa.gov/dods/GEOS-5/fp/0.25_deg/assim"
NLAT, NLON = 721, 1152
STRIDE = 4  # 1 x 1.25 degrees
HOURS = 25  # the last 24 hours, both ends included
HEADERS = {"User-Agent": "canary-earth-monitor"}
REFRESH_SECONDS = 3600
FILE = CACHE_DIR / "weather" / "day.npz"

# How each field is stored in one byte, and how a value is read back:
#   linear  value = lo + q / 255 * (hi - lo)
#   log     value = expm1(q / 255 * log1p(hi))
#   wind    value = (q - 128) / 2   (m/s)
FIELDS = {
    "cloud": {"label": "Cloud cover", "unit": "%", "encoding": "linear", "lo": 0.0, "hi": 100.0},
    "precip": {"label": "Precipitation", "unit": "mm/h", "encoding": "log", "lo": 0.0, "hi": 40.0},
    "temp": {"label": "Air temperature, 2 m", "unit": "°C", "encoding": "linear", "lo": -60.0, "hi": 50.0},
    "u": {"label": "Wind, eastward", "unit": "m/s", "encoding": "wind"},
    "v": {"label": "Wind, northward", "unit": "m/s", "encoding": "wind"},
}
REQUESTS = [("tavg1_2d_rad_Nx", ["cldtot"]), ("tavg1_2d_flx_Nx", ["prectot"]), ("tavg1_2d_slv_Nx", ["t2m", "u10m", "v10m"])]

_lock = threading.Lock()
_state = {"status": "idle", "started": None, "error": None}


def _time_axis(collection: str) -> tuple[int, datetime]:
    das = httpx.get(f"{ROOT}/{collection}.das", timeout=60, headers=HEADERS).raise_for_status().text
    block = das[das.index("    time {"):]
    size = int(re.search(r'grads_size "(\d+)"', block).group(1))
    start = datetime.strptime(re.search(r'minimum "([^"]+)"', block).group(1), "%H:%Mz%d%b%Y")
    return size, start.replace(tzinfo=timezone.utc)


def parse_dods(raw: bytes, names: list[str], shape: tuple[int, int, int]) -> dict[str, np.ndarray]:
    """Read the XDR body of an OPeNDAP .dods response holding Grids of one shape."""
    at = raw.index(b"\nData:\n") + len(b"\nData:\n")
    out = {}
    count = shape[0] * shape[1] * shape[2]
    for name in names:
        n = struct.unpack(">I", raw[at:at + 4])[0]
        if n != count:
            raise ValueError(f"{name}: expected {count} values, got {n}")
        at += 8  # the count is written twice
        out[name] = np.frombuffer(raw, dtype=">f4", count=count, offset=at).astype(np.float32).reshape(shape)
        at += 4 * count
        for size in shape:  # the map vectors (time, lat, lon) follow each array
            at += 8 + 8 * size
    return out


def _fetch(collection: str, names: list[str], first: int, last: int) -> dict[str, np.ndarray]:
    sel = f"[{first}:1:{last}][0:{STRIDE}:{NLAT - 1}][0:{STRIDE}:{NLON - 1}]"
    url = f"{ROOT}/{collection}.dods?" + ",".join(f"{n}{sel}" for n in names)
    for attempt in range(3):
        try:
            raw = httpx.get(url, timeout=600, headers=HEADERS).raise_for_status().content
            shape = (last - first + 1, (NLAT - 1) // STRIDE + 1, (NLON - 1) // STRIDE + 1)
            return parse_dods(raw, names, shape)
        except (httpx.HTTPError, ValueError):
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("unreachable")


def encode(name: str, values: np.ndarray) -> np.ndarray:
    spec = FIELDS[name]
    v = np.where(np.isfinite(values) & (np.abs(values) < 1e14), values, np.nan)
    if spec["encoding"] == "linear":
        q = (v - spec["lo"]) / (spec["hi"] - spec["lo"]) * 255
    elif spec["encoding"] == "log":
        q = np.log1p(np.clip(v, 0, spec["hi"])) / math.log1p(spec["hi"]) * 255
    else:
        q = v * 2 + 128
    return np.clip(np.nan_to_num(np.round(q), nan=0), 0, 255).astype(np.uint8)


def decode(name: str, q: np.ndarray) -> np.ndarray:
    spec = FIELDS[name]
    q = q.astype(np.float64)
    if spec["encoding"] == "linear":
        return spec["lo"] + q / 255 * (spec["hi"] - spec["lo"])
    if spec["encoding"] == "log":
        return np.expm1(q / 255 * math.log1p(spec["hi"]))
    return (q - 128) / 2


def fetch_day() -> dict:
    """Download the last 24 hours of every field and return them encoded."""
    axes = {c: _time_axis(c) for c, _ in REQUESTS}
    # Use the latest hour that every collection has.
    ends = {c: start + timedelta(hours=size - 1) for c, (size, start) in axes.items()}
    end = min(ends.values())
    jobs = []
    with ThreadPoolExecutor(len(REQUESTS)) as pool:
        for collection, names in REQUESTS:
            size, start = axes[collection]
            last = round((end - start).total_seconds() / 3600)
            jobs.append(pool.submit(_fetch, collection, names, last - HOURS + 1, last))
        data = {}
        for job in jobs:
            data.update(job.result())
    raw = {"cloud": data["cldtot"] * 100, "precip": data["prectot"] * 3600, "temp": data["t2m"] - 273.15,
           "u": data["u10m"], "v": data["v10m"]}
    times = [(end - timedelta(hours=HOURS - 1 - i)) for i in range(HOURS)]
    return {"times": np.array([t.timestamp() for t in times]), **{k: encode(k, v) for k, v in raw.items()}}


def _refresh() -> None:
    try:
        day = fetch_day()
        FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = FILE.with_suffix(".tmp.npz")
        np.savez_compressed(tmp, **day)
        tmp.replace(FILE)
        with _lock:
            _state.update(status="ready", error=None)
    except Exception as exc:  # noqa: BLE001 - keep serving the last good day
        with _lock:
            _state.update(status="failed", error=str(exc)[:300])
    finally:
        with _lock:
            _state["started"] = None


def refresh_in_background() -> None:
    """Start a download unless one is running or the cached day is fresh."""
    with _lock:
        if _state["started"] is not None:
            return
        if FILE.exists() and time.time() - FILE.stat().st_mtime < REFRESH_SECONDS:
            return
        _state.update(started=time.time(), status="loading")
    threading.Thread(target=_refresh, daemon=True, name="geos-weather").start()


_loaded: dict = {"mtime": None, "day": None}


def day() -> dict | None:
    """The cached day as arrays, or None before the first download has finished."""
    if not FILE.exists():
        return None
    mtime = FILE.stat().st_mtime
    if _loaded["mtime"] != mtime:
        with np.load(FILE) as f:
            _loaded["day"] = {k: f[k] for k in f.files}
        _loaded["mtime"] = mtime
    return _loaded["day"]


def meta() -> dict:
    """What the client needs to draw the day, plus the download status."""
    refresh_in_background()
    d = day()
    with _lock:
        state = dict(_state)
    out = {"status": "ready" if d is not None else state["status"], "refreshing": state["started"] is not None,
           "error": state["error"], "source": "NASA GEOS-FP analysis (GMAO), hourly averages",
           "fields": FIELDS}
    if d is not None:
        frames, nlat, nlon = d["cloud"].shape
        out.update({
            "times": [datetime.fromtimestamp(t, timezone.utc).isoformat().replace("+00:00", "Z") for t in d["times"]],
            "frames": frames, "nlat": nlat, "nlon": nlon,
            "lat0": -90.0, "dlat": 0.25 * STRIDE, "lon0": -180.0, "dlon": 0.3125 * STRIDE,
            "age_minutes": round((time.time() - FILE.stat().st_mtime) / 60),
        })
    return out


def field_bytes(name: str) -> bytes:
    d = day()
    if d is None or name not in FIELDS:
        raise KeyError(name)
    return d[name].tobytes()
