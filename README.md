# Canary

**Be an Earth trend detective.** Ask "Is [a variable] changing in [a region]?" and get a
verdict in plain words: rising or falling, by how much per decade, and whether the change is
significant or could be chance. The globe shows where it is changing; click a country to ask
about it, or any point to open that place: its vital signs, where its rain goes, the weather
now, and a detective's case file. Satellite layers, live events, wind and 3D terrain are one
click away in the layer list.

Built for the 2026 NASA Space Apps Challenge,
[Be An Earth System Trend Detective!](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/)

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn canary.api:app --port 8000
```

Open http://localhost:8000. No API keys or logins are needed for anything except the AI
detective, which is optional:

```bash
export ANTHROPIC_API_KEY=...                        # switches on the Claude-powered detective and brief
.venv/bin/pip install -e ".[forecast]"              # adds a pretrained forecasting model to the backtest
```

Without a key, case files and the daily brief are written by fixed rules and labelled as such.

```bash
.venv/bin/python -m pytest                      # all tests (some call live services)
.venv/bin/python -m pytest -m "not network"
.venv/bin/python -m canary.cube                 # fetch the global grids now (otherwise on first use; about 1 GB)
.venv/bin/python -m canary.globalmap            # recompute the trend maps for all 26 variables
.venv/bin/python -m canary.snapshot OUT_DIR     # a static copy of Canary for any file host
```

The snapshot needs no backend: every variable is precomputed for the whole world, the named
regions, the continents and the countries over its full record, with today's indicators,
events and wind and four example places (about 21 MB). Custom years, boxes drawn on the globe,
other places and NASA's satellite imagery need the running app.

## How it answers the challenge

| The challenge asks for | Where it is in Canary |
|---|---|
| Identify variables of interest | A picker of 26 variables in five themes, each with a plain definition; a three-question guide that suggests where to start; a scan that tests every variable in a region and ranks the ones that are trending |
| Acquire the data for a region | The whole world, 13 named regions, 7 continents, 177 countries, or a box drawn on the map; area-weighted averages from NASA POWER global grids (MERRA-2 and CERES) |
| Visualise the time series | Yearly series with the trend line, hover readout, data table and CSV download; two regions on one chart |
| Rate of change and significance | Theil-Sen slope with a 95% range; Mann-Kendall test and a t-test on the least-squares slope, both corrected for memory in the data; the size of the change against normal year-to-year swings |
| What is changing, where, how much, significant? | One verdict sentence, a trend map of every grid cell (bright where significant), and the share of the region rising and falling |
| "Opposite trends from the same process" | Compare mode: for example, haze rising over India and falling over Japan |
| "A trend may need a longer record" | When a trend is not significant, an estimate of how many more years of data would settle it |
| Demonstration examples to watch | Three one-minute walkthroughs on real data |

## What you can do

### One workspace

The question sits in the header: a variable, a region, an optional second region to compare,
and the years. The globe fills the screen and shows the variable's trend map. One panel on the
right has three tabs:

| Tab | What it shows |
|---|---|
| Trend | The verdict; the record (one cell per year, coloured by its difference from normal); rate of change, 95% range, total change and size against normal swings; an evidence bar and a range bar; the yearly chart or table; the two significance tests; what might explain it; every other variable in the region ranked |
| Place | Any point you click or search for: vital signs, land and water, right now, and the detective |
| Today | Planet indicators, the brief, and the biggest natural events now |

Click a country on the globe to make it the region. In the Place tab a click opens that exact
point instead. The Guide button explains the workspace, asks three questions to suggest a
variable, and plays three one-minute walkthroughs on real data.

### Colour (the Strata theme)

Colour means one thing, everywhere. The full system, shown live on real data, is in
`design/strata.html`.

- **One object.** Every answer is drawn as a record: one cell per year, coloured by how far
  that year sat from normal. It appears full size in the verdict, at row size in tables and in a
  place's vital signs, and as a glyph in the variable picker.
- **Three colour families.** Thermal (heat, snow and ice) runs blue to red, and red always
  points the way a warming world pushes. Water runs brown (drier) to teal (wetter). Air runs violet
  (more haze, cloud, ozone or pressure) to green (more sun and wind). Each has a grey middle, so
  "no change" never looks like a result. The globe, the records and the numbers use the same family.
- **Colour is earned.** A rate, a trend line or a map cell takes its colour only when the test
  says it is unlikely to be chance; otherwise it stays grey, and lines are dashed and cells faint.
- **Yellow means look here.** Canary yellow marks the region you chose, the place you clicked,
  the finding in the headline and keyboard focus. It is never used for data.
- **Light and dark.** The panel follows the system theme or the switch in the header; the globe
  stays dark in both.

### Today: the dashboard

| Part | What it shows | Source |
|---|---|---|
| Planet indicators | Global temperature, carbon dioxide, Arctic sea ice, El Niño: latest value, rank, trend and history | NASA GISTEMP, NOAA GML, NSIDC, NOAA PSL |
| The brief | Four to six lines on what is unusual today | Written by Claude from the page's own figures, or by rules |
| Biggest events now | Storms, earthquakes, wildfires and volcanoes on one severity scale, each with an Investigate button | NASA EONET, USGS |

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
| | A 24-month outlook, shown only with its measured skill | Rolling backtest from six past start dates; the winner among seasonal average, trend plus memory, and a pretrained model is used |
| Land and water | Elevation, slope, aspect, relief | Horn's method on 150 m elevation |
| | Where a raindrop falling there goes: the route, the rivers it joins, the distance and the drop, with an elevation profile linked to the map | Priority-Flood flow routing at three scales |
| | The local stream network | Flow accumulation |
| Right now | Temperature, wind and pressure; natural events within 1,000 km | NASA GEOS-FP, NASA EONET, USGS |
| Detective | A case file: headline, findings with confidence and numbered evidence, suspects with the case for and against, outlook, the skeptic's objections and how each was handled | See below |

### The detective and the skeptic

Three roles in three separate conversations, so that no role marks its own work
(`canary/llm.py`, model `claude-opus-5-5`):

1. **Investigator.** Given a place and nine tools (vital signs, climate links, stability check,
   outlook, terrain and water, current conditions, nearby events, planet context, and a
   comparison with any other place), it decides what to read and in what order. It is told to
   test at least one alternative explanation, for example by checking whether a change is shared
   by neighbours.
2. **Skeptic.** A fresh Claude instance that sees only the evidence and the draft, and is asked
   to find what is overstated, unsupported, or explained as well by a data artefact or chance.
3. **Revision.** The investigator must answer every objection: change the case file or say which
   evidence settles it.

Then code, not a model, traces every figure in the final text back to the numbered evidence and
shows the count ("23 of 23 figures traced"). The models can read Canary's numbers but have no
way to introduce their own without it showing.

The same tools and the same output shape back a rule-based author (`canary/detective.py`) used
when no key is set. Its skeptic is the fixed list of objections a careful scientist would raise.

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
- **Forecasts.** Every outlook is first tested on the past against the obvious guess, a normal
  year. Where nothing beats that guess, Canary shows the normal year and says so. On the places
  checked, the winning method beat it by 0-40% depending on the variable. The 80% range comes
  from the backtest's own errors and held about 78% of outcomes it was not fitted to. The record
  ends in December 2025, so outlooks start there and do not know about the El Niño of 2026.
- **Event ranking.** Events are ranked by physical size, not harm; the ranking knows nothing about
  who lives nearby, and says so. A case opened on an event reports the long-term record at its
  location as background and does not attribute the event to it.
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
  sources/planet.py     global temperature, CO2, sea ice, El Niño status
  stats/forecast.py     backtested outlooks
  catalogue.py          the 26 variables, themes and guide questions
  cube.py               global annual grids, fetched once and memory-mapped
  regions.py            world, named regions, countries, continents, boxes
  investigate.py        regional series, trend, significance, scan
  globalmap.py          global trend maps and the alarm map
  terrain.py            terrain shape, flow routing, raindrop paths
  briefing.py           event severity ranking and the rule-written brief
  detective.py          evidence tools, rule-based case files, number tracing
  llm.py                Claude investigator, skeptic, revision and daily brief
  api.py                FastAPI app, also serves web/
  palette.py            the colour families and which way each variable points
  snapshot.py           static, backend-free copy of Canary
web/
  start.js              the workspace: the question, the verdict, compare, guide, walkthroughs
  app.js                the globe: map, layers, legends, place selection, the panel's tabs
  dashboard.js          the world dashboard and the case-file view
  dossier.js            vital signs, land and water, right now
  charts.js             SVG line charts with crosshair and tooltip
  record.js             the record strip, evidence bar and range bar
  ui.js                 searchable select, sortable table, view tabs, theme switch
  wind.js               wind particle animation
  preview.js            answers API calls from files in a snapshot build
  maps/                 precomputed trend and alarm maps
tests/
design/                 the Strata colour system: specimen page, its data and ramp generator
reports/                research survey of data, tools and methods
```

## Not built yet

- River basins as regions (no small, openly licensed basin file to ship).
- Monthly or seasonal regional series; regions are analysed on yearly averages.
- The trend map for a chosen sub-period; it always shows each variable's full record.
- Satellite-only vital signs with long records: GRACE water storage, MODIS vegetation, FIRMS fire.
- Water-balance attribution (climate versus human water use).
- Forecasts that use the state of El Niño as an input.
- A global map of the early-warning (tipping-point) signal.

## Data credits

NASA POWER (NASA Langley), NASA GIBS (ESDIS), NASA GEOS-FP (GMAO), NASA EONET, NASA GISTEMP, USGS Earthquake
Hazards Program, NOAA PSL, CPC and NCEI climate indices, NOAA GML carbon dioxide, NSIDC Sea Ice Index, Terrain Tiles on AWS (NASA SRTM, GMTED2010,
ETOPO1 and national surveys), Natural Earth rivers and coastlines, Open-Meteo geocoding (GeoNames),
OpenStreetMap contributors (map labels).
