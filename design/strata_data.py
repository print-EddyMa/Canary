"""Real data for the Strata colour-system preview (design/strata.html).

    python design/strata_data.py

Writes design/strata/data.json: record strips for a set of example investigations,
every variable in the Arctic, one-degree trend maps for one variable per colour family,
simplified country outlines, and the elevation around Mount Fuji for contour lines.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np

from canary import catalogue, cube, investigate, regions, terrain
from canary.globalmap import FDR, MIN_YEARS, _nice, fdr_grid, trend_grid

OUT = Path(__file__).resolve().parent / "strata" / "data.json"

# Three colour families. Each variable says which pole an increase points to:
# thermal a = cooler (blue), b = warmer (red); water a = drier (brown), b = wetter (teal);
# air a = more in the air between sun and ground (violet), b = more sun or wind at the surface (orange).
FAMILY = {"heat": "thermal", "ice": "thermal", "water": "water", "sky": "air", "wind": "air"}
UP = {
    "temperature": "b", "temperature_max": "b", "temperature_min": "b", "ground_temperature": "b",
    "cooling_demand": "b", "frost_days": "a", "heating_demand": "a",
    "snowfall": "a", "snow": "a", "snow_cover": "a", "sea_ice": "a",
    "precipitation": "b", "soil_wetness": "b", "surface_soil_wetness": "b", "evaporation": "b",
    "humidity": "b", "relative_humidity": "b", "water_vapour": "b",
    "sunlight": "b", "wind": "b", "wind_max": "b",
    "haze": "a", "cloud": "a", "ozone": "a", "reflectivity": "a", "pressure": "a",
}
VARS = {v.id: v for v in catalogue.VARIABLES}

EXAMPLES = [
    ("temperature", "preset:arctic"), ("sea_ice", "preset:arctic"), ("frost_days", "continent:Europe"),
    ("precipitation", "country:IND"), ("soil_wetness", "country:BRA"), ("precipitation", "preset:sahel"),
    ("haze", "country:IND"), ("haze", "country:JPN"), ("pressure", "world"), ("wind", "continent:Africa"),
]


def record(var: str, region: str) -> dict:
    a = investigate.analyse(var, region, with_split=False, with_links=False)
    t = a["trend"]
    return {
        "var": var, "label": a["variable"]["label"], "unit": a["variable"]["unit"], "decimals": a["variable"]["decimals"],
        "family": FAMILY[VARS[var].theme], "up": UP[var], "region": a["region"]["name"], "regionId": region,
        "years": a["years"], "values": [None if x is None else round(x, 5) for x in a["values"]], "normal": a["normal"],
        "rate": t["per_decade"], "range": t["range_per_decade"], "total": t["total_change"], "pct": t["percent_change"],
        "snr": t["signal_to_noise"], "line": t["line"], "p": a["tests"]["mann_kendall"]["p"], "sig": a["significant"],
        "more": a["more_years_needed"], "headline": a["headline"], "detail": a["detail"],
    }


def one_degree(var: str) -> dict:
    """The per-decade trend on a one-degree grid, quantised to a byte, with false-discovery control."""
    c = cube.load(var)
    years = c.years.astype(np.float64)
    data = np.asarray(c.data, dtype=np.float64)
    li = np.floor(c.lats + 90).astype(int).clip(0, 179)
    lo = np.floor((c.lons + 180) % 360).astype(int).clip(0, 359)
    total = np.zeros((years.size, 180, 360))
    count = np.zeros((180, 360))
    for i in range(c.lats.size):
        ok = np.isfinite(data[:, i, :])
        np.add.at(total, (slice(None), li[i], lo), np.where(ok, data[:, i, :], 0.0))
        np.add.at(count, (li[i], lo), ok[0].astype(float))
    with np.errstate(invalid="ignore", divide="ignore"):
        grid = total / count
    grid[:, count == 0] = np.nan
    slope, p, _ = trend_grid(np.ascontiguousarray(grid.reshape(years.size, -1).T), years, MIN_YEARS)
    significant = (fdr_grid(p) < FDR).reshape(180, 360)
    per = (slope * 10).reshape(180, 360)
    vmax = _nice(float(np.nanpercentile(np.abs(per[np.isfinite(per)]), 98)))
    q = np.where(np.isfinite(per), np.clip(np.round(per / vmax * 126), -126, 126), -128).astype(np.int8)
    return {"vmax": vmax, "unit": VARS[var].unit, "family": FAMILY[VARS[var].theme], "up": UP[var], "label": VARS[var].label,
            "period": [int(years[0]), int(years[-1])], "v": base64.b64encode(q.tobytes()).decode(),
            "s": base64.b64encode(np.packbits(significant.astype(np.uint8)).tobytes()).decode()}


def outlines() -> list[list[float]]:
    rings = []
    for f in regions.countries_geojson()["features"]:
        g = f["geometry"]
        for poly in g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]:
            pts, last = [], None
            for x, y in poly[0]:
                pt = (round(x * 2) / 2, round(y * 2) / 2)
                if pt != last:
                    pts.append(pt)
                    last = pt
            if len(pts) > 3:
                rings.append([c for pt in pts for c in pt])
    return rings


def fuji() -> dict:
    z, lat, lon = 11, 35.3606, 138.7274
    px, py = terrain.lonlat_to_pixel(lon, lat, z)
    tx, ty = int(px // 256), int(py // 256)
    mosaic = np.block([[terrain.fetch_tile(z, tx + dx, ty + dy) for dx in (-2, -1, 0, 1, 2)] for dy in (-1, 0, 1)])
    cx, cy = px - (tx - 2) * 256, py - (ty - 1) * 256
    win = mosaic[int(cy - 200):int(cy + 200), int(cx - 300):int(cx + 300)]
    h, w = 100, 150
    small = np.clip(win[np.ix_(np.linspace(0, win.shape[0] - 1, h).astype(int), np.linspace(0, win.shape[1] - 1, w).astype(int))], 0, None)
    return {"w": w, "h": h, "scale": 4, "name": "Mount Fuji", "lat": lat, "lon": lon,
            "data": base64.b64encode(np.round(small / 4).astype(np.uint16).tobytes()).decode()}


def main() -> None:
    scan = investigate.scan("preset:arctic")
    rows = []
    for r in scan["variables"]:
        rec = record(r["id"], "preset:arctic")
        rec["sigFdr"] = r["significant"]
        rows.append(rec)
    out = {"examples": [record(*x) for x in EXAMPLES], "rows": rows,
           "maps": {v: one_degree(v) for v in ("temperature", "precipitation", "haze")},
           "outlines": outlines(), "elevation": fuji()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    print(f"{OUT}: {OUT.stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
