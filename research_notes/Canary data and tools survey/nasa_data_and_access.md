# NASA Earth science datasets and fast-access APIs/tools (state as of 14 Nov 2026)

Research was cut short by the coordinator before all lines of inquiry were closed. Evidence levels used below:

- **[LIVE]** = I called the endpoint myself on 2026-11-14 from a plain Linux VM (no credentials) and report what came back.
- **[CMR]** = read from NASA's Common Metadata Repository on 2026-11-14 (collection span, latest granule date, per-granule size, granule count). Sizes are the size of the *latest* granule; totals are my multiplication.
- **[PAGE]** = I opened the cited page.
- **[SNIPPET]** = taken from a search-result summary of the cited page; the page itself was not opened. Treat as probable, not confirmed.
- Anything I only know from prior knowledge and did not re-verify is listed under **Gaps** as UNVERIFIED, not under Cited Findings.

**Not obtained: the official Resources tab of the challenge page.** `https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/` returned HTTP 503 twice and a TLS failure via curl; a Wayback snapshot exists (timestamp 20261101105409) but archive.org was unreachable from my environment. See the last Gaps block of the first section.

---

## Which 6-10 variables can be obtained fastest as multi-decade monthly time series for an arbitrary lat/lon or bounding box, and through which single API each?

### Takeaway
NASA POWER is the single fastest route: one unauthenticated HTTPS GET returned 45 years (1981-2025) of monthly MERRA-2-based values for a point in about 0.5 s, and it covers temperature, precipitation, humidity, wind, soil wetness, radiation, cloud, snow, ozone and aerosol. Everything not in POWER (NDVI, LST, burned area, snow cover, GRACE water storage, IMERG rain, night lights) needs a free Earthdata Login and either AppEEARS (queued extraction) or downloading global monthly grids via earthaccess.

### Cited Findings

#### Recommended shortlist (variable -> single fastest API)

| # | Variable | Fastest single route | Record | Auth | Evidence |
|---|---|---|---|---|---|
| 1 | 2 m air temperature (mean/max/min: `T2M`, `T2M_MAX`, `T2M_MIN`), skin temp `TS` | POWER monthly point API | 1981-2025 monthly | none | [LIVE] |
| 2 | Precipitation (`PRECTOTCORR`, mm/day, MERRA-2 bias-corrected) | POWER monthly point API | 1981-2025 | none | [LIVE] |
| 3 | Soil wetness (`GWETTOP`, `GWETROOT`, `GWETPROF`, 0-1) | POWER monthly point API | 1981-2025 | none | [LIVE] |
| 4 | Humidity / wind / pressure (`RH2M`, `QV2M`, `WS10M`, `WS2M`, `PS`, `SLP`, `TQV`) | POWER monthly point API | 1981-2025 | none | [LIVE] |
| 5 | Surface solar and longwave radiation, cloud (`ALLSKY_SFC_SW_DWN`, `CLRSKY_SFC_SW_DWN`, `ALLSKY_SFC_LW_DWN`, `CLOUD_AMT`) | POWER monthly point API | solar from 1984 | none | [LIVE] + [PAGE] |
| 6 | Snow (`SNODP`, `FRSNO`, `PRECSNOLAND`), evaporation (`EVLAND`, `EVPTRNS`), `FROST_DAYS` | POWER monthly point API | 1981-2025 | none | [LIVE] |
| 7 | Total ozone `TO3`, aerosol optical depth `AOD_55` | POWER monthly point API | see gap | none | [LIVE] (parameter exists; start year not checked) |
| 8 | Terrestrial water storage anomaly (GRACE/GRACE-FO JPL mascon) | one 44 MB netCDF from PO.DAAC via earthaccess | Apr 2002-2026, with gap | Earthdata Login | [CMR] |
| 9 | NDVI/EVI, land surface temperature, snow cover, burned area (MODIS) | AppEEARS point/area task, or global CMG monthly grids via earthaccess | 2000-2026 | Earthdata Login | [CMR] + [PAGE] |
| 10 | Global/hemispheric indices: GISTEMP global temperature anomaly; NSIDC Sea Ice Index extent | direct CSV download | 1880-Oct 2026; 1979-2026 | none | [LIVE] |

#### NASA POWER API (details)
- Monthly point endpoint: `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=77.2&latitude=28.6&start=1981&end=2025&format=JSON`. Returned HTTP 200, 17 KB, in 0.53 s, no key, no login. Keys are `YYYYMM`; month `13` is the annual value (strip it before trend fitting). Fill value is -999. Header reported `api version v2.10.0`, `sources: ["MERRA2"]`, `start 19810101`, `end 20251231`. [LIVE] — [POWER monthly point API](https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=77.2&latitude=28.6&start=1981&end=2025&format=JSON)
- Monthly API limits: up to 20 parameters per point request; regional requests take one parameter per request; meteorology (MERRA-2) starts 1 Jan 1981 and "runs through the previous year"; solar starts 1 Jan 1984; formats NetCDF, ASCII, JSON, CSV. [PAGE] — [POWER monthly API docs](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/)
- Monthly regional endpoint: `https://power.larc.nasa.gov/api/temporal/monthly/regional?latitude-min=20&latitude-max=30&longitude-min=70&longitude-max=80&parameters=T2M&community=AG&start=1981&end=2025&format=CSV`. A 10 x 10 degree box for 45 years returned 1.56 MB CSV in 2.3 s; rows are one grid cell per year with JAN..DEC,ANN columns on the native 0.5 x 0.625 degree MERRA-2 grid. [LIVE] — [POWER monthly regional API](https://power.larc.nasa.gov/api/temporal/monthly/regional?latitude-min=20&latitude-max=30&longitude-min=70&longitude-max=80&parameters=T2M&community=AG&start=1981&end=2025&format=CSV)
- Regional bounding box hard limit: a 40 x 40 degree request returned HTTP 422 with "Please provide a maximum of 10 degree range in latitude" and the same for longitude. Larger regions must be tiled into 10-degree boxes, one parameter each. [LIVE] — [POWER monthly regional API](https://power.larc.nasa.gov/api/temporal/monthly/regional?latitude-min=0&latitude-max=40&longitude-min=60&longitude-max=100&parameters=T2M&community=AG&start=2020&end=2021&format=CSV)
- Daily point endpoint (`/api/temporal/daily/point`, dates `YYYYMMDD`) for 25 Oct-13 Nov 2026 reported `sources: ["GEOSIT","FLASHFLUX"]`, API v2.10.3. Meteorology was filled through 11 Nov (2-3 day lag); solar through 9 Nov (about 5 day lag). Recent months therefore come from GEOS-IT, not MERRA-2. [LIVE] — [POWER daily point API](https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,GWETROOT&community=AG&longitude=77.2&latitude=28.6&start=20261025&end=20261113&format=JSON)
- Parameter catalogue endpoint `https://power.larc.nasa.gov/api/system/manager/parameters?community=AG&temporal=MONTHLY` returned 1,388 names (about 134 after removing hourly/min/max/SD variants). All parameters in the shortlist table above were confirmed present with the units shown: T2M (C), PRECTOTCORR (mm/day), GWET* (0-1), ALLSKY_SFC_SW_DWN (MJ/m^2/day), CLOUD_AMT (%), SNODP (cm), TO3 (Dobsons), AOD_55, EVLAND (mm/day), FRSEAICE, etc. [LIVE] — [POWER parameter manager](https://power.larc.nasa.gov/api/system/manager/parameters?community=AG&temporal=MONTHLY)
- POWER API general: RESTful; error codes 200 OK, 422 validation, 429 too many requests; "requests typically finish in under a minute". The numeric rate-limit threshold is not published on the pages I read. [PAGE] — [POWER API overview](https://power.larc.nasa.gov/docs/services/api/)
- POWER also publishes public Zarr stores on AWS: bucket `nasa-power` lists anonymously and contains `merra2/temporal/power_merra2_{monthly,daily,hourly,annual,climatology}_temporal_{utc,lst}.zarr/`. The monthly store's `.zattrs` is readable without credentials. This is a no-auth route to *global* monthly MERRA-2-derived grids without the 10-degree limit. [LIVE] — [nasa-power S3 bucket listing](https://nasa-power.s3.amazonaws.com/?list-type=2&delimiter=/&prefix=merra2/temporal/)

#### Other no-auth index series confirmed live
- GISTEMP v4 global land-ocean monthly anomalies: `https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv`, 13 KB, HTTP 200, last row 2026 filled through October (Oct 2026 = 1.55). [LIVE] — [GISTEMP GLB.Ts+dSST.csv](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv)
- NSIDC Sea Ice Index monthly extent/area CSVs: `https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv` (pattern `N_MM_extent_v4.0.csv`), 2.4 KB, HTTP 200, 1979 through Sept 2026 (Sept 2026 extent 4.81, area 3.12 million km^2). The old `_v3.0.csv` filename now returns 404. [LIVE] — [NSIDC G02135 monthly CSV](https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv)

#### Earthdata-Login routes for the satellite variables
- AppEEARS API: base `https://appeears.earthdatacloud.nasa.gov/api`; `POST /login` with Earthdata username/password (HTTP Basic) returns a Bearer token valid about 48 h; `POST /task` with `task_type` `point` (list of lat/lon) or `area` (GeoJSON), `dates`, `layers`; poll `GET /status/{task_id}` (pending/processing/done/error); `GET /bundle/{task_id}` lists files; point results are CSV, area results GeoTIFF or NetCDF4; `GET /product` lists products without auth; finished tasks expire about 30 days later. The docs state no limits on points/area and give no typical processing time. [PAGE] — [AppEEARS API docs](https://appeears.earthdatacloud.nasa.gov/api/)
- Giovanni now has a programmatic time-series endpoint: `https://api.giovanni.earthdata.nasa.gov/timeseries`. Called without a token it returns `{"code":"401","message":"Bad or missing token"}` (HTTP 403), confirming the service exists and requires an Earthdata Login bearer token. [LIVE] — [Giovanni timeseries API](https://api.giovanni.earthdata.nasa.gov/timeseries)
- Per a GES DISC expert on the Earthdata Forum, the Giovanni time-series service works only for single points; it does not return area averages or spatial subsets (they point users to harmony-py for that). A forum user reported sending the Earthdata token as a Bearer header obtained via earthaccess. [SNIPPET] — [Earthdata Forum: Unable to run API call to Giovanni](https://forum.earthdata.nasa.gov/viewtopic.php?p=25258)
- CMR search API works without auth for discovery: `https://cmr.earthdata.nasa.gov/search/collections.json?short_name=M2TMNXSLV` returned in 0.37 s; granule search with `sort_key=-start_date&page_size=1` gives the latest granule and the `CMR-Hits` header gives the count. [LIVE] — [CMR collections search](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=M2TMNXSLV&page_size=5)
- CMR-STAC root `https://cmr.earthdata.nasa.gov/stac` responds as a STAC 1.0.0 catalog with item-search conformance classes, no auth for search. [LIVE] — [CMR-STAC](https://cmr.earthdata.nasa.gov/stac)

#### Dataset reference (spans and sizes from CMR, 14 Nov 2026)

| Collection (short name, version) | Start | Latest granule | Latest granule size | Granules | DAAC |
|---|---|---|---|---|---|
| MERRA-2 monthly single-level `M2TMNXSLV` 5.12.4 (also `M2TMNXLND` land, `M2TMNXFLX` fluxes, `M2TMNXAER` aerosol; `M2SDNXSLV` daily stats) | 1980-01 | 2026-09 | 75 MB | 561 | GES DISC |
| GLDAS Noah monthly 0.25 deg `GLDAS_NOAH025_M` 2.1 | 2000-01 | 2026-07 | 23 MB | 319 | GES DISC |
| GLDAS Noah monthly 0.25 deg `GLDAS_NOAH025_M` 2.0 | 1948-01 | ends 2014-12 | 24 MB | 804 | GES DISC |
| GLDAS Noah monthly 1 deg `GLDAS_NOAH10_M` 2.1 / 2.0 | 2000 / 1948 | ongoing / 2014 | not checked | not checked | GES DISC |
| GLDAS Catchment daily with GRACE assimilation `GLDAS_CLSM025_DA1_D` 2.2 | 2003-02 | 2026-08-31 | 15 MB | 8,613 | GES DISC |
| IMERG Final monthly 0.1 deg `GPM_3IMERGM` V07 | 1998-01 | **2025-09 (record ends)** | 18 MB | 333 | GES DISC |
| IMERG Final daily `GPM_3IMERGDF` V07 | 1998-01 | ends 2025-09-30 | not checked | not checked | GES DISC |
| IMERG Late daily `GPM_3IMERGDL` V07 | 1998-01 | 2026-11-13 | 26 MB | 10,544 | GES DISC |
| TRMM TMPA monthly `TRMM_3B43` v7 (0.25 deg) | 1998-01 | ends 2019-12 | not checked | not checked | GES DISC |
| JPL GRACE/GRACE-FO mascon CRI `TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4` | 2002-04 | single file, all months | 44 MB | 1 | PO.DAAC |
| SMAP L3 36 km daily `SPL3SMP` v009 | 2015-03-31 | 2026-11-12 | 30 MB | 4,165 | NSIDC |
| SMAP L3 enhanced 9 km daily `SPL3SMP_E` v006 | 2015-03-31 | 2026-11-12 | **621 MB** | 4,167 | NSIDC |
| SMAP L4 9 km 3-hourly `SPL4SMGP` v008 | 2015-03-31 | 2026-11-10 | 143 MB | 33,961 | NSIDC |
| MODIS Terra NDVI/EVI monthly 0.05 deg `MOD13C2` 061 | 2000-02 | 2026-10 | 101 MB | 321 | LP DAAC |
| MODIS Aqua NDVI/EVI monthly `MYD13C2` 061 | 2002-07 | 2026-10 | 103 MB | 292 | LP DAAC |
| MODIS Terra NDVI monthly 1 km tiles `MOD13A3` 061 | 2000-02 | 2026-10 | 17 MB/tile | 93,611 | LP DAAC |
| VIIRS SNPP NDVI monthly 0.05 deg `VNP13C2` 002 | 2012-01 | 2026-11 | 147 MB | 179 | LP DAAC |
| VIIRS NOAA-20 NDVI monthly `VJ113C2` 002 | 2018-01 | 2026-09 | 150 MB | 105 | LP DAAC |
| MODIS Terra LST monthly 0.05 deg `MOD11C3` 061 | 2000-02 | 2026-10 | 74 MB | 321 | LP DAAC |
| MODIS Aqua LST monthly `MYD11C3` 061 | 2002-07 | 2026-10 | 75 MB | 292 | LP DAAC |
| VIIRS SNPP LST monthly `VNP21C3` 002 | 2012-01 | 2026-11 | 73 MB | 178 | LP DAAC |
| MODIS burned area monthly 500 m tiles `MCD64A1` 061 | 2000-11 | 2026-09 | 0.14 MB/tile | 83,336 | LP DAAC |
| VIIRS burned area monthly `VNP64A1` 002 | 2012-03 | 2026-09 | 0.12 MB/tile | 50,050 | LP DAAC |
| MODIS Terra snow cover monthly 0.05 deg `MOD10CM` 61 | 2000-03 | 2026-10 | 2.0 MB | 315 | NSIDC |
| MODIS Aqua snow cover monthly `MYD10CM` 61 | 2002-07 | 2026-10 | 2.3 MB | 290 | NSIDC |
| MODIS Terra snow daily CMG `MOD10C1` 61 | 2000-02-24 | 2026-11-12 | 4.1 MB | 9,691 | NSIDC |
| MODIS land cover yearly 0.05 deg `MCD12C1` 061 | 2001 | 2025 | 1.19 GB | 25 | LP DAAC |
| MODIS NPP yearly `MOD17A3HGF`, ET yearly `MOD16A3GF` 061 | 2001 / 2000 | 2025 | under 1.1 MB/tile | 7,250 / 7,426 | LP DAAC |
| AIRS L3 monthly 1 deg `AIRS3STM` v7.0 (v006 also still produced) | 2002-09 | 2026-10 | 202 MB (v006: 413 MB) | 290 | GES DISC |
| AIRS L3 daily `AIRS3STD` v7.0 | 2002-08-31 | 2026-11-12 | 182 MB | 8,758 | GES DISC |
| OMI total ozone daily 1 deg `OMTO3d` v004 (v003 also current) | 2004-10 | 2026-11-12 | 0.54 MB | 8,020 | GES DISC |
| OMI NO2 daily 0.25 deg `OMNO2d` v004 | 2004-10 | 2026-11-11 | 11 MB | 8,028 | GES DISC |
| OMI SO2 daily `OMSO2e` v004 (cloud_hosted = False) | 2004-10 | 2026-11-12 | 2.8 MB | 8,043 | GES DISC |
| OMI UV aerosol daily `OMAERUVd` v003 | 2004-10 | 2026-11-08 | 0.56 MB | 8,036 | GES DISC |
| Black Marble daily `VNP46A2` v2 | 2012-01-19 | 2026-11-02 | 12 MB/tile | 2,785,382 | LAADS |
| Black Marble monthly `VNP46A3` v2 | 2012-01 | 2026-11 | 1.4 MB/tile | 96,507 | LAADS |
| Black Marble yearly `VNP46A4` v2 | 2012 | 2025 | 155 MB/tile | 7,560 | LAADS |
| OPERA `OPERA_L3_DSWX-HLS_V1` (surface water, 30 m) | 2016-01-01 (collection metadata) | 2026-11-05 | 18 MB | 25,078,653 | PO.DAAC |
| OPERA `OPERA_L3_DSWX-S1_V1` | 2023-12-01 | 2026-11-14 | 3.5 MB | 5,364,136 | PO.DAAC |
| OPERA `OPERA_L3_DISP-S1_V1` (displacement) | 2016-07-01 | 2026-01-29 | 136 MB | 205,761 | ASF |
| OPERA `OPERA_L3_DIST-ALERT-HLS_V1` (disturbance alerts) | 2023-01-01 | 2026-11-05 | size not reported | 16,302,476 | LP DAAC |
| OPERA `OPERA_L3_DIST-ANN-HLS_V1` (annual disturbance) | 2023-01-01 | 2025-04-20 | size not reported | 56,695 | LP DAAC |
| OPERA `OPERA_L2_RTC-S1_V1` (SAR backscatter) | 2016-04-14 | 2026-11-14 | 13 MB | 77,347,904 | ASF |
| HLS `HLSL30` / `HLSS30` v2.0 (30 m reflectance) | 2013-04 / 2015-11 | 2026-11-05 | not reported | 16.2 M / 22.3 M | LP DAAC |
| GPWv4 population density rev 11 `CIESIN_SEDAC_GPWv4_POPDENS_R11` v4.11 | 2000 | 2020 (5 epochs) | 0.08-180 MB | 54 | ESDIS (cloud_hosted = False) |

All rows [CMR] — [CMR collections search](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=MOD13C2) and [CMR granules search](https://cmr.earthdata.nasa.gov/search/granules.json?short_name=MOD13C2&sort_key=-start_date&page_size=1) (substitute the short name). Every collection above except OMSO2e v004 and the GPW collections is flagged `cloud_hosted: true`.

#### GRACE / GRACE-FO specifics
- JPL's current mascon is RL06.3Mv04 (supersedes RL06.1Mv03); JPL recommends the CRI-filtered version for most users. [SNIPPET] — [data.nasa.gov JPL mascon CRI entry](https://data.nasa.gov/dataset/jpl-grace-and-grace-fo-mascon-ocean-ice-and-hydrology-equivalent-water-height-coastal-reso-30063)
- CSR states RL06.3 is its current operational release; its mascon page listed a data span of Apr 2002 to Aug 2026 with an update date of 7 Oct 2026. [SNIPPET] — [CSR RL06 mascons](https://www2.csr.utexas.edu/grace/RL06_mascons.html)
- GFZ RL06.3 Level-2 series was listed as available June 2018 through December 2025, i.e. GRACE-FO data begin June 2018 and GFZ lags CSR/JPL. [SNIPPET] — [GFZ RL06.3 release notes](https://isdcftp-ng.gfz.de/grace-fo/DOCUMENTS/RELEASE_NOTES/GRACE-FO_GFZ_L2_Release_Notes_for_RL06.3.pdf)
- JPL Level-2 RL06.3 release notes are dated 22 Jan 2026; a 2025 JPL presentation calls RL06.3 the current release with RL07 expected later (no date). [SNIPPET] — [JPL RL06.3 release notes](https://isdcftp-ng.gfz.de/grace-fo/DOCUMENTS/RELEASE_NOTES/GRACE-FO_JPL_L2_Release_Notes_for_RL06.3.pdf)

#### FIRMS active fire API
- Area endpoint: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north | world]/[DAY_RANGE]/[YYYY-MM-DD]`. Sources: `MODIS_NRT`, `MODIS_SP`, `VIIRS_SNPP_NRT`, `VIIRS_SNPP_SP`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA21_NRT`, `VIIRS_NOAA21_SP`, `LANDSAT_NRT` (US/Canada only). `DAY_RANGE` is 1 to 5 days per query. Output CSV. [PAGE] — [FIRMS area API](https://firms.modaps.eosdis.nasa.gov/api/area/)
- MAP_KEY is free; limit is 5,000 transactions per 10-minute interval; large requests can count as several transactions; limit can be raised on request. Date coverage per source is exposed at `/api/data_availability/`. [PAGE] — [FIRMS area API](https://firms.modaps.eosdis.nasa.gov/api/area/)

#### GIBS / Worldview imagery
- GIBS WMTS needs no key: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml` returned HTTP 200 (5.3 MB XML, 8.6 s). A REST tile `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2024-07-01/250m/2/1/2.jpg` returned an 86 KB JPEG with no auth. Pattern: `/wmts/{epsg4326|epsg3857|...}/best/{Layer}/default/{YYYY-MM-DD}/{TileMatrixSet}/{z}/{row}/{col}.{jpg|png}`. [LIVE] — [GIBS WMTS capabilities](https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml)
- Worldview lets users browse "more than 1,200 full-resolution satellite imagery layers". [SNIPPET] — [Earthdata tools](https://www.earthdata.nasa.gov/data/tools)

#### NISAR
- Release timeline per ASF's NISAR user guide: 23 Jan 2026 about 25 pre-calibration sample products; Feb 2026 BETA release of over 100,000 Level 1-3 products (over 500 TB) covering 17 Oct 2025 to 20 Jan 2026, not fully calibrated; 20 Jul 2026 PROVISIONAL L0-L3 (calibrated, partially validated) for acquisitions from 17 Jun 2026; 6 Nov 2026 VALIDATED L0-L2 for acquisitions from 21 Oct 2026 (L3 soil moisture SME2 not yet in the validated collection); reprocessing of pre-21 Oct 2026 data planned for 2027. [PAGE] — [ASF NISAR availability overview](https://nisar-docs.asf.alaska.edu/availability-overview/)
- Permanent instrument data gap between 2026-07-27T22:03Z and 2026-08-10T00:55Z; BETA should not be mixed with PROVISIONAL; S-band products are distributed by ISRO's Bhoonidhi hub, not ASF. [PAGE] — [ASF NISAR availability overview](https://nisar-docs.asf.alaska.edu/availability-overview/)
- Access: free via ASF DAAC and Earthdata; discoverable in Earthdata Search and ASF Vertex; programmatic via ASF SearchAPI and the `asf_search` Python package. [SNIPPET] — [ASF notice: NISAR L-band data now publicly available](https://asf.alaska.edu/notices/nisar-l-band-data-now-publicly-available/)
- Per-granule sizes from CMR (latest granule): `NISAR_L1_RSLC_PROVISIONAL_V1` 3.5 GB (164,886 granules); BETA RSLC 8.0 GB; `NISAR_L2_GSLC_PROVISIONAL_V1` 3.1 GB (162,907); `NISAR_L2_GCOV_PROVISIONAL_V1` 0.9 GB (163,672); `NISAR_L2_GUNW_PROVISIONAL_V1` 0.83 GB (94,150); `NISAR_L2_GOFF_PROVISIONAL_V1` 1.1 GB (27,717); `NISAR_L1_RUNW_PROVISIONAL_V1` 0.36 GB (27,192); `NISAR_L3_SME2_PROVISIONAL_V1` (soil moisture) 24 MB (103,943). Latest PROVISIONAL granules are dated 9-21 Oct 2026. [CMR] — [CMR NISAR collections](https://cmr.earthdata.nasa.gov/search/collections.json?keyword=NISAR)

#### SEDAC / GPW
- SEDAC's contract (Columbia/CIESIN) was terminated 30 Apr 2025; from 17 Jun 2025 all SEDAC datasets (over 350 collections) were relocated and are found through Earthdata Search; Earthdata Login is required; the datasets "are complete and will no longer be updated". [SNIPPET] — [Earthdata: SEDAC data back in Earthdata Search](https://www.earthdata.nasa.gov/data/alerts-outages/sedac-data-back-earthdata-search)
- GPWv4 now sits in CMR under provider ESDIS with short names like `CIESIN_SEDAC_GPWv4_POPDENS_R11` (v4.11, epochs 2000-2020, 54 granules), `cloud_hosted: false`. [CMR] — [CMR GPW search](https://cmr.earthdata.nasa.gov/search/collections.json?keyword=gridded%20population%20of%20the%20world%20v4%20population%20density)
- Users reported GPWv4 downloads blocked in spring 2025 (before the relocation); a Harvard Dataverse mirror of CIESIN datasets and the R `geodata` package were suggested as alternatives. [SNIPPET] — [Earthdata Forum: GPW access denied](https://forum.earthdata.nasa.gov/viewtopic.php?p=22756)

### Inferences
- For a 48-hour build, design the product around POWER as the backbone (10+ variables, 44-45 years, sub-second, no login), then add two or three satellite-observed variables as pre-downloaded global monthly grids: GRACE mascon (one 44 MB file), MODIS snow cover `MOD10CM` (about 0.6 GB for the full record), and MODIS NDVI `MOD13C2` or LST `MOD11C3` (about 24-32 GB each for the full record at 0.05 deg; smaller if coarsened once and cached).
- For "any region on Earth" larger than 10 x 10 degrees, the POWER regional API needs tiling; reading the public `nasa-power` Zarr with xarray is likely simpler for regional or global maps, but I did not time a data read (only listed the bucket and read the attributes).
- POWER monthly ends at December 2025. To show 2026 the team must aggregate POWER daily (GEOS-IT source) themselves, which introduces a source change at the join.
- None of NISAR, OPERA, SMAP, Black Marble or HLS reaches 20 years. NISAR (about 1 year, GB-scale granules, three maturity levels that should not be mixed) is unsuitable for trend detection in a weekend; OPERA DISP-S1 is the nearest "ready-made trend" product but its latest granule is January 2026.
- GPW is a static 5-epoch product (2000-2020), useful only as an exposure layer, not a trend series.

### Gaps
- **Challenge Resources tab not retrieved.** The live page returned 503 (twice) and archive.org was unreachable. I therefore cannot list what NASA recommends there. Indirect signal only: participant repositories for this challenge cite NASA POWER, PO.DAAC sea level, GISTEMP, NSIDC Sea Ice Index and NOAA GML CO2 ([GitHub example: entitySource/trend_detective](https://github.com/entitySource/trend_detective), [GitHub example: GOHSUNJIN/TerraTrend](https://github.com/GOHSUNJIN/TerraTrend)); this is what other teams used, not the official list. Someone should open the page in a browser. Wayback snapshot to try: `http://web.archive.org/web/20261101105409/https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/`.
- Giovanni time-series API: exact request parameter names, variable identifiers and rate limits not confirmed (no official doc page found before stopping).
- AppEEARS: typical turnaround time is not documented. UNVERIFIED prior knowledge: point requests for a handful of MODIS layers usually finish in minutes to tens of minutes, large area requests in hours, and queue time varies.
- POWER: numeric rate limit not found; start year of `TO3` and `AOD_55` not checked; I did not test the hourly endpoint or time a Zarr read.
- Sea level: not researched before stopping. UNVERIFIED prior knowledge: PO.DAAC hosts global mean sea level series (TOPEX/Jason/Sentinel-6, 1993 onward) and gridded sea surface height products, behind Earthdata Login.
- Ice sheets: not researched. UNVERIFIED prior knowledge: Greenland and Antarctic mass time series are derived from the same GRACE/GRACE-FO mascons.
- Black Marble: UNVERIFIED prior knowledge that downloads go through LAADS with an Earthdata token and that the `blackmarblepy` package wraps this; not checked.
- earthaccess, Harmony, OPeNDAP/Hyrax, Earthdata GIS, kerchunk/virtual-Zarr: not researched in this session beyond a forum pointer to harmony-py. UNVERIFIED prior knowledge: `earthaccess.login()` + `earthaccess.search_data(short_name=..., temporal=..., bounding_box=...)` + `earthaccess.download()` / `earthaccess.open()` is the standard path; Harmony and OPeNDAP can subset by variable and bounding box for GES DISC and PO.DAAC collections.
- GLDAS and MERRA-2 variable lists were not enumerated from the user guides.
- OPERA DSWx-HLS collection start reads 2016-01-01 in CMR; I did not check whether granules actually exist back to 2016 or whether routine production began later (my prior belief was 2023). OPERA DISP-S1 coverage is, to my UNVERIFIED knowledge, North America only.

---

## Which sources need no authentication at all, and which need a free Earthdata Login or key?

### Takeaway
No auth at all: NASA POWER (API and public Zarr on S3), GIBS/Worldview tiles, CMR and CMR-STAC search, GISTEMP CSVs, NSIDC Sea Ice Index CSVs. A free FIRMS MAP_KEY is needed for fire hot spots, and a free Earthdata Login is needed to download essentially every DAAC-archived file and to use AppEEARS and the Giovanni API.

### Cited Findings
- POWER monthly, daily and regional endpoints and the parameter catalogue all returned data with no credentials. [LIVE] — [POWER monthly point API](https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=77.2&latitude=28.6&start=1981&end=2025&format=JSON)
- The `nasa-power` S3 bucket lists and serves objects anonymously over HTTPS. [LIVE] — [nasa-power S3 bucket](https://nasa-power.s3.amazonaws.com/?list-type=2&delimiter=/)
- GIBS WMTS capabilities and tiles are served with no credentials. [LIVE] — [GIBS WMTS capabilities](https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml)
- CMR search and CMR-STAC respond without credentials (search/metadata only; the data links they return need Earthdata Login). [LIVE] — [CMR-STAC](https://cmr.earthdata.nasa.gov/stac)
- GISTEMP and NSIDC Sea Ice Index CSVs download with no credentials. [LIVE] — [GISTEMP CSV](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv); [NSIDC G02135 CSV](https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv)
- FIRMS API requires a free MAP_KEY embedded in the URL; 5,000 transactions per 10 minutes. [PAGE] — [FIRMS area API](https://firms.modaps.eosdis.nasa.gov/api/area/)
- AppEEARS requires Earthdata Login (username/password exchanged for a 48-hour Bearer token); the product list endpoint is open. [PAGE] — [AppEEARS API docs](https://appeears.earthdatacloud.nasa.gov/api/)
- Giovanni time-series API rejects unauthenticated calls ("Bad or missing token"). [LIVE] — [Giovanni timeseries API](https://api.giovanni.earthdata.nasa.gov/timeseries)
- Relocated SEDAC data (GPW etc.) require Earthdata Login to view and download. [SNIPPET] — [Earthdata: SEDAC data back in Earthdata Search](https://www.earthdata.nasa.gov/data/alerts-outages/sedac-data-back-earthdata-search)
- NISAR products are free through ASF DAAC and NASA Earthdata. [SNIPPET] — [ASF notice](https://asf.alaska.edu/notices/nisar-l-band-data-now-publicly-available/)

### Inferences
- A browser-only front end can use POWER and GIBS directly (no secrets to hide), provided those hosts allow cross-origin requests; I did not check CORS headers.
- Anything needing Earthdata Login should be fetched server-side or pre-computed before the demo; each teammate downloading data needs their own free account.
- GES DISC collections (MERRA-2, GLDAS, IMERG, AIRS, OMI) additionally require approving the "NASA GESDISC DATA ARCHIVE" application in the Earthdata Login profile — this is UNVERIFIED prior knowledge, but it is the most common first-hour failure and worth doing before the hackathon starts.

### Gaps
- CORS behaviour of POWER and GIBS not tested.
- Whether LAADS (Black Marble) still needs a separately generated download token versus a standard Earthdata bearer token was not checked.
- S3 direct access: UNVERIFIED prior knowledge that in-region direct S3 access to Earthdata Cloud buckets works only from AWS us-west-2 with temporary credentials, while HTTPS download via Earthdata Login works from anywhere. Not re-confirmed.
- Licence/usage terms were not researched per dataset. UNVERIFIED prior knowledge: NASA Earth science data are free and open with no restrictions on reuse, with requested citation; the `nasa-power` bucket contains a `LICENSE.txt` and `CITATION.cff` that I listed but did not read.

---

## What are the realistic download sizes and wait times for global monthly grids versus point/region extractions?

### Takeaway
Point and small-region extractions from POWER take 0.5-2.5 seconds and kilobytes to about 1.5 MB. Full-record global monthly grids range from 44 MB (GRACE, one file) through about 0.6 GB (MODIS snow CMG) and 6-8 GB (IMERG, GLDAS) to 24-60 GB (MODIS/VIIRS 0.05 degree NDVI and LST, MERRA-2, AIRS).

### Cited Findings
- POWER monthly point, 2 parameters x 45 years: 17 KB, 0.53 s. [LIVE] — [POWER monthly point API](https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=77.2&latitude=28.6&start=1981&end=2025&format=JSON)
- POWER monthly regional, 10 x 10 degrees, 1 parameter x 45 years: 1.56 MB CSV, 2.3 s. [LIVE] — [POWER monthly regional API](https://power.larc.nasa.gov/api/temporal/monthly/regional?latitude-min=20&latitude-max=30&longitude-min=70&longitude-max=80&parameters=T2M&community=AG&start=1981&end=2025&format=CSV)
- POWER docs: requests "typically finish in under a minute"; hourly and many-parameter requests are slower. [PAGE] — [POWER API overview](https://power.larc.nasa.gov/docs/services/api/)
- CMR metadata queries: about 0.4 s each. [LIVE] — [CMR collections search](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=M2TMNXSLV&page_size=5)
- GIBS capabilities document is 5.3 MB and took 8.6 s; individual tiles are tens of KB. [LIVE] — [GIBS WMTS capabilities](https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml)
- Per-granule sizes and granule counts for global monthly products (see the dataset table in the first section). [CMR] — [CMR granules search](https://cmr.earthdata.nasa.gov/search/granules.json?short_name=MOD13C2&sort_key=-start_date&page_size=1)
- AppEEARS download links redirect to S3 URLs valid for 48 hours; task bundles expire about 30 days after completion; no processing-time figure is published. [PAGE] — [AppEEARS API docs](https://appeears.earthdatacloud.nasa.gov/api/)
- NISAR granules are 0.36-8 GB each; the February 2026 BETA release alone exceeded 500 TB. [CMR] + [PAGE] — [CMR NISAR collections](https://cmr.earthdata.nasa.gov/search/collections.json?keyword=NISAR); [ASF NISAR availability overview](https://nisar-docs.asf.alaska.edu/availability-overview/)

### Inferences
Full-record totals (latest granule size x granule count; my arithmetic, approximate because granule size varies):

| Product | Approx. full-record size |
|---|---|
| GRACE JPL mascon CRI | 0.044 GB (1 file) |
| MODIS snow monthly CMG `MOD10CM` | 0.6 GB |
| IMERG Final monthly V07 (1998-2025-09) | 6 GB |
| GLDAS Noah 0.25 deg monthly v2.1 (2000-2026) | 7.5 GB |
| MODIS LST monthly CMG `MOD11C3` | 24 GB |
| MODIS NDVI monthly CMG `MOD13C2` | 32 GB |
| MERRA-2 monthly single-level `M2TMNXSLV` | 42 GB |
| AIRS monthly L3 v7.0 | 59 GB |
| SMAP L3 enhanced 9 km daily | about 2.6 TB (avoid; use 36 km `SPL3SMP`, about 125 GB, or POWER/GLDAS soil wetness instead) |

- Variable and bounding-box subsetting (OPeNDAP, Harmony, GES DISC subsetter) would cut the MERRA-2, GLDAS and AIRS figures by one to two orders of magnitude, since each file carries dozens of variables — I did not test this in the session.
- Tile-based products (MOD13A3, MCD64A1, VNP46A3, OPERA, HLS) have tens of thousands to millions of granules; for anything beyond a small region they are impractical to mosaic in a weekend. Use the CMG (0.05 degree global) variants or AppEEARS.
- On a typical 50-100 Mbit/s connection, 30 GB is roughly 40-80 minutes of transfer if the server does not throttle; this is my estimate, not a measurement.

### Gaps
- No timed download of an actual Earthdata granule (no credentials in this environment), so real throughput from GES DISC / LP DAAC cloud endpoints is unmeasured.
- AppEEARS and Harmony turnaround times unmeasured.
- Time to read a regional subset from the POWER Zarr store unmeasured.

---

## Which records have known breaks or artefacts that would produce misleading trends?

### Takeaway
Confirmed in this session: IMERG's Final record is frozen at September 2025 pending a version change, POWER switches source from MERRA-2 to GEOS-IT for recent data, the NSIDC Sea Ice Index changed its input dataset for recent years, GLDAS exists as two non-continuous versions, Terra's overpass time has drifted, and NISAR has three non-mixable maturity levels plus a hardware gap. Several other well-known breaks (GRACE 2017-18 gap, SMAP radar loss, MERRA-2 observing-system steps, OMI row anomaly) are from my prior knowledge and were not re-verified.

### Cited Findings
- **IMERG:** the V07 Final record ends in September 2025 because the parent products (CORRA, GPROF) are moving to V08. [SNIPPET] — [GPM: IMERG V08 transition schedule](https://gpm.nasa.gov/data/news/imerg-v08-transition-schedule); confirmed by CMR, where `GPM_3IMERGM` V07 has `time_end` 2025-09-30 and its latest granule is 2025-09. [CMR] — [CMR GPM_3IMERGM](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=GPM_3IMERGM)
- **IMERG:** as of 6 Aug 2026 the V08 Final Run was not released; expected "fall 2026" only if parent products behave; Early and Late runs stay in a "hybrid" mode and switch "no sooner than winter 2026"; a retrospective V08 record from 1998 is planned. [PAGE] — [GPM: update to IMERG V08 transition schedule, Aug 2026](https://gpm.nasa.gov/data/news/update-imerg-v08-transition-schedule-aug-2026)
- **IMERG:** a forum post says V07 processing ended 28 Feb 2026, which differs from the 30 Sept 2025 data end date (probably processing date versus data date). [SNIPPET] — [Earthdata Forum post](https://forum.earthdata.nasa.gov/viewtopic.php?p=25931)
- **IMERG/TRMM heritage:** IMERG V07 collections start 1998-01 (TRMM era included); legacy TMPA `TRMM_3B43` v7 ends 2019-12. [CMR] — [CMR TRMM_3B43](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=TRMM_3B43)
- **POWER:** monthly API reports source MERRA2 through 2025-12-31; daily API for late 2026 reports sources GEOSIT and FLASHFLUX. [LIVE] — [POWER daily point API](https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,GWETROOT&community=AG&longitude=77.2&latitude=28.6&start=20261025&end=20261113&format=JSON)
- **Sea Ice Index:** the v4.0 CSV's `source_dataset` column reads `NSIDC-0051` for 1979-1980 rows and `NSIDC-0803` for the 2025 and 2026 rows, i.e. the input product changed within the series. [LIVE] — [NSIDC G02135 CSV](https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv)
- **GLDAS:** Noah v2.0 covers 1948-2014 and v2.1 covers 2000-present as separate collections. [CMR] — [CMR GLDAS_NOAH025_M](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=GLDAS_NOAH025_M)
- **Terra orbit drift:** inclination manoeuvres stopped in late 2020; by fall 2022 Terra had lowered about 5 km and was crossing the equator at 10:15 instead of 10:30. [PAGE] — [NASA Science: Terra, the end of an era](https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era)
- **Terra instruments:** MOPITT entered safe mode 1 Feb 2025 and was switched off 9 Apr 2025; ASTER SWIR is non-operational; one of two CERES instruments is dead. [PAGE] — [NASA Science: Terra, the end of an era](https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era)
- **GRACE:** GFZ's GRACE-FO series starts June 2018 (the GRACE-FO era), and JPL/CSR mascon collections start April 2002. [SNIPPET] + [CMR] — [GFZ RL06.3 release notes](https://isdcftp-ng.gfz.de/grace-fo/DOCUMENTS/RELEASE_NOTES/GRACE-FO_GFZ_L2_Release_Notes_for_RL06.3.pdf); [CMR JPL mascon](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4)
- **OMI:** `OMNO2d` and `OMSO2e` v003 stopped in mid-to-late March 2026 (latest granules 2026-03-15 and 2026-03-22) while v004 continues to November 2026; `OMTO3d` has both v003 and v004 current. Mixing versions would splice two algorithms. [CMR] — [CMR OMNO2d](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=OMNO2d)
- **AIRS:** both v006 and v7.0 monthly L3 collections are still being produced; choose one. [CMR] — [CMR AIRS3STM](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=AIRS3STM)
- **NISAR:** BETA (Oct 2025-Jan 2026) is not fully calibrated and should not be mixed with PROVISIONAL; there is a permanent instrument gap 27 Jul-10 Aug 2026. [PAGE] — [ASF NISAR availability overview](https://nisar-docs.asf.alaska.edu/availability-overview/)
- **Giovanni:** data from the Cloud Giovanni time-series service could contain small spurious blocks of zeros; fixed 26 Mar 2026. Series pulled before that date should be re-pulled. [SNIPPET] — [Earthdata alert: reprocessed hydrology products available from Cloud Giovanni](https://www.earthdata.nasa.gov/data/alerts-outages/reprocessed-hydrology-products-available-from-cloud-giovanni)
- **VIIRS S-NPP:** latest S-NPP granules in CMR stop at 1-2 Nov 2026 (`VNP46A2` 2026-11-02, `VNP10C1` 2026-11-02), consistent with the reported end of new Suomi NPP product delivery. [CMR] — [CMR VNP46A2](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=VNP46A2)

### Inferences
- Do not concatenate IMERG V07 Final (to Sept 2025) with Late-run data for Oct 2025 onward without labelling it: the Late run lacks the gauge adjustment of the Final run, so a step is plausible. Simplest honest choice is to end the IMERG trend at Sept 2025.
- Do not splice GLDAS 2.0 and 2.1 to make a 1948-present series; use 2.1 alone (2000-present, 26+ years) for trends.
- Terra-only afternoon/morning-sensitive variables (LST especially) after about 2020 carry a drift-related cooling/warming artefact risk; Aqua (`MYD11C3`) or a Terra-Aqua comparison is a safer basis, though Aqua has also drifted (UNVERIFIED for Aqua).
- A MODIS-to-VIIRS splice for 20+ year vegetation or night-light series needs explicit cross-calibration over the overlap (2012 onward); with S-NPP ending in Nov 2026 the forward series must come from NOAA-20/21 (`VJ1*`/`VJ2*`), adding another sensor join.
- For early-warning-signal statistics (variance, lag-1 autocorrelation), any source switch or gap filling will masquerade as a change in variance or autocorrelation; flag such periods in the UI rather than interpolate silently.

### Gaps
The following are well known to me but were NOT re-verified in this session; treat as UNVERIFIED until checked against the user guides:
- GRACE to GRACE-FO gap of roughly 11 months (about July 2017 to May 2018), plus scattered missing months late in the GRACE mission (battery management, 2011 onward) and a couple of missing months early in GRACE-FO; GRACE values are anomalies relative to a 2004-2009 baseline; native resolution about 300 km (3-degree mascons) despite the 0.5-degree grid.
- SMAP L-band radar failed in July 2015, leaving radiometer-only products; the SMAP record is too short (2015 onward) for 20-year trends regardless.
- MERRA-2 has spurious steps tied to observing-system changes (for example late-1990s microwave sounders, 2000s hyperspectral sounders), particularly in precipitation, humidity and land water budget; `PRECTOTCORR` is observation-corrected, which reduces but does not remove this.
- GLDAS 2.1 has forcing-data changes within its record (precipitation and radiation sources change in the early 2000s and later).
- OMI "row anomaly" since about 2007-2009 reduces usable swath and can bias L3 trends.
- Aqua also ceased inclination manoeuvres and has drifted to later overpass times since about 2022-2023.
- MODIS Collection 6.1 corrected much of Terra's sensor degradation that produced false "browning" in earlier collections.
- NSIDC-0803 is, I believe, an AMSR2-based product adopted after DoD SSMIS data became unavailable in 2025; the reason for the switch was not verified.
- Black Marble and FIRMS VIIRS/MODIS detection-count differences (375 m VIIRS detects several times more fires than 1 km MODIS, so raw counts cannot be spliced across sensors).

---

## What has changed recently (2025-2026): satellite decommissioning, data-centre closures or migrations, API deprecations?

### Takeaway
Terra, Aqua and Aura are still operating but now have projected science end dates of February 2027, September 2027 and August 2028; Suomi NPP product delivery appears to have stopped at the start of November 2026; IMERG is mid-transition from V07 to V08; SEDAC was shut down in 2025 and its data frozen; NISAR data became public in 2026; and NASA is consolidating DAAC websites, legacy download routes and APIs into Earthdata Cloud through the end of 2026.

### Cited Findings
- Science operations are projected to end, due to fuel and power limits, for Terra in February 2027, Aqua in September 2027 and Aura in August 2028 (editor's note on an article published 29 Dec 2025, page updated 20 Mar 2026). [PAGE] — [NASA Science: Terra, the end of an era](https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era)
- A July 2026 MODIS weekly report lists Terra in Normal Mode with MODIS in A-side nominal science mode. [SNIPPET] — [MCST weekly report](https://mcst.gsfc.nasa.gov/iot/am1weekly20261992026205)
- MODIS Terra and Aqua monthly products are still being produced: latest `MOD13C2`, `MYD13C2`, `MOD11C3`, `MYD11C3`, `MOD10CM`, `MYD10CM` granules are for October 2026. [CMR] — [CMR MOD13C2 granules](https://cmr.earthdata.nasa.gov/search/granules.json?short_name=MOD13C2&sort_key=-start_date&page_size=1)
- Earlier published end dates (Terra MODIS to December 2025, Aqua MODIS to August 2026) have been superseded by the 2027 dates; older pages still show them. [SNIPPET] — [MODIS science team presentation, 2023](https://modis.gsfc.nasa.gov/sci_team/meetings/202305/presentations/thome.pdf)
- NASA advises MODIS users to move to equivalent VIIRS products. [SNIPPET] — [Earthdata: transition from MODIS to VIIRS](https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs) (page returned 403 to my fetch; content from search summary only)
- Delivery of new Suomi NPP data products ceases at the start of November 2026 (search summaries give both 1 Nov and 2 Nov); users are told to move to NOAA-20 or NOAA-21. [SNIPPET] — [Earthdata tools listing](https://www.earthdata.nasa.gov/data/tools?page=2); corroborated by S-NPP granules in CMR stopping at 1-2 Nov 2026. [CMR] — [CMR VNP10C1](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=VNP10C1)
- IMERG V07 Final ended at September 2025; V08 Final not released as of 6 Aug 2026 (target fall 2026); Early/Late switch no sooner than winter 2026. [PAGE] — [GPM: update to IMERG V08 transition schedule, Aug 2026](https://gpm.nasa.gov/data/news/update-imerg-v08-transition-schedule-aug-2026)
- SEDAC contract terminated 30 Apr 2025; datasets relocated 17 Jun 2025; no further updates. [SNIPPET] — [Earthdata: SEDAC data back in Earthdata Search](https://www.earthdata.nasa.gov/data/alerts-outages/sedac-data-back-earthdata-search)
- NISAR (launched 2025) data releases: samples Jan 2026, BETA Feb 2026, PROVISIONAL 20 Jul 2026, VALIDATED L0-L2 6 Nov 2026. [PAGE] — [ASF NISAR availability overview](https://nisar-docs.asf.alaska.edu/availability-overview/)
- GRACE-FO is still delivering: CSR mascons span to August 2026 (updated 7 Oct 2026); RL06.3 is the current release across JPL/CSR/GFZ. [SNIPPET] — [CSR RL06 mascons](https://www2.csr.utexas.edu/grace/RL06_mascons.html)
- LP DAAC retired Data Pool access to MEaSUREs, ASTER GDEM and community datasets on 3 Dec 2025; Earthdata Cloud is now the primary archive for land data. [SNIPPET] — [Earthdata: LP DAAC discontinues Data Pool distribution](https://www.earthdata.nasa.gov/data/alerts-outages/lp-daac-discontinues-data-pool-distribution-aster-gdem-measures-community)
- LAADS Classic API / web service is being retired in favour of the JSON/REST LAADS API v2 (affects scripted Black Marble and atmosphere downloads). [SNIPPET] — [Earthdata: retirement of LAADS Classic API](https://www.earthdata.nasa.gov/data/alerts-outages/retirement-laads-classic-api-transition-laads-api-v2)
- Web Unification Project: all Earth Science Data Systems web properties (DAAC sites) are being folded into earthdata.nasa.gov by the end of 2026, so old DAAC URLs in tutorials may redirect or break. [SNIPPET] — [Earthdata: Web Unification Project](https://www.earthdata.nasa.gov/about/web-unification-project)
- Consolidated ingest/archive migration interrupted new-data ingestion at PO.DAAC, ASF DAAC and GES DISC on 28-30 Oct 2026. [SNIPPET] — [Earthdata alert: ingest and archive migration](https://www.earthdata.nasa.gov/data/alerts-outages/ingest-archive-migration-interrupt-data-ingestion-oct.-28-30)
- NASA planning documents describe consolidating the 11 DAACs into thematic teams / an "ESDIS 3.0" structure with three pillars; this is planning, with no confirmed list of DAAC closures found. [SNIPPET] — [ESD Town Hall, 16 Dec 2025](https://assets.science.nasa.gov/content/dam/science/esd/earth-science-division/resources/ESD%20Town%20Hall%2012162025.pdf); [ESDS presentation, Sept 2026](https://espo.nasa.gov/sites/default/files/documents/2026-09/D3_0945_OSullivan_ESDS.pdf)
- Giovanni: a cloud-based time-series service and API are live in 2026; a zero-block bug was fixed 26 Mar 2026; maintenance outage 8 Apr 2026. [SNIPPET] + [LIVE] — [Earthdata alert](https://www.earthdata.nasa.gov/data/alerts-outages/reprocessed-hydrology-products-available-from-cloud-giovanni); [Giovanni timeseries API](https://api.giovanni.earthdata.nasa.gov/timeseries)
- NSIDC Sea Ice Index is now version 4.0; v3.0 file URLs return 404. [LIVE] — [NSIDC G02135 CSV](https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv)
- POWER API is at v2.10.x with data version 10.0.0 and now uses GEOS-IT for near-real-time meteorology. [LIVE] — [POWER daily point API](https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M&community=AG&longitude=77.2&latitude=28.6&start=20261025&end=20261113&format=JSON)

### Inferences
- Tutorials and code written before 2025 are likely to contain dead links: SEDAC URLs, LP DAAC Data Pool (`e4ftl01`) URLs, LAADS classic API calls, old Giovanni URL-scraping tricks, Sea Ice Index v3 filenames, and DAAC-specific domain names. Prefer earthaccess/CMR short names over hard-coded URLs.
- The S-NPP cutoff landed about two weeks before the hackathon; any VIIRS `VNP*` product should be treated as a closed record ending October/November 2026.
- Because MODIS is still producing data in late 2026, a 2000-2026 MODIS series (26 years) is the longest single-sensor land record available and does not yet need a VIIRS splice.

### Gaps
- Could not open the Earthdata "transition from MODIS to VIIRS" alert (HTTP 403), so the exact MODIS product end plan and any forward-processing changes are unconfirmed.
- No source newer than July 2026 on Terra/Aqua spacecraft health; current status inferred only from products still flowing in CMR.
- Whether IMERG V08 Final was actually released between August and November 2026 is unknown; CMR still shows only V07 with a 2025-09 end, which suggests not yet.
- NISAR: ASF's guide says PROVISIONAL covers acquisitions from 17 Jun 2026, but the CMR PROVISIONAL collections carry a start date of 2025-10-28 and about 163,000 granules; whether the backlog has already been reprocessed into PROVISIONAL was not resolved.
- AIRS and Aura/OMI instrument health in 2026 not researched beyond confirming products are current.
- Earthdata Login changes, earthaccess version changes, Harmony/OPeNDAP deprecations in 2025-2026 were not researched.
- The exact date new Suomi NPP deliveries stopped (1 vs 2 Nov 2026) and whether the spacecraft itself was decommissioned were not confirmed from a primary page.
