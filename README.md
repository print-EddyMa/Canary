# Canary

**Vital signs for planet Earth.** Click any place on the globe and Canary reads up to ten
vital signs from NASA records going back to 1981, then tells you what is changing, by how
much, and whether the change is more than chance.

Built for the 2026 NASA Space Apps Challenge,
[Be An Earth System Trend Detective!](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/)

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn canary.api:app --port 8000
```

Open http://localhost:8000. No API keys or logins are needed.

```bash
.venv/bin/python -m pytest            # all tests (some call the live NASA API)
.venv/bin/python -m pytest -m "not network"
```

## What it does

For the grid cell under any point (about 50 km across):

| Step | What you see | How |
|---|---|---|
| Vital signs | Temperature, precipitation, root-zone soil wetness, evaporation, humidity, wind, sunlight, cloud, snow depth, haze | NASA POWER monthly API (MERRA-2 reanalysis, CERES satellite record) |
| Trend | Rate of change per decade with a 95% range | Theil-Sen slope on monthly anomalies (seasonal cycle removed against 1991-2020) |
| Significance | Whether the trend is more than chance | Mann-Kendall test corrected for memory in the data, then false-discovery control across the vital signs |
| Size | Whether the change has left the normal range | Total change divided by ordinary year-to-year variability (signal to noise) |
| Suspects | Which planet-wide rhythm the place follows | Lagged correlation with El Niño, the Pacific Decadal Oscillation, the Indian Ocean Dipole, the North Atlantic Oscillation and Atlantic variability (NOAA indices) |
| Stability check | Early-warning signs of a system losing resilience | Rising lag-1 autocorrelation and variance in a sliding window (critical slowing down), judged against 500 surrogate series |
| Condition | One headline: Stable, Watch, Serious or Critical | Counts of vital signs with real trends and of those outside their normal range |

Every chart has a hover readout, a data table, the full statistics, and a Listen button that
plays the record as sound.

## Honesty checks built in

- **Memory in the data.** Climate series are autocorrelated, which makes the plain Mann-Kendall
  test cry wolf. In our simulations of trend-free noise with lag-1 autocorrelation of 0.4 to 0.8,
  the plain test flagged 17-55% of series at the 5% level and the common Hamed-Rao correction
  still flagged 10-23%. Canary applies the larger of the
  Hamed-Rao and AR(1) effective-sample-size corrections, which brings false alarms back to about
  5% (`tests/test_trend.py`).
- **Many tests at once.** Benjamini-Hochberg false-discovery control is applied across the vital
  signs of a place, and across every vital-sign-by-climate-mode pair.
- **Spliced satellite records.** NASA POWER joins two satellite products for sunlight and cloud
  at 2000/2001. At 78°N the join shows up as cloud cover jumping from 59% to 78% in one year.
  Canary uses only the record from 2001 for those two vital signs.
- **Early-warning signals.** Overlapping windows make ordinary p-values meaningless, so
  significance comes from phase-randomised surrogates; the false-alarm rate on stationary noise
  is tested (`tests/test_ews.py`). The check runs only on slow, memory-bearing variables
  (soil wetness), where the theory applies.
- **Stated limits.** Reanalysis is a weather model constrained by observations, not a single
  instrument; changes in the observing system can leave artificial steps. A correlation with a
  climate mode is a suspect, not a proven cause. An early-warning signal is not a forecast.

## Layout

```
canary/
  sources/power.py      NASA POWER client with disk cache
  sources/indices.py    NOAA climate-mode indices
  stats/trend.py        anomalies, Mann-Kendall, Theil-Sen, least squares, FDR
  stats/ews.py          critical-slowing-down indicators and surrogates
  stats/teleconnect.py  lagged links to climate modes
  vitals.py             the vital-sign registry and definitions
  chart.py              assembles one place's chart
  api.py                FastAPI app, also serves web/
web/                    globe (MapLibre + NASA GIBS imagery) and the chart panel
tests/
reports/                research survey of data, tools and methods
```

## Not built yet

- A global map of trends and alarms, so the globe shows where to look before you click.
- Satellite-only vital signs: GRACE water storage, MODIS vegetation, FIRMS fire.
- Water-balance attribution (climate versus human water use).
- Forecasts with a pretrained time-series model, with backtests.
- Detective and skeptic AI agents that choose variables and write up each case.

## Data credits

NASA POWER (NASA Langley Research Center), NASA GIBS Blue Marble imagery, NOAA PSL, CPC and NCEI
climate indices, Open-Meteo geocoding (GeoNames).
