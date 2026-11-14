import numpy as np
import pymannkendall as pmk
import pytest

from canary.stats import trend


def ar1_noise(rng, n, phi, size=None):
    shape = (n,) if size is None else (size, n)
    e = rng.standard_normal(shape)
    x = np.empty(shape)
    x[..., 0] = e[..., 0] / np.sqrt(1 - phi**2)
    for i in range(1, n):
        x[..., i] = phi * x[..., i - 1] + e[..., i]
    return x


def test_matches_reference_implementation_on_autocorrelated_trend():
    rng = np.random.default_rng(1)
    x = ar1_noise(rng, 300, 0.5) + 0.01 * np.arange(300)
    ours = trend.mann_kendall(x)
    ref = pmk.hamed_rao_modification_test(x)
    plain = pmk.original_test(x)
    assert ours.slope == pytest.approx(ref.slope)
    assert ours.tau == pytest.approx(ref.Tau)
    assert ours.p_uncorrected == pytest.approx(plain.p)
    # Our Hamed-Rao term reproduces the reference implementation exactly ...
    assert ours.inflation_hamed_rao == pytest.approx(ref.var_s / plain.var_s)
    # ... and the applied correction is never smaller than it.
    assert ours.variance_inflation >= ours.inflation_hamed_rao
    assert ours.p >= ref.p - 1e-12


def test_recovers_known_slope_and_interval_covers_it():
    rng = np.random.default_rng(2)
    t = 1981 + (np.arange(540) + 0.5) / 12
    x = 0.03 * (t - 1981) + rng.standard_normal(540) * 0.5
    r = trend.mann_kendall(x, t)
    assert r.slope == pytest.approx(0.03, abs=0.005)
    assert r.slope_low < 0.03 < r.slope_high
    assert r.p < 0.001


def test_handles_missing_values_and_ties():
    rng = np.random.default_rng(3)
    x = np.round(rng.standard_normal(200) + 0.02 * np.arange(200), 1)
    x[[5, 50, 120]] = np.nan
    r = trend.mann_kendall(x)
    assert r.n == 197
    assert r.slope > 0


@pytest.mark.parametrize("phi", [0.4, 0.8])
def test_false_positive_rate_on_red_noise_is_controlled(phi):
    """Trend-free noise with memory: the plain test over-fires, ours does not."""
    rng = np.random.default_rng(4)
    series = ar1_noise(rng, 240, phi, size=400)
    results = [trend.mann_kendall(s) for s in series]
    plain_rate = np.mean([r.p_uncorrected < 0.05 for r in results])
    corrected_rate = np.mean([r.p < 0.05 for r in results])
    assert plain_rate > 0.12  # naive test: far above the nominal 5%
    assert corrected_rate < 0.08  # close to the nominal 5%
    # After false-discovery control almost nothing survives.
    adjusted = trend.fdr_adjust([r.p for r in results])
    assert (adjusted < 0.05).mean() < 0.01


def test_linear_trend_agrees_with_mann_kendall():
    rng = np.random.default_rng(5)
    t = np.arange(360) / 12.0
    x = 0.2 * t + ar1_noise(rng, 360, 0.3)
    lin = trend.linear_trend(x, t)
    mk = trend.mann_kendall(x, t)
    assert lin.slope == pytest.approx(mk.slope, abs=0.03)
    assert lin.slope_low < 0.2 < lin.slope_high
    assert lin.n_effective < 360


def test_monthly_anomalies_remove_the_seasonal_cycle():
    years = np.repeat(np.arange(1981, 2026), 12)
    months = np.tile(np.arange(1, 13), 45)
    seasonal = 10 * np.sin(2 * np.pi * months / 12)
    anomalies, clim = trend.monthly_anomalies(20 + seasonal, years, months)
    assert np.allclose(anomalies, 0)
    assert clim.shape == (12,)


def test_fdr_adjust_passes_nan_through():
    out = trend.fdr_adjust([0.001, np.nan, 0.5])
    assert np.isnan(out[1])
    assert out[0] < 0.05 < out[2]


def test_signal_to_noise():
    years = np.arange(1981, 2026)
    rng = np.random.default_rng(6)
    annual = 0.05 * (years - 1981) + rng.standard_normal(45) * 0.5
    snr = trend.signal_to_noise(0.05 * 44, annual, years)
    assert snr == pytest.approx(4.4, rel=0.35)
