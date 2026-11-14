"""Suspects: which planet-wide climate rhythm does a local series follow?

The challenge notes that one process can push a variable up in one region and
down in another. Climate modes such as El Niño are the classic case. For each
local series we measure its lagged correlation with each mode's index, after
removing the linear trend from both so that two unrelated series that merely
both drift upward are not declared related.

Significance uses an effective sample size that accounts for memory in both
series (Bretherton et al. 1999, J. Climate 12), and a Bonferroni factor for
having tried several lags and kept the best one.

Correlation is not proof of cause; this is the list of suspects, not a verdict.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import stats

from .trend import lag1_autocorrelation

MAX_LAG = 6  # months by which the climate mode may lead the local response


def _detrend(x: np.ndarray) -> np.ndarray:
    ok = np.isfinite(x)
    out = np.full(x.shape, np.nan)
    if ok.sum() < 3:
        return out
    idx = np.arange(x.size, dtype=float)
    out[ok] = x[ok] - np.polyval(np.polyfit(idx[ok], x[ok], 1), idx[ok])
    return out


@dataclass
class Link:
    r: float  # correlation at the best lag
    lag: int  # months the mode leads the local series
    p: float  # adjusted for memory and for choosing the best lag
    n_effective: float

    def to_dict(self) -> dict:
        return asdict(self)


def lagged_link(local: np.ndarray, index: np.ndarray, max_lag: int = MAX_LAG) -> Link | None:
    """Strongest lagged correlation between a climate index and a local
    anomaly series on the same monthly axis. Returns None if too little overlap."""
    local, index = _detrend(np.asarray(local, float)), _detrend(np.asarray(index, float))
    best: Link | None = None
    for lag in range(max_lag + 1):
        a = index[: index.size - lag] if lag else index
        b = local[lag:]
        ok = np.isfinite(a) & np.isfinite(b)
        n = int(ok.sum())
        if n < 60:
            continue
        a, b = a[ok], b[ok]
        if a.std() == 0 or b.std() == 0:
            continue
        r = float(np.corrcoef(a, b)[0, 1])
        r1a, r1b = lag1_autocorrelation(a), lag1_autocorrelation(b)
        n_eff = float(np.clip(n * (1 - r1a * r1b) / (1 + r1a * r1b), 4.0, n))
        t = r * np.sqrt((n_eff - 2) / max(1 - r * r, 1e-12))
        p = float(2 * stats.t.sf(abs(t), n_eff - 2))
        if best is None or abs(r) > abs(best.r):
            best = Link(r=r, lag=lag, p=p, n_effective=n_eff)
    if best is None:
        return None
    best.p = min(1.0, best.p * (max_lag + 1))
    return best
