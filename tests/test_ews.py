import numpy as np

from canary.stats import ews


def simulate(rng, n, phi_start, phi_end):
    """AR(1) process whose memory drifts from phi_start to phi_end."""
    phi = np.linspace(phi_start, phi_end, n)
    x = np.zeros(n)
    for i in range(1, n):
        x[i] = phi[i] * x[i - 1] + rng.standard_normal()
    return x


TIME = 1981 + (np.arange(540) + 0.5) / 12


def test_rolling_indicators_match_direct_computation():
    rng = np.random.default_rng(0)
    x = rng.standard_normal(200)
    w = 50
    ar1 = ews.rolling_ar1(x, w)
    var = ews.rolling_variance(x, w)
    assert ar1.shape == var.shape == (151,)
    for i in (0, 77, 150):
        seg = x[i: i + w]
        assert np.isclose(ar1[i], np.corrcoef(seg[:-1], seg[1:])[0, 1])
        assert np.isclose(var[i], seg.var(ddof=1))


def test_surrogates_preserve_the_spectrum():
    rng = np.random.default_rng(1)
    x = simulate(rng, 512, 0.6, 0.6)
    s = ews.phase_surrogates(x, 5, rng)
    assert s.shape == (5, 512)
    assert np.allclose(np.abs(np.fft.rfft(s - s.mean(axis=1, keepdims=True))),
                       np.abs(np.fft.rfft(x - x.mean())), atol=1e-6)


def test_detects_a_system_losing_stability():
    rng = np.random.default_rng(2)
    x = simulate(rng, 540, 0.1, 0.9)
    result = ews.early_warning(x, TIME, surrogates=300)
    assert result.tau_ar1 > 0.5
    assert result.p_ar1 < 0.05
    assert result.warning


def test_false_alarm_rate_on_stationary_series_is_near_nominal():
    rng = np.random.default_rng(3)
    alarms = 0
    trials = 60
    for _ in range(trials):
        x = simulate(rng, 540, 0.5, 0.5)
        result = ews.early_warning(x, TIME, surrogates=100, seed=int(rng.integers(1e9)))
        alarms += result.warning
    # Nominal rate is at most 5%; allow sampling slack for 60 trials.
    assert alarms / trials <= 0.12


def test_returns_none_for_short_or_gappy_records():
    assert ews.early_warning(np.random.default_rng(4).standard_normal(100), TIME[:100]) is None
    gappy = np.random.default_rng(5).standard_normal(540)
    gappy[100:200] = np.nan
    assert ews.early_warning(gappy, TIME) is None


def test_gaussian_smooth_tolerates_nan():
    x = np.linspace(0, 1, 100)
    x[10] = np.nan
    out = ews.gaussian_smooth(x, 5)
    assert np.isfinite(out).all()
    assert abs(out[50] - x[50]) < 0.01
