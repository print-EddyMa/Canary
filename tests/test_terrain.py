import numpy as np
import pytest

from canary import terrain


def flood(elev, sea=None, seed=None):
    elev = np.ascontiguousarray(elev, dtype=np.float32)
    sea = np.zeros(elev.shape, dtype=bool) if sea is None else sea
    seed = elev.copy() if seed is None else seed
    return terrain.priority_flood(elev, sea, seed)


def test_water_runs_downhill_on_a_tilted_plane():
    rows, cols = 20, 30
    elev = np.tile(np.arange(cols, dtype=float)[::-1], (rows, 1))  # high in the west
    parent, order, filled = flood(elev)
    path = terrain.trace(parent, 10 * cols + 3)
    end_row, end_col = divmod(int(path[-1]), cols)
    assert end_row in (0, rows - 1) or end_col in (0, cols - 1)  # leaves through an edge
    assert end_col > 3  # having moved east, the downhill direction
    assert (np.diff(filled[path]) <= 0).all()  # and never uphill


def test_pits_are_filled_and_still_drain():
    elev = np.full((15, 15), 10.0)
    elev[:, -1] = 0.0  # outlet side
    elev[7, 7] = -50.0  # a deep pit in the middle
    parent, order, filled = flood(elev)
    assert filled[7 * 15 + 7] == pytest.approx(10.0)  # raised to the spill level
    path = terrain.trace(parent, 7 * 15 + 7)
    assert parent[path[-1]] == -1 and path.size > 1


def test_flow_accumulation_counts_every_cell_once():
    rng = np.random.default_rng(0)
    elev = rng.random((25, 25)) * 100
    parent, order, _ = flood(elev)
    acc = terrain.flow_accumulation(parent, order)
    outlets = parent == -1
    assert acc[outlets].sum() == elev.size
    assert acc.min() == 1


def test_sea_cells_are_outlets():
    elev = np.full((11, 11), 5.0)
    elev[5, 5] = 1.0
    sea = np.zeros((11, 11), dtype=bool)
    sea[5, 5] = True
    seed = elev.copy()
    seed[5, 5] = -10.0
    parent, _, _ = flood(elev, sea, seed)
    path = terrain.trace(parent, 5 * 11 + 3)
    assert path[-1] == 5 * 11 + 5


def test_clean_removes_single_cell_pits_and_inland_negatives():
    elev = np.full((9, 9), 100.0, dtype=np.float32)
    elev[4, 4] = 20.0  # stray pit
    elev[2, 2] = -300.0  # junk over a river
    land = np.ones((9, 9), dtype=bool)
    out = terrain.clean(elev, land)
    assert out[4, 4] == 100.0
    assert out[2, 2] >= 0.0


def test_pixel_round_trip():
    x, y = terrain.lonlat_to_pixel(16.37, 48.21, 7)
    lon, lat = terrain.pixel_to_lonlat(x, y, 7)
    assert float(lon) == pytest.approx(16.37, abs=1e-6)
    assert float(lat) == pytest.approx(48.21, abs=1e-6)


def test_haversine():
    assert float(terrain.haversine_km(0, 0, 0, 1)) == pytest.approx(111.2, abs=0.2)


@pytest.mark.network
@pytest.mark.parametrize("name,lat,lon,river,mouth", [
    ("Vienna", 48.21, 16.37, "Danube", (45.2, 29.5)),  # Black Sea, through the Iron Gates
    ("Denver", 39.74, -104.99, "Mississippi", (29.2, -89.5)),
    ("Cusco", -13.53, -71.97, "Amazonas", (0.0, -50.0)),
])
def test_raindrop_reaches_the_right_sea(name, lat, lon, river, mouth):
    drop = terrain.analyse(lat, lon)["raindrop"]
    assert drop["outcome"] == "sea"
    assert river in drop["via"]
    miss = terrain.haversine_km(drop["end"]["lon"], drop["end"]["lat"], mouth[1], mouth[0])
    assert float(miss) < 400


@pytest.mark.network
def test_great_basin_is_closed():
    drop = terrain.analyse(40.76, -111.89)["raindrop"]  # Salt Lake City
    assert drop["outcome"] == "basin"


@pytest.mark.network
def test_open_ocean_point():
    assert terrain.analyse(0.0, -150.0)["raindrop"]["outcome"] == "water"
