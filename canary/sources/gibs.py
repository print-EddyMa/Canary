"""Curated catalogue of NASA GIBS imagery layers.

GIBS (Global Imagery Browse Services) serves map tiles of NASA satellite
products with no login. It lists well over a thousand layers; this module
picks the ones that answer plain questions and reads their dates, zoom
levels and legends from the live capabilities document.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from dataclasses import dataclass

import httpx

from .cache import cached_text

CAPABILITIES = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
TILE_ROOT = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"


@dataclass(frozen=True)
class Pick:
    key: str  # our short id
    gibs: str  # GIBS layer identifier
    label: str
    group: str
    about: str
    sensor: str
    kind: str = "overlay"  # "base" replaces the globe's surface; "overlay" sits on top


PICKS: tuple[Pick, ...] = (
    # Base imagery
    Pick("blue_marble", "BlueMarble_ShadedRelief_Bathymetry", "Blue Marble", "Globe",
         "A cloud-free composite of Earth with shaded terrain and sea floor.", "MODIS composite", "base"),
    Pick("true_color", "VIIRS_NOAA20_CorrectedReflectance_TrueColor", "Satellite view, chosen day", "Globe",
         "What a satellite actually saw on the chosen day: clouds, smoke, dust, snow and all.", "VIIRS, NOAA-20", "base"),
    Pick("night", "VIIRS_Black_Marble", "Night lights", "Globe",
         "City lights at night, a map of where people and electricity are.", "VIIRS Black Marble 2016", "base"),
    Pick("landsat", "Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual", "Landsat close-up (30 m)", "Globe",
         "A cloud-free mosaic sharp enough to see valleys, fields and towns. Best zoomed in.", "Landsat WELD, 2000", "base"),
    Pick("relief", "ASTER_GDEM_Color_Shaded_Relief", "Shaded relief", "Globe",
         "The shape of the land alone: elevation in colour with shadows, no vegetation or cloud.", "ASTER GDEM", "base"),
    # Water and weather
    Pick("rain", "IMERG_Precipitation_Rate", "Rain and snowfall", "Water and weather",
         "Precipitation rate measured from space by a constellation of satellites.", "GPM IMERG"),
    Pick("soil_moisture", "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture", "Soil moisture", "Water and weather",
         "Water held in the root zone of the soil, from microwave measurements.", "SMAP"),
    Pick("surface_water", "OPERA_L3_Dynamic_Surface_Water_Extent-HLS", "Surface water", "Water and weather",
         "Open water mapped at 30 m: lakes, rivers, reservoirs and floods. Zoom in to see it.", "OPERA, Landsat and Sentinel-2"),
    Pick("snow", "MODIS_Terra_NDSI_Snow_Cover", "Snow cover", "Water and weather",
         "Where snow lies on the ground on the chosen day.", "MODIS, Terra"),
    Pick("sea_temp", "GHRSST_L4_MUR_Sea_Surface_Temperature", "Sea surface temperature", "Water and weather",
         "Temperature of the ocean surface, blended from many satellites.", "GHRSST MUR"),
    Pick("sea_ice", "GHRSST_L4_MUR_Sea_Ice_Concentration", "Sea ice", "Water and weather",
         "Share of the ocean surface covered by ice.", "GHRSST MUR"),
    # Land and life
    Pick("vegetation", "MODIS_Terra_L3_NDVI_16Day", "Vegetation greenness", "Land and life",
         "How green and dense plant cover is (NDVI), over 16 days.", "MODIS, Terra"),
    Pick("land_temp", "MODIS_Terra_Land_Surface_Temp_Day", "Land surface temperature", "Land and life",
         "Daytime temperature of the ground itself, hotter than the air on sunny days.", "MODIS, Terra"),
    Pick("canopy", "GEDI_ISS_L3_Canopy_Height_Mean_RH100_201904-202303", "Forest height (lidar)", "Land and life",
         "Height of the forest canopy measured by a laser on the International Space Station.", "GEDI lidar"),
    Pick("biomass", "GEDI_ISS_L4B_Aboveground_Biomass_Density_Mean_201904-202303", "Forest biomass (lidar)", "Land and life",
         "Mass of living wood above ground, the carbon stored in forests.", "GEDI lidar"),
    # Air
    Pick("no2", "OMI_Nitrogen_Dioxide_Tropo_Column", "Nitrogen dioxide", "Air",
         "A pollutant from engines and power plants; it outlines cities and industry.", "OMI, Aura"),
    Pick("aerosol", "MODIS_Terra_Aerosol_Optical_Depth_3km", "Haze, smoke and dust", "Air",
         "How much fine particle haze dims the light passing through the air.", "MODIS, Terra"),
    Pick("co", "AIRS_L3_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Daily_Day", "Carbon monoxide", "Air",
         "Carbon monoxide about 5 km up, a tracer of fire smoke and pollution plumes.", "AIRS, Aqua"),
    # Radar and people
    Pick("radar", "OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1", "Radar view", "Radar and people",
         "Radar backscatter, which sees through cloud and at night. Zoom in to see it.", "Sentinel-1 SAR via OPERA"),
    Pick("population", "GPW_Population_Density_2020", "Population density", "Radar and people",
         "People per square kilometre in 2020.", "GPW v4"),
    Pick("built_up", "Landsat_Human_Built-up_And_Settlement_Extent", "Built-up areas", "Radar and people",
         "Land covered by buildings and pavement.", "Landsat"),
)


def _fetch() -> str:
    response = httpx.get(CAPABILITIES, timeout=120.0, headers={"User-Agent": "canary-earth-monitor"})
    response.raise_for_status()
    return response.text


def _layer_xml(doc: str, identifier: str) -> str | None:
    marker = f"<ows:Identifier>{identifier}</ows:Identifier>"
    at = doc.find(marker)
    if at < 0:
        return None
    return doc[doc.rfind("<Layer>", 0, at): doc.find("</Layer>", at)]


def catalogue() -> list[dict]:
    """The curated layers with live dates, tile templates and legends."""
    doc = cached_text("gibs", "capabilities.xml", _fetch, max_age_days=0.5)
    out = []
    for pick in PICKS:
        xml = _layer_xml(doc, pick.gibs)
        if xml is None:
            continue  # NASA retired or renamed the layer
        matrix = re.search(r"<TileMatrixSet>(.*?)</TileMatrixSet>", xml).group(1)
        mime = re.search(r"<Format>(.*?)</Format>", xml).group(1)
        ext = {"image/png": "png", "image/jpeg": "jpeg"}.get(mime)
        if ext is None:
            continue
        default = re.search(r"<Default>(.*?)</Default>", xml)
        ranges = re.findall(r"<Value>(.*?)</Value>", xml)
        legend = re.search(r"legend-type/horizontal'[^>]*xlink:href='([^']+)'", xml)
        timed = default is not None
        start = end = period = None
        if timed and ranges:
            start = ranges[0].split("/")[0][:10]
            end = ranges[-1].split("/")[1][:10]
            period = ranges[-1].split("/")[2]
        date_part = "{date}/" if timed else ""
        out.append({
            "key": pick.key,
            "label": pick.label,
            "group": pick.group,
            "about": pick.about,
            "sensor": pick.sensor,
            "kind": pick.kind,
            "tiles": f"{TILE_ROOT}/{pick.gibs}/default/{date_part}{matrix}/{{z}}/{{y}}/{{x}}.{ext}",
            "maxzoom": int(matrix.rsplit("Level", 1)[1]),
            "timed": timed,
            "default_date": default.group(1)[:10] if timed else None,
            "start": start,
            "end": end,
            "period": period,
            "legend": legend.group(1) if legend else None,
        })
    return out


# Geostationary satellites: a new full-disk image every 10 minutes. Together they cover the
# Americas (GOES-East), the Pacific (GOES-West) and Asia and Australia (Himawari). GIBS has no
# Meteosat imagery, so Europe and Africa are not covered by the loop.
GEOSTATIONARY = [
    ("goes_east", "GOES-East_ABI_GeoColor", "GOES-East GeoColor", "NOAA GOES-East ABI: true colour by day, infrared and city lights by night"),
    ("goes_west", "GOES-West_ABI_GeoColor", "GOES-West GeoColor", "NOAA GOES-West ABI: true colour by day, infrared and city lights by night"),
    ("himawari", "Himawari_AHI_Band13_Clean_Infrared", "Himawari infrared", "JMA Himawari AHI band 13 (10.4 µm): cold cloud tops are bright"),
]


def _latest_times(xml: str, count: int) -> list[str]:
    """The last `count` image times listed in a layer's time dimension."""
    times: list[datetime] = []
    for value in re.findall(r"<Value>(.*?)</Value>", xml)[::-1]:
        start, end, period = value.split("/")
        step = timedelta(minutes=int(re.match(r"PT(\d+)M", period).group(1))) if period.startswith("PT") else None
        t, first = datetime.fromisoformat(end.replace("Z", "+00:00")), datetime.fromisoformat(start.replace("Z", "+00:00"))
        while t >= first and len(times) < count:
            times.append(t)
            if step is None:
                break
            t -= step
        if len(times) >= count:
            break
    return [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in sorted(times)]


def geostationary(frames: int = 18) -> list[dict]:
    """The latest images of each geostationary satellite, for a loop of the last few hours."""
    doc = cached_text("gibs", "capabilities_live.xml", _fetch, max_age_days=10 / 1440)
    out = []
    for key, identifier, label, about in GEOSTATIONARY:
        xml = _layer_xml(doc, identifier)
        if xml is None:
            continue
        matrix = re.search(r"<TileMatrixSet>(.*?)</TileMatrixSet>", xml).group(1)
        out.append({"key": key, "label": label, "about": about,
                    "tiles": f"{TILE_ROOT}/{identifier}/default/{{time}}/{matrix}/{{z}}/{{y}}/{{x}}.png",
                    "maxzoom": int(matrix.rsplit("Level", 1)[1]), "times": _latest_times(xml, frames)})
    return out
