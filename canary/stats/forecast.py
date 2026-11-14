"""Outlooks for a monthly series, with skill measured before anything is shown.

A forecast is only worth showing if it beats the obvious guess. The obvious
guess for a climate variable is the seasonal average ("next July will be like
a normal July"). So every outlook here is first tested on the past:

1. Pretend it is December of 2013, 2015, ... 2023 in turn, hide everything
   after that date, forecast the next 24 months, and compare with what
   actually happened (a rolling-origin backtest).
2. Do the same with the seasonal-average baseline.
3. Report skill = 1 - (model error / baseline error). Zero or less means the
   model is no better than the seasonal average, and then the seasonal
   average is what Canary shows, and says so.

Models
- "seasonal average": mean of each calendar month over the last 30 years.
- "trend + memory": seasonal cycle + a straight-line trend + the latest
  departure from the trend fading at the rate the series itself forgets
  (lag-1 autocorrelation).
- optionally a pretrained time-series model (Amazon Chronos-Bolt) when the
  `chronos` package is installed; it must win the same backtest to be used.

The 80% range comes from the backtest's own errors at each lead time, and the
share of past outcomes it actually contained is reported next to it.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

HORIZON = 24  # months
BACKTEST_ORIGINS = (2013, 2015, 2017, 2019, 2021, 2023)  # forecasts start the January after
MIN_TRAIN_YEARS = 10
LEAD_BUCKETS = ((1, 3), (4, 12), (13, 24))
INTERVAL = 0.80


def _monthly_means(values: np.ndarray, months: np.ndarray) -> np.ndarray:
    out = np.full(12, np.nan)
    for m in range(1, 13):
        v = values[months == m]
        v = v[np.isfinite(v)]
        if v.size:
            out[m - 1] = v.mean()
    return out


def _future_months(last_year: int, last_month: int, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    index = last_year * 12 + (last_month - 1) + np.arange(1, horizon + 1)
    return index // 12, index % 12 + 1


def seasonal_average(values, years, months, horizon: int = HORIZON) -> np.ndarray:
    recent = years > years[-1] - 30
    clim = _monthly_means(values[recent], months[recent])
    _, fm = _future_months(int(years[-1]), int(months[-1]), horizon)
    return clim[fm - 1]


def trend_memory(values, years, months, horizon: int = HORIZON) -> np.ndarray:
    t = years + (months - 0.5) / 12.0
    clim = _monthly_means(values, months)
    anomaly = values - clim[months - 1]
    ok = np.isfinite(anomaly)
    slope, intercept = np.polyfit(t[ok], anomaly[ok], 1)
    resid = anomaly - (intercept + slope * t)
    r = resid[ok]
    rc = r - r.mean()
    denom = float((rc * rc).sum())
    phi = float(np.clip((rc[:-1] * rc[1:]).sum() / denom, 0.0, 0.95)) if denom > 0 else 0.0
    last = float(np.nanmean(resid[-3:]))  # the latest departure from trend, lightly smoothed
    fy, fm = _future_months(int(years[-1]), int(months[-1]), horizon)
    ft = fy + (fm - 0.5) / 12.0
    lead = np.arange(1, horizon + 1)
    return clim[fm - 1] + intercept + slope * ft + last * phi**lead


@lru_cache(maxsize=1)
def _chronos():
    """The pretrained model, or None when it is not installed or disabled."""
    if os.environ.get("CANARY_CHRONOS", "1") == "0":
        return None
    try:
        import torch
        from chronos import BaseChronosPipeline
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        return BaseChronosPipeline.from_pretrained("amazon/chronos-bolt-small", device_map="cpu")
    except Exception:  # noqa: BLE001 - optional dependency, any failure means "not available"
        return None


def chronos_batch(contexts: list[np.ndarray], horizon: int = HORIZON) -> list[np.ndarray] | None:
    """Median forecasts for several series at once, or None if unavailable."""
    pipeline = _chronos()
    if pipeline is None:
        return None
    import torch
    tensors = [torch.tensor(np.where(np.isfinite(c), c, np.nan), dtype=torch.float32) for c in contexts]
    quantiles, _ = pipeline.predict_quantiles(tensors, prediction_length=horizon, quantile_levels=[0.5])
    return [q[:, 0].numpy().astype(float) for q in quantiles]


MODELS = {"seasonal average": seasonal_average, "trend + memory": trend_memory}
MODEL_LABEL = {
    "seasonal average": "the seasonal average of the last 30 years",
    "trend + memory": "seasonal cycle, long-term trend and the fading of the latest anomaly",
    "pretrained model": "a pretrained time-series model (Amazon Chronos-Bolt)",
}


@dataclass
class Outlook:
    years: list[int]
    months: list[int]
    median: list[float]
    low: list[float]
    high: list[float]
    method: str
    method_label: str
    skill: float  # 1 - MAE(model) / MAE(seasonal average); the baseline scores 0
    candidates: dict[str, float]  # backtest MAE of every model tried
    coverage: float | None  # share of held-out outcomes inside the stated range
    interval: float
    origins: list[int]
    next_year_mean: float
    next_year_low: float
    next_year_high: float
    summary: str

    def to_dict(self, digits: int = 3) -> dict:
        rnd = lambda xs: [round(float(v), digits) for v in xs]  # noqa: E731
        return {
            "years": self.years, "months": self.months,
            "median": rnd(self.median), "low": rnd(self.low), "high": rnd(self.high),
            "method": self.method, "method_label": self.method_label,
            "skill": round(self.skill, 3),
            "candidates": {k: round(v, 4) for k, v in self.candidates.items()},
            "coverage": None if self.coverage is None else round(self.coverage, 2),
            "interval": self.interval, "backtest_origins": self.origins,
            "next_year_mean": round(self.next_year_mean, digits),
            "next_year_range": [round(self.next_year_low, digits), round(self.next_year_high, digits)],
            "summary": self.summary,
        }


def outlook(values, years, months, lower_bound: float | None = None, upper_bound: float | None = None,
            horizon: int = HORIZON, use_pretrained: bool = True) -> Outlook | None:
    """Backtest the candidate models on this series and forecast with the winner.

    Returns None when the record is too short to test anything.
    """
    values = np.asarray(values, dtype=float)
    years, months = np.asarray(years), np.asarray(months)
    first = int(np.flatnonzero(np.isfinite(values))[0])
    values, years, months = values[first:], years[first:], months[first:]
    last_year = int(years[-1])

    def clip(a):
        return np.clip(a, lower_bound if lower_bound is not None else -np.inf,
                       upper_bound if upper_bound is not None else np.inf)

    # ---- rolling-origin backtest ----
    folds = []  # (origin, train slice end, truth)
    for origin in BACKTEST_ORIGINS:
        end = int(np.searchsorted(years, origin, side="right"))  # first index after December of `origin`
        if end + horizon > values.size or origin - int(years[0]) + 1 < MIN_TRAIN_YEARS:
            continue
        truth = values[end: end + horizon]
        if np.isfinite(truth).mean() < 0.8:
            continue
        folds.append((origin, end, truth))
    if len(folds) < 3:
        return None

    errors: dict[str, list[np.ndarray]] = {name: [] for name in MODELS}
    for _, end, truth in folds:
        for name, model in MODELS.items():
            errors[name].append(clip(model(values[:end], years[:end], months[:end], horizon)) - truth)
    if use_pretrained:
        batch = chronos_batch([values[:end] for _, end, _ in folds], horizon)
        if batch is not None:
            errors["pretrained model"] = [clip(pred) - truth for pred, (_, _, truth) in zip(batch, folds)]

    mae = {name: float(np.nanmean(np.abs(np.concatenate(errs)))) for name, errs in errors.items()}
    baseline = mae["seasonal average"]
    best = min(mae, key=mae.get)
    # A challenger must beat the baseline by a clear margin, not by rounding error.
    method = best if best != "seasonal average" and mae[best] < 0.98 * baseline else "seasonal average"
    skill = 1.0 - mae[method] / baseline if baseline > 0 else 0.0

    # ---- interval from the backtest's own errors, checked leave-one-origin-out ----
    stacked = np.abs(np.vstack(errors[method]))  # folds x horizon
    lead = np.arange(1, horizon + 1)
    half = np.empty(horizon)
    inside, total = 0, 0
    for lo, hi in LEAD_BUCKETS:
        cols = (lead >= lo) & (lead <= hi)
        pool = stacked[:, cols]
        half[cols] = np.nanquantile(pool, INTERVAL)
        for k in range(pool.shape[0]):
            others = np.delete(pool, k, axis=0)
            width = np.nanquantile(others, INTERVAL)
            held = pool[k][np.isfinite(pool[k])]
            inside += int((held <= width).sum())
            total += held.size
    coverage = inside / total if total else None

    # ---- the forecast itself ----
    if method == "pretrained model":
        median = chronos_batch([values], horizon)[0]
    else:
        median = MODELS[method](values, years, months, horizon)
    median = clip(median)
    low, high = clip(median - half), clip(median + half)
    fy, fm = _future_months(last_year, int(months[-1]), horizon)

    # Mean of the next 12 months; errors of a 12-month mean, again from the backtest.
    annual_errors = np.abs(np.array([np.nanmean(e[:12]) for e in errors[method]]))
    annual_half = float(np.quantile(annual_errors, INTERVAL))
    next_mean = float(np.mean(median[:12]))

    if method == "seasonal average":
        summary = ("No forecast beat the plain seasonal average when tested on the past, so the outlook is "
                   "simply a normal year.")
    else:
        summary = (f"Tested on {len(folds)} past start dates, this outlook was {round(100 * skill)}% more "
                   f"accurate than assuming a normal year.")
    return Outlook(
        years=[int(v) for v in fy], months=[int(v) for v in fm],
        median=median.tolist(), low=low.tolist(), high=high.tolist(),
        method=method, method_label=MODEL_LABEL[method], skill=skill, candidates=mae,
        coverage=coverage, interval=INTERVAL, origins=[o for o, _, _ in folds],
        next_year_mean=next_mean,
        next_year_low=float(clip(np.array(next_mean - annual_half))),
        next_year_high=float(clip(np.array(next_mean + annual_half))),
        summary=summary,
    )
