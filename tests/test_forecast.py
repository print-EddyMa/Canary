import numpy as np

from canary.stats import forecast


def series(rng, years=45, trend=0.0, noise=1.0, memory=0.0):
    n = years * 12
    y = np.repeat(np.arange(1981, 1981 + years), 12)
    m = np.tile(np.arange(1, 13), years)
    t = y + (m - 0.5) / 12
    e = rng.standard_normal(n) * noise
    r = np.zeros(n)
    for i in range(1, n):
        r[i] = memory * r[i - 1] + e[i]
    return 10 * np.sin(2 * np.pi * m / 12) + trend * (t - 1981) + r, y, m


def test_trend_model_wins_when_there_is_a_trend():
    values, y, m = series(np.random.default_rng(0), trend=0.15, noise=0.6)
    out = forecast.outlook(values, y, m, use_pretrained=False)
    assert out.method == "trend + memory"
    assert out.skill > 0.2
    assert len(out.median) == forecast.HORIZON
    assert (out.years[0], out.months[0]) == (2026, 1)
    assert all(lo <= mid <= hi for lo, mid, hi in zip(out.low, out.median, out.high))


def test_falls_back_to_the_seasonal_average_when_nothing_beats_it():
    values, y, m = series(np.random.default_rng(1), trend=0.0, noise=1.0)
    out = forecast.outlook(values, y, m, use_pretrained=False)
    assert out.method == "seasonal average"
    assert out.skill == 0.0
    assert "normal year" in out.summary


def test_stated_range_holds_about_the_stated_share_of_past_outcomes():
    values, y, m = series(np.random.default_rng(2), trend=0.05, noise=1.0, memory=0.4)
    out = forecast.outlook(values, y, m, use_pretrained=False)
    assert 0.65 <= out.coverage <= 0.92  # nominal 0.80, with sampling slack


def test_bounds_are_respected():
    values, y, m = series(np.random.default_rng(3), noise=3.0)
    values = np.clip(values + 2, 0, None)  # like precipitation: never negative
    out = forecast.outlook(values, y, m, lower_bound=0.0, use_pretrained=False)
    assert min(out.low) >= 0.0


def test_short_records_are_refused():
    values, y, m = series(np.random.default_rng(4), years=45)
    values[y < 2012] = np.nan  # only 14 years: too few backtest origins with enough training
    assert forecast.outlook(values, y, m, use_pretrained=False) is None


def test_future_months_roll_over_the_year():
    fy, fm = forecast._future_months(2025, 11, 4)
    assert list(zip(fy.tolist(), fm.tolist())) == [(2025, 12), (2026, 1), (2026, 2), (2026, 3)]
