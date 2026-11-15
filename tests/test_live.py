"""Weather decoding and live-alert helpers."""

import struct

import numpy as np
import pytest

from canary.sources import alerts, weather


def test_parse_dods_reads_grids_and_skips_maps():
    shape = (2, 3, 4)
    values = np.arange(24, dtype=np.float32)
    body = b"Dataset {...}\nData:\n" + struct.pack(">II", 24, 24) + values.astype(">f4").tobytes()
    for size in shape:  # map vectors follow each array
        body += struct.pack(">II", size, size) + np.zeros(size, dtype=">f8").tobytes()
    out = weather.parse_dods(body, ["cldtot"], shape)
    assert out["cldtot"].shape == shape
    assert out["cldtot"][1, 2, 3] == 23


@pytest.mark.parametrize("name,values", [
    ("cloud", [0, 37.5, 100]), ("temp", [-40, 0.0, 31.2]), ("precip", [0, 0.5, 12.0]), ("u", [-20.5, 0, 17.0])])
def test_weather_encoding_round_trips(name, values):
    v = np.array(values)
    back = weather.decode(name, weather.encode(name, v))
    tolerance = {"cloud": 0.3, "temp": 0.3, "precip": 0.08 * np.maximum(v, 1), "u": 0.3}[name]
    assert np.all(np.abs(back - v) <= tolerance)


@pytest.mark.network
def test_country_at_names_the_country():
    assert alerts.country_at(48.86, 2.35) == "France"
    assert alerts.country_at(0.0, -140.0) == ""
