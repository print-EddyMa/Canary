"""A static snapshot of Canary: every answer precomputed, no backend needed.

    python -m canary.snapshot OUT_DIR [--pages-only]

Writes OUT_DIR/index.html (for any static host) and OUT_DIR/page.html (the same page as a
body fragment with its styles inline, for hosts that wrap pages themselves), the scripts,
the trend maps, and data/: one analysis per variable and built-in region over the full
record, today's indicators, events and wind, and four example places. Custom years, boxes
drawn on the globe, other places and NASA's satellite imagery need the running app.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import re
import shutil
from pathlib import Path

import httpx
import numpy as np

from . import catalogue, cube, investigate, regions

WEB = Path(__file__).resolve().parent.parent / "web"
MAPLIBRE = "https://unpkg.com/maplibre-gl@5.6.0/dist"
SCRIPTS = ("start.js", "app.js", "charts.js", "util.js", "ui.js", "record.js", "dossier.js", "dashboard.js",
           "wind.js", "fields.js", "command.js", "preview.js")
# The example places offered in the Place pane (web/app.js DEMOS).
PLACES = [(78.2, 15.6, "Svalbard, Arctic Norway"), (0.0, -150.0, "Equatorial Pacific"),
          (39.74, -104.99, "Denver, Colorado"), (-1.28, 36.82, "Nairobi, Kenya")]


def _dump(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False))


def region_ids() -> list[str]:
    listing = regions.catalogue()
    return ["world"] + [r["id"] for kind in ("presets", "continents", "countries") for r in listing[kind]]


def write_data(out: Path) -> None:
    from fastapi.testclient import TestClient

    from .api import app

    ids = region_ids()
    with TestClient(app) as client:
        get = lambda url: client.get(url).raise_for_status().json()  # noqa: E731
        for name, url in [("catalogue", "/api/catalogue"), ("countries", "/api/countries"),
                          ("briefing", "/api/briefing?ai=false"), ("events", "/api/events"), ("wind", "/api/wind")]:
            _dump(out / f"data/{name}.json", get(url))
        places = {}
        for lat, lon, name in PLACES:
            q = f"lat={lat:.3f}&lon={lon:.3f}"
            places[f"{lat:.2f},{lon:.2f}"] = {
                "chart": get(f"/api/chart?{q}"), "terrain": get(f"/api/terrain?{q}"),
                "now": get(f"/api/now?{q}"), "case": get(f"/api/case?lat={lat:.2f}&lon={lon:.2f}&author=rules"),
            }
            print(f"  place: {name}", flush=True)
        _dump(out / "data/places.json", places)
        # The last 24 hours of weather, as served when the snapshot was made.
        meta = get("/api/weather")
        if meta.get("status") == "ready":
            _dump(out / "data/weather.json", meta)
            for name in meta["fields"]:
                (out / "data/weather").mkdir(parents=True, exist_ok=True)
                raw = client.get(f"/api/weather/{name}").raise_for_status().content
                (out / f"data/weather/{name}.b64.txt").write_text(base64.b64encode(raw).decode())
    _dump(out / "data/snapshot.json", {"date": dt.date.today().strftime("%-d %B %Y"), "regions": len(ids)})

    per_region: dict[str, list[dict]] = {r: [] for r in ids}
    for variable in catalogue.VARIABLES:
        np.asarray(cube.load(variable.id).data)  # one sequential read instead of one per region
        answers = {}
        for region in ids:
            try:
                answers[region] = investigate.analyse(variable.id, region)
                per_region[region].append(answers[region])
            except ValueError as exc:  # no data for this variable here
                answers[region] = {"error": str(exc)}
        _dump(out / f"data/investigate/{variable.id}.json", answers)
        print(f"  {variable.id}: {sum('error' not in a for a in answers.values())} of {len(ids)} regions", flush=True)

    _dump(out / "data/scan.json", {r: investigate.rank(regions.parse(r), found, []) for r, found in per_region.items()})
    _dump(out / "data/suggest.json", {
        f"{interest or ''}|{place or ''}": investigate.suggest(interest, place)
        for interest in [None, *catalogue.INTERESTS] for place in [None, *catalogue.PLACE_KINDS]})


def write_pages(out: Path) -> None:
    for name in SCRIPTS:
        shutil.copy(WEB / name, out / name)
    # Binary grids go out as base64 text, which every static host serves.
    (out / "maps").mkdir(parents=True, exist_ok=True)
    for f in (WEB / "maps").iterdir():
        if f.suffix == ".bin":
            (out / "maps" / f"{f.stem}.b64.txt").write_text(base64.b64encode(f.read_bytes()).decode())
        else:
            shutil.copy(f, out / "maps" / f.name)

    html = (WEB / "index.html").read_text()
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    body = re.sub(r"\s*<script[^>]*>.*?</script>", "", body, flags=re.S)
    fonts = re.search(r'<link rel="stylesheet" href="(https://fonts\.googleapis\.com[^"]+)">', html).group(1)
    maplibre_css = httpx.get(f"{MAPLIBRE}/maplibre-gl.css", follow_redirects=True, timeout=60).raise_for_status().text
    assert "url(" not in maplibre_css.replace("url(\"data:", "").replace("url(data:", ""), "MapLibre CSS links out"
    css = (WEB / "style.css").read_text()
    scripts = (f'<script src="{MAPLIBRE}/maplibre-gl.js"></script>\n'
               '<script src="preview.js"></script>\n<script type="module" src="start.js"></script>')
    fragment = ("<title>Canary</title>\n<meta name=\"claude:viewport-fit-sides\" content=\"cover\">\n"
                f'<link rel="stylesheet" href="{fonts}">\n'
                f"<style>{maplibre_css}</style>\n<style>{css}</style>\n{body.strip()}\n{scripts}\n")
    (out / "page.html").write_text(fragment)
    (out / "index.html").write_text(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        f"</head>\n<body>\n{fragment}</body>\n</html>\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--pages-only", action="store_true", help="rebuild the pages, keep existing data")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if not args.pages_only:
        missing = [v.label for v in catalogue.VARIABLES if not cube.ready(v.id)]
        if missing:
            raise SystemExit(f"Global grids not fetched yet ({', '.join(missing)}). Run: python -m canary.cube")
        write_data(args.out)
    write_pages(args.out)
    size = sum(f.stat().st_size for f in args.out.rglob("*") if f.is_file())
    print(f"Snapshot in {args.out}: {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
