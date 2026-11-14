"""The detective's core question: for this variable, in this region, over
these years, what is changing, how much, and is it significant?

One call returns everything the start page shows:
- the yearly series for the region (an area-weighted average of its cells);
- the rate of change (Theil-Sen slope) with a 95% range;
- two significance tests: Mann-Kendall corrected for memory in the data, and
  a least-squares t-test with the same correction as a second opinion;
- how big the change is against ordinary year-to-year swings;
- when a trend is not significant, roughly how many more years of data it
  would take to tell at this rate and this much noise;
- how the region's cells split between rising and falling, because a regional
  average can hide opposite trends inside it;
- which planet-wide climate rhythms the yearly swings follow.
"""

from __future__ import annotations

import json
import math

import numpy as np
from scipy import stats

from . import cube, globalmap, regions
from .catalogue import BY_ID, VARIABLES, Variable
from .sources import indices
from .stats import trend

ALPHA = 0.05
MIN_YEARS = 15
BASELINE = (1991, 2020)
MAX_CELLS_FOR_SPLIT = 70_000  # above this, use the precomputed world statistics


def _clean(value):
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _chance(p: float) -> str:
    """A p-value in words a student can repeat correctly."""
    if p < 0.001:
        odds = "less than 1 time in 1,000"
    elif p < 0.01:
        odds = "less than 1 time in 100"
    elif p < 0.05:
        odds = "less than 1 time in 20"
    else:
        odds = f"about 1 time in {max(round(1 / p), 1)}" if p < 0.5 else "more often than not"
    return f"If nothing were really changing, a pattern this strong would turn up by chance {odds}."


def _years_needed(n: int, t_now: float, t_needed: float) -> int | None:
    """Extra years of record needed for the trend to reach significance if the
    rate and the noise stay as they are. The t statistic of a linear trend
    grows as the 1.5 power of the record length."""
    if t_now <= 0:
        return None
    needed = n * (t_needed / t_now) ** (2.0 / 3.0)
    extra = math.ceil(needed - n)
    return extra if 0 < extra <= 150 else None


def _annual_index(mode_id: str, years: np.ndarray) -> np.ndarray:
    table = indices.load(mode_id)
    out = np.full(years.size, np.nan)
    for i, y in enumerate(years):
        values = [table[(int(y), m)] for m in range(1, 13) if (int(y), m) in table]
        if len(values) >= 10:
            out[i] = float(np.mean(values))
    return out


def _detrend(x: np.ndarray, t: np.ndarray) -> np.ndarray:
    ok = np.isfinite(x)
    out = np.full(x.shape, np.nan)
    if ok.sum() >= 3:
        out[ok] = x[ok] - np.polyval(np.polyfit(t[ok], x[ok], 1), t[ok])
    return out


def climate_links(series: np.ndarray, years: np.ndarray) -> list[dict]:
    """Planet-wide rhythms whose yearly value the region's yearly swings follow.
    Trends are removed from both first; Benjamini-Hochberg across the rhythms tested."""
    resid = _detrend(series, years.astype(float))
    tested = []
    for mode in indices.MODES:
        try:
            index = _detrend(_annual_index(mode.id, years), years.astype(float))
        except Exception:  # noqa: BLE001 - an index server being down is not fatal
            continue
        ok = np.isfinite(resid) & np.isfinite(index)
        if ok.sum() < 15 or resid[ok].std() == 0 or index[ok].std() == 0:
            continue
        r, p = stats.pearsonr(resid[ok], index[ok])
        tested.append((mode, float(r), float(p)))
    if not tested:
        return []
    adjusted = trend.fdr_adjust([p for _, _, p in tested])
    links = [{"id": mode.id, "name": mode.name, "description": mode.description, "r": round(r, 2),
              "share_of_swings_percent": round(100 * r * r), "p": _clean(p_adj)}
             for (mode, r, _), p_adj in zip(tested, adjusted) if p_adj < ALPHA]
    return sorted(links, key=lambda link: -abs(link["r"]))


def _split(variable: Variable, c: cube.Cube, region_mask: np.ndarray, years_ok: np.ndarray) -> dict | None:
    """Share of the region's area with a significant rise or fall, cell by cell."""
    rows, cols = np.nonzero(region_mask)
    if rows.size == 0 or rows.size > MAX_CELLS_FOR_SPLIT:
        return None
    cells = np.ascontiguousarray(np.asarray(c.data[years_ok][:, rows, cols], dtype=np.float64).T)
    slope, p, _ = globalmap.trend_grid(cells, c.years[years_ok].astype(np.float64), MIN_YEARS)
    p_fdr = globalmap.fdr_grid(p)
    w = np.cos(np.radians(c.lats[rows]))
    valid = np.isfinite(slope)
    area = float(w[valid].sum())
    if area == 0:
        return None
    sig = valid & (p_fdr < ALPHA)
    share = lambda m: round(100 * float(w[m].sum()) / area, 1)  # noqa: E731
    return {"rising_percent": share(sig & (slope > 0)), "falling_percent": share(sig & (slope < 0)),
            "unclear_percent": share(valid & ~sig), "cells": int(valid.sum())}


def _world_split(variable_id: str, info: dict, period: list[int]) -> dict | None:
    """For the whole world over the whole record, the precomputed map statistics."""
    if info["kind"] != "world":
        return None
    try:
        layer = next(l for l in json.loads(globalmap.OUT_DIR.joinpath("index.json").read_text())["layers"]
                     if l["id"] == variable_id)
    except (OSError, ValueError, StopIteration):
        return None
    if layer["period"] != period:
        return None
    return {"rising_percent": layer["percent_rising"], "falling_percent": layer["percent_falling"],
            "unclear_percent": round(100 - layer["percent_significant"], 1), "cells": layer["cells_tested"]}


def series_for(variable_id: str, region: str) -> tuple[np.ndarray, np.ndarray, int, cube.Cube, np.ndarray]:
    c = cube.load(variable_id)
    m = regions.mask(region, c.lats, c.lons)
    series, cells = regions.area_mean(c.data, m, c.lats)
    return c.years, series, cells, c, m


def analyse(variable_id: str, region: str, start: int | None = None, end: int | None = None,
            with_split: bool = True, with_links: bool = True) -> dict:
    """Everything about one variable in one region over one period."""
    if variable_id not in BY_ID:
        raise ValueError(f"unknown variable: {variable_id}")
    variable = BY_ID[variable_id]
    info = regions.parse(region)
    years, series, cells, c, m = series_for(variable_id, info["id"])
    if cells == 0:
        raise ValueError(f"{variable.label} has no data in {info['name']} "
                         f"(for example, a land-only variable over open ocean, or snow where there is none).")

    first, last = int(years[0]), int(years[-1])
    start = max(start or first, first)
    end = min(end or last, last)
    window = (years >= start) & (years <= end)
    ok = window & np.isfinite(series)
    if ok.sum() < MIN_YEARS:
        raise ValueError(f"At least {MIN_YEARS} years are needed to test a trend; this selection has {int(ok.sum())}.")
    y, t = series[ok], years[ok].astype(float)
    span = float(t[-1] - t[0] + 1)

    mk = trend.mann_kendall(y, t)
    lin = trend.linear_trend(y, t)
    total = mk.slope * span
    base = series[(years >= BASELINE[0]) & (years <= BASELINE[1]) & np.isfinite(series)]
    normal = float(base.mean()) if base.size >= 10 else float(np.nanmean(series))
    snr = trend.signal_to_noise(total, y, t)
    significant = mk.p < ALPHA
    direction = "rising" if mk.slope > 0 else "falling" if mk.slope < 0 else "flat"

    # Least-squares t statistic, for the "how many more years" estimate.
    t_crit = float(stats.t.ppf(1 - ALPHA / 2, max(lin.n_effective - 2, 1)))
    half = (lin.slope_high - lin.slope_low) / 2
    t_now = abs(lin.slope) / (half / t_crit) if half > 0 else float("inf")
    more_years = None if significant else _years_needed(int(ok.sum()), t_now, t_crit)

    unit = variable.unit
    rate = f"{abs(mk.slope * 10):.{_digits(mk.slope * 10)}f} {unit} per decade"
    if significant:
        headline = f"{'Rising' if direction == 'rising' else 'Falling'} by {rate}"
        verdict = "significant"
        size = ("far outside" if snr >= 2 else "outside" if snr >= 1 else "still within") if snr == snr else "within"
        detail = (f"Significant. {_chance(mk.p)} The total change since {int(t[0])} is "
                  f"{'larger than' if snr >= 1 else 'smaller than'} the usual year-to-year swing"
                  f"{f' ({snr:.1f} times it)' if snr == snr else ''}, so the region is {size} its normal range.")
    else:
        headline = f"No significant trend ({'up' if direction == 'rising' else 'down'} {rate}, but it could be chance)"
        verdict = "not_significant"
        detail = f"Not significant. {_chance(mk.p)}"
        if more_years:
            detail += (f" A trend can be real and still too small to see through the noise: at this rate, about "
                       f"{more_years} more year{'s' if more_years != 1 else ''} of data would settle it.")
        else:
            detail += " There is no sign of a consistent direction."

    result = {
        "variable": {"id": variable.id, "label": variable.label, "unit": unit, "definition": variable.definition,
                     "theme": variable.theme, "source": variable.source, "parameter": variable.parameter,
                     "decimals": variable.decimals, "caution": variable.caution,
                     "red_when_rising": variable.red_when_rising, "record": [first, last]},
        "region": {**info, "cells": cells},
        "period": [int(t[0]), int(t[-1])],
        "years": [int(v) for v in years[window]],
        "values": [None if not np.isfinite(v) else round(float(v), variable.decimals + 2) for v in series[window]],
        "normal": _clean(normal),
        "trend": {
            "direction": direction,
            "per_decade": _clean(mk.slope * 10),
            "range_per_decade": [_clean(mk.slope_low * 10), _clean(mk.slope_high * 10)],
            "total_change": _clean(total),
            "percent_change": _clean(100 * total / normal) if normal and unit not in ("°C", "%", "hPa") else None,
            "line": [_clean(mk.intercept + mk.slope * t[0]), _clean(mk.intercept + mk.slope * t[-1])],
            "signal_to_noise": _clean(snr),
        },
        "tests": {
            "mann_kendall": {"tau": _clean(mk.tau), "p": _clean(mk.p), "p_uncorrected": _clean(mk.p_uncorrected),
                             "variance_inflation": _clean(mk.variance_inflation)},
            "t_test": {"per_decade": _clean(lin.slope * 10),
                       "range_per_decade": [_clean(lin.slope_low * 10), _clean(lin.slope_high * 10)],
                       "p": _clean(lin.p), "effective_years": _clean(lin.n_effective)},
            "agree": bool((lin.p < ALPHA) == significant),
            "years": int(ok.sum()),
        },
        "verdict": verdict,
        "significant": bool(significant),
        "headline": headline,
        "detail": detail,
        "more_years_needed": more_years,
        "split": None,
        "links": [],
    }
    if with_split:
        result["split"] = _split(variable, c, m, window) or _world_split(variable.id, info, result["period"])
    if with_links:
        result["links"] = climate_links(np.where(window, series, np.nan)[window], years[window])
    return result


def _digits(x: float) -> int:
    """Decimals that show two significant digits."""
    a = abs(x)
    return 0 if a == 0 else int(max(0, min(4, 1 - math.floor(math.log10(a)))))


def scan(region: str, start: int | None = None, end: int | None = None) -> dict:
    """Test every variable in a region and rank them: which are trending here?

    Testing many variables at once invites flukes, so significance here is
    judged after Benjamini-Hochberg false-discovery control across them.
    """
    info = regions.parse(region)
    rows, waiting = [], []
    for variable in VARIABLES:
        if not cube.ready(variable.id):
            waiting.append(variable.label)
            continue
        try:
            a = analyse(variable.id, info["id"], start, end, with_split=False, with_links=False)
        except ValueError:
            continue  # no data for this variable here
        rows.append({
            "id": variable.id, "label": variable.label, "unit": variable.unit, "theme": variable.theme,
            "direction": a["trend"]["direction"], "per_decade": a["trend"]["per_decade"],
            "signal_to_noise": a["trend"]["signal_to_noise"], "p": a["tests"]["mann_kendall"]["p"],
            "period": a["period"],
        })
    adjusted = trend.fdr_adjust([r["p"] for r in rows]) if rows else []
    for row, p_fdr in zip(rows, adjusted):
        row["p_adjusted"] = _clean(p_fdr)
        row["significant"] = bool(p_fdr < ALPHA)
    rows.sort(key=lambda r: (not r["significant"], -(r["signal_to_noise"] or 0)))
    return {"region": info, "variables": rows, "still_loading": waiting,
            "significant": sum(r["significant"] for r in rows), "tested": len(rows)}


def suggest(interest: str | None, place_kind: str | None) -> list[dict]:
    """The three-question guide: variables worth a first look, with the reason."""
    from .catalogue import INTERESTS, PLACE_KINDS
    picks: list[tuple[str, str]] = []
    if place_kind in PLACE_KINDS:
        _, ids, why = PLACE_KINDS[place_kind]
        picks += [(i, why) for i in ids]
    if interest in INTERESTS:
        question, ids = INTERESTS[interest]
        picks = [(i, f"A direct answer to “{question}”") for i in ids] + picks
    seen, out = set(), []
    for variable_id, why in picks:
        if variable_id in seen or variable_id not in BY_ID:
            continue
        seen.add(variable_id)
        v = BY_ID[variable_id]
        out.append({"id": v.id, "label": v.label, "definition": v.definition, "why": why})
    return out[:5]
