"""Regions to average over: the whole world, named regions, countries,
continents, or a box the user draws.

A region string identifies one:
    world
    preset:arctic
    country:KEN            (three-letter code from Natural Earth)
    continent:Africa
    box:south,west,north,east      (degrees; west may be greater than east across the date line)

Country outlines are Natural Earth 1:110m (public domain). River basins are
not included: there is no small, openly licensed basin file to ship.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

import httpx
import numpy as np
from PIL import Image, ImageDraw

from .sources.cache import cached_text

COUNTRIES_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
                 "ne_110m_admin_0_countries.geojson")


@dataclass(frozen=True)
class Preset:
    id: str
    name: str
    south: float
    west: float
    north: float
    east: float
    about: str


PRESETS: tuple[Preset, ...] = (
    Preset("arctic", "The Arctic", 66.5, -180, 90, 180, "Everything north of the Arctic Circle."),
    Preset("southern_ocean", "The Southern Ocean", -65, -180, -50, 180, "The belt of ocean around Antarctica."),
    Preset("tropics", "The tropics", -23.5, -180, 23.5, 180, "Between the Tropics of Cancer and Capricorn."),
    Preset("sahel", "The Sahel", 12, -17, 18, 38, "The dry belt along the southern edge of the Sahara."),
    Preset("amazon", "The Amazon basin", -12, -75, 2, -50, "The world's largest rainforest."),
    Preset("mediterranean", "The Mediterranean", 30, -10, 46, 37, "The sea and the lands around it."),
    Preset("south_asia", "South Asia", 8, 68, 30, 90, "The Indian monsoon region."),
    Preset("great_plains", "The US Great Plains", 33, -104, 49, -95, "North America's grain belt."),
    Preset("siberia", "Siberia", 55, 60, 72, 140, "Northern Asia's forest and tundra."),
    Preset("tibet", "The Tibetan Plateau", 28, 78, 38, 102, "Asia's high-altitude water tower."),
    Preset("equatorial_pacific", "The equatorial Pacific", -5, -170, 5, -120, "The home of El Niño (the Niño 3.4 box)."),
    Preset("southern_africa", "Southern Africa", -35, 12, -15, 40, "Africa south of the Zambezi."),
    Preset("australia_interior", "The Australian interior", -30, 120, -20, 145, "The arid centre of Australia."),
)
PRESET_BY_ID = {p.id: p for p in PRESETS}


def _fetch(url: str) -> str:
    response = httpx.get(url, timeout=120.0, follow_redirects=True)
    response.raise_for_status()
    return response.text


@lru_cache(maxsize=1)
def countries_geojson() -> dict:
    """Country outlines with only the properties the app needs."""
    doc = json.loads(cached_text("rivers", "ne_110m_countries.geojson", lambda: _fetch(COUNTRIES_URL), max_age_days=365))
    features = []
    for f in doc["features"]:
        p = f["properties"]
        if not f.get("geometry"):
            continue
        features.append({"type": "Feature", "geometry": f["geometry"],
                         "properties": {"code": p["ADM0_A3"], "name": p["ADMIN"], "continent": p["CONTINENT"]}})
    return {"type": "FeatureCollection", "features": features}


@lru_cache(maxsize=1)
def _country_index() -> dict[str, dict]:
    return {f["properties"]["code"]: f for f in countries_geojson()["features"]}


def country_list() -> list[dict]:
    rows = [{"code": f["properties"]["code"], "name": f["properties"]["name"], "continent": f["properties"]["continent"]}
            for f in countries_geojson()["features"]]
    return sorted(rows, key=lambda r: r["name"])


def continents() -> list[str]:
    names = {f["properties"]["continent"] for f in countries_geojson()["features"]}
    return sorted(n for n in names if n not in ("Seven seas (open ocean)",))


def _polygons(geometry: dict) -> list[list]:
    return geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]


def _raster(features: list[dict], lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """True for grid cells whose centre lies inside any of the features."""
    scale = 4  # draw at 4x the grid, then take cell centres: smoother coastlines
    nlat, nlon = lats.size, lons.size
    dlat, dlon = lats[1] - lats[0], lons[1] - lons[0]
    image = Image.new("L", (nlon * scale, nlat * scale), 0)
    draw = ImageDraw.Draw(image)

    def xy(ring):
        ring = np.asarray(ring, dtype=float)
        x = (ring[:, 0] - (lons[0] - dlon / 2)) / dlon * scale
        y = (ring[:, 1] - (lats[0] - dlat / 2)) / dlat * scale
        return list(zip(x.tolist(), y.tolist()))

    for feature in features:
        for polygon in _polygons(feature["geometry"]):
            if len(polygon[0]) >= 3:
                draw.polygon(xy(polygon[0]), fill=1)
            for hole in polygon[1:]:
                if len(hole) >= 3:
                    draw.polygon(xy(hole), fill=0)
    fine = np.asarray(image, dtype=bool)
    centre = scale // 2
    return fine[centre::scale, centre::scale][:nlat, :nlon]


def _box(south, west, north, east, lats, lons) -> np.ndarray:
    lat_ok = (lats >= min(south, north)) & (lats <= max(south, north))
    if west <= east:
        lon_ok = (lons >= west) & (lons <= east)
    else:  # crosses the date line
        lon_ok = (lons >= west) | (lons <= east)
    return lat_ok[:, None] & lon_ok[None, :]


def parse(region: str) -> dict:
    """Validate a region string and describe it. Raises ValueError if it is not understood."""
    kind, _, rest = region.partition(":")
    if region == "world":
        return {"id": "world", "kind": "world", "name": "The whole world", "bounds": [-90, -180, 90, 180]}
    if kind == "preset" and rest in PRESET_BY_ID:
        p = PRESET_BY_ID[rest]
        return {"id": region, "kind": "preset", "name": p.name, "about": p.about,
                "bounds": [p.south, p.west, p.north, p.east]}
    if kind == "country" and rest in _country_index():
        f = _country_index()[rest]
        coords = np.concatenate([np.asarray(poly[0], dtype=float) for poly in _polygons(f["geometry"])])
        return {"id": region, "kind": "country", "name": f["properties"]["name"],
                "bounds": [float(coords[:, 1].min()), float(coords[:, 0].min()),
                           float(coords[:, 1].max()), float(coords[:, 0].max())]}
    if kind == "continent" and rest in continents():
        return {"id": region, "kind": "continent", "name": rest, "bounds": None}
    if kind == "box":
        try:
            south, west, north, east = (float(v) for v in rest.split(","))
        except ValueError as exc:
            raise ValueError("a box needs four numbers: south,west,north,east") from exc
        if not (-90 <= south <= 90 and -90 <= north <= 90 and -180 <= west <= 180 and -180 <= east <= 180):
            raise ValueError("box coordinates are out of range")
        if abs(north - south) < 1 or (abs(east - west) < 1 and west <= east):
            raise ValueError("a box must be at least 1 degree on each side")
        south, north = min(south, north), max(south, north)
        ns = lambda v, pos, neg: f"{abs(v):.0f}°{pos if v >= 0 else neg}"  # noqa: E731
        return {"id": f"box:{south:g},{west:g},{north:g},{east:g}", "kind": "box",
                "name": f"Box {ns(south, 'N', 'S')}–{ns(north, 'N', 'S')}, {ns(west, 'E', 'W')}–{ns(east, 'E', 'W')}",
                "bounds": [south, west, north, east]}
    raise ValueError(f"unknown region: {region}")


@lru_cache(maxsize=256)
def _mask_cached(region: str, shape_key: tuple) -> np.ndarray:
    lats = np.linspace(shape_key[0], shape_key[1], shape_key[2])
    lons = np.linspace(shape_key[3], shape_key[4], shape_key[5])
    info = parse(region)
    kind = info["kind"]
    if kind == "world":
        return np.ones((lats.size, lons.size), dtype=bool)
    if kind in ("preset", "box"):
        return _box(*info["bounds"], lats, lons)
    code = region.partition(":")[2]
    if kind == "country":
        return _raster([_country_index()[code]], lats, lons)
    return _raster([f for f in countries_geojson()["features"] if f["properties"]["continent"] == code], lats, lons)


def mask(region: str, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Boolean grid mask for a region on a regular lat/lon grid."""
    key = (float(lats[0]), float(lats[-1]), int(lats.size), float(lons[0]), float(lons[-1]), int(lons.size))
    return _mask_cached(region, key)


def area_mean(data: np.ndarray, region_mask: np.ndarray, lats: np.ndarray) -> tuple[np.ndarray, int]:
    """Area-weighted mean of each time slice over the masked cells.

    Cells shrink toward the poles, so each is weighted by the cosine of its
    latitude. Cells with no data in a given year are left out of that year.
    Returns (series, number of cells that ever had data).
    """
    rows, cols = np.nonzero(region_mask)
    if rows.size == 0:
        return np.full(data.shape[0], np.nan), 0
    r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    block = np.asarray(data[:, r0:r1, c0:c1], dtype=np.float64)
    inside = region_mask[r0:r1, c0:c1]
    weights = np.cos(np.radians(lats[r0:r1]))[:, None] * inside
    valid = np.isfinite(block) & inside[None, :, :]
    w = np.where(valid, weights[None, :, :], 0.0)
    total = w.sum(axis=(1, 2))
    with np.errstate(invalid="ignore", divide="ignore"):
        series = np.where(total > 0, (np.where(valid, block, 0.0) * w).sum(axis=(1, 2)) / total, np.nan)
    return series, int(valid.any(axis=0).sum())


def catalogue() -> dict:
    """Everything the region picker needs."""
    return {
        "presets": [{"id": f"preset:{p.id}", "name": p.name, "about": p.about} for p in PRESETS],
        "continents": [{"id": f"continent:{c}", "name": c} for c in continents()],
        "countries": [{"id": f"country:{c['code']}", "name": c["name"], "continent": c["continent"]} for c in country_list()],
    }
