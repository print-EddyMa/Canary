"""Trend detection and significance testing.

The recipe, in order:

1. Remove the seasonal cycle by subtracting each calendar month's long-term
   mean (monthly anomalies), so summer-versus-winter swings are not mistaken
   for change.
2. Estimate the rate of change with the Theil-Sen slope: the median of the
   slopes between every pair of points. It ignores outliers and does not
   assume the data are bell-shaped.
3. Test whether the trend is real with the Mann-Kendall test, corrected for
   memory. Climate series have memory (a wet month tends to follow a wet
   month), which makes the plain test far too eager to cry "significant".
   Two published corrections widen the uncertainty: Hamed & Rao (1998), from
   the autocorrelation of the ranks, and an effective-sample-size correction
   from a fitted AR(1) model (Yue & Wang 2004). We apply whichever is larger.
   In our simulations of trend-free noise with memory, Hamed-Rao alone still
   raised false alarms 10-23% of the time at the 5% level; taking the larger
   of the two brought that back to about 5% (see tests/test_trend.py).
4. When many tests are run at once (several vital signs, or every square of a
   map), control the false discovery rate with Benjamini-Hochberg so that
   chance alone does not produce a crop of "significant" results.

References
- Mann (1945), Kendall (1975): the rank trend test.
- Sen (1968): slope estimator and its confidence interval.
- Hamed & Rao (1998), J. Hydrology 204: variance correction for autocorrelation.
- Yue & Wang (2004), Water Resources Management 18: effective sample size.
- Benjamini & Hochberg (1995); Wilks (2016), BAMS 97: false discovery rate
  for gridded climate data.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import stats

BASELINE = (1991, 2020)  # WMO standard climate normal period


def monthly_anomalies(
    values: np.ndarray,
    years: np.ndarray,
    months: np.ndarray,
    baseline: tuple[int, int] = BASELINE,
) -> tuple[np.ndarray, np.ndarray]:
    """Subtract each calendar month's baseline mean.

    Returns (anomalies, climatology) where climatology has 12 entries.
    Falls back to the whole record for months with too little baseline data.
    """
    in_base = (years >= baseline[0]) & (years <= baseline[1])
    climatology = np.full(12, np.nan)
    for m in range(1, 13):
        sel = months == m
        base_vals = values[sel & in_base]
        base_vals = base_vals[np.isfinite(base_vals)]
        if base_vals.size >= 10:
            climatology[m - 1] = base_vals.mean()
        else:
            all_vals = values[sel]
            all_vals = all_vals[np.isfinite(all_vals)]
            if all_vals.size:
                climatology[m - 1] = all_vals.mean()
    return values - climatology[months - 1], climatology


def _acf(x: np.ndarray, nlags: int) -> np.ndarray:
    y = x - x.mean()
    n = y.size
    acov = np.correlate(y, y, "full")[n - 1:] / n
    if acov[0] == 0:
        return np.zeros(nlags + 1)
    return acov[: nlags + 1] / acov[0]


def lag1_autocorrelation(x: np.ndarray) -> float:
    x = x[np.isfinite(x)]
    if x.size < 3:
        return 0.0
    return float(_acf(x, 1)[1])


def ar1_variance_inflation(r1: float, n: int) -> float:
    """n / n_effective for an AR(1) process: 1 + 2 * sum((1 - k/n) * rho^k).

    `r1` is the sample lag-1 autocorrelation of a detrended series, which is
    biased low; it is bias-corrected first.
    """
    rho = (r1 * n + 1.0) / (n - 4.0)
    rho = float(np.clip(rho, 0.0, 0.99))
    if rho == 0.0:
        return 1.0
    k = np.arange(1, n)
    return float(1.0 + 2.0 * np.sum((1.0 - k / n) * rho**k))


@dataclass
class TrendResult:
    n: int  # number of valid points
    slope: float  # units per year (Theil-Sen)
    slope_low: float  # 95% confidence interval, autocorrelation-aware
    slope_high: float
    intercept: float  # value of the fitted line at t = 0 (median-based)
    tau: float  # Kendall's tau: -1 (always falling) .. +1 (always rising)
    z: float
    p: float  # two-sided p-value after autocorrelation correction
    p_uncorrected: float  # what the plain Mann-Kendall test would report
    variance_inflation: float  # how much memory in the data widened the uncertainty
    inflation_hamed_rao: float  # the two candidate corrections; the larger is applied
    inflation_ar1: float
    lag1: float  # lag-1 autocorrelation of the detrended series

    def to_dict(self) -> dict:
        return asdict(self)


def mann_kendall(
    x: np.ndarray,
    t: np.ndarray | None = None,
    alpha: float = 0.05,
    max_lag: int | None = None,
) -> TrendResult:
    """Mann-Kendall trend test with autocorrelation correction and Theil-Sen
    slope.

    x: values (NaN allowed, skipped). t: time of each value, any unit; the
    slope comes back in x-units per t-unit. Defaults to 0, 1, 2, ...
    max_lag: how many autocorrelation lags to consider (default: all).
    """
    x = np.asarray(x, dtype=float)
    t = np.arange(x.size, dtype=float) if t is None else np.asarray(t, dtype=float)
    keep = np.isfinite(x) & np.isfinite(t)
    x, t = x[keep], t[keep]
    n = x.size
    if n < 8:
        raise ValueError("need at least 8 valid points for a trend test")

    # S statistic: number of rising pairs minus number of falling pairs.
    iu = np.triu_indices(n, k=1)
    dx = x[iu[1]] - x[iu[0]]
    s = float(np.sign(dx).sum())

    # Variance of S under "no trend", with the standard correction for ties.
    _, counts = np.unique(x, return_counts=True)
    ties = counts[counts > 1]
    var_s = (n * (n - 1) * (2 * n + 5) - (ties * (ties - 1) * (2 * ties + 5)).sum()) / 18.0

    # Theil-Sen slope and intercept.
    dt = t[iu[1]] - t[iu[0]]
    pair_slopes = np.sort(dx[dt != 0] / dt[dt != 0])
    slope = float(np.median(pair_slopes))
    intercept = float(np.median(x) - slope * np.median(t))

    # Hamed-Rao: autocorrelation of the ranks of the detrended series.
    detrended = x - slope * t
    ranks = stats.rankdata(detrended)
    nlags = n - 1 if max_lag is None else min(max_lag, n - 1)
    rho = _acf(ranks, nlags)
    bound = stats.norm.ppf(1 - alpha / 2) / np.sqrt(n)
    lags = np.arange(1, nlags + 1)
    r = rho[1:]
    significant = np.abs(r) > bound
    weights = (n - lags) * (n - lags - 1.0) * (n - lags - 2.0)
    inflation_hr = 1.0 + (2.0 / (n * (n - 1.0) * (n - 2.0))) * float((weights * r)[significant].sum())

    # Effective-sample-size correction from an AR(1) fit to the detrended data.
    inflation_ar1 = ar1_variance_inflation(lag1_autocorrelation(detrended), n)

    # Apply the larger correction, and never let it make a trend look *more*
    # certain than the plain test would.
    inflation = max(inflation_hr, inflation_ar1, 1.0)
    var_corrected = var_s * inflation

    def z_score(var: float) -> float:
        if var <= 0 or s == 0:
            return 0.0
        return (s - np.sign(s)) / np.sqrt(var)  # continuity correction

    z = z_score(var_corrected)
    p = float(2 * stats.norm.sf(abs(z)))
    p_plain = float(2 * stats.norm.sf(abs(z_score(var_s))))

    # Sen's confidence interval for the slope, using the corrected variance.
    c = stats.norm.ppf(1 - alpha / 2) * np.sqrt(var_corrected)
    m = pair_slopes.size
    lo_idx = int(np.clip(np.floor((m - c) / 2.0) - 1, 0, m - 1))
    hi_idx = int(np.clip(np.ceil((m + c) / 2.0), 0, m - 1))

    return TrendResult(
        n=n,
        slope=slope,
        slope_low=float(pair_slopes[lo_idx]),
        slope_high=float(pair_slopes[hi_idx]),
        intercept=intercept,
        tau=float(s / (0.5 * n * (n - 1))),
        z=float(z),
        p=p,
        p_uncorrected=p_plain,
        variance_inflation=float(inflation),
        inflation_hamed_rao=float(inflation_hr),
        inflation_ar1=float(inflation_ar1),
        lag1=lag1_autocorrelation(detrended),
    )


@dataclass
class LinearResult:
    slope: float
    slope_low: float
    slope_high: float
    p: float
    n_effective: float

    def to_dict(self) -> dict:
        return asdict(self)


def linear_trend(x: np.ndarray, t: np.ndarray, alpha: float = 0.05) -> LinearResult:
    """Ordinary least-squares trend with a t-test adjusted for autocorrelation.

    The residuals' lag-1 autocorrelation r1 shrinks the sample size to
    n_eff = n (1 - r1) / (1 + r1) (Santer et al. 2008), which widens the
    confidence interval when months are not independent.
    This is the second opinion alongside Mann-Kendall.
    """
    keep = np.isfinite(x) & np.isfinite(t)
    x, t = x[keep], t[keep]
    n = x.size
    tc = t - t.mean()
    slope = float((tc * (x - x.mean())).sum() / (tc**2).sum())
    resid = x - x.mean() - slope * tc
    r1 = float(np.clip(lag1_autocorrelation(resid), 0.0, 0.98))
    n_eff = max(n * (1 - r1) / (1 + r1), 3.0)
    se = float(np.sqrt((resid**2).sum() / (n_eff - 2) / (tc**2).sum()))
    df = n_eff - 2
    if se == 0:
        return LinearResult(slope, slope, slope, 0.0 if slope else 1.0, n_eff)
    p = float(2 * stats.t.sf(abs(slope / se), df))
    half = float(stats.t.ppf(1 - alpha / 2, df) * se)
    return LinearResult(slope, slope - half, slope + half, p, float(n_eff))


def fdr_adjust(p_values) -> np.ndarray:
    """Benjamini-Hochberg adjusted p-values (NaN entries pass through).

    Call a result significant when its adjusted p is below the false
    discovery rate you accept (0.05 here): among everything flagged, at most
    about 5% are expected to be flukes.
    """
    p = np.asarray(p_values, dtype=float)
    out = np.full(p.shape, np.nan)
    ok = np.isfinite(p)
    if ok.any():
        out[ok] = stats.false_discovery_control(p[ok], method="bh")
    return out


def annual_means(values: np.ndarray, years: np.ndarray, min_months: int = 9):
    """Calendar-year means, NaN for years with fewer than `min_months` values."""
    uniq = np.unique(years)
    out = np.full(uniq.size, np.nan)
    for i, y in enumerate(uniq):
        v = values[years == y]
        v = v[np.isfinite(v)]
        if v.size >= min_months:
            out[i] = v.mean()
    return uniq, out


def signal_to_noise(total_change: float, annual_anomalies: np.ndarray, annual_years: np.ndarray) -> float:
    """Size of the long-term change relative to ordinary year-to-year swings.

    Noise is the standard deviation of annual anomalies after removing the
    linear trend. A ratio above 1 means the change has emerged from the range
    of natural variability (Hawkins & Sutton 2012).
    """
    ok = np.isfinite(annual_anomalies)
    if ok.sum() < 5:
        return float("nan")
    y, x = annual_anomalies[ok], annual_years[ok].astype(float)
    resid = y - np.polyval(np.polyfit(x, y, 1), x)
    noise = resid.std(ddof=2)
    if noise == 0:
        return float("nan")
    return float(abs(total_change) / noise)
