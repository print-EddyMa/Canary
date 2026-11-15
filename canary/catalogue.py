"""The variables a detective can choose from.

All come from NASA POWER's global annual grids: MERRA-2 reanalysis for
weather and land (0.5 x 0.625 degree, from 1981) and the CERES SYN1deg
satellite record for radiation, cloud and aerosol (1 degree, from 2001).
Each has a plain-language definition, because the first obstacle for a new
data detective is not knowing what a variable is.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import palette

MERRA2 = "NASA POWER (MERRA-2 reanalysis)"
CERES = "NASA POWER (CERES SYN1deg satellite record)"

THEMES = (
    ("heat", "Heat", "How warm the air and ground are, and how often it freezes."),
    ("water", "Water", "Rain, moisture in the air and soil, and evaporation."),
    ("ice", "Snow and ice", "Snowfall, snow on the ground and ice on the sea."),
    ("sky", "Air and sky", "Sunlight, cloud, haze, ozone and how reflective the surface is."),
    ("wind", "Wind and pressure", "How hard the wind blows and the weight of the air."),
)


@dataclass(frozen=True)
class Variable:
    id: str
    parameter: str
    label: str
    unit: str
    theme: str
    definition: str
    store: str = "merra2"  # which POWER Zarr store holds it
    factor: float = 1.0  # native unit -> displayed unit
    decimals: int = 2
    min_mean: float | None = None  # skip cells whose long-term mean is below this (no snow, no ice)
    start_year: int | None = None
    caution: str = ""  # a known weakness of this variable, shown with every result

    @property
    def source(self) -> str:
        return CERES if self.store == "syn1deg" else MERRA2

    @property
    def family(self) -> str:
        """Its colour family: thermal, water or air (see canary/palette.py)."""
        return palette.family(self.theme)

    @property
    def up(self) -> str:
        """Which pole of the family an increase points to: "a" or "b"."""
        return palette.UP[self.id]


REANALYSIS_WATER = ("Comes from a weather model constrained by observations. The mix of satellites feeding the "
                    "model changed over the decades, which can leave artificial steps in water-cycle variables.")
REANALYSIS_WIND = ("Model winds are sensitive to changes in the observing system and to how the land surface is "
                   "described; treat long-term wind trends with care.")

VARIABLES: tuple[Variable, ...] = (
    # ---- heat ----
    Variable("temperature", "T2M", "Air temperature", "°C", "heat",
             "Average air temperature two metres above the ground."),
    Variable("temperature_max", "T2M_MAX", "Hottest temperature of the year", "°C", "heat",
             "The highest air temperature reached during the year."),
    Variable("temperature_min", "T2M_MIN", "Coldest temperature of the year", "°C", "heat",
             "The lowest air temperature reached during the year."),
    Variable("ground_temperature", "TS", "Ground temperature", "°C", "heat",
             "Temperature of the surface itself (soil, rock, water or ice), which is hotter than the air on "
             "sunny days."),
    Variable("frost_days", "FROST_DAYS", "Frost days", "days", "heat",
             "Number of days in the year when the temperature fell below freezing.", decimals=1, min_mean=1.0),
    Variable("cooling_demand", "CDD18_3", "Cooling demand", "degree-days", "heat",
             "How much, and for how long, it was warmer than 18.3 °C: a standard measure of the need for air "
             "conditioning.", decimals=0, min_mean=10.0),
    Variable("heating_demand", "HDD18_3", "Heating demand", "degree-days", "heat",
             "How much, and for how long, it was colder than 18.3 °C: a standard measure of the need for "
             "heating.", decimals=0, min_mean=10.0),
    # ---- water ----
    Variable("precipitation", "PRECTOTCORR", "Precipitation", "mm/day", "water",
             "Average rain and snowfall per day, corrected against rain gauges.", caution=REANALYSIS_WATER),
    Variable("soil_wetness", "GWETROOT", "Root-zone soil wetness", "fraction", "water",
             "How full of water the top metre of soil is, where plant roots drink: 0 is completely dry, 1 is "
             "saturated.", decimals=3, caution=REANALYSIS_WATER),
    Variable("surface_soil_wetness", "GWETTOP", "Surface soil wetness", "fraction", "water",
             "How wet the top few centimetres of soil are: 0 is completely dry, 1 is saturated.",
             decimals=3, caution=REANALYSIS_WATER),
    Variable("evaporation", "EVLAND", "Evaporation from land", "mm/day", "water",
             "Water returned to the air from soil and plants each day.", caution=REANALYSIS_WATER),
    Variable("humidity", "QV2M", "Moisture in the air", "g/kg", "water",
             "Grams of water vapour in each kilogram of air near the ground (specific humidity)."),
    Variable("relative_humidity", "RH2M", "Relative humidity", "%", "water",
             "How close the air is to holding all the water vapour it can at its temperature.", decimals=1),
    Variable("water_vapour", "TQV", "Water vapour overhead", "kg/m²", "water",
             "All the water vapour in the column of air above a square metre of ground."),
    # ---- snow and ice ----
    Variable("snowfall", "PRECSNOLAND", "Snowfall on land", "mm/day", "ice",
             "Average snowfall per day, as the depth of water it would melt to.", decimals=3, min_mean=0.01,
             caution=REANALYSIS_WATER),
    Variable("snow", "SNODP", "Snow depth", "cm", "ice",
             "Average depth of snow lying on the ground.", min_mean=1.0, caution=REANALYSIS_WATER),
    Variable("snow_cover", "FRSNO", "Snow cover", "fraction", "ice",
             "Share of the land covered by snow, averaged over the year.", decimals=3, min_mean=0.01),
    Variable("sea_ice", "FRSEAICE", "Sea ice cover", "fraction", "ice",
             "Share of the sea surface covered by ice, averaged over the year.", decimals=3, min_mean=0.01),
    # ---- air and sky ----
    Variable("sunlight", "ALLSKY_SFC_SW_DWN", "Sunlight reaching the ground", "MJ/m²/day", "sky",
             "Solar energy arriving at the surface each day, after clouds and haze.",
             store="syn1deg", factor=0.0864, start_year=2001),
    Variable("cloud", "CLOUD_AMT", "Cloud cover", "%", "sky",
             "Share of the sky covered by cloud, averaged over the year.", store="syn1deg", decimals=1, start_year=2001),
    Variable("haze", "AOD_55", "Haze (aerosols)", "optical depth", "sky",
             "How much dust, smoke and pollution is suspended in the air column, measured by how strongly it "
             "dims light.", store="syn1deg", decimals=3, start_year=2001),
    Variable("reflectivity", "ALLSKY_SRF_ALB", "Surface reflectivity", "fraction", "sky",
             "Share of sunlight the surface bounces back (albedo). Snow and ice are bright; forest and open "
             "water are dark.", store="syn1deg", decimals=3, start_year=2001),
    Variable("ozone", "TO3", "Ozone layer", "Dobson units", "sky",
             "Total ozone in the column of air overhead, which shields the surface from ultraviolet light.",
             decimals=1),
    # ---- wind and pressure ----
    Variable("wind", "WS10M", "Wind speed", "m/s", "wind",
             "Average wind speed ten metres above the ground.", caution=REANALYSIS_WIND),
    Variable("wind_max", "WS10M_MAX", "Strongest wind of the year", "m/s", "wind",
             "The highest wind speed reached during the year.", caution=REANALYSIS_WIND),
    Variable("pressure", "SLP", "Air pressure", "hPa", "wind",
             "The weight of the air, adjusted to sea level so that places at different heights can be compared.",
             decimals=1),
)

BY_ID = {v.id: v for v in VARIABLES}

# Starting points for the three-question guide: curiosity -> variables worth a first look.
INTERESTS = {
    "heat": ("Is it getting hotter?", ["temperature", "temperature_max", "cooling_demand", "frost_days"]),
    "water": ("Is it getting wetter or drier?", ["precipitation", "soil_wetness", "evaporation", "humidity"]),
    "ice": ("Is snow and ice disappearing?", ["snow", "snow_cover", "sea_ice", "frost_days"]),
    "sky": ("Is the air getting cleaner or hazier?", ["haze", "sunlight", "cloud", "ozone"]),
    "wind": ("Is it getting windier?", ["wind", "wind_max", "pressure"]),
    "farming": ("Is farming getting harder?", ["soil_wetness", "precipitation", "temperature_max", "frost_days"]),
    "energy": ("Is energy demand changing?", ["cooling_demand", "heating_demand", "sunlight", "wind"]),
}

# The kind of place changes which variables are most telling there.
PLACE_KINDS = {
    "city": ("A big city", ["temperature_max", "cooling_demand", "haze"],
             "Cities trap heat and produce haze, so peak temperatures, cooling demand and aerosols are the first things to check."),
    "desert": ("A desert", ["temperature_max", "soil_wetness", "haze"],
               "Deserts show heat extremes clearly, and dust shows up as haze."),
    "rainforest": ("A rainforest", ["precipitation", "evaporation", "soil_wetness"],
                   "A rainforest recycles its own rain, so rainfall, evaporation and soil moisture move together."),
    "coast": ("A coast or estuary", ["wind", "humidity", "precipitation"],
              "Coasts are shaped by wind off the sea and by moisture in the air."),
    "mountains": ("Mountains", ["snow", "frost_days", "temperature"],
                  "Mountain water supplies depend on snow, which depends on how often it freezes."),
    "farmland": ("Farmland", ["soil_wetness", "precipitation", "frost_days"],
                 "Crops respond to soil moisture, rain, and the length of the frost-free season."),
    "polar": ("The polar regions", ["sea_ice", "snow_cover", "temperature", "reflectivity"],
              "Ice and snow reflect sunlight; when they shrink, the surface darkens and warms further."),
}
