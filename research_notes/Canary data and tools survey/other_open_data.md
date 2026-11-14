# Open non-NASA, non-Google Earth and climate data sources and access platforms (state as of 14 November 2026)

Method note for the report writer: research was cut short by the coordinator before all items were covered. Findings marked "direct probe" were verified by an HTTP request made from the research sandbox on 2026-11-14 (status code, file size, first and last lines of the file). Everything I could not check this session is listed under "Gaps" in each section and labelled UNVERIFIED (it comes from prior knowledge, up to mid-2026, and should be re-checked before the team relies on it).

## Which single API gives the fastest multi-decade daily or monthly time series for an arbitrary point with no authentication, and what are its limits?

### Takeaway
Open-Meteo's Historical Weather API (ERA5 / ERA5-Land, 1940 onward) is the fastest no-auth option: one keyless GET returned 86 years of daily temperature, precipitation and soil moisture for one point in 5.5 seconds (0.9 MB JSON). The free tier is non-commercial only, capped at 10,000 calls/day, 5,000/hour and 600/minute per IP, and it throttles shared IPs, so it suits per-click point lookups but not bulk extraction of a global grid.

### Cited Findings

Open-Meteo Historical Weather API
- Endpoint is `https://archive-api.open-meteo.com/v1/archive` with required `latitude`, `longitude`, `start_date`, `end_date`, plus `hourly=` / `daily=` variable lists; no key for non-commercial use (an `apikey` parameter and `customer-` host prefix exist only for paid use) — [Open-Meteo Historical Weather API docs](https://open-meteo.com/en/docs/historical-weather-api)
- Underlying models and coverage: ERA5 0.25° hourly 1940 to present (daily updates, 5-day delay); ERA5-Land 0.1° hourly 1950 to present (5-day delay); ERA5-Ensemble 0.5° 3-hourly 1940 to present; ECMWF IFS 9 km hourly 2017 to present (no delay); CERRA 5 km 1985 to June 2021 — [Open-Meteo Historical Weather API docs](https://open-meteo.com/en/docs/historical-weather-api)
- The docs advise that "when studying climate change over decades, it is advisable to exclusively utilise ERA5 or ERA5-Land", because the default "Best Match" blend includes the newer IFS model and model upgrades introduce inconsistencies — [Open-Meteo Historical Weather API docs](https://open-meteo.com/en/docs/historical-weather-api)
- Multiple points per call: comma-separated lists, for example `latitude=52.52,48.85&longitude=13.41,2.35`; JSON returns a list of location objects, CSV/XLSX add a `location_id` column — [Open-Meteo Historical Weather API docs](https://open-meteo.com/en/docs/historical-weather-api)
- Daily variables include mean soil moisture for 0-7 cm, 7-28 cm, 28-100 cm and 0-100 cm; formats are JSON (default), CSV and XLSX — [Open-Meteo Historical Weather API docs](https://open-meteo.com/en/docs/historical-weather-api)
- Direct probe 2026-11-14: a single request for `daily=temperature_2m_mean,precipitation_sum,soil_moisture_0_to_7cm_mean` from 1940-01-01 to 2026-11-10 at 64.15N, 21.94W returned HTTP 200, 906,476 bytes, in 5.5 s; the point was snapped to grid cell 64.077, -21.957 — [archive-api.open-meteo.com](https://archive-api.open-meteo.com/v1/archive?latitude=64.15&longitude=-21.94&start_date=1940-01-01&end_date=2026-11-10&daily=temperature_2m_mean,precipitation_sum,soil_moisture_0_to_7cm_mean&timezone=GMT)
- Direct probe 2026-11-14: the very first request from the sandbox (a shared egress IP) was refused with HTTP 429 `{"error":true,"reason":"Minutely API request limit exceeded. Please try again in one minute."}`; a retry minutes later succeeded — [archive-api.open-meteo.com](https://archive-api.open-meteo.com/v1/archive?latitude=52.52&longitude=13.41&start_date=1940-01-01&end_date=1940-01-03&daily=temperature_2m_mean)

Open-Meteo limits and licence
- Free tier terms: "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute"; the comparison table lists 300,000 calls/month; limits are applied per IP address and per application, and hosted platforms such as Vercel, Netlify, Render or Google Sheets "may hit limits sooner" — [Open-Meteo terms](https://open-meteo.com/en/terms)
- Free tier is for non-commercial use only (private/non-profit sites without subscriptions or ads, public research, education are fine); data licence is CC BY 4.0; Open-Meteo may block applications and IPs that misuse the service without notice — [Open-Meteo terms](https://open-meteo.com/en/terms)
- Paid tiers allow commercial use at 1 million (Standard), 5 million (Professional) and more than 50 million (Enterprise) calls/month — [Open-Meteo terms](https://open-meteo.com/en/terms)
- The Open-Meteo homepage states non-commercial use up to 10,000 daily API calls is free with no API key or sign-up — [open-meteo.com](https://open-meteo.com/)

Other Open-Meteo endpoints (all keyless; all probed 2026-11-14 with HTTP 200)
- Flood API: `https://flood-api.open-meteo.com/v1/flood` returned daily `river_discharge` in m³/s for 1984-01-01 at a requested point (snapped to a 0.05° cell), so the record reaches back to at least 1984 — [flood-api.open-meteo.com](https://flood-api.open-meteo.com/v1/flood?latitude=59.91&longitude=10.75&daily=river_discharge&start_date=1984-01-01&end_date=1984-01-03)
- Climate API: `https://climate-api.open-meteo.com/v1/climate` returned daily `temperature_2m_max` for 1950-01-01 for model `MRI_AGCM3_2_S`, so downscaled CMIP6 series start in 1950 — [climate-api.open-meteo.com](https://climate-api.open-meteo.com/v1/climate?latitude=52.52&longitude=13.41&start_date=1950-01-01&end_date=1950-01-03&models=MRI_AGCM3_2_S&daily=temperature_2m_max)
- Air Quality API: `https://air-quality-api.open-meteo.com/v1/air-quality` returned hourly PM2.5 (μg/m³) for 2013-01-01 at Berlin, so the air-quality archive goes back at least to 2013 — [air-quality-api.open-meteo.com](https://air-quality-api.open-meteo.com/v1/air-quality?latitude=52.52&longitude=13.41&hourly=pm2_5&start_date=2013-01-01&end_date=2013-01-02)
- Geocoding API: `https://geocoding-api.open-meteo.com/v1/search?name=Reykjavik&count=1` returned name, lat/lon, elevation, country, admin1, population and timezone with no key — [geocoding-api.open-meteo.com](https://geocoding-api.open-meteo.com/v1/search?name=Reykjavik&count=1)

Station-based alternative with no auth
- NOAA NCEI Access Data Service v1 returns station monthly summaries as JSON with no token: a probe for dataset `global-summary-of-the-month`, station USW00094728, returned TAVG and PRCP for Jan-Mar 2025 — [NCEI Access Data Service](https://www.ncei.noaa.gov/access/services/data/v1?dataset=global-summary-of-the-month&stations=USW00094728&startDate=2025-01-01&endDate=2025-03-01&format=json&dataTypes=TAVG,PRCP)
- The older NCEI Climate Data Online v2 API returned HTTP 400 without a token (it needs a free emailed token) — [NCEI CDO API v2](https://www.ncei.noaa.gov/cdo-web/api/v2/datasets)
- GHCN-Daily station inventory `ghcnd-stations.txt` (11.4 MB) had a last-modified date of 14 November 2026, so GHCN-Daily is still refreshed daily — [NCEI GHCN-Daily](https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt)

### Inferences
- For the "type your hometown" flow, one Open-Meteo archive call per click (ERA5, 1940 to 5 days ago) is enough for temperature, precipitation and soil moisture trends; pin the model to ERA5 or ERA5-Land rather than the default blend to avoid an artificial step in 2017 when IFS data begins.
- 600 calls/minute and 10,000/day rule out pulling a full 0.25° global grid (about 1 million cells) through the API; global trend maps need downloaded gridded files or cloud Zarr (next two sections).
- Because limits are per IP, a hackathon backend on a shared cloud host can be throttled by other tenants (I hit a 429 on my first request). Calling Open-Meteo from the user's browser, or caching each point server-side, avoids this.
- Soil moisture from this API is reanalysis model output (ERA5), not a satellite measurement; it returned values back to 1940.

### Gaps
- UNVERIFIED: Open-Meteo counts "heavy" requests as more than one call (prior knowledge: requests with more than 10 variables or spanning more than about 2 weeks are weighted as multiple calls, so an 86-year request may count as dozens of calls against the 10,000/day budget). The terms page does not explain the weighting and I did not reach the pricing/FAQ page that does.
- UNVERIFIED: the official `openmeteo-requests` Python package (FlatBuffers responses) and the `models=era5` / `models=era5_land` parameter names; the docs page fetched did not name them.
- UNVERIFIED: Flood API is GloFAS v4 (about 5 km, 1984 onward) and Air Quality API is CAMS global (about 0.4°, from about 2013; CAMS Europe 0.1° from 2013). Start years are consistent with my probes but the source models were not confirmed on the docs pages.
- UNVERIFIED: Climate API covers 1950-2050 for seven high-resolution CMIP6 (HighResMIP) models downscaled to 10 km.
- Not checked: Meteostat, NASA POWER (excluded as NASA) and other point APIs.

## Which gridded global monthly datasets are small enough to download whole (under a few GB) for global trend maps at about 0.25 to 1 degree?

### Takeaway
NOAA PSL's download server hosts single-file monthly NetCDFs of most classic global records, each well under 300 MB and most refreshed in November 2026 (GPCP 20 MB, CMAP 17 MB, NOAAGlobalTemp 77 MB, ERSSTv5 162 MB, CPC soil moisture 256 MB, GHCN-CAMS 187 MB); HadCRUT5 (33 MB), CRU TS (443 MB per variable) and Berkeley Earth (455 MB) are similarly small. CHIRPS monthly is one 7-8 GiB file at 0.05° and has to be coarsened or read by year.

### Cited Findings

Single-file monthly NetCDFs on NOAA PSL (sizes and dates from HTTP HEAD, 2026-11-14; no auth)
- GPCP monthly precipitation: 20.4 MB, last modified 11 Nov 2026 — [precip.mon.mean.nc](https://downloads.psl.noaa.gov/Datasets/gpcp/precip.mon.mean.nc)
- CMAP enhanced monthly precipitation: 16.9 MB, last modified 13 Nov 2026 — [cmap/enh/precip.mon.mean.nc](https://downloads.psl.noaa.gov/Datasets/cmap/enh/precip.mon.mean.nc)
- NOAAGlobalTemp monthly anomalies: 77.3 MB, last modified 15 Sep 2026 — [noaaglobaltemp/air.mon.anom.nc](https://downloads.psl.noaa.gov/Datasets/noaaglobaltemp/air.mon.anom.nc)
- ERSST v5 monthly SST: 162 MB, last modified 3 Nov 2026 — [noaa.ersst.v5/sst.mnmean.nc](https://downloads.psl.noaa.gov/Datasets/noaa.ersst.v5/sst.mnmean.nc)
- OISST v2 high-resolution monthly SST: 2.25 GB, last modified 2 Nov 2026 — [noaa.oisst.v2.highres/sst.mon.mean.nc](https://downloads.psl.noaa.gov/Datasets/noaa.oisst.v2.highres/sst.mon.mean.nc)
- CPC soil moisture (model-based) monthly: 256 MB, last modified 4 Nov 2026 — [cpcsoil/soilw.mon.mean.v2.nc](https://downloads.psl.noaa.gov/Datasets/cpcsoil/soilw.mon.mean.v2.nc)
- GHCN-CAMS monthly land air temperature: 187 MB, last modified 5 Nov 2026 — [ghcncams/air.mon.mean.nc](https://downloads.psl.noaa.gov/Datasets/ghcncams/air.mon.mean.nc)
- University of Delaware monthly air temperature v5.01: 251 MB, static since Jan 2022 — [udel.airt.precip/air.mon.mean.v501.nc](https://downloads.psl.noaa.gov/Datasets/udel.airt.precip/air.mon.mean.v501.nc)
- Dai self-calibrated PDSI monthly: 18.3 MB, but last modified 4 Mar 2024 (not being updated) — [dai_pdsi/pdsi.mon.mean.selfcalibrated.nc](https://downloads.psl.noaa.gov/Datasets/dai_pdsi/pdsi.mon.mean.selfcalibrated.nc)
- CPC global unified gauge daily precipitation is split by year at about 66 MB/year (2025 file) — [cpc_global_precip/precip.2025.nc](https://downloads.psl.noaa.gov/Datasets/cpc_global_precip/precip.2025.nc)

Global temperature records
- HadCRUT5 is now at version 5.2.0.0 ("Data set version updated to HadCRUT.5.2.0.0 on 18/09/2026"); it is a 5° grid of monthly anomalies relative to 1961-1990 from January 1850, blending CRUTEM5 and HadSST4, offered both non-infilled and statistically infilled; licence is the UK Open Government Licence v3 — [Met Office HadCRUT5](https://www.metoffice.gov.uk/hadobs/hadcrut5/)
- HadCRUT.5.2.0.0 infilled ensemble-mean gridded NetCDF is 32.9 MB, last modified 23 Oct 2026 — [HadCRUT.5.2.0.0.analysis.anomalies.ensemble_mean.nc](https://www.metoffice.gov.uk/hadobs/hadcrut5/data/HadCRUT.5.2.0.0/analysis/HadCRUT.5.2.0.0.analysis.anomalies.ensemble_mean.nc)
- HadCRUT.5.2.0.0 global monthly summary CSV (columns: Time, anomaly, 2.5% and 97.5% limits) runs 1850-01 to 2026-09; last value +1.28 °C — [HadCRUT.5.2.0.0 summary series](https://www.metoffice.gov.uk/hadobs/hadcrut5/data/HadCRUT.5.2.0.0/analysis/diagnostics/HadCRUT.5.2.0.0.analysis.summary_series.global.monthly.csv)
- The previous-version file `HadCRUT.5.0.2.0...summary_series.global.monthly.csv` still resolves but its last row is 2025-02, so hard-coded 5.0.2.0 URLs silently give a truncated record — [HadCRUT.5.0.2.0 summary series](https://www.metoffice.gov.uk/hadobs/hadcrut5/data/HadCRUT.5.0.2.0/analysis/diagnostics/HadCRUT.5.0.2.0.analysis.summary_series.global.monthly.csv)
- Berkeley Earth 1° gridded land+ocean file is 454.6 MB on a public S3 bucket, last modified 10 Jan 2025 — [Land_and_Ocean_LatLong1.nc](https://berkeley-earth-temperature.s3.us-west-1.amazonaws.com/Global/Gridded/Land_and_Ocean_LatLong1.nc)
- Berkeley Earth global monthly text series on the same bucket was last modified 10 Jan 2025 and its last data row is December 2024 — [Land_and_Ocean_complete.txt](https://berkeley-earth-temperature.s3.us-west-1.amazonaws.com/Global/Land_and_Ocean_complete.txt)
- CRU TS 4.09 monthly mean temperature, 1901-2024, is a single 443 MB gzip NetCDF — [cru_ts4.09.1901.2024.tmp.dat.nc.gz](https://crudata.uea.ac.uk/cru/data/hrg/cru_ts_4.09/cruts.2503051245.v4.09/tmp/cru_ts4.09.1901.2024.tmp.dat.nc.gz)
- NOAAGlobalTemp v6 time series and gridded files are served from an open NCEI directory (listing returned HTTP 200) — [NCEI NOAAGlobalTemp v6](https://www.ncei.noaa.gov/data/noaa-global-surface-temperature/v6/access/timeseries/)

CHIRPS rainfall
- CHIRPS v3.0 was released 2025-01-01; it is quasi-global land-only 60°N-60°S at 0.05°, 1981 to near-real time, in pentad to annual steps, as NetCDF, GeoTIFF, COG and BIL — [CHIRPS v3.0 README](https://data.chc.ucsb.edu/products/CHIRPS/v3.0/README-CHIRPSv3.0.txt)
- Latency: preliminary CHIRPS appears 2 days after the end of each pentad; final CHIRPS is "typically complete during the third week of the following month" — [CHIRPS v3.0 README](https://data.chc.ucsb.edu/products/CHIRPS/v3.0/README-CHIRPSv3.0.txt)
- v3.0 uses more than 90 station sources (nearly four times v2.0), applies a gauge-undercatch correction that makes it "overall wetter compared to CHIRPS v2.0", extends coverage from 50° to 60° latitude, and fills gaps with 0.25° ERA5 instead of 0.5° CFS — [CHIRPS v3.0 README](https://data.chc.ucsb.edu/products/CHIRPS/v3.0/README-CHIRPSv3.0.txt)
- Whole-record global monthly files: `chirps-v3.0.monthly.nc` is 8.3 GiB (dated 15 Oct 2026) with a `by_year/` folder alongside — [CHIRPS v3.0 monthly global netcdf](https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/netcdf/)
- CHIRPS v2.0 is still being updated in parallel: `chirps-v2.0.monthly.nc` is 7.2 GiB, dated 13 Nov 2026, with a `byYear/` folder — [CHIRPS v2.0 global_monthly netcdf](https://data.chc.ucsb.edu/products/CHIRPS/v2.0/global_monthly/netcdf/)

### Inferences
- A complete "global trend map" starter kit (temperature from HadCRUT5 or NOAAGlobalTemp, precipitation from GPCP, SST from ERSSTv5, soil moisture from CPC) totals under 600 MB and downloads in minutes with plain `curl`; no accounts needed.
- These files are coarser than the 0.25° target (GPCP and HadCRUT are multi-degree grids). For 0.25-0.5° land detail the practical whole-file options are CRU TS (0.5°), GHCN-CAMS and UDel (0.5°), or coarsening CHIRPS by year.
- CHIRPS v2 and v3 are not interchangeable in one trend line because v3 is systematically wetter; pick one version for the whole record.
- Berkeley Earth's public S3 copy appears frozen at December 2024, so HadCRUT5 or NOAAGlobalTemp are safer for a record that reaches 2026.

### Gaps
- UNVERIFIED: grid resolutions and start years of the PSL files (prior knowledge: GPCP 2.5° from 1979; CMAP 2.5° from 1979; NOAAGlobalTemp 5° from 1850; ERSSTv5 2° from 1854; OISST 0.25° from 1981; CPC soil moisture 0.5° from 1948; GHCN-CAMS 0.5° from 1948; CRU TS 0.5°; Berkeley 1°). I only confirmed sizes and modification dates.
- GPCC precipitation: the PSL paths I guessed returned 404; availability and size not confirmed.
- TerraClimate (1958 onward, monthly, about 4 km): the download host `climate.northwestknowledge.net` reset the connection from the sandbox, so file sizes, the per-variable-per-year file pattern and the current end year are UNVERIFIED. The project page itself is live — [climatologylab.org/terraclimate](https://www.climatologylab.org/terraclimate.html).
- UNVERIFIED: ERA5 monthly means on single levels from the CDS (prior knowledge: a few variables for 1940 to present at 0.25° is on the order of 1-2 GB per variable; requires a free account and queue).
- UNVERIFIED: GLEAM evaporation and root-zone soil moisture (prior knowledge: v4, 0.1°, 1980 onward, monthly files small, but access is by SFTP credentials requested through a web form). The site is live — [gleam.eu](https://www.gleam.eu/).
- UNVERIFIED: SPEIbase / SPEI Global Drought Monitor (prior knowledge: 0.5° or 1° monthly SPEI NetCDF, 1901 or 1955 onward, open licence). The SPEI database viewer is live — [spei.csic.es/spei_database](https://spei.csic.es/spei_database/).
- Not checked: ESA CCI / C3S soil moisture, C3S sea level, GRACE-based water storage (NASA, out of scope), night-lights composites.

## Where are analysis-ready cloud Zarr copies of ERA5, CHIRPS, TerraClimate and similar, readable anonymously with xarray?

### Takeaway
ERA5 has two anonymous, current cloud copies: the ARCO-ERA5 Zarr on Google Cloud Storage (hourly 0.25°, 1940 to 30 June 2026 final plus ERA5T to 8 November 2026) and Earthmover's Icechunk store on AWS S3 (hourly 1940-2025, with a time-series-optimised chunk layout). TerraClimate is available as Zarr on the Planetary Computer but only through 2021; I found no verified anonymous Zarr copy of CHIRPS.

### Cited Findings

ERA5
- ARCO-ERA5 on GCS: `gs://gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3` is readable anonymously over HTTPS; its consolidated metadata (probed 2026-11-14) reports `valid_time_start` 1940-01-01, `valid_time_stop` 2026-06-30, `valid_time_stop_era5t` 2026-11-08, `last_updated` 2026-11-14, 277 arrays, and a time axis of 1,323,648 hourly steps — [ARCO-ERA5 .zmetadata](https://storage.googleapis.com/gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3/.zmetadata)
- Despite the `-v3` suffix in the path, the store exposes Zarr v2-style `.zmetadata` (HTTP 200) and has no `zarr.json` (HTTP 404) — [ARCO-ERA5 zarr.json probe](https://storage.googleapis.com/gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3/zarr.json)
- The ARCO-ERA5 recipes repository documents opening the store with xarray and anonymous token access — [google-research/arco-era5](https://github.com/google-research/arco-era5)
- Earthmover "Icechunk ERA5" on the AWS Open Data Registry: hourly 0.25° ERA5 from 1940 to 2025 as one Icechunk + Zarr v3 store; 35 single-level variables, 8 pressure-level variables on 13 levels, and a 500 hPa geopotential slice; updated quarterly; CC-BY 4.0; bucket `earthmover-icechunk-era5`, prefix `icechunkV2`, region us-east-1; no AWS account needed — [AWS Open Data Registry: Icechunk ERA5](https://registry.opendata.aws/earthmover-era5/)
- Each Earthmover group exists in two chunk layouts with identical data: `<group>/spatial` (one global map per hour) and `<group>/temporal` (long time series in small spatial tiles, "suited to time-series extraction, location-based analysis") — [AWS Open Data Registry: Icechunk ERA5](https://registry.opendata.aws/earthmover-era5/)
- Access code given on the registry page: `storage = icechunk.s3_storage(bucket="earthmover-icechunk-era5", prefix="icechunkV2", region="us-east-1", anonymous=True)`; `repo = icechunk.Repository.open(storage)`; `session = repo.readonly_session("main")`; `ds = xr.open_zarr(session.store, group="single/spatial", consolidated=False, chunks=None)` — [AWS Open Data Registry: Icechunk ERA5](https://registry.opendata.aws/earthmover-era5/)
- NCAR's ERA5 mirror bucket `nsf-ncar-era5` lists anonymously on S3 with prefixes `e5.oper.an.sfc/`, `e5.oper.an.pl/`, `e5.oper.fc.sfc.accumu/`, `e5.oper.fc.sfc.minmax/` and others — [nsf-ncar-era5 bucket listing](https://nsf-ncar-era5.s3.amazonaws.com/?list-type=2&delimiter=/&max-keys=30)
- The older `era5-pds` S3 bucket refused an anonymous listing with HTTP 403 — [era5-pds bucket probe](https://era5-pds.s3.amazonaws.com/?list-type=2&max-keys=3)
- ECMWF's own ARCO data lake gives tokenised (not anonymous) access to ERA5 and ERA5-Land cubes; it is described as a beta service with only a subset of single-level variables — [ECMWF forum: access to ARCO ERA5 data lake](https://forum.ecmwf.int/t/access-to-our-arco-era5-data-lake-zarr-store/15123)

Planetary Computer Zarr collections (from the live STAC API, 2026-11-14)
- `terraclimate`: Zarr assets `zarr-abfs` and `zarr-https`, temporal extent 1958-01-01 to 2021-12-01, licence CC0-1.0 — [Planetary Computer STAC collections](https://planetarycomputer.microsoft.com/api/stac/v1/collections)
- `gpm-imerg-hhr`: Zarr asset, extent 2000-06-01 to 2021-05-31 — [Planetary Computer STAC collections](https://planetarycomputer.microsoft.com/api/stac/v1/collections)
- `era5-pds`: listed with extent starting 1979-01-01 and open-ended — [Planetary Computer STAC collections](https://planetarycomputer.microsoft.com/api/stac/v1/collections)
- A short-lived read token for a collection's storage is issued without any login: `GET https://planetarycomputer.microsoft.com/api/sas/v1/token/terraclimate` returned HTTP 200 with a token valid about 24 hours — [Planetary Computer SAS token endpoint](https://planetarycomputer.microsoft.com/api/sas/v1/token/terraclimate)
- Planetary Computer documentation states hosted data is free to use, that some datasets need a token for Azure Blob access, and that no registration or subscription key is needed to obtain one — [Planetary Computer SAS docs](https://planetarycomputer.microsoft.com/docs/concepts/sas)

### Inferences
- For per-point multi-decade series from ERA5 without the Open-Meteo rate limit, Earthmover's `single/temporal` group is the best fit because it is chunked for time-series reads; ARCO-ERA5 on GCS is chunked one global field per hour (the name says "chunk-1"), so pulling 86 years for one point means touching hundreds of thousands of chunks.
- The ARCO-ERA5 time axis is longer than the data (1,323,648 hours is about 151 years), so code must slice to `valid_time_start`..`valid_time_stop` from the attributes or it will read empty chunks.
- ARCO-ERA5 is the only verified copy that reaches November 2026 (as preliminary ERA5T); Earthmover stops at 2025 and updates quarterly.
- The NCAR bucket's prefix names match NCAR's RDA file layout, which implies NetCDF files rather than Zarr; usable with `fsspec` + `xarray` but not analysis-ready.
- Planetary Computer's TerraClimate Zarr ends in December 2021, so it lacks the last four to five years; fine for long-term means, weak for "what happened recently".

### Gaps
- No verified anonymous Zarr of CHIRPS found. CHC itself serves NetCDF, GeoTIFF and COG only. UNVERIFIED leads: dynamical.org and Source Cooperative catalogues may carry CHIRPS or similar; not checked.
- UNVERIFIED: ERA5-Land Zarr copies (prior knowledge: ECMWF's tokenised ARCO service; some Pangeo/Source Cooperative copies). Not checked.
- UNVERIFIED: whether Planetary Computer's `era5-pds` actually extends past 2020 (prior knowledge says it covered 1979-2020 only; the STAC shows an open end date).
- Source Cooperative (`data.source.coop` responded, HTTP 400 on the bare root), Pangeo-Forge catalogues, Arraylake public datasets beyond ERA5, and Radiant/Clay were not examined. UNVERIFIED prior knowledge: Radiant Earth runs Source Cooperative (public S3-compatible hosting, anonymous reads); Radiant MLHub was retired and its datasets moved to Source Cooperative; Pangeo-Forge is largely unmaintained and many of its Zarr stores live on OSN or GCS.

## Which climate-mode index files are available as plain text at stable URLs, and how far back do they go?

### Takeaway
All the main indices are plain text with no auth at NOAA PSL, NOAA CPC and NOAA NCEI, and most were current to September-October 2026 when probed. Three widely-copied URLs are stale and should be avoided: PSL's Kaplan AMO (ends January 2023), PSL's `pdo.data` (last updated October 2025) and the Bureau of Meteorology RMM MJO file (frozen February 2024); NCEI's ERSSTv5 PDO and AMO files and CPC's MJO file are the current replacements.

### Cited Findings

ENSO
- Niño 3.4 anomaly, PSL "correlation" format (year plus 12 monthly columns, first line gives start and end year, missing = -99.99): 1948 to October 2026; footer labels the source "ERSST V6", anomaly from 1981-2010 — [psl.noaa.gov nina34.anom.data](https://psl.noaa.gov/data/correlation/nina34.anom.data)
- Long Niño 3.4 from HadISST: 1870 to September 2026 — [psl.noaa.gov nino34.long.anom.data](https://psl.noaa.gov/data/timeseries/month/data/nino34.long.anom.data)
- The older path `psl.noaa.gov/gcos_wgsp/Timeseries/Data/nino34.long.anom.data` returns HTTP 404 — [old gcos_wgsp path](https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/nino34.long.anom.data)
- Oceanic Niño Index (3-month running mean, columns SEAS YR TOTAL ANOM): DJF 1950 to ASO 2026; the latest value is +2.46 for ASO 2026 — [CPC oni.ascii.txt](https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt)
- Monthly Niño 1+2, 3, 4 and 3.4 SST and anomalies: January 1982 to October 2026; Niño 3.4 anomaly for October 2026 is +3.25 — [CPC sstoi.indices](https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices)
- Southern Oscillation Index: CPC file (standardised Tahiti minus Darwin) — [CPC soi](https://www.cpc.ncep.noaa.gov/data/indices/soi); PSL copy with data from 1951 to July 2026 — [psl.noaa.gov soi.data](https://psl.noaa.gov/data/correlation/soi.data)

Pacific and Atlantic decadal modes
- PDO from ERSSTv5: January 1854 to October 2026 (year plus 12 columns, missing = 99.99) — [NCEI ersst.v5.pdo.dat](https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.pdo.dat)
- PSL's `pdo.data` covers 1948-2025 and its footer says "updated 10/2025" — [psl.noaa.gov pdo.data](https://psl.noaa.gov/data/correlation/pdo.data)
- AMO from ERSSTv5 (North Atlantic 0-60°N SST anomaly; long format year, month, value): January 1854 to October 2026 — [NCEI ersst.v5.amo.dat](https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.amo.dat)
- PSL's Kaplan-SST AMO starts 1856 but its last value is January 2023 — [psl.noaa.gov amon.us.long.data](https://psl.noaa.gov/data/correlation/amon.us.long.data)

Atlantic and Arctic atmospheric modes
- NAO (CPC): PSL copy with data 1950 to July 2026 — [psl.noaa.gov nao.data](https://psl.noaa.gov/data/correlation/nao.data); CPC table from 1950 — [CPC norm.nao.monthly table](https://www.cpc.ncep.noaa.gov/products/precip/CWlink/pna/norm.nao.monthly.b5001.current.ascii.table)
- Station-based NAO (CRU, Gibraltar minus Iceland): 1821 to July 2026 — [CRU nao.dat](https://crudata.uea.ac.uk/cru/data/nao/nao.dat)
- AO: PSL copy 1950-2026 — [psl.noaa.gov ao.data](https://psl.noaa.gov/data/correlation/ao.data); CPC table from 1950 — [CPC monthly.ao.index table](https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_ao_index/monthly.ao.index.b50.current.ascii.table)

Indian Ocean Dipole
- Dipole Mode Index from HadISST1.1 (west box 10S-10N, 50-70E minus east box 10S-0, 90-110E): 1870 to May 2026; file created 25 July 2026 and flagged "Preliminary"; missing = -9999 — [psl.noaa.gov dmi.had.long.data](https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data)

MJO
- CPC daily MJO index file: HTTP 200, last modified 5 November 2026 — [CPC proj_norm_order.ascii](https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_mjo_index/proj_norm_order.ascii)
- PSL OLR-based MJO index (OMI): HTTP 200, last modified 29 June 2026 — [psl.noaa.gov omi.1x.txt](https://psl.noaa.gov/mjo/mjoindex/omi.1x.txt)
- Bureau of Meteorology RMM file: the `clim_data/IDCKMJCN04` URL returns 404, and the older `climate/mjo/graphics` URL redirects to a file last modified 25 February 2024 — [BoM rmm.74toRealtime.txt](http://www.bom.gov.au/climate/mjo/graphics/rmm.74toRealtime.txt)

Greenhouse gases, global temperature and sea ice (same plain-text pattern)
- Mauna Loa monthly CO2: March 1958 to September 2026 (monthly mean 426.07 ppm; deseasonalised 429.55 ppm); `#`-commented header — [NOAA GML co2_mm_mlo.txt](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt)
- Global monthly marine-surface CH4: through June 2026 (1934.57 ppb) — [NOAA GML ch4_mm_gl.txt](https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt)
- NSIDC Sea Ice Index v4.0 monthly extent CSVs (one file per month and hemisphere): 1979 to September 2026 (September 2026 Arctic extent 4.81 million km²); the `source_dataset` column switches from NSIDC-0051 to NSIDC-0803 from 2025 — [NSIDC Sea Ice Index N_09_extent_v4.0.csv](https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv)

### Inferences
- A single small loader handles most of these: PSL "correlation" files share one format (header line with start/end year, 12 columns, sentinel missing values that differ by file: -99.9, -99.99, 99.99, -9999).
- The index files show a strong El Niño under way in late 2026 (ONI +2.46 for ASO; monthly Niño 3.4 +3.25 in October). If these values hold, the hackathon weekend coincides with an event at or above the strength of 1997-98 and 2015-16, which gives Canary a live "why are distant regions moving in opposite directions right now" story. The magnitude is taken straight from the CPC files; I did not cross-check it against a CPC bulletin.
- PSL's Niño 3.4 file now cites ERSST V6 while NCEI's PDO/AMO files are still named `ersst.v5`; baselines differ across files (ONI uses rolling 30-year base periods, PSL uses 1981-2010), so indices from different files should not be mixed in one chart without noting it.
- The DMI file lags about five months; for a current IOD value the team needs another source.

### Gaps
- UNVERIFIED: start month of the CH4 global series (prior knowledge: July 1983).
- UNVERIFIED: a current plain-text IOD/DMI source (prior knowledge: BoM publishes weekly IOD values and NOAA OOPC/PSL has an OISST-based DMI; BoM restructured its website in late 2025 and old data URLs broke, consistent with the 404 I saw).
- UNVERIFIED: exact column layout of the CPC MJO and PSL OMI files; I confirmed only that they exist and their modification dates.
- Not checked: PNA, SAM/AAO, QBO, TNA/TSA, Atlantic Niño, and the PSL index list page itself (`psl.noaa.gov/data/climateindices/list/`).

## What changed in 2025-2026 (service shutdowns, API migrations, licence changes, funding-related outages, especially for US federal data services)?

### Takeaway
Core NOAA text and NetCDF endpoints were live and current on 14 November 2026, but several US federal products were retired in 2025 (NCEI snow and ice products, the Billion-Dollar Disasters database, a batch of coastal/marine tools) and several long-used URLs have moved or gone stale. Outside NOAA, the notable changes are CHIRPS v3.0 and a new CHC directory layout, HadCRUT 5.2.0.0, the ReliefWeb API v1 shutdown with mandatory approved app names, and the continued operation of the free Planetary Computer catalogue after its Hub was retired.

### Cited Findings

US federal services
- NOAA NCEI stopped maintaining its snow and ice data products effective 5 May 2025; affected products hosted at NSIDC include global sea ice extent, snow cover and glacier inventories — [E&E News](https://www.eenews.net/articles/threats-to-noaa-funded-snow-and-ice-data-products-alarm-polar-scientists)
- Despite that, the NSIDC Sea Ice Index monthly file contained September 2026 data when probed — [NSIDC Sea Ice Index](https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv)
- NOAA stopped updating the Billion-Dollar Weather and Climate Disasters database after calendar year 2024; the 1980-2024 records remain archived — [Utility Dive](https://www.utilitydive.com/news/noaa-stops-tracking-climate-disasters-billion-dollar-database/748107/)
- Reporting tied the retirements to budget and staffing pressure, citing proposals for a 24% cut to NOAA's 2026 budget including elimination of its research division — [E&E News](https://www.eenews.net/articles/threats-to-noaa-funded-snow-and-ice-data-products-alarm-polar-scientists)
- PSL's PDO file was last updated October 2025, and PSL's Kaplan AMO ends January 2023 (see index section) — [psl.noaa.gov pdo.data](https://psl.noaa.gov/data/correlation/pdo.data); [psl.noaa.gov amon.us.long.data](https://psl.noaa.gov/data/correlation/amon.us.long.data)
- USGS earthquake catalogue API (FDSN event service, version 2.8.4) answered without auth; `count` and `query?format=geojson` both worked — [USGS FDSN event API](https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2026-11-01&minmagnitude=6.5&limit=2)
- USDA's G-REALM global reservoir and lake monitor page returned HTTP 503 when probed — [USDA G-REALM](https://ipad.fas.usda.gov/cropexplorer/global_reservoir/)

Dataset versions and paths
- CHIRPS v3.0 was released 2025-01-01; CHC's directory layout changed so that the old `products/CHIRPS-2.0/` path returns 404 and data now live under `products/CHIRPS/v2.0/` and `products/CHIRPS/v3.0/` — [CHC products CHIRPS index](https://data.chc.ucsb.edu/products/CHIRPS/); [old CHIRPS-2.0 path](https://data.chc.ucsb.edu/products/CHIRPS-2.0/)
- The CHIRPS v3.0 README credits collaboration with "the United States Department of State Famine Early Warning Systems Network (FEWS NET)" and USGS EROS — [CHIRPS v3.0 README](https://data.chc.ucsb.edu/products/CHIRPS/v3.0/README-CHIRPSv3.0.txt)
- HadCRUT5 moved to version 5.2.0.0 on 18 September 2026; version-pinned 5.0.2.0 URLs still resolve but stop at February 2025 — [Met Office HadCRUT5](https://www.metoffice.gov.uk/hadobs/hadcrut5/)

Humanitarian and hazard APIs
- ReliefWeb API v1 is gone: it returns HTTP 410 "The API version 'v1' has been decommissioned. Please use version 'v2' instead." — [ReliefWeb API v1](https://api.reliefweb.int/v1/disasters?appname=test&limit=1)
- ReliefWeb API v2 rejects unregistered app names with HTTP 403: "You are not using an approved appname. Kindly request an appname from ReliefWeb" — [ReliefWeb API v2](https://api.reliefweb.int/v2/disasters?appname=test&limit=1); request form at [apidoc.reliefweb.int](https://apidoc.reliefweb.int/parameters#appname)
- GDACS event API answered without auth and returned GeoJSON with event type, GLIDE number and coordinates for floods between 1 October and 10 November 2026 — [GDACS API](https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&fromdate=2026-10-01&todate=2026-11-10)

Platforms
- Microsoft retired the Planetary Computer Hub (the hosted JupyterHub) on 6 June 2024 — [Planetary Computer GitHub discussion 347](https://github.com/microsoft/PlanetaryComputer/discussions/347)
- The free Planetary Computer data catalogue and STAC API were live on 14 November 2026 with 139 collections; a STAC search returned a Sentinel-2 L2A scene acquired 9 November 2026; collections named `predicted-damage-colombia-2026` and `predicted-damage-venezuela-2026` show additions during 2026 — [Planetary Computer STAC API](https://planetarycomputer.microsoft.com/api/stac/v1/collections)
- "Planetary Computer Pro" is a separate paid Azure service for organisations' private geospatial data, priced on storage, operations and compute — [Microsoft Learn: Planetary Computer Pro](https://learn.microsoft.com/en-us/azure/planetary-computer); [Azure pricing](https://azure.microsoft.com/pricing/details/planetary-computer-pro/)
- Copernicus Climate Data Store: the current API uses a personal access token from the user profile in `~/.cdsapirc` (or `CDSAPI_URL` / `CDSAPI_KEY`), without the old `UID:key` prefix, and an ECMWF account — [CDS API setup](https://cds.climate.copernicus.eu/how-to-api); [ECMWF forum step-by-step](https://forum.ecmwf.int/t/step-by-step-instructions-on-how-to-download-data-using-new-climate-data-store-beta-cds-beta/3743)
- The same API pattern serves the Atmosphere Data Store (CAMS) and the Early Warning Data Store (GloFAS, drought) at separate URLs — [ADS API setup](https://ads.atmosphere.copernicus.eu/how-to-api); [EWDS API setup](https://ewds.climate.copernicus.eu/how-to-api)
- Each CDS dataset's licence must be accepted on the website, per account, before the API will serve it — [xcube CDS guide](https://earthsystemdatalab.net/guide/jupyterlab/notebooks/xcube-datastores/Generate_C3S_CDS_cubes/)
- WorldPop REST endpoints (`www.worldpop.org/rest/data` and `hub.worldpop.org/rest/data/pop`) failed TLS verification with "certificate has expired" when probed on 14 November 2026 — [WorldPop REST](https://hub.worldpop.org/rest/data/pop)

### Inferences
- The pattern for US federal data in 2025-2026 is quiet staleness rather than hard outages: URLs keep answering but the file stops updating (PSL PDO and AMO, Dai PDSI). Checking the last data row at startup is a cheap guard.
- The NSIDC Sea Ice Index survived the NCEI decommissioning, apparently by switching its input product (NSIDC-0051 to NSIDC-0803 from 2025).
- ReliefWeb needs an approved app name, which may not be granted within a 48-hour hackathon; GDACS and USGS need nothing.
- The Planetary Computer remains a usable free STAC source of Sentinel, Landsat and MODIS in 2026, but several of its climate Zarr cubes are frozen (TerraClimate at 2021, IMERG at 2021).
- The WorldPop certificate failure may be transient, but it means the team should fetch any WorldPop rasters early or use GHSL population instead.

### Gaps
- No single authoritative list of NOAA/NCEI retirements for 2025-2026 was found; NCEI's "Notice of Changes" page was not reached.
- UNVERIFIED: effects of the October-November 2025 US federal government shutdown on NOAA/USGS web services (prior knowledge: many sites carried "not being updated" banners while operational data flows continued).
- UNVERIFIED: ERA5 licence. Prior knowledge is that ECMWF moved Copernicus datasets from the bespoke "Licence to use Copernicus Products" to CC-BY 4.0 during 2025; the only corroboration found is that Earthmover's ERA5 copy is labelled CC-BY 4.0 and a third-party R client accepts a licence id `cc-by` — [AWS registry](https://registry.opendata.aws/earthmover-era5/); [CopernicusClimate R manual](https://cran.r-universe.dev/CopernicusClimate/CopernicusClimate.pdf).
- UNVERIFIED: current CDS queue times (prior knowledge: minutes for small ERA5 monthly requests, hours for large hourly ones; per-request size limits apply; the legacy CDS was switched off in September 2024).
- UNVERIFIED: a search result mentioned Planet-run Sentinel Hub deprecations (a Catalog API 0.9.0 end-of-life and a third-party data import sunset on 11 November 2026); I did not open those pages and they concern Planet's commercial Sentinel Hub, not the Copernicus Data Space deployment.
- The Planetary Computer changelog page rendered empty to my fetcher, so no dated list of catalogue changes was obtained.
- Not checked: status of Global Forest Watch, EM-DAT, GRDC, Hydroweb, EOG night lights, USGS M2M/Landsat access changes.

## What other sources in the brief are usable within a weekend (Copernicus services, surface water, settlement, hazards, geocoding, boundaries, base maps), and how are they accessed?

### Takeaway
Copernicus Data Space offers the broadest free non-NASA catalogue (Sentinel plus the Copernicus Land Monitoring global vegetation, soil-water, burned-area, water-body and lake-level products) but needs a free account and has monthly quotas of 10,000 Sentinel Hub processing units and 10,000 openEO credits. For the front end, keyless geocoding is available from Open-Meteo and Nominatim (1 request/second, no autocomplete), boundaries from geoBoundaries and Natural Earth, and keyless vector base maps from OpenFreeMap and CARTO style endpoints.

### Cited Findings

Copernicus Data Space Ecosystem (CDSE)
- Free "Copernicus General" quotas: Sentinel Hub APIs 10,000 requests and 10,000 processing units per month, 300 per minute; openEO 10,000 credits per month (a temporary boost announced 3 September 2024), 2 concurrent jobs; downloads up to 12 TB per rolling 30 days, 4 concurrent connections at 20 MB/s; access tokens last 10 minutes; Sentinel Hub Batch Processing is not available to free users — [CDSE quotas](https://documentation.dataspace.copernicus.eu/Quotas.html)
- The CDSE STAC API is public for searching (`https://stac.dataspace.copernicus.eu/v1`) and listed at least 300 collections on 14 November 2026 — [CDSE STAC collections](https://stac.dataspace.copernicus.eu/v1/collections?limit=300)
- Collections include Sentinel-1 (GRD, SLC, global mosaics), Sentinel-2 (L1C, L2A, global mosaics), Sentinel-3, Landsat Collection 2 Level-1, MODIS (vegetation indices, LST, burned area MCD64A1, fire MOD14, land cover MCD12Q1) and Copernicus DEM — [CDSE STAC collections](https://stac.dataspace.copernicus.eu/v1/collections?limit=300)
- Copernicus Land Monitoring Service global products in the same catalogue (collection ids): NDVI 1 km and 300 m 10-daily including long-term statistics (`clms_ndvi_global_1km_10daily_v3`, `clms_ndvi-lts_global_1km_10daily_v3`), LAI, FAPAR, FCOVER, GPP/NPP/DMP, burned area 300 m daily and monthly (`clms_ba_global_300m_monthly_v4`), Soil Water Index 12.5 km daily and 10-daily plus a time-series product (`clms_swi-timeseries_global_12.5km_daily_v4_nc`), water bodies 100 m / 300 m / 1 km, land surface temperature 5 km hourly, snow cover and snow water equivalent, global land cover 100 m yearly, and lake and river water levels as daily vector GeoJSON (`clms_wl-lakes_global_vector_daily_v2_geojson`, `clms_wl-rivers_global_vector_daily_v2_geojson`) — [CDSE STAC collections](https://stac.dataspace.copernicus.eu/v1/collections?limit=300)

Planetary Computer catalogue (no account; STAC at `https://planetarycomputer.microsoft.com/api/stac/v1`)
- Relevant collections and temporal extents from the live API: `landsat-c2-l2` from 1982-08-22; `sentinel-2-l2a` from 2015-06-27; `sentinel-1-rtc` from 2014-10-10 (CC-BY-4.0); `sentinel-5p-l2-netcdf` from 2018-04-30; `modis-13A1-061` vegetation indices from 2000-02-18; `modis-64A1-061` burned area from 2000-11-01; `jrc-gsw` surface water 1984-03 to 2020-12; `esa-cci-lc` land cover 1992-2020; `io-lulc-annual-v02` 10 m land cover 2017-2024; `noaa-cdr-sea-surface-temperature-optimum-interpolation` from 1981-09; `nasa-nex-gddp-cmip6` 1950-2100; `deltares-water-availability` 1970-2020; `ms-buildings`; `cop-dem-glo-30`; `hls2-l30` from 2020 — [Planetary Computer STAC collections](https://planetarycomputer.microsoft.com/api/stac/v1/collections)

Surface water, settlement, population
- JRC Global Surface Water v1.4 tiles are directly downloadable without auth from a public bucket (example occurrence tile 0E_50N, 36.8 MB, `downloads2021` folder) — [JRC GSW occurrence tile](https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_0E_50Nv1_4_2021.tif)
- Global Human Settlement Layer files are served from the JRC open-data file server (HTTP 200) — [JRC GHSL open data](https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/)

Hazards and drought
- USGS earthquakes: `https://earthquake.usgs.gov/fdsnws/event/1/` (`query`, `count`; GeoJSON/CSV; no key) — [USGS FDSN event API](https://earthquake.usgs.gov/fdsnws/event/1/count?starttime=2026-11-01&minmagnitude=6)
- GDACS: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH` with `eventlist` (for example FL), `fromdate`, `todate`; GeoJSON; no key — [GDACS API](https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&fromdate=2026-10-01&todate=2026-11-10)
- Copernicus Global Drought Observatory download page is live — [GDO download](https://drought.emergency.copernicus.eu/tumbo/gdo/download/)
- EM-DAT public portal is live — [EM-DAT](https://public.emdat.be/)
- European Ground Motion Service portal is live (last modified 29 October 2026) — [EGMS](https://egms.land.copernicus.eu/)
- Hydroweb.next (lake and river levels from altimetry) portal is live — [hydroweb.next](https://hydroweb.next.theia-land.fr/)

Geocoding and boundaries
- Nominatim public API policy: absolute maximum 1 request per second per application (all users combined); a custom User-Agent or Referer identifying the app is required; client-side autocomplete is prohibited; bulk and systematic queries are discouraged or banned; results should be cached; attribution required; data under ODbL; violations lead to bans — [OSMF Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- The policy also says LLM-generated code must comply with it and that no-code/low-code/"vibe-coding" platforms must not build in the public API as a generic geocoder — [OSMF Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- Nominatim search worked without a key and returned lat/lon, OSM id, class/type and an ODbL licence string — [Nominatim search](https://nominatim.openstreetmap.org/search?q=Reykjavik&format=json&limit=1)
- Photon (Komoot's OSM geocoder) answered without a key, but with `limit=1` the query "Reykjavik" returned a locality in Manitoba, Canada, not Iceland's capital — [Photon API](https://photon.komoot.io/api/?q=Reykjavik&limit=1)
- geoBoundaries API (`https://www.geoboundaries.org/api/current/gbOpen/{ISO3}/{ADM level}/`) returns JSON metadata with download links and a per-boundary licence; the Iceland ADM1 record is sourced from OpenStreetMap under ODbL 1.0 — [geoBoundaries API](https://www.geoboundaries.org/api/current/gbOpen/ISL/ADM1/)
- Natural Earth files download directly from the NACIS CDN (110 m countries shapefile zip is 215 KB) — [Natural Earth CDN](https://naciscdn.org/naturalearth/110m/cultural/ne_110m_admin_0_countries.zip)
- GADM 4.1 per-country files download directly (Iceland level-1 GeoJSON zip, 72 KB; files dated July 2022) — [GADM 4.1](https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_ISL_1.json.zip)

Base map endpoints that answered without a key on 14 November 2026
- OpenFreeMap "liberty" vector style — [tiles.openfreemap.org](https://tiles.openfreemap.org/styles/liberty)
- CARTO "positron" GL style — [basemaps.cartocdn.com](https://basemaps.cartocdn.com/gl/positron-gl-style/style.json)
- MapLibre demo tiles style — [demotiles.maplibre.org](https://demotiles.maplibre.org/style.json)
- OpenStreetMap standard raster tiles — [tile.openstreetmap.org](https://tile.openstreetmap.org/0/0/0.png)

### Inferences
- For a hometown search box, Open-Meteo's geocoder (keyless, returns population and admin names, no stated ban on autocomplete in what I read) is a safer default than Nominatim, whose policy forbids autocomplete and caps the whole app at 1 request/second; Nominatim remains useful for a single on-submit lookup or reverse geocoding.
- Photon's ranking can put an obscure namesake first, so any geocoder result list should show several candidates with country names instead of taking the first hit.
- geoBoundaries licences vary per boundary (some ODbL, which is share-alike); Natural Earth is the simplest choice for country and admin-1 outlines.
- CDSE is the non-NASA route to MODIS-era-plus-Sentinel vegetation, burned-area, soil-water and lake-level series, but account creation, 10-minute tokens and quota accounting make it a second-tier option for a 48-hour build compared with keyless sources.
- The European Ground Motion Service covers Europe only by design, so it cannot serve "any place on Earth".

### Gaps
- UNVERIFIED (prior knowledge, not checked this session):
  - CDSE Sentinel Hub Statistical API is included in the free processing-unit quota and returns per-polygon time-series statistics; the quota page does not mention it by name.
  - C3S satellite soil moisture (ESA CCI-based, 0.25°, daily/dekadal/monthly, 1978 onward) and C3S sea level are served through the CDS API with a free account.
  - CAMS global reanalysis (EAC4, about 0.75°, 2003 onward, 3-hourly and monthly means) is served through the Atmosphere Data Store API with a free account.
  - GloFAS historical river discharge (0.05°, 1979/1984 onward) is on the Early Warning Data Store; GRDC station discharge requires a download request through its portal with non-commercial terms.
  - JRC Global Surface Water covers 1984-2021 at 30 m (v1.4); newer annual updates may exist. The licence is open with attribution.
  - GHSL R2023A gives built-up surface and population grids at 5-year epochs 1975-2030 (100 m, 1 km), CC BY 4.0.
  - WorldPop gives annual 100 m and 1 km population 2000-2020 (and a newer 2015-2030 series), CC BY 4.0, by direct file download or REST API.
  - Global Forest Watch Data API (`data-api.globalforestwatch.org`) needs a free API key for queries; my unauthenticated probes returned empty bodies. Hansen tree-cover loss runs 2001 to the latest year at 30 m; GLAD and integrated deforestation alerts are served through the same API and as tiles.
  - EM-DAT requires free registration and is free for non-commercial use only; data from 1900, most reliable from 2000.
  - EGMS needs a free account for downloads; Sentinel-1 based, 2015/2018 onward, annual updates.
  - Hydroweb.next needs a free account and API key; G-REALM gives text files per lake from 1992 onward (the site returned 503 when probed).
  - Natural Earth is public domain; GADM is free for academic and non-commercial use and forbids redistribution and commercial use without permission.
  - OpenStreetMap's tile usage policy forbids heavy use and bulk downloading and requires attribution and a valid Referer/User-Agent; OpenFreeMap states no limits and no key with OSM attribution; CARTO basemaps are free for limited non-commercial use with attribution.
  - MapLibre GL JS (BSD-3) supports a globe projection since v5; deck.gl (MIT) has `GlobeView`; CesiumJS (Apache-2.0) is the full 3D globe engine and its default imagery and terrain need a free Cesium ion token.
  - USGS/EROS Landsat Collection 2 is on AWS in a requester-pays bucket; Planetary Computer and CDSE host no-cost copies (Level-2 on Planetary Computer; Level-1 on CDSE per the collection ids seen).
  - Night lights from non-NASA sources: Earth Observation Group (Colorado School of Mines) annual VIIRS and DMSP composites need a free login; a harmonised DMSP-VIIRS 1992-onward series exists on Figshare.
- Not researched at all because the work was stopped: Copernicus Global Land Service legacy portal status, ESA CCI open data portal, Global Fire Emissions Database (site answered HTTP 200 at globalfiredata.org), CAMS GFAS, and free-tier terms of MapTiler, Stadia and Protomaps.
