"""Canary's colour families (the Strata theme), shared by the maps and the API.

Each kind of variable has one diverging family with a neutral grey middle:

    thermal  blue (cooler) to red (warmer): heat, snow and ice. Red is the way a warming
             world pushes, so less sea ice is red and more frost days are blue.
    water    brown (drier) to teal (wetter).
    air      violet (more in the air between sun and ground: haze, cloud, ozone, pressure)
             to green (more sun and wind at the surface).

Steps run from the a pole through grey to the b pole. The dark steps are used on the globe,
which sits in space in both themes; web/style.css carries the same values as tokens.
design/ramps.py generates them in OKLCH.
"""

FAMILY_OF_THEME = {"heat": "thermal", "ice": "thermal", "water": "water", "sky": "air", "wind": "air"}

FAMILIES = {
    "thermal": {"name": "Thermal", "a": "cooler", "b": "warmer"},
    "water": {"name": "Water", "a": "drier", "b": "wetter"},
    "air": {"name": "Air", "a": "more in the air", "b": "more sun and wind"},
}

# Which pole an increase in each variable points to.
UP = {
    "temperature": "b", "temperature_max": "b", "temperature_min": "b", "ground_temperature": "b",
    "cooling_demand": "b", "frost_days": "a", "heating_demand": "a",
    "snowfall": "a", "snow": "a", "snow_cover": "a", "sea_ice": "a",
    "precipitation": "b", "soil_wetness": "b", "surface_soil_wetness": "b", "evaporation": "b",
    "humidity": "b", "relative_humidity": "b", "water_vapour": "b",
    "sunlight": "b", "wind": "b", "wind_max": "b",
    "haze": "a", "cloud": "a", "ozone": "a", "reflectivity": "a", "pressure": "a",
}

DARK = {
    "thermal": ["#89c3fe", "#399cf6", "#2e76ba", "#225382", "#2e3133", "#7c3a31", "#b15246", "#ea6a5b", "#ffa193"],
    "water": ["#f9aa60", "#cd853e", "#9b6531", "#6c4724", "#2e3133", "#095d5b", "#0a8481", "#07aeaa", "#2dd8d3"],
    "air": ["#d1a9ff", "#ac7fdd", "#8261a8", "#5b4475", "#2e3133", "#315c33", "#448448", "#58ae5d", "#7bd77f"],
}

# Sequential, one hue (ember) for counts of alarms. Canary yellow is never used for data.
EMBER = ["#4a2116", "#a33a22", "#f0743f", "#ffc1a6"]


def family(theme: str) -> str:
    return FAMILY_OF_THEME[theme]


def rising_stops(variable_id: str, theme: str) -> list[str]:
    """The family's dark steps ordered from the strongest fall to the strongest rise."""
    stops = DARK[family(theme)]
    return stops if UP[variable_id] == "b" else stops[::-1]
