# Canary

**Vital signs for planet Earth.** A 3D globe that shows where Earth is changing, what satellites
see today, and what is happening right now. Click any place for its dossier: ten vital signs
from NASA records since 1981 with trends and significance, the shape of the land, where the
rain that falls there ends up, and current conditions.

Built for the 2026 NASA Space Apps Challenge,
[Be An Earth System Trend Detective!](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/)

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev,maps]"
.venv/bin/uvicorn canary.api:app --port 8000
```

Open http://localhost:8000. No API keys or logins are needed.

```bash
.venv/bin/python -m pytest                      # all tests (some call live services)
.venv/bin/python -m pytest -m "not network"
.venv/bin/python -m canary.globalmap            # recompute the global trend maps (about a minute)
```

## What you can do

### Look at the whole planet

| Layer | What it shows | Source |
|---|---|---|
| Alarm map | How many of the ten vital signs have left their normal range in each grid cell | Canary analysis of NASA POWER |
| Trend maps | Change per decade for each vital sign, 1981-2025; faint where it could be chance | Canary analysis of NASA POWER |
| Wind | Animated particles following the latest global wind field | NASA GEOS-FP analysis |
| Events | Open wildfires, storms and their tracks, volcanoes, icebergs; earthquakes of the past week | NASA EONET, USGS |
| Satellite data | 16 layers with a date picker and NASA's own legends: rainfall, soil moisture, surface water, snow, sea temperature, sea ice, vegetation, land temperature, forest height and biomass from lidar, nitrogen dioxide, aerosols, carbon monoxide, radar, population, built-up land | NASA GIBS |
| Globe | Blue Marble, the satellite view of a chosen day, night lights, a 30 m Landsat mosaic, shaded relief | NASA GIBS |
| 3D terrain | Real relief you can tilt and fly through | Terrain Tiles (NASA SRTM and others) |

### Open a place

| Tab | What it tells you | How |
|---|---|---|
| Vital signs | Temperature, precipitation, root-zone soil wetness, evaporation, humidity, wind, sunlight, cloud, snow depth, haze: rate of change, 95% range, whether it is more than chance, and whether it has left the normal range | Theil-Sen slope and Mann-Kendall test on monthly anomalies, corrected for memory, with false-discovery control |
| | Which planet-wide rhythm the place follows (El Niño and four others) | Lagged correlation with NOAA climate indices |
| | Early-warning signs of lost stability | Rising autocorrelation and variance against 500 surrogates |
| Land and water | Elevation, slope, aspect, relief | Horn's method on 150 m elevation |
| | Where a raindrop falling there goes: the route, the rivers it joins, the distance and the drop, with an elevation profile linked to the map | Priority-Flood flow routing at three scales |
| | The local stream network | Flow accumulation |
| Right now | Temperature, wind and pressure; natural events within 1,000 km | NASA GEOS-FP, NASA EONET, USGS |

Every chart has a hover readout, a data table and the full statistics. Vital-sign charts can
also be played as sound.

## Honesty checks built in

- **Memory in the data.** Climate series are autocorrelated, which makes the plain Mann-Kendall
  test cry wolf. In our simulations of trend-free noise with lag-1 autocorrelation of 0.4 to 0.8,
  the plain test flagged 17-55% of series at the 5% level and the common Hamed-Rao correction
  still flagged 10-23%. Canary applies the larger of the Hamed-Rao and AR(1) effective-sample-size
  corrections, which brings false alarms back to about 5% (`tests/test_trend.py`).
- **Many tests at once.** Benjamini-Hochberg false-discovery control is applied across the vital
  signs of a place, across every vital-sign-by-climate-mode pair, and across all 200,000 cells of
  each global map.
- **Spliced satellite records.** NASA POWER joins two satellite products for sunlight and cloud
  at 2000/2001. At 78°N the join shows up as cloud cover jumping from 59% to 78% in one year.
  Canary uses only the record from 2001 for those two vital signs.
- **Early-warning signals.** Overlapping windows make ordinary p-values meaningless, so
  significance comes from phase-randomised surrogates, and the false-alarm rate on stationary
  noise is tested (`tests/test_ews.py`). The check runs only on slow, memory-bearing variables.
  One flag raises a place to "watch", never straight to "critical".
- **Water routing.** Coarse elevation turns river gorges into dams, so the mapped river network
  is burned in and valley floors are preserved before routing. Checked against 27 places with
  known outlets, 25 routes are right (Vienna to the Black Sea by the Danube, Denver to the Gulf
  by the Mississippi, Cusco to the Atlantic by the Amazon, Salt Lake City staying in its closed
  basin). The two known failures are shallow inland basins, Lake Chad and Lake Eyre, which are
  routed onward to the sea. The app says so.
- **Stated limits.** Reanalysis is a weather model constrained by observations, not a single
  instrument; changes in the observing system can leave artificial steps. A correlation with a
  climate mode is a suspect, not a proven cause. An early-warning signal is not a forecast.

## Layout

```
canary/
  sources/power.py      NASA POWER client with disk cache
  sources/indices.py    NOAA climate-mode indices
  sources/gibs.py       curated NASA GIBS layer catalogue
  sources/geos.py       live wind, temperature and pressure from NASA GEOS-FP
  sources/events.py     NASA EONET events and USGS earthquakes
  stats/trend.py        anomalies, Mann-Kendall, Theil-Sen, least squares, FDR
  stats/ews.py          critical-slowing-down indicators and surrogates
  stats/teleconnect.py  lagged links to climate modes
  vitals.py             the vital-sign registry and definitions
  chart.py              assembles one place's vital signs
  globalmap.py          global trend maps and the alarm map
  terrain.py            terrain shape, flow routing, raindrop paths
  api.py                FastAPI app, also serves web/
web/
  app.js                map, layers, legends, place selection
  dossier.js            the three tabs of a place
  charts.js             SVG line charts with crosshair and tooltip
  wind.js               wind particle animation
  maps/                 precomputed trend and alarm maps
tests/
reports/                research survey of data, tools and methods
```

## Not built yet

- Satellite-only vital signs with long records: GRACE water storage, MODIS vegetation, FIRMS fire.
- Water-balance attribution (climate versus human water use).
- Forecasts with a pretrained time-series model, with backtests.
- Detective and skeptic AI agents that choose variables and write up each case.
- A global map of the early-warning (tipping-point) signal.

## Data credits

NASA POWER (NASA Langley), NASA GIBS (ESDIS), NASA GEOS-FP (GMAO), NASA EONET, USGS Earthquake
Hazards Program, NOAA PSL, CPC and NCEI climate indices, Terrain Tiles on AWS (NASA SRTM, GMTED2010,
ETOPO1 and national surveys), Natural Earth rivers and coastlines, Open-Meteo geocoding (GeoNames),
OpenStreetMap contributors (map labels).
