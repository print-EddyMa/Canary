"""Global trend maps: where on Earth is each vital sign changing?

Takes NASA POWER's global annual grids (see cube.py) for every catalogue variable,
runs the same trend test as the place charts on every grid cell, controls the
false discovery rate across the whole map (Wilks 2016), and writes one
Web-Mercator PNG per vital sign plus a JSON index for the front end.

Run:  python -m canary.globalmap            (about a minute on a laptop)

Differences from the place charts, which use monthly anomalies: the maps use
calendar-year means (45 values per cell). The two agree on direction and
rough size but not to the last digit.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

import numpy as np
from numba import njit, prange
from scipy import stats

from . import palette
from .vitals import VITALS

OUT_DIR = Path(__file__).resolve().parent.parent / "web" / "maps"
MIN_YEARS = 20
FDR = 0.05
IMAGE_SIZE = 1152  # pixels per side of the Web-Mercator image
MERCATOR_MAX_LAT = 85.051129


@njit(cache=True)
def _cell_trend(x, t):
    """Mann-Kendall + Theil-Sen for one series; mirrors stats.trend.mann_kendall.

    Returns (slope, p, signal_to_noise). NaNs must already be removed.
    """
    n = x.size
    npairs = n * (n - 1) // 2
    slopes = np.empty(npairs)
    s = 0.0
    k = 0
    for i in range(n - 1):
        for j in range(i + 1, n):
            d = x[j] - x[i]
            if d > 0:
                s += 1.0
            elif d < 0:
                s -= 1.0
            slopes[k] = d / (t[j] - t[i])
            k += 1
    slope = np.median(slopes)

    # Variance of S with tie correction.
    xs = np.sort(x)
    tie_term = 0.0
    run = 1
    for i in range(1, n):
        if xs[i] == xs[i - 1]:
            run += 1
        else:
            if run > 1:
                tie_term += run * (run - 1) * (2 * run + 5)
            run = 1
    if run > 1:
        tie_term += run * (run - 1) * (2 * run + 5)
    var_s = (n * (n - 1) * (2 * n + 5) - tie_term) / 18.0
    if var_s <= 0:
        return slope, 1.0, np.nan

    detrended = x - slope * t

    # Hamed-Rao: autocorrelation of the ranks of the detrended series.
    order = np.argsort(detrended)
    ranks = np.empty(n)
    for i in range(n):
        ranks[order[i]] = i + 1.0
    rm = ranks - ranks.mean()
    c0 = (rm * rm).sum()
    bound = 1.959963984540054 / math.sqrt(n)
    acc = 0.0
    for lag in range(1, n):
        r = (rm[: n - lag] * rm[lag:]).sum() / c0
        if abs(r) > bound:
            acc += (n - lag) * (n - lag - 1.0) * (n - lag - 2.0) * r
    infl_hr = 1.0 + 2.0 / (n * (n - 1.0) * (n - 2.0)) * acc

    # AR(1) effective-sample-size correction.
    dm = detrended - detrended.mean()
    d0 = (dm * dm).sum()
    r1 = (dm[:-1] * dm[1:]).sum() / d0 if d0 > 0 else 0.0
    rho = (r1 * n + 1.0) / (n - 4.0)
    rho = min(max(rho, 0.0), 0.99)
    infl_ar = 1.0
    if rho > 0:
        acc = 0.0
        pw = 1.0
        for lag in range(1, n):
            pw *= rho
            acc += (1.0 - lag / n) * pw
        infl_ar = 1.0 + 2.0 * acc

    inflation = max(infl_hr, infl_ar, 1.0)
    if s == 0:
        z = 0.0
    else:
        z = (s - np.sign(s)) / math.sqrt(var_s * inflation)
    p = math.erfc(abs(z) / math.sqrt(2.0))

    # Signal to noise: total change over year-to-year scatter about a line.
    tm = t - t.mean()
    b = (tm * (x - x.mean())).sum() / (tm * tm).sum()
    resid = x - x.mean() - b * tm
    noise = math.sqrt((resid * resid).sum() / (n - 2))
    snr = abs(slope) * (t[n - 1] - t[0] + 1.0) / noise if noise > 0 else np.nan
    return slope, p, snr


@njit(parallel=True, cache=True)
def trend_grid(data, years, min_years):
    """Per-cell trend. data: (cells, years) with NaN gaps. Returns slope per
    year, p and signal-to-noise, NaN where the record is too short."""
    cells = data.shape[0]
    slope = np.full(cells, np.nan)
    p = np.full(cells, np.nan)
    snr = np.full(cells, np.nan)
    for c in prange(cells):
        row = data[c]
        ok = np.isfinite(row)
        n = ok.sum()
        if n < min_years:
            continue
        x = row[ok]
        if x.max() == x.min():
            continue
        slope[c], p[c], snr[c] = _cell_trend(x, years[ok])
    return slope, p, snr


def fdr_grid(p: np.ndarray) -> np.ndarray:
    out = np.full(p.shape, np.nan)
    ok = np.isfinite(p)
    if ok.any():
        out[ok] = stats.false_discovery_control(p[ok], method="bh")
    return out


# ---------- rendering ----------

def _ramp(stops: list[str], t: np.ndarray) -> np.ndarray:
    """Interpolate hex colour stops at positions t in [0, 1]. Returns (..., 3) uint8."""
    rgb = np.array([[int(h[i: i + 2], 16) for i in (1, 3, 5)] for h in stops], dtype=float)
    pos = np.clip(np.nan_to_num(t), 0, 1) * (len(stops) - 1)
    lo = np.clip(np.floor(pos).astype(int), 0, len(stops) - 2)
    frac = (pos - lo)[..., None]
    return (rgb[lo] * (1 - frac) + rgb[lo + 1] * frac).round().astype(np.uint8)


# Diverging: the variable's colour family (canary/palette.py) around a neutral grey
# midpoint. On the dark globe the strongest values are the brightest.
ALARM_RAMP = palette.EMBER


def diverging_rgba(values, vmax, significant, stops):
    """stops: the family's steps ordered from the strongest fall to the strongest rise."""
    values = np.where(np.isfinite(values), values, np.nan)
    with np.errstate(invalid="ignore"):
        t = (np.clip(values / vmax, -1, 1) + 1) / 2
    rgb = _ramp(stops, t)
    alpha = np.where(significant, 235, 70).astype(np.uint8)
    alpha[~np.isfinite(values)] = 0
    return np.dstack([rgb, alpha])


def to_mercator(grid: np.ndarray, lats: np.ndarray, lons: np.ndarray, size: int = IMAGE_SIZE) -> np.ndarray:
    """Resample a lat/lon grid (nearest neighbour) onto a square Web-Mercator image."""
    ymax = math.log(math.tan(math.pi / 4 + math.radians(MERCATOR_MAX_LAT) / 2))
    y = np.linspace(ymax, -ymax, size, endpoint=False) - ymax / size  # row centres
    row_lat = np.degrees(2 * np.arctan(np.exp(y)) - math.pi / 2)
    col_lon = -180 + (np.arange(size) + 0.5) * 360 / size
    dlat, dlon = lats[1] - lats[0], lons[1] - lons[0]
    ri = np.clip(np.round((row_lat - lats[0]) / dlat).astype(int), 0, lats.size - 1)
    ci = np.round((col_lon - lons[0]) / dlon).astype(int) % lons.size
    return grid[np.ix_(ri, ci)]


def _area_weights(lats, shape):
    return np.broadcast_to(np.cos(np.radians(lats))[:, None], shape)


def _nice(x: float) -> float:
    """Round up to 1, 2 or 5 times a power of ten."""
    if x <= 0 or not math.isfinite(x):
        return 1.0
    mag = 10 ** math.floor(math.log10(x))
    for m in (1, 2, 5, 10):
        if x <= m * mag * 1.0000001:
            return m * mag
    return 10 * mag


def build(out_dir: Path = OUT_DIR) -> dict:
    from PIL import Image

    from . import cube
    from .catalogue import VARIABLES

    out_dir.mkdir(parents=True, exist_ok=True)
    vital_ids = {v.id for v in VITALS}
    base = cube.load("temperature")
    base_lats, base_lons = base.lats, base.lons

    layers = []
    emerged_count = np.zeros((base_lats.size, base_lons.size), dtype=np.int16)
    tested_count = np.zeros_like(emerged_count)

    for variable in VARIABLES:
        t0 = time.time()
        c = cube.load(variable.id)
        years = c.years.astype(np.float64)
        lats, lons = c.lats, c.lons
        shape = c.data.shape[1:]
        flat = np.ascontiguousarray(np.asarray(c.data, dtype=np.float64).reshape(years.size, -1).T)
        slope, p, snr = trend_grid(flat, years, MIN_YEARS)
        p_fdr = fdr_grid(p)
        slope, p_fdr, snr = (a.reshape(shape) for a in (slope, p_fdr, snr))
        per_decade = slope * 10
        significant = p_fdr < FDR
        valid = np.isfinite(per_decade)

        w = _area_weights(lats, shape)
        area = float(w[valid].sum())
        vmax = _nice(float(np.nanpercentile(np.abs(per_decade[valid]), 98)))
        stops = palette.rising_stops(variable.id, variable.theme)
        rgba = to_mercator(diverging_rgba(per_decade, vmax, significant, stops), lats, lons)
        Image.fromarray(rgba, "RGBA").save(out_dir / f"trend_{variable.id}.png", optimize=True)

        # The alarm map counts the ten vital signs only.
        if variable.id in vital_ids:
            emerged = significant & (snr >= 1)
            if shape != emerged_count.shape:
                ri = np.clip(np.round((base_lats - lats[0]) / (lats[1] - lats[0])).astype(int), 0, lats.size - 1)
                ci = np.round((base_lons - lons[0]) / (lons[1] - lons[0])).astype(int) % lons.size
                emerged, valid_b = emerged[np.ix_(ri, ci)], valid[np.ix_(ri, ci)]
            else:
                valid_b = valid
            emerged_count += emerged
            tested_count += valid_b

        layers.append({
            "id": variable.id,
            "label": variable.label,
            "unit": variable.unit,
            "theme": variable.theme,
            "vital": variable.id in vital_ids,
            "definition": variable.definition,
            "source": variable.source,
            "image": f"maps/trend_{variable.id}.png",
            "period": [int(years[0]), int(years[-1])],
            "scale_max": vmax,
            "family": variable.family,
            "up": variable.up,
            "stops": stops,
            "percent_significant": round(100 * float(w[valid & significant].sum()) / area, 1),
            "percent_rising": round(100 * float(w[valid & significant & (per_decade > 0)].sum()) / area, 1),
            "percent_falling": round(100 * float(w[valid & significant & (per_decade < 0)].sum()) / area, 1),
            "percent_emerged": round(100 * float(w[valid & significant & (snr >= 1)].sum()) / area, 1),
            "mean_trend_per_decade": float(np.nansum(np.where(valid, per_decade, 0.0) * w) / area),
            "cells_tested": int(valid.sum()),
        })
        print(f"{variable.id:20s} {years[0]:.0f}-{years[-1]:.0f} cells={valid.sum():6d} "
              f"sig={layers[-1]['percent_significant']:5.1f}% scale=±{vmax:g} ({time.time() - t0:.1f}s)", flush=True)

    # Alarm map: how many vital signs have left their normal range in each cell.
    top = 6
    t = np.clip((emerged_count - 1) / (top - 1), 0, 1)
    rgb = _ramp(ALARM_RAMP, t)
    alpha = np.where(emerged_count > 0, 225, 0).astype(np.uint8)
    alpha[tested_count == 0] = 0
    Image.fromarray(to_mercator(np.dstack([rgb, alpha]), base_lats, base_lons), "RGBA").save(
        out_dir / "alarm.png", optimize=True)
    w = _area_weights(base_lats, emerged_count.shape)
    index = {
        "generated": time.strftime("%Y-%m-%d"),
        "false_discovery_rate": FDR,
        "bounds": [-180, -MERCATOR_MAX_LAT, 180, MERCATOR_MAX_LAT],
        "colors": {"alarm": ALARM_RAMP},
        "families": palette.FAMILIES,
        "method": "Calendar-year means per grid cell; Theil-Sen slope; Mann-Kendall test with "
                  "autocorrelation correction; Benjamini-Hochberg false-discovery control across "
                  "all cells of each map. Faint cells have a trend that could be chance.",
        "alarm": {
            "image": "maps/alarm.png",
            "scale_max": top,
            "percent_any": round(100 * float(w[emerged_count >= 1].sum() / w.sum()), 1),
            "percent_three_plus": round(100 * float(w[emerged_count >= 3].sum() / w.sum()), 1),
        },
        "layers": layers,
    }
    (out_dir / "index.json").write_text(json.dumps(index, indent=1))
    return index


if __name__ == "__main__":
    build()
