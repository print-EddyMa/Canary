"""A static snapshot of the start page: every answer precomputed, no backend needed.

    python -m canary.snapshot OUT_DIR [--shots DIR]

Writes OUT_DIR/index.html (for any static host) and OUT_DIR/page.html (the same page as a
body fragment with its styles inline, for hosts that wrap pages themselves), the scripts,
the trend maps, and data/ with one analysis per variable and built-in region over the full
record. Custom year ranges, drawn boxes and Explore mode need the running app; with --shots,
JPEG pictures of Explore mode listed in DIR/index.json are shown in their place.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
from pathlib import Path

import httpx
import numpy as np

from . import briefing, catalogue, cube, investigate, regions

WEB = Path(__file__).resolve().parent.parent / "web"
MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css"
SCRIPTS = ("start.js", "charts.js", "util.js", "preview.js")

# The live page is one fixed, scrolling pane beside Explore mode; alone it can scroll normally.
EXTRA_CSS = """
html, body { height: auto; overflow: visible; }
.start { position: static; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
@media (min-width: 700px) { .start { padding-left: clamp(16px, 4vw, 48px); padding-right: clamp(16px, 4vw, 48px); } }
.preview-note { margin: -14px auto 22px; padding: 8px 12px; font-size: 13px; color: var(--text-2); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
.shots figure { margin: 0 0 18px; }
.shots img { display: block; width: 100%; height: auto; border: 1px solid var(--border); border-radius: 10px; }
.shots figcaption { margin-top: 6px; font-size: 13.5px; color: var(--text-2); }
.shots figcaption strong { color: var(--text); }
"""


def _dump(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False))


def region_ids() -> list[str]:
    listing = regions.catalogue()
    return ["world"] + [r["id"] for kind in ("presets", "continents", "countries") for r in listing[kind]]


def write_data(out: Path) -> None:
    from .api import variable_catalogue  # the same catalogue the live page receives

    ids = region_ids()
    _dump(out / "data/catalogue.json", variable_catalogue())
    _dump(out / "data/countries.json", regions.countries_geojson())
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
    today = briefing.briefing()
    today["ai_available"] = False
    _dump(out / "data/briefing.json", today)


def write_pages(out: Path, shots: Path | None) -> None:
    for name in SCRIPTS:
        shutil.copy(WEB / name, out / name)
    shutil.copytree(WEB / "maps", out / "maps", dirs_exist_ok=True)
    if shots:
        shutil.copytree(shots, out / "shots", dirs_exist_ok=True)
    else:
        _dump(out / "shots/index.json", [])

    html = (WEB / "index.html").read_text()
    main = re.search(r"<main id=\"start\".*?</main>", html, re.S).group(0)
    title = "Canary trend detective"
    css = (WEB / "style.css").read_text() + EXTRA_CSS
    maplibre_css = httpx.get(MAPLIBRE_CSS, follow_redirects=True, timeout=60).raise_for_status().text
    assert "url(" not in maplibre_css.replace("url(\"data:", "").replace("url(data:", ""), "MapLibre CSS links out"
    scripts = ('<script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>\n'
               '<script src="preview.js"></script>\n<script type="module" src="start.js"></script>')
    fragment = (f"<title>{title}</title>\n<meta name=\"claude:viewport-fit-sides\" content=\"cover\">\n"
                f"<style>{maplibre_css}</style>\n<style>{css}</style>\n{main}\n{scripts}\n")
    (out / "page.html").write_text(fragment)
    (out / "index.html").write_text(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"</head>\n<body>\n{fragment}</body>\n</html>\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--shots", type=Path, help="folder of Explore-mode pictures with an index.json")
    parser.add_argument("--pages-only", action="store_true", help="rebuild the pages, keep existing data")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if not args.pages_only:
        missing = [v.label for v in catalogue.VARIABLES if not cube.ready(v.id)]
        if missing:
            raise SystemExit(f"Global grids not fetched yet ({', '.join(missing)}). Run: python -m canary.cube")
        write_data(args.out)
    write_pages(args.out, args.shots)
    size = sum(f.stat().st_size for f in args.out.rglob("*") if f.is_file())
    print(f"Snapshot in {args.out}: {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
