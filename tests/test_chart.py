"""End-to-end checks against the live NASA POWER API."""

import json

import pytest

from canary.chart import place_chart

pytestmark = pytest.mark.network


@pytest.fixture(scope="module")
def svalbard():
    return place_chart(78.2, 15.6)


def test_chart_is_valid_json_with_expected_shape(svalbard):
    json.dumps(svalbard, allow_nan=False)  # no NaN leaks into the response
    assert svalbard["condition"]["level"] in {"stable", "watch", "serious", "critical"}
    ids = [v["id"] for v in svalbard["vitals"]]
    assert "temperature" in ids and "snow" in ids
    for v in svalbard["vitals"]:
        assert len(v["years"]) == len(v["annual_anomaly"]) == len(v["annual_mean"])
        t = v["trend"]
        assert t["ci_per_decade"][0] <= t["slope_per_decade"] <= t["ci_per_decade"][1]
        assert 0 <= t["p"] <= t["p_fdr"] <= 1


def test_arctic_warming_is_detected(svalbard):
    temperature = next(v for v in svalbard["vitals"] if v["id"] == "temperature")
    assert temperature["trend"]["significant"]
    assert temperature["trend"]["slope_per_decade"] > 0.3  # deg C per decade
    assert temperature["status"] in {"emerged", "extreme"}


def test_spliced_satellite_era_is_excluded(svalbard):
    cloud = next(v for v in svalbard["vitals"] if v["id"] == "cloud")
    assert cloud["period"][0] == 2001


def test_equatorial_pacific_follows_el_nino():
    chart = place_chart(0.0, -150.0)
    temperature = next(v for v in chart["vitals"] if v["id"] == "temperature")
    enso = next(s for s in temperature["suspects"] if s["id"] == "enso")
    assert enso["r"] > 0.8
    # Ocean point: land-only vital signs are absent.
    assert "soil_wetness" not in [v["id"] for v in chart["vitals"]]
