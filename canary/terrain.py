"""Terrain and water flow: the shape of the land at a place, and where a
raindrop that falls there would go.

Elevation comes from the Terrain Tiles open dataset on AWS (Mapzen
"terrarium" encoding), which blends NASA SRTM, GMTED, ETOPO1 bathymetry and
national lidar surveys. No login.

Water routing uses Priority-Flood (Barnes, Lehman & Mulla 2014, Computers &
Geosciences 62): water is let in from the sea and from the edge of the map
window and rises; each cell records the neighbour through which it was first
reached, which is its downhill exit even across pits and flats. Following
those pointers from a cell gives the raindrop's path; counting how many cells
drain through each cell gives the stream network.

The path is traced at three scales (about 150 m, 1.2 km and 10 km cells),
switching to the next when it leaves the window. Coarse elevation averages
away the gorges that big rivers cut through mountains, so at the two coarser
scales the mapped river network (Natural Earth, public domain) is "burned"
into the terrain first: river cells are lowered so that routed water follows
the real channel. This is the standard stream-burning technique.

The result ignores dams, canals, underground flow and evaporation, and small
rivers missing from the mapped network can still be misrouted. Treat it as an
informed sketch, not a survey.
"""

from __future__ import annotations

import base64
import heapq
import io
import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import httpx
import numpy as np
from numba import njit
from PIL import Image, ImageDraw
from scipy import ndimage

from .sources.cache import CACHE_DIR, cached_text

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TILE = 256
EARTH_CIRCUMFERENCE = 40075016.686
LEVELS = (10, 7, 4)  # zoom levels for the raindrop trace, fine to coarse
WINDOW = 3  # tiles per side
STREAM_SHARE = 0.002  # a cell is a "stream" if this share of the window drains through it
RIVERS_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
              "ne_10m_rivers_lake_centerlines.geojson")
LAND_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
            "ne_50m_land.geojson")
BURN_LEVELS = (7, 4)  # zoom levels at which mapped rivers are burned in
POOL_LEVELS = (7, 4)  # built from tiles two zooms finer, keeping valley floors
POOL_FACTOR = 4
BURN_DEPTH = 1000.0  # metres
# With rivers burned in, a route that can only continue by ponding water this
# deep (metres above the real ground) has entered a closed basin.
BASIN_DEPTH = 200.0
# A route that follows a mapped river to its end and then needs this much
# ponding to continue has reached a terminal lake.
TERMINAL_DEPTH = 20.0
TERMINAL_RUN = 25  # cells travelled off the mapped network before it counts


# ---------- tiles ----------

def _tile_path(z: int, x: int, y: int):
    return CACHE_DIR / "terrain" / str(z) / str(x) / f"{y}.png"


_client = httpx.Client(timeout=30.0, limits=httpx.Limits(max_connections=16))


def _download(url: str, attempts: int = 4) -> bytes:
    """Fetch with retries: dropped connections are common under parallel load."""
    for attempt in range(attempts):
        try:
            response = _client.get(url)
            response.raise_for_status()
            return response.content
        except (httpx.TransportError, httpx.HTTPStatusError):
            if attempt == attempts - 1:
                raise
            time.sleep(0.4 * (attempt + 1))
    raise AssertionError("unreachable")


def fetch_tile(z: int, x: int, y: int) -> np.ndarray:
    """Elevation in metres for one tile; NaN beyond the poles."""
    n = 2**z
    if not 0 <= y < n:
        return np.full((TILE, TILE), np.nan, dtype=np.float32)
    x %= n
    path = _tile_path(z, x, y)
    if path.exists():
        raw = path.read_bytes()
    else:
        raw = _download(TILE_URL.format(z=z, x=x, y=y))
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
        tmp.write_bytes(raw)
        tmp.replace(path)
    rgb = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float32)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


def lonlat_to_pixel(lon: float, lat: float, z: int) -> tuple[float, float]:
    """Global pixel coordinates (x right, y down) in Web Mercator at zoom z."""
    size = TILE * 2**z
    lat = max(min(lat, 85.05), -85.05)
    x = (lon + 180.0) / 360.0 * size
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * size
    return x, y


def pixel_to_lonlat(x, y, z: int):
    size = TILE * 2**z
    lon = np.asarray(x) / size * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * np.asarray(y) / size))))
    return lon, lat


class Window:
    """A square mosaic of elevation tiles centred on a point."""

    def __init__(self, lon: float, lat: float, z: int, tiles: int = WINDOW, pool: int = 1):
        """`pool` > 1 builds the window from finer tiles and keeps the LOWEST
        elevation in each block, so that narrow valleys and gorges survive the
        coarsening (plain averaging turns a gorge into a dam)."""
        self.z = z
        px, py = lonlat_to_pixel(lon, lat, z)
        half = tiles // 2
        self.tx0 = int(px // TILE) - half
        self.ty0 = int(py // TILE) - half
        fine_z = z + int(math.log2(pool))
        side = tiles * pool
        coords = [(self.tx0 * pool + i, self.ty0 * pool + j) for j in range(side) for i in range(side)]
        with ThreadPoolExecutor(max_workers=16) as workers:
            parts = list(workers.map(lambda c: fetch_tile(fine_z, c[0], c[1]), coords))
        rows = [np.hstack(parts[j * side: (j + 1) * side]) for j in range(side)]
        elev = np.vstack(rows)
        if pool > 1:
            n = tiles * TILE
            blocks = elev.reshape(n, pool, n, pool)
            with np.errstate(all="ignore"):
                elev = np.where(np.isnan(blocks).all(axis=(1, 3)), np.nan, np.nanmin(blocks, axis=(1, 3)))
        self.elev = elev.astype(np.float32)
        self.col = int(px - self.tx0 * TILE)
        self.row = int(py - self.ty0 * TILE)
        self.cell_m = EARTH_CIRCUMFERENCE * math.cos(math.radians(lat)) / (TILE * 2**z)

    def lonlat(self, rows, cols):
        """Longitude and latitude of cell centres."""
        return pixel_to_lonlat(self.tx0 * TILE + np.asarray(cols) + 0.5,
                               self.ty0 * TILE + np.asarray(rows) + 0.5, self.z)

    def bounds(self) -> list[list[float]]:
        """Corner coordinates (NW, NE, SE, SW) for a MapLibre image source."""
        n = self.elev.shape[0]
        (w, e), (north, south) = pixel_to_lonlat(
            [self.tx0 * TILE, self.tx0 * TILE + n], [self.ty0 * TILE, self.ty0 * TILE + n], self.z)
        return [[float(w), float(north)], [float(e), float(north)], [float(e), float(south)], [float(w), float(south)]]


# ---------- cleaning ----------

def clean(elev: np.ndarray, land: np.ndarray) -> np.ndarray:
    """Repair junk values found over inland water in the source tiles:
    impossible depths on land, and single-cell pits."""
    e = elev.copy()
    # Negative elevations inside the coastline are almost always junk over
    # rivers and lakes. Real land below sea level (Death Valley, the Dead Sea
    # shore) is flattened to zero too, a small price for sound rivers.
    with np.errstate(invalid="ignore"):
        e[land & (e < 0)] = 0.0
    ring = np.ones((3, 3), dtype=bool)
    ring[1, 1] = False
    lowest_neighbour = ndimage.minimum_filter(e, footprint=ring, mode="nearest")
    pit = e < lowest_neighbour - 25.0
    e[pit] = lowest_neighbour[pit]
    return e


# ---------- land and sea ----------

def _fetch(url: str) -> str:
    response = httpx.get(url, timeout=120.0, follow_redirects=True)
    response.raise_for_status()
    return response.text


@lru_cache(maxsize=1)
def land_polygons() -> list[list[np.ndarray]]:
    """Natural Earth land as [exterior ring, hole, hole, ...] lon/lat arrays.
    Inland seas such as the Caspian are holes, so they count as sea."""
    doc = json.loads(cached_text("rivers", "ne_50m_land.geojson", lambda: _fetch(LAND_URL), max_age_days=365))
    out = []
    for feature in doc["features"]:
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        out.extend([[np.asarray(ring, dtype=float)[:, :2] for ring in polygon] for polygon in polygons])
    return out


def land_mask(window: "Window") -> np.ndarray:
    """True where the window is land according to the mapped coastline."""
    n = window.elev.shape[0]
    world = TILE * 2**window.z
    image = Image.new("L", (n, n), 0)
    draw = ImageDraw.Draw(image)

    def project(ring, shift):
        lat = np.clip(ring[:, 1], -85.05, 85.05)
        col = (ring[:, 0] + 180.0) / 360.0 * world - window.tx0 * TILE + shift
        row = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * world - window.ty0 * TILE
        return col, row

    for rings in land_polygons():
        for shift in (-world, 0, world):  # the window may straddle the antimeridian
            col, row = project(rings[0], shift)
            if col.max() < 0 or col.min() >= n or row.max() < 0 or row.min() >= n:
                continue
            draw.polygon(list(zip(col.tolist(), row.tolist())), fill=1)
            for hole in rings[1:]:
                hc, hr = project(hole, shift)
                draw.polygon(list(zip(hc.tolist(), hr.tolist())), fill=0)
    return np.asarray(image, dtype=bool)


def sea_mask(ground: np.ndarray, land: np.ndarray, cell_m: float) -> np.ndarray:
    """Sea = outside the mapped coastline, plus below-zero cells within about
    3 km of it (the mapped coastline is only accurate to a few kilometres)."""
    near_coast = ndimage.binary_dilation(~land, iterations=max(int(3000 / cell_m), 2))
    with np.errstate(invalid="ignore"):
        return ~land | ((ground < 0) & near_coast) | np.isnan(ground)


# ---------- mapped rivers ----------

@lru_cache(maxsize=1)
def rivers() -> list[tuple[str, list[np.ndarray]]]:
    """Natural Earth river and lake centrelines as (name, [lon/lat arrays])."""
    doc = json.loads(cached_text("rivers", "ne_10m_rivers.geojson", lambda: _fetch(RIVERS_URL), max_age_days=365))
    out = []
    for feature in doc["features"]:
        geometry = feature.get("geometry")
        if not geometry:
            continue
        lines = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
        props = feature["properties"]
        name = props.get("name_en") or props.get("name") or ""
        out.append((name, [np.asarray(line, dtype=float)[:, :2] for line in lines if len(line) > 1]))
    return out


def rasterize_rivers(window: "Window") -> np.ndarray:
    """Grid of river indices (-1 where there is no mapped river)."""
    n = window.elev.shape[0]
    world = TILE * 2**window.z
    grid = np.full((n, n), -1, dtype=np.int32)
    for index, (_, lines) in enumerate(rivers()):
        for line in lines:
            lat = np.clip(line[:, 1], -85.05, 85.05)
            px = (line[:, 0] + 180.0) / 360.0 * world
            py = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * world
            col = (px - window.tx0 * TILE) % world
            row = py - window.ty0 * TILE
            if col.max() < 0 or col.min() >= n or row.max() < 0 or row.min() >= n:
                continue
            for k in range(col.size - 1):
                dc, dr = col[k + 1] - col[k], row[k + 1] - row[k]
                if abs(dc) > world / 2:
                    continue  # segment crosses the antimeridian
                steps = int(max(abs(dc), abs(dr)) * 2) + 2
                cc = np.linspace(col[k], col[k + 1], steps).astype(int)
                rr = np.linspace(row[k], row[k + 1], steps).astype(int)
                ok = (cc >= 0) & (cc < n) & (rr >= 0) & (rr < n)
                grid[rr[ok], cc[ok]] = index
    return grid


# ---------- flow routing ----------

@njit(cache=True)
def priority_flood(elev, sea, seed_level):
    """Priority-Flood with flow directions.

    Outlets are the window edge and the cells marked `sea`; each starts at
    `seed_level`. Edge cells start at the real ground, not their burned-in
    elevation: otherwise the point where a river ENTERS the window would look
    like a drain and pull water upstream. Sea cells start below every burned
    channel, so that water climbs each river in order of real elevation and
    two river mouths cannot steal each other's basins.

    Returns (parent, order, filled): `parent[i]` is the flat index of the cell
    that cell i drains to (-1 for outlets: the window edge, the sea, or
    missing data); `order` lists cells from outlets inland; `filled` is the
    water-surface elevation after pits are filled. Ties are broken first-in,
    first-out so that water crosses flats by the shortest way.
    """
    rows, cols = elev.shape
    n = rows * cols
    parent = np.full(n, -1, dtype=np.int32)
    filled = np.empty(n, dtype=np.float32)
    seen = np.zeros(n, dtype=np.bool_)
    order = np.empty(n, dtype=np.int32)
    heap = [(np.float32(0.0), np.int64(0), np.int32(0))]
    heap.pop()
    seq = 0
    for r in range(rows):
        for c in range(cols):
            e = elev[r, c]
            edge = r == 0 or c == 0 or r == rows - 1 or c == cols - 1
            if edge or sea[r, c] or np.isnan(e):
                i = r * cols + c
                seen[i] = True
                level = seed_level[r, c]
                filled[i] = level if not np.isnan(level) else np.float32(0.0)
                heapq.heappush(heap, (filled[i], np.int64(seq), np.int32(i)))
                seq += 1
    k = 0
    while len(heap) > 0:
        level, _, i = heapq.heappop(heap)
        order[k] = i
        k += 1
        r, c = i // cols, i % cols
        for dr in range(-1, 2):
            for dc in range(-1, 2):
                if dr == 0 and dc == 0:
                    continue
                rr, cc = r + dr, c + dc
                if rr < 0 or cc < 0 or rr >= rows or cc >= cols:
                    continue
                j = rr * cols + cc
                if seen[j]:
                    continue
                seen[j] = True
                parent[j] = i
                filled[j] = max(elev[rr, cc], level)
                heapq.heappush(heap, (filled[j], np.int64(seq), np.int32(j)))
                seq += 1
    return parent, order[:k], filled


@njit(cache=True)
def flow_accumulation(parent, order):
    """Number of cells draining through each cell (itself included)."""
    acc = np.ones(parent.size, dtype=np.int32)
    for k in range(order.size - 1, -1, -1):
        i = order[k]
        p = parent[i]
        if p >= 0:
            acc[p] += acc[i]
    return acc


@njit(cache=True)
def trace(parent, start):
    path = [start]
    i = start
    while parent[i] >= 0:
        i = parent[i]
        path.append(i)
    return np.array(path, dtype=np.int32)


def haversine_km(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(np.radians, (lon1, lat1, lon2, lat2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(a))


def _thin(n: int, target: int) -> np.ndarray:
    """Indices that keep about `target` evenly spaced points, always including the ends."""
    if n <= target:
        return np.arange(n)
    return np.unique(np.round(np.linspace(0, n - 1, target)).astype(int))


# ---------- analysis ----------

def _shape(window: Window) -> dict:
    """Elevation, slope, aspect and relief at the window's centre point."""
    e = window.elev
    r, c = window.row, window.col
    r, c = min(max(r, 1), e.shape[0] - 2), min(max(c, 1), e.shape[1] - 2)
    # Horn's method on the 3 x 3 neighbourhood.
    z = e[r - 1: r + 2, c - 1: c + 2].astype(float)
    dzdx = ((z[0, 2] + 2 * z[1, 2] + z[2, 2]) - (z[0, 0] + 2 * z[1, 0] + z[2, 0])) / (8 * window.cell_m)
    dzdy = ((z[2, 0] + 2 * z[2, 1] + z[2, 2]) - (z[0, 0] + 2 * z[0, 1] + z[0, 2])) / (8 * window.cell_m)
    slope = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    # Compass direction the slope faces (downhill), clockwise from north.
    aspect = (math.degrees(math.atan2(-dzdx, dzdy)) + 360) % 360 if slope > 0.5 else None

    radius = max(int(round(10_000 / window.cell_m)), 3)
    rr, cc = np.ogrid[:e.shape[0], :e.shape[1]]
    disc = e[((rr - r) ** 2 + (cc - c) ** 2) <= radius**2]
    disc = disc[np.isfinite(disc)]
    here = float(e[r, c])
    return {
        "elevation_m": round(here, 1),
        "slope_deg": round(slope, 1),
        "aspect_deg": None if aspect is None else round(aspect),
        "relief_10km_m": round(float(disc.max() - disc.min())),
        "lowest_10km_m": round(float(disc.min())),
        "highest_10km_m": round(float(disc.max())),
        # Share of the surrounding 10 km that lies below this point.
        "height_rank_percent": round(100 * float((disc < here).mean())),
        "cell_m": round(window.cell_m),
    }


def _drainage_image(acc: np.ndarray, shape: tuple[int, int]) -> str | None:
    """Stream network as a transparent PNG (data URL): brighter and more
    opaque where more land drains through."""
    acc = acc.reshape(shape)
    threshold = max(int(acc.size * STREAM_SHARE), 50)
    stream = acc >= threshold
    if not stream.any():
        return None
    strength = np.clip(np.log(acc / threshold + 1e-9) / math.log(max(acc.max() / threshold, 2.0)), 0, 1)
    rgba = np.zeros(shape + (4,), dtype=np.uint8)
    rgba[..., 0] = (80 + 110 * strength).astype(np.uint8)
    rgba[..., 1] = (170 + 70 * strength).astype(np.uint8)
    rgba[..., 2] = 255
    rgba[..., 3] = np.where(stream, (120 + 135 * strength).astype(np.uint8), 0)
    buffer = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def analyse(lat: float, lon: float) -> dict:
    """Terrain shape, local stream network and the raindrop's path from a point."""
    lon = ((lon + 180) % 360) - 180
    local = Window(lon, lat, LEVELS[0])
    shape = _shape(local)
    result = {
        "place": {"lat": lat, "lon": lon},
        "shape": shape,
        "source": "Terrain Tiles on AWS (NASA SRTM, GMTED2010, ETOPO1 and national surveys)",
        "method": "Priority-Flood flow routing on elevation at about 150 m, 1.2 km and 10 km cells, "
                  "with mapped rivers burned in and valley floors kept at the two coarser scales.",
        "caveat": "An informed sketch, not a survey: it ignores dams, canals, underground flow and "
                  "evaporation, and small rivers missing from the mapped network can be misrouted.",
        "drainage": None,
        "raindrop": None,
    }
    if not np.isfinite(local.elev[local.row, local.col]):
        result["raindrop"] = {"outcome": "water", "summary": "No elevation data here."}
        return result

    lons, lats, heights = [], [], []
    cur_lon, cur_lat = lon, lat
    outcome = "edge"
    scales = []
    via: list[str] = []
    for level_index, z in enumerate(LEVELS):
        if level_index == 0:
            window = local
        else:
            window = Window(cur_lon, cur_lat, z, pool=POOL_FACTOR if z in POOL_LEVELS else 1)
        land = land_mask(window)
        ground = clean(window.elev, land).astype(np.float32)
        sea = sea_mask(ground, land, window.cell_m)
        if level_index == 0 and sea[window.row, window.col]:
            result["raindrop"] = {"outcome": "water", "summary": "This point is in the sea."}
            return result
        routed = ground
        river_grid = None
        if z in BURN_LEVELS:
            river_grid = rasterize_rivers(window)
            burned = river_grid >= 0
            # Mapped rivers often stop short of the mapped coast, in a delta or
            # estuary. Bridge that gap across low ground, or the river would not
            # connect to its own mouth and another river could capture it.
            reach = 30 if z >= 7 else 6
            burned |= (ndimage.binary_dilation(burned, iterations=reach)
                       & ndimage.binary_dilation(sea, iterations=reach) & ~sea & (ground < 20.0))
            routed = np.where(burned, ground - BURN_DEPTH, ground).astype(np.float32)
        seed = ground.copy()
        seed[sea] = -BURN_DEPTH - 10.0 if river_grid is not None else np.minimum(ground[sea], 0.0)
        parent, order, filled = priority_flood(np.ascontiguousarray(routed), sea, seed)
        width = ground.shape[1]
        start = window.row * width + window.col
        cells = trace(parent, start)

        basin = False
        if river_grid is not None:
            # Ponding depth, judged off the mapped network only (inside a burned
            # channel the fill level means nothing) and against smoothed ground
            # so that a stray low cell cannot fake a deep pond.
            smooth = ndimage.median_filter(ground, size=3, mode="nearest").ravel()
            on_river = river_grid.ravel()[cells] >= 0
            depth = np.where(on_river, 0.0, filled[cells] - smooth[cells])
            cut = None
            # Walk the route in runs of on-river / off-river cells. Short hops
            # off the mapped line (it is drawn a little to one side of the real
            # channel) are ignored; only a sustained stretch can be a basin.
            river_cells, k = 0, 0
            while k < cells.size and cut is None:
                if on_river[k]:
                    river_cells += 1
                    k += 1
                    continue
                run_end = k
                while run_end < cells.size and not on_river[run_end]:
                    run_end += 1
                if run_end - k >= TERMINAL_RUN:
                    deep = np.flatnonzero(depth[k:run_end] >= BASIN_DEPTH)
                    if deep.size:
                        cut = k + int(deep[0])  # a closed basin
                    elif river_cells >= 20 and (depth[k:run_end] >= TERMINAL_DEPTH).any():
                        cut = k  # a mapped river ended in a lake with no outlet
                k = run_end
            if cut is not None:
                cells = cells[: cut + 1]
                basin = True

        if river_grid is not None:
            # Name the mapped rivers the route follows, in order.
            ids = river_grid.ravel()[cells]
            names = rivers()
            run_id, run_len = -1, 0
            for rid in ids:
                run_len = run_len + 1 if rid == run_id else 1
                run_id = rid
                if rid >= 0 and run_len == (8 if z >= 7 else 3) and names[rid][0] and names[rid][0] not in via:
                    via.append(names[rid][0])

        rows, cols = cells // width, cells % width
        plon, plat = window.lonlat(rows, cols)
        keep = _thin(cells.size, 400)
        # Skip the first point of later scales: it repeats the previous exit.
        keep = keep[1:] if level_index and keep.size > 1 else keep
        surface = filled[cells]
        if river_grid is not None:
            # In a burned channel the fill level is meaningless; use the real ground.
            on_river = river_grid.ravel()[cells] >= 0
            surface = np.where(on_river, ground.ravel()[cells], surface)
        lons.extend(plon[keep].tolist())
        lats.extend(plat[keep].tolist())
        heights.extend(np.maximum(surface[keep], 0).tolist())
        scales.append({"zoom": z, "cell_m": round(window.cell_m), "points": int(cells.size)})

        if level_index == 0:
            acc = flow_accumulation(parent, order)
            result["drainage"] = {
                "image": _drainage_image(acc, ground.shape),
                "coordinates": window.bounds(),
                # A lower bound: only land inside the window is counted.
                "upstream_km2": round(float(acc[start]) * (window.cell_m / 1000) ** 2, 1),
                "window_km": round(width * window.cell_m / 1000),
            }

        cur_lon, cur_lat = float(plon[-1]), float(plat[-1])
        if basin:
            outcome = "basin"
            break
        if sea.ravel()[cells[-1]] or np.isnan(ground.ravel()[cells[-1]]):
            outcome = "sea"
            break

    lons, lats, heights = np.array(lons), np.array(lats), np.array(heights)
    # The water surface can only go down; smooth out scale-change steps.
    heights = np.minimum.accumulate(heights)
    step = haversine_km(lons[:-1], lats[:-1], lons[1:], lats[1:]) if lons.size > 1 else np.array([])
    distance = np.concatenate([[0.0], np.cumsum(step)])
    total_km = float(distance[-1])
    drop = float(heights[0] - heights[-1])
    if outcome == "sea":
        summary = (f"A raindrop falling here travels about {total_km:,.0f} km downhill and drops "
                   f"{drop:,.0f} m before it reaches sea level.")
    elif outcome == "basin":
        summary = (f"A raindrop falling here travels about {total_km:,.0f} km and drops {drop:,.0f} m, then "
                   "stops in a closed basin: a low area with no outlet, where water collects, sinks in or "
                   "evaporates instead of reaching the sea.")
    else:
        summary = (f"A raindrop falling here was followed for {total_km:,.0f} km and {drop:,.0f} m of descent; "
                   "its route continues beyond the mapped window.")
    result["raindrop"] = {
        "outcome": outcome,
        "summary": summary,
        "distance_km": round(total_km, 1),
        "drop_m": round(drop),
        "end": {"lat": round(float(lats[-1]), 3), "lon": round(float(lons[-1]), 3)},
        "path": {"type": "Feature", "properties": {},
                 "geometry": {"type": "LineString",
                              "coordinates": [[round(a, 4), round(b, 4)] for a, b in zip(lons.tolist(), lats.tolist())]}},
        "profile": {"distance_km": [round(float(d), 2) for d in distance],
                    "elevation_m": [round(float(h), 1) for h in heights]},
        "via": via,
        "scales": scales,
    }
    return result
