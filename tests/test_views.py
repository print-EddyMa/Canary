"""Latitude-time anomalies and decadal distributions on a synthetic grid."""

import numpy as np

from canary import cube, investigate


def _cube(warming_north=0.05):
    years = np.arange(1981, 2026)
    lats = np.arange(-60, 60.5, 2.0)
    lons = np.arange(-180, 180, 2.5)
    rng = np.random.default_rng(1)
    trend = np.where(lats > 0, warming_north, 0.0)  # only the north warms
    data = trend[None, :, None] * (years - 2000)[:, None, None] + rng.normal(0, 0.3, (years.size, lats.size, lons.size))
    return cube.Cube(years=years, lats=lats, lons=lons, data=data.astype(np.float32))


def test_zonal_finds_the_warming_band():
    c = _cube()
    mask = np.ones(c.data.shape[1:], bool)
    window = np.ones(c.years.size, bool)
    z = investigate.zonal(c, mask, window, decimals=2)
    assert len(z["anomaly"]) == c.years.size
    assert len(z["lat"]) == len(z["trend"]) == len(z["significant"])
    mids = np.array([(a + b) / 2 for a, b in z["lat"]])
    north = [s for s, m in zip(z["significant"], mids) if m > 5]
    south = [s for s, m in zip(z["significant"], mids) if m < -5]
    assert all(north) and sum(south) <= 1  # FDR bounds the share of false discoveries, not their number
    slope = np.array([t[0] for t in z["trend"]])
    assert abs(slope[mids > 5].mean() - 0.5) < 0.1  # 0.05 per year = 0.5 per decade


def test_spread_shifts_right_and_widens_the_warm_tail():
    c = _cube(warming_north=0.08)
    mask = np.ones(c.data.shape[1:], bool)
    s = investigate.spread(c, mask, np.ones(c.years.size, bool))
    first, last = s["decades"][0], s["decades"][-1]
    assert last["mean"] > first["mean"] + 0.5
    assert last["above_2sd"] > first["above_2sd"]
    widths = np.diff(s["edges"])
    for d in s["decades"]:
        assert abs(sum(np.array(d["density"]) * widths) - 1) < 0.02  # each is a density
