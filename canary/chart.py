"""Assemble the full "medical chart" for one place on Earth."""

from __future__ import annotations

import math

import numpy as np

from . import catalogue
from .sources import indices, power
from .stats import ews, forecast, teleconnect, trend
from .vitals import VITALS, Vital

FDR = 0.05  # accepted false discovery rate
MIN_YEARS = 15  # shortest record on which we will report a trend


def _clean(value):
    """JSON-safe number: NaN and infinity become None."""
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _round_list(values, digits: int):
    return [None if not np.isfinite(v) else round(float(v), digits) for v in values]


def _status(significant: bool, snr: float | None) -> str:
    """Plain-language status of one vital sign.

    stable   - no trend distinguishable from chance
    shifting - a real trend, still inside ordinary year-to-year swings
    emerged  - the change is larger than ordinary year-to-year swings
    extreme  - the change is more than twice ordinary year-to-year swings
    """
    if not significant:
        return "stable"
    if snr is None or snr < 1:
        return "shifting"
    return "extreme" if snr >= 2 else "emerged"


def _analyse(vital: Vital, series: power.MonthlySeries) -> dict | None:
    values = series.values.get(vital.parameter)
    if values is None:
        return None
    if vital.start_year is not None:
        values = np.where(series.years >= vital.start_year, values, np.nan)
    valid = np.flatnonzero(np.isfinite(values))
    if valid.size == 0:
        return None
    # Trim to the span that has data (some records start in 2001).
    sl = slice(valid[0], valid[-1] + 1)
    values, years, months = values[sl], series.years[sl], series.months[sl]
    time = series.time[sl]
    span_years = float(time[-1] - time[0]) + 1 / 12
    if span_years < MIN_YEARS or np.isfinite(values).mean() < 0.9:
        return None
    if vital.skip_if_flat:
        finite = values[np.isfinite(values)]
        # e.g. snow depth in the tropics: nothing to monitor.
        if np.percentile(finite, 90) < 1.0:
            return None

    anomalies, climatology = trend.monthly_anomalies(values, years, months)
    if np.nanstd(anomalies) == 0:
        return None

    mk = trend.mann_kendall(anomalies, time)
    lin = trend.linear_trend(anomalies, time)
    ann_years, ann_anom = trend.annual_means(anomalies, years)
    _, ann_abs = trend.annual_means(values, years)
    total_change = mk.slope * span_years
    snr = trend.signal_to_noise(total_change, ann_anom, ann_years)
    baseline_mean = float(np.nanmean(climatology))

    result = {
        "id": vital.id,
        "label": vital.label,
        "unit": vital.unit,
        "definition": vital.definition,
        "source": vital.source,
        "note": vital.note,
        "parameter": vital.parameter,
        "decimals": vital.decimals,
        "period": [int(years[0]), int(years[-1])],
        "baseline_mean": _clean(baseline_mean),
        "years": [int(y) for y in ann_years],
        "annual_anomaly": _round_list(ann_anom, vital.decimals + 2),
        "annual_mean": _round_list(ann_abs, vital.decimals + 2),
        "trend": {
            "slope_per_decade": _clean(mk.slope * 10),
            "ci_per_decade": [_clean(mk.slope_low * 10), _clean(mk.slope_high * 10)],
            "total_change": _clean(total_change),
            "percent_change": _clean(100 * total_change / baseline_mean) if baseline_mean else None,
            "tau": _clean(mk.tau),
            "p": _clean(mk.p),
            "p_uncorrected": _clean(mk.p_uncorrected),
            "variance_inflation": _clean(mk.variance_inflation),
            "lag1": _clean(mk.lag1),
            "n_months": mk.n,
            "signal_to_noise": _clean(snr),
            # Line through the annual anomalies, for drawing.
            "line": [_clean(mk.intercept + mk.slope * (y + 0.5)) for y in (ann_years[0], ann_years[-1])],
            "linear": {
                "slope_per_decade": _clean(lin.slope * 10),
                "ci_per_decade": [_clean(lin.slope_low * 10), _clean(lin.slope_high * 10)],
                "p": _clean(lin.p),
                "n_effective": _clean(lin.n_effective),
            },
        },
        "early_warning": None,
        "forecast": None,
        "suspects": [],
        # Kept for later steps, removed before returning.
        "_anomalies": anomalies,
        "_years": years,
        "_months": months,
    }

    look = forecast.outlook(values, years, months,
                            lower_bound=None if vital.id == "temperature" else 0.0,
                            upper_bound=1.0 if vital.unit == "fraction" else 100.0 if vital.unit == "%" else None)
    if look is not None:
        result["forecast"] = look.to_dict(vital.decimals + 1)
        # The last five years of monthly values, so the outlook can be drawn after them.
        tail = slice(-60, None)
        result["forecast"]["recent"] = {
            "years": [int(v) for v in years[tail]], "months": [int(v) for v in months[tail]],
            "values": _round_list(values[tail], vital.decimals + 1),
        }
        result["forecast"]["next_year_vs_normal"] = _clean(look.next_year_mean - baseline_mean)

    if vital.early_warning:
        warning = ews.early_warning(anomalies, time)
        if warning is not None:
            result["early_warning"] = warning.to_dict()
    return result


def _add_suspects(vitals: list[dict]) -> None:
    """Attach climate-mode links, with false-discovery control across every
    vital-sign-by-mode pair tested for this place."""
    tested: list[tuple[dict, indices.ClimateMode, teleconnect.Link]] = []
    for mode in indices.MODES:
        try:
            indices.load(mode.id)
        except Exception:
            continue  # an index server being down must not break the chart
        for v in vitals:
            link = teleconnect.lagged_link(v["_anomalies"], indices.aligned(mode.id, v["_years"], v["_months"]))
            if link is not None:
                tested.append((v, mode, link))
    if not tested:
        return
    adjusted = trend.fdr_adjust([link.p for _, _, link in tested])
    for (v, mode, link), p_fdr in zip(tested, adjusted):
        if p_fdr < FDR and abs(link.r) >= 0.2:
            v["suspects"].append({
                "id": mode.id,
                "name": mode.name,
                "description": mode.description,
                "r": round(link.r, 3),
                "lag_months": link.lag,
                "p_fdr": _clean(p_fdr),
                "variance_explained": round(link.r**2, 3),
            })
    for v in vitals:
        v["suspects"].sort(key=lambda s: -abs(s["r"]))


CONDITIONS = {
    "stable": "Stable: no vital sign shows a trend distinguishable from chance.",
    "watch": "Watch: at least one vital sign has a trend unlikely to be chance, or shows an "
             "early-warning sign of lost stability.",
    "serious": "Serious: at least two vital signs have moved outside their ordinary year-to-year range, "
               "or one has and another shows an early-warning sign.",
    "critical": "Critical: at least half of the vital signs have moved outside their ordinary range.",
}


def _condition(vitals: list[dict]) -> dict:
    statuses = [v["status"] for v in vitals]
    emerged = sum(s in ("emerged", "extreme") for s in statuses)
    # An early-warning flag is expected by chance in about 1 place in 20, so
    # on its own it raises the level to "watch", never straight to "critical".
    warnings = sum(bool(v["early_warning"] and v["early_warning"]["warning"]) for v in vitals)
    if emerged >= 2 and emerged * 2 >= len(vitals):
        level = "critical"
    elif emerged >= 2 or (emerged and warnings):
        level = "serious"
    elif warnings or any(s != "stable" for s in statuses):
        level = "watch"
    else:
        level = "stable"
    return {
        "level": level,
        "summary": CONDITIONS[level],
        "changing": sum(s != "stable" for s in statuses),
        "emerged": emerged,
        "early_warnings": warnings,
        "monitored": len(vitals),
    }


def place_chart(lat: float, lon: float) -> dict:
    """Everything Canary knows about one point on Earth."""
    series = power.monthly(lat, lon, tuple(v.parameter for v in VITALS))
    vitals = [r for r in (_analyse(v, series) for v in VITALS) if r is not None]

    # False-discovery control across the vital signs tested at this place.
    adjusted = trend.fdr_adjust([v["trend"]["p"] for v in vitals])
    for v, p_fdr in zip(vitals, adjusted):
        t = v["trend"]
        t["p_fdr"] = _clean(p_fdr)
        t["significant"] = bool(p_fdr < FDR)
        t["direction"] = "rising" if t["slope_per_decade"] > 0 else "falling" if t["slope_per_decade"] < 0 else "flat"
        v["status"] = _status(t["significant"], t["signal_to_noise"])

    _add_suspects(vitals)
    for v in vitals:
        # Colour family, so a place's vital signs read in the same colours as the globe.
        variable = catalogue.BY_ID.get(v["id"])
        if variable:
            v["family"], v["up"] = variable.family, variable.up
        for key in ("_anomalies", "_years", "_months"):
            del v[key]

    return {
        "place": {
            "lat": series.lat,
            "lon": series.lon,
            "elevation_m": _clean(series.elevation),
            "grid": "about 50 km (0.5° x 0.625° MERRA-2 cell; 1° for sunlight and cloud)",
        },
        "condition": _condition(vitals),
        "vitals": vitals,
        "methods": {
            "baseline": list(trend.BASELINE),
            "false_discovery_rate": FDR,
            "trend": "Theil-Sen slope on monthly anomalies; Mann-Kendall test with "
                     "autocorrelation correction (larger of Hamed-Rao 1998 and AR(1) "
                     "effective sample size); Benjamini-Hochberg across vital signs.",
            "early_warning": "Lag-1 autocorrelation and variance in a sliding 10-year window "
                             "on detrended anomalies; Kendall tau judged against 500 "
                             "phase-randomised surrogates.",
            "forecast": "24-month outlook from whichever model (seasonal average, or trend plus memory, "
                        "or a pretrained model if installed) had the lowest error in a rolling backtest from "
                        "six past start dates; the 80% range is the backtest's own error at each lead time. "
                        "The record ends in December 2025, so the outlook starts in January 2026.",
            "suspects": "Best lagged correlation (mode leading by 0-6 months) of detrended "
                        "anomalies with NOAA climate indices; effective sample size; "
                        "Bonferroni over lags and Benjamini-Hochberg over all pairs.",
            "caveats": [
                "Values come from a reanalysis (a weather model constrained by observations), "
                "not from a single instrument. Changes in the observing system over the decades "
                "can leave artificial steps, especially in precipitation and soil wetness.",
                "One grid cell covers roughly 50 km, so local features such as a city or a "
                "valley are averaged out.",
                "An early-warning signal is a statistical warning sign, not a prediction of collapse.",
                "A correlation with a climate mode identifies a suspect, not a proven cause.",
            ],
        },
    }
