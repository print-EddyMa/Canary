import numpy as np

from canary.sources import indices
from canary.stats import teleconnect


def test_parse_wide_and_long_index_files():
    wide = """  1950 2026
 1950  -1.5  -1.3  99.99 -1.2 -1.4 -1.1 -0.8 -0.9 -0.7 -0.8 -1.1 -1.0
 1951  -0.9  -0.7  -0.3  0.0  0.1  0.4  0.7  0.8  0.9  0.9  0.8  0.6
  -99.99
 Nino 3.4 footer text 2026
"""
    table = indices.parse(wide, "wide")
    assert table[(1950, 1)] == -1.5
    assert (1950, 3) not in table  # missing-value marker dropped
    assert table[(1951, 12)] == 0.6
    assert len(table) == 23

    long = "Year Month Value\n1854 1 0.12\n1854 2 -99.99\n1854 3 0.30\n"
    table = indices.parse(long, "long")
    assert table == {(1854, 1): 0.12, (1854, 3): 0.30}


def test_lagged_link_finds_the_lag_and_sign():
    rng = np.random.default_rng(0)
    index = rng.standard_normal(500)
    local = np.empty(500)
    local[3:] = -0.8 * index[:-3]
    local[:3] = 0
    local += 0.3 * rng.standard_normal(500)
    link = teleconnect.lagged_link(local, index)
    assert link.lag == 3
    assert link.r < -0.8
    assert link.p < 0.001


def test_shared_trend_alone_is_not_a_link():
    rng = np.random.default_rng(1)
    t = np.arange(500) / 100
    link = teleconnect.lagged_link(t + rng.standard_normal(500), t + rng.standard_normal(500))
    assert abs(link.r) < 0.15
    assert link.p > 0.05


def test_too_little_overlap_returns_none():
    x = np.full(100, np.nan)
    x[:30] = 1.0
    assert teleconnect.lagged_link(x, np.arange(100.0)) is None
