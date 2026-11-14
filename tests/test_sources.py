import numpy as np

from canary.sources import events, geos


def test_parse_opendap_ascii_grid_and_series():
    text = """u10m, [1][2][3]
[0][0], 1.5, 2.5, 3.5
[0][1], -1.0, 0.0, 1e+15

time, [1]
739934.5
lat, [2]
-90.0, 0.0
"""
    out = geos.parse_ascii(text)
    assert out["u10m"].shape == (1, 2, 3)
    assert out["u10m"][0, 1, 0] == -1.0
    assert out["lat"].tolist() == [-90.0, 0.0]
    assert geos._clean(out["u10m"], 1)[-1] is None  # fill value becomes null


def test_eonet_events_become_points_and_tracks():
    doc = {"events": [
        {"title": "Typhoon X", "categories": [{"id": "severeStorms"}], "sources": [{"url": "http://example.org"}],
         "geometry": [{"type": "Point", "coordinates": [150.0, 20.0], "date": "2026-11-10T00:00:00Z"},
                      {"type": "Point", "coordinates": [152.0, 24.0], "date": "2026-11-11T00:00:00Z",
                       "magnitudeValue": 65.0, "magnitudeUnit": "kts"}]},
        {"title": "Fire Y", "categories": [{"id": "wildfires"}], "geometry": [
            {"type": "Point", "coordinates": [-100.0, 40.0], "date": "2026-11-12T00:00:00Z"}]},
        {"title": "No geometry", "categories": [{"id": "floods"}], "geometry": []},
    ]}
    features = events.simplify_eonet(doc)
    kinds = [(f["properties"]["kind"], f["geometry"]["type"]) for f in features]
    assert kinds == [("severeStorms", "Point"), ("severeStorms", "LineString"), ("wildfires", "Point")]
    assert features[0]["geometry"]["coordinates"] == [152.0, 24.0]  # latest position
    assert features[0]["properties"]["magnitude"] == "65 kts"


def test_usgs_quakes():
    doc = {"features": [{"properties": {"mag": 6.1, "title": "M 6.1 - somewhere", "time": 1, "url": "u"},
                         "geometry": {"type": "Point", "coordinates": [10.0, 20.0, 33.0]}}]}
    feature = events.simplify_usgs(doc)[0]
    assert feature["properties"]["magnitude"] == "M 6.1"
    assert feature["properties"]["depth_km"] == 33.0
    assert feature["geometry"]["coordinates"] == [10.0, 20.0]
