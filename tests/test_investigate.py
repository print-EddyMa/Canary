import numpy as np
import pytest

from canary import catalogue, cube, investigate, regions


# ---------- regions ----------

LATS = np.arange(-90, 90.5, 0.5)
LONS = np.arange(-180, 180, 0.625)


def test_catalogue_is_consistent():
    themes = {t[0] for t in catalogue.THEMES}
    ids = [v.id for v in catalogue.VARIABLES]
    assert len(ids) == len(set(ids)) >= 20
    assert all(v.theme in themes and v.definition.endswith(".") for v in catalogue.VARIABLES)
    for _, picks in catalogue.INTERESTS.values():
        assert set(picks) <= set(ids)
    for _, picks, _ in catalogue.PLACE_KINDS.values():
        assert set(picks) <= set(ids)


def test_box_and_preset_masks():
    arctic = regions.mask("preset:arctic", LATS, LONS)
    assert arctic[LATS >= 66.5].all() and not arctic[LATS < 66.5].any()
    box = regions.mask("box:10,170,20,-170", LATS, LONS)  # crosses the date line
    assert box[np.searchsorted(LATS, 15), np.searchsorted(LONS, 175)]
    assert box[np.searchsorted(LATS, 15), np.searchsorted(LONS, -175)]
    assert not box[np.searchsorted(LATS, 15), np.searchsorted(LONS, 0)]
    assert regions.mask("world", LATS, LONS).all()


def test_region_parsing_rejects_nonsense():
    for bad in ("moon", "box:1,2,3", "box:0,0,0.2,0.2", "preset:nowhere", "country:XXX"):
        with pytest.raises(ValueError):
            regions.parse(bad)
    assert regions.parse("box:40,-10,30,5")["bounds"] == [30.0, -10.0, 40.0, 5.0]  # south and north are put in order


def test_area_mean_weights_by_latitude_and_skips_missing_cells():
    lats = np.array([0.0, 60.0])
    data = np.array([[[10.0, 10.0], [20.0, 20.0]],
                     [[10.0, np.nan], [20.0, 20.0]]])
    m = np.ones((2, 2), dtype=bool)
    series, cells = regions.area_mean(data, m, lats)
    # cos(0) = 1, cos(60) = 0.5: the equatorial row counts double.
    assert series[0] == pytest.approx((10 * 2 * 1 + 20 * 2 * 0.5) / (2 + 1))
    assert series[1] == pytest.approx((10 * 1 + 20 * 2 * 0.5) / (1 + 1))
    assert cells == 4
    empty, n = regions.area_mean(data, np.zeros((2, 2), dtype=bool), lats)
    assert n == 0 and np.isnan(empty).all()


@pytest.mark.network
def test_country_masks_land_where_the_country_is():
    kenya = regions.mask("country:KEN", LATS, LONS)
    assert kenya[np.searchsorted(LATS, -1.0), np.searchsorted(LONS, 37.0)]  # near Nairobi
    assert not kenya[np.searchsorted(LATS, 48.0), np.searchsorted(LONS, 2.0)]  # Paris
    assert 100 < kenya.sum() < 400
    africa = regions.mask("continent:Africa", LATS, LONS)
    assert africa.sum() > 20 * kenya.sum()


# ---------- analysis on a synthetic world ----------

@pytest.fixture
def fake_cube(monkeypatch):
    """Temperature that warms in the north and cools in the south, with noise."""
    rng = np.random.default_rng(0)
    years = np.arange(1981, 2026)
    lats = np.arange(-89.0, 90.0, 2.0)
    lons = np.arange(-179.0, 180.0, 2.0)
    slope = np.where(lats > 0, 0.05, -0.05)[None, :, None]
    data = (10 + slope * (years - 1981)[:, None, None]
            + rng.standard_normal((years.size, lats.size, lons.size)) * 0.5).astype(np.float32)
    flat = (10 + rng.standard_normal((years.size, lats.size, lons.size)) * 0.5).astype(np.float32)
    cubes = {"temperature": cube.Cube(years, lats, lons, data), "precipitation": cube.Cube(years, lats, lons, flat)}
    monkeypatch.setattr(cube, "load", lambda vid: cubes[vid])
    monkeypatch.setattr(cube, "ready", lambda vid: vid in cubes)
    monkeypatch.setattr(investigate, "climate_links", lambda series, years: [])
    return cubes


def test_opposite_trends_in_two_regions_and_none_in_their_average(fake_cube):
    north = investigate.analyse("temperature", "box:20,-180,80,180")
    south = investigate.analyse("temperature", "box:-80,-180,-20,180")
    world = investigate.analyse("temperature", "box:-80,-180,80,180")
    assert north["significant"] and north["trend"]["direction"] == "rising"
    assert south["significant"] and south["trend"]["direction"] == "falling"
    assert north["trend"]["per_decade"] == pytest.approx(0.5, abs=0.05)
    lo, hi = north["trend"]["range_per_decade"]
    assert lo < 0.5 < hi
    # The average of the two hides both trends, but the split inside it shows them.
    assert not world["significant"]
    assert world["split"]["rising_percent"] > 30 and world["split"]["falling_percent"] > 30
    assert north["tests"]["agree"] and "Rising by" in north["headline"]


def test_a_flat_series_is_called_not_significant_with_a_plain_explanation(fake_cube):
    a = investigate.analyse("precipitation", "box:-30,-60,30,60")
    assert a["verdict"] == "not_significant"
    assert a["headline"].startswith("No significant trend")
    assert "by chance" in a["detail"]


def test_period_selection_and_too_short_periods(fake_cube):
    a = investigate.analyse("temperature", "box:20,-180,80,180", start=2000, end=2020)
    assert a["period"] == [2000, 2020] and len(a["years"]) == 21
    with pytest.raises(ValueError, match="At least 15 years"):
        investigate.analyse("temperature", "box:20,-180,80,180", start=2015, end=2025)
    with pytest.raises(ValueError, match="unknown variable"):
        investigate.analyse("nonsense", "world")


def test_scan_ranks_trending_variables_first(fake_cube):
    result = investigate.scan("box:20,-180,80,180")
    assert [r["id"] for r in result["variables"]] == ["temperature", "precipitation"]
    assert result["variables"][0]["significant"] and not result["variables"][1]["significant"]
    assert result["still_loading"]  # the rest of the catalogue is not in the fake world


def test_years_needed_grows_as_the_signal_shrinks():
    assert investigate._years_needed(45, 1.0, 2.0) > investigate._years_needed(45, 1.8, 2.0) > 0
    assert investigate._years_needed(45, 0.0, 2.0) is None
    assert investigate._years_needed(45, 0.01, 2.0) is None  # centuries away: no sign of a trend


def test_guide_suggestions():
    picks = investigate.suggest("ice", "mountains")
    assert picks[0]["id"] == "snow" and len({p["id"] for p in picks}) == len(picks) <= 5
    assert investigate.suggest(None, None) == []
    assert all(p["definition"] and p["why"] for p in picks)


def test_chance_wording():
    assert "1 time in 1,000" in investigate._chance(0.0002)
    assert "1 time in 20" in investigate._chance(0.03)
    assert "about 1 time in 4" in investigate._chance(0.25)
