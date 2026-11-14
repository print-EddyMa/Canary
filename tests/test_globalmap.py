import numpy as np
import pytest

from canary import globalmap
from canary.stats import trend


def test_grid_trend_matches_the_point_implementation():
    rng = np.random.default_rng(0)
    years = np.arange(1981, 2026, dtype=float)
    data = np.empty((6, years.size))
    for c in range(6):
        noise = np.zeros(years.size)
        for i in range(1, years.size):
            noise[i] = 0.5 * noise[i - 1] + rng.standard_normal()
        data[c] = 0.03 * c * (years - 1981) + noise
    data[2, [3, 17]] = np.nan
    slope, p, snr = globalmap.trend_grid(data, years, 20)
    for c in range(6):
        ref = trend.mann_kendall(data[c], years)
        assert slope[c] == pytest.approx(ref.slope)
        assert p[c] == pytest.approx(ref.p, abs=1e-9)
    assert snr[5] > snr[0]


def test_short_or_constant_cells_are_skipped():
    years = np.arange(1981, 2026, dtype=float)
    data = np.full((2, years.size), np.nan)
    data[0, :10] = np.arange(10)
    data[1] = 3.0
    slope, p, _ = globalmap.trend_grid(data, years, 20)
    assert np.isnan(slope).all() and np.isnan(p).all()


def test_mercator_resampling_keeps_orientation():
    lats = np.arange(-90, 90.5, 0.5)
    lons = np.arange(-180, 180, 0.625)
    grid = np.broadcast_to(lats[:, None], (lats.size, lons.size)).copy()
    img = globalmap.to_mercator(grid, lats, lons, size=256)
    assert img.shape == (256, 256)
    assert img[0, 0] > 84 and img[-1, 0] < -84  # north at the top
    assert abs(img[128, 0]) < 1  # equator in the middle
    lon_grid = np.broadcast_to(lons[None, :], (lats.size, lons.size)).copy()
    img = globalmap.to_mercator(lon_grid, lats, lons, size=256)
    assert img[0, 0] < -178 and img[0, -1] > 178


def test_colour_ramp_endpoints():
    rgb = globalmap._ramp(["#000000", "#ffffff"], np.array([0.0, 0.5, 1.0]))
    assert rgb.tolist() == [[0, 0, 0], [128, 128, 128], [255, 255, 255]]
