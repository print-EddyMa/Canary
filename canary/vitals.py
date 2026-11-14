"""Registry of the vital signs Canary monitors.

Each vital sign maps to one NASA POWER monthly parameter. POWER serves
MERRA-2 reanalysis for meteorology and CERES/SRB satellite products for
radiation and cloud, on a 0.5 x 0.625 degree grid (1 degree for radiation).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Vital:
    id: str
    parameter: str  # NASA POWER parameter name
    label: str
    unit: str
    definition: str
    source: str
    # Slow, memory-bearing variables are the only ones where a rise in
    # autocorrelation can be read as loss of resilience (critical slowing down).
    early_warning: bool = False
    # Variables that are zero most of the time in most places (snow) are
    # skipped where they carry no signal.
    skip_if_flat: bool = False
    decimals: int = 2
    # Ignore data before this year (used where an earlier instrument was
    # spliced onto the record and would fake a trend).
    start_year: int | None = None
    note: str = ""


MERRA2 = "NASA POWER (MERRA-2 reanalysis)"
CERES = "NASA POWER (CERES SYN1deg satellite record)"
# POWER joins GEWEX SRB (1984-2000) to CERES SYN1deg (2001 onward). The join
# leaves a step: at 78°N cloud cover jumps from 59% to 78% between 2000 and
# 2001. We therefore use the CERES era only.
CERES_START = 2001
CERES_NOTE = (
    "Record starts in 2001. NASA POWER also offers 1984-2000 from an older "
    "satellite product, but the join between the two leaves an artificial "
    "step that would be mistaken for a trend."
)

VITALS: tuple[Vital, ...] = (
    Vital(
        "temperature", "T2M", "Air temperature", "°C",
        "Average air temperature two metres above the ground.",
        MERRA2,
    ),
    Vital(
        "precipitation", "PRECTOTCORR", "Precipitation", "mm/day",
        "Average rain and snowfall per day, corrected against rain gauges.",
        MERRA2,
    ),
    Vital(
        "soil_wetness", "GWETROOT", "Root-zone soil wetness", "fraction",
        "How full of water the top metre of soil is, where plant roots drink: "
        "0 is completely dry, 1 is saturated.",
        MERRA2, early_warning=True, decimals=3,
    ),
    Vital(
        "evaporation", "EVLAND", "Evaporation from land", "mm/day",
        "Water returned to the air from soil and plants each day.",
        MERRA2,
    ),
    Vital(
        "humidity", "QV2M", "Moisture in the air", "g/kg",
        "Grams of water vapour in each kilogram of air near the ground "
        "(specific humidity).",
        MERRA2,
    ),
    Vital(
        "wind", "WS10M", "Wind speed", "m/s",
        "Average wind speed ten metres above the ground.",
        MERRA2,
    ),
    Vital(
        "sunlight", "ALLSKY_SFC_SW_DWN", "Sunlight reaching the ground", "MJ/m²/day",
        "Solar energy arriving at the surface each day, after clouds and haze.",
        CERES, start_year=CERES_START, note=CERES_NOTE,
    ),
    Vital(
        "cloud", "CLOUD_AMT", "Cloud cover", "%",
        "Share of the sky covered by cloud, averaged over the month.",
        CERES, decimals=1, start_year=CERES_START, note=CERES_NOTE,
    ),
    Vital(
        "snow", "SNODP", "Snow depth", "cm",
        "Average depth of snow lying on the ground.",
        MERRA2, skip_if_flat=True,
    ),
    Vital(
        "haze", "AOD_55", "Haze (aerosols)", "optical depth",
        "How much dust, smoke and pollution is suspended in the air column, "
        "measured by how strongly it dims light (aerosol optical depth at 550 nm).",
        MERRA2, decimals=3,
    ),
)

BY_ID = {v.id: v for v in VITALS}
