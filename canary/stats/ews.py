"""Early-warning signals of lost stability ("critical slowing down").

Theory: a system that is being pushed towards a tipping point recovers more
and more slowly from everyday shocks. In a time series that shows up as
rising memory (lag-1 autocorrelation, AR(1)) and rising variance, before any
visible collapse (Scheffer et al. 2009, Nature 461; Dakos et al. 2012, PLoS
ONE 7). Boulton et al. (2022, Nature Climate Change 12) used this recipe to
show the Amazon rainforest losing resilience.

Recipe used here:
1. Start from monthly anomalies (seasonal cycle already removed).
2. Remove the slow trend with a Gaussian kernel smoother, leaving the
   fluctuations around it.
3. Slide a window along the fluctuations and compute AR(1) and variance in
   each window.
4. Measure whether each indicator rises over time with Kendall's tau.
5. Judge significance against surrogates: shuffled-phase copies of the same
   fluctuations that keep their overall spectrum but have, by construction,
   no change in stability over time. The ordinary Kendall p-value is useless
   here because overlapping windows are heavily dependent on one another.

A positive result is a *warning sign*, not a forecast of collapse.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import stats


def gaussian_smooth(x: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian kernel smoother that tolerates NaNs and renormalises at the edges."""
    n = x.size
    half = int(np.ceil(4 * sigma))
    kernel = np.exp(-0.5 * (np.arange(-half, half + 1) / sigma) ** 2)
    valid = np.isfinite(x).astype(float)
    filled = np.where(np.isfinite(x), x, 0.0)
    num = np.convolve(filled, kernel, mode="same")
    den = np.convolve(valid, kernel, mode="same")
    with np.errstate(invalid="ignore", divide="ignore"):
        out = num / den
    out[den == 0] = np.nan
    return out[:n]


def _rolling_sum(a: np.ndarray, w: int) -> np.ndarray:
    c = np.cumsum(np.concatenate([np.zeros(a.shape[:-1] + (1,)), a], axis=-1), axis=-1)
    return c[..., w:] - c[..., :-w]


def rolling_ar1(x: np.ndarray, window: int) -> np.ndarray:
    """Lag-1 autocorrelation in each sliding window (works along the last axis)."""
    a, b = x[..., :-1], x[..., 1:]
    w = window - 1
    sa, sb = _rolling_sum(a, w), _rolling_sum(b, w)
    saa, sbb, sab = _rolling_sum(a * a, w), _rolling_sum(b * b, w), _rolling_sum(a * b, w)
    cov = sab - sa * sb / w
    va = saa - sa * sa / w
    vb = sbb - sb * sb / w
    with np.errstate(invalid="ignore", divide="ignore"):
        r = cov / np.sqrt(va * vb)
    return r


def rolling_variance(x: np.ndarray, window: int) -> np.ndarray:
    s, ss = _rolling_sum(x, window), _rolling_sum(x * x, window)
    return np.maximum(ss - s * s / window, 0.0) / (window - 1)


def phase_surrogates(x: np.ndarray, count: int, rng: np.random.Generator) -> np.ndarray:
    """Fourier surrogates: same power spectrum, random phases.

    Each surrogate has the same overall variance and autocorrelation as `x`
    but is stationary, so any trend in its rolling indicators is chance.
    """
    n = x.size
    spectrum = np.fft.rfft(x - x.mean())
    phases = rng.uniform(0, 2 * np.pi, size=(count, spectrum.size))
    phases[:, 0] = 0.0
    if n % 2 == 0:
        phases[:, -1] = 0.0
    return np.fft.irfft(np.abs(spectrum) * np.exp(1j * phases), n=n, axis=-1) + x.mean()


def _tau_over_time(series: np.ndarray) -> float:
    ok = np.isfinite(series)
    if ok.sum() < 8:
        return float("nan")
    return float(stats.kendalltau(np.arange(series.size)[ok], series[ok]).statistic)


@dataclass
class EarlyWarning:
    window: int  # months per sliding window
    detrend_sigma: float  # months
    time: np.ndarray  # time at the END of each window
    ar1: np.ndarray
    variance: np.ndarray
    tau_ar1: float  # trend of AR(1) over time, -1..+1
    tau_variance: float
    p_ar1: float  # share of surrogates with a rise at least this strong
    p_variance: float
    surrogates: int
    warning: bool  # both indicators rising, AR(1) significantly

    def to_dict(self) -> dict:
        return {
            "window_months": self.window,
            "detrend_sigma_months": self.detrend_sigma,
            "time": [round(float(v), 3) for v in self.time],
            "ar1": [None if not np.isfinite(v) else round(float(v), 4) for v in self.ar1],
            "variance": [None if not np.isfinite(v) else float(f"{v:.4g}") for v in self.variance],
            "tau_ar1": self.tau_ar1,
            "tau_variance": self.tau_variance,
            "p_ar1": self.p_ar1,
            "p_variance": self.p_variance,
            "surrogates": self.surrogates,
            "warning": self.warning,
        }


def early_warning(
    anomalies: np.ndarray,
    time: np.ndarray,
    window: int = 120,
    detrend_sigma: float = 36.0,
    surrogates: int = 500,
    alpha: float = 0.05,
    seed: int = 0,
) -> EarlyWarning | None:
    """Critical-slowing-down indicators for one monthly anomaly series.

    Returns None when the record is too short or too gappy to say anything.
    """
    x = np.asarray(anomalies, dtype=float)
    time = np.asarray(time, dtype=float)
    # Use the span between the first and last valid values.
    valid = np.flatnonzero(np.isfinite(x))
    if valid.size == 0:
        return None
    x, time = x[valid[0]: valid[-1] + 1], time[valid[0]: valid[-1] + 1]
    if x.size < 2.5 * window or np.isnan(x).mean() > 0.05:
        return None

    residual = x - gaussian_smooth(x, detrend_sigma)
    # Fill the few gaps with zero (the residual's mean) so windows stay aligned.
    residual = np.where(np.isfinite(residual), residual, 0.0)
    if residual.std() == 0:
        return None

    ar1 = rolling_ar1(residual, window)
    var = rolling_variance(residual, window)
    tau_ar1, tau_var = _tau_over_time(ar1), _tau_over_time(var)

    rng = np.random.default_rng(seed)
    surr = phase_surrogates(residual, surrogates, rng)
    surr_ar1 = rolling_ar1(surr, window)
    surr_var = rolling_variance(surr, window)
    null_ar1 = np.array([_tau_over_time(row) for row in surr_ar1])
    null_var = np.array([_tau_over_time(row) for row in surr_var])
    p_ar1 = float((1 + np.sum(null_ar1 >= tau_ar1)) / (surrogates + 1))
    p_var = float((1 + np.sum(null_var >= tau_var)) / (surrogates + 1))

    return EarlyWarning(
        window=window,
        detrend_sigma=detrend_sigma,
        time=time[window - 1:],
        ar1=ar1,
        variance=var,
        tau_ar1=tau_ar1,
        tau_variance=tau_var,
        p_ar1=p_ar1,
        p_variance=p_var,
        surrogates=surrogates,
        warning=bool(p_ar1 < alpha and tau_ar1 > 0 and tau_var > 0),
    )
