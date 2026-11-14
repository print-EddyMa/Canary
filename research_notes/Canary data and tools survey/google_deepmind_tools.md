# Google and Google DeepMind tools, models and datasets for Earth observation, weather and climate (state as of 14 November 2026)

Reading notes for the report writer:

- Every finding was retrieved on 14 Nov 2026. Where the newest source I could reach is from 2025 or earlier, the bullet is tagged **[2025 source]** or **[2024 source]**.
- "Search snippet only" means I saw the claim in a search result summary but did not open the primary page. Treat those as lower confidence.
- Status labels used throughout: **OPEN** (usable now with a free account), **GATED** (form, allowlist, waitlist or trusted tester), **PAPER/PREVIEW** (no practical access for a hackathon team).
- Several things changed in 2026 that older write-ups get wrong: Earth Engine now has monthly EECU quota tiers (from 27 Apr 2026), WeatherNext 3 replaced WeatherNext 2 as flagship (Aug 2026), the GraphCast repo is now `google-deepmind/weathernext`, WeatherNext Gen/Graph datasets were deprecated (Jul 2026), and TimesFM 3.0 shipped with a non-commercial weights licence (Aug 2026).

## Which of these can a team with free accounts start using within an hour, and which need approval that would not arrive during a weekend?

### Takeaway
Usable within an hour on free accounts: Earth Engine (noncommercial Community tier, access "enabled immediately"), the AlphaEarth Satellite Embedding dataset, Dynamic World, Open Buildings, PARDIG precipitation, the NASA catalogue in Earth Engine, ARCO-ERA5 and WeatherBench 2 Zarr stores (anonymous), TimesFM 2.5 (Apache-2.0 weights), NeuralGCM, the open WeatherNext 2 / Gen / Graph weights, Weather Lab cyclone downloads, and the Gemini API tools. Not obtainable in a weekend: WeatherNext 2 and 3 forecast data (form, 5-7 business days), WeatherNext custom inference (allowlist via account team), Flood Forecasting API (waitlist), Earth AI Geospatial Reasoning agent, Planetary Prediction Engine, Remote Sensing Foundations and PDFM (trusted tester / early access), Custom Satellite Embeddings (preview), FireSat data (early adopters only), and the Earth Engine Partner tier (weeks).

### Cited Findings

#### Quick status table (details and sources in the item sections below)

| Asset | Status | Time to first use | Gate |
|---|---|---|---|
| Earth Engine, Community tier | OPEN | Minutes ("enabled immediately" after registration) | Noncommercial questionnaire in Cloud Console |
| Satellite Embedding V1 (AlphaEarth) in Earth Engine | OPEN | Minutes once EE works | None beyond EE |
| NASA catalogue in EE (MODIS, IMERG, GRACE, GLDAS, MERRA-2, FIRMS) | OPEN | Minutes | None beyond EE |
| Dynamic World V1 | OPEN | Minutes | None beyond EE |
| Open Buildings 2.5D Temporal | OPEN | Minutes | None beyond EE |
| PARDIG-LR / PARDIG-NRT precipitation | OPEN | Minutes | None ("no application required") |
| ARCO-ERA5 Zarr on GCS | OPEN | Minutes | Anonymous (`token='anon'`) |
| WeatherBench 2 Zarr on GCS | OPEN | Minutes | Public bucket; per-dataset LICENSE files |
| TimesFM 2.5 (Hugging Face / PyPI) | OPEN | Minutes | None; Apache-2.0 |
| TimesFM 3.0 weights | OPEN, non-commercial licence | Minutes | Licence restricts to non-commercial, non-production |
| BigQuery `AI.FORECAST` (TimesFM 2.5 default; 3.0 Preview) | OPEN, needs Cloud project | Under an hour | BigQuery billing/sandbox rules apply |
| NeuralGCM code and checkpoints | OPEN | Under an hour to install; GPU advisable | None |
| WeatherNext 2 / Cyclones / Gen / Graph open weights (GitHub `google-deepmind/weathernext`) | OPEN | Mini models on free Colab TPU | Full models need H100-class accelerator |
| Weather Lab cyclone track downloads (CSV / ATCF) | OPEN | Minutes | None documented |
| Gemini API tools (function calling, code execution, Search, Maps, URL context, File Search) | OPEN | Minutes with an API key | Free-tier limits not confirmed |
| Earth Engine in BigQuery (`ST_REGIONSTATS`) | OPEN, needs Cloud project | Under an hour | EE API enabled; US region only |
| WeatherNext 3 and WeatherNext 2 forecast data (EE / BigQuery / GCS) | GATED | 5-7 business days typical | WeatherNext Data Request Form |
| WeatherNext custom inference on Google Cloud | GATED | Unknown; via account team | Allowlist, billing |
| Flood Forecasting API | GATED | Unknown | Waitlist + API key |
| Earth AI Geospatial Reasoning Agent API (A2A) | GATED | Unknown | Early partners / interest form |
| Planetary Prediction Engine | GATED / PREVIEW | Unknown | Early preview |
| Remote Sensing Foundations, PDFM (Population Dynamics) | GATED | Unknown | Trusted tester / request |
| Custom Satellite Embeddings (Maps Platform) | GATED / PREVIEW | Missed (academic sample deadline was 1 Sep 2026) | Preview for customers |
| FireSat data | GATED | Not available | Early adopters (fire agencies, scientists) |
| Earth Engine Partner tier (100,000 EECU-hours) | GATED | "Up to several weeks" | Application |

#### Google Earth Engine (platform)

- Registration flow: create or choose a Cloud project, enable the Earth Engine API, register the project as commercial or noncommercial; "After registration, Earth Engine access is enabled immediately." Noncommercial projects do not require billing. — [Earth Engine access guide](https://developers.google.com/earth-engine/guides/access)
- Noncommercial eligibility is confirmed through a questionnaire in the Cloud Console; projects must be reverified periodically; if Google determines a project is commercial it cannot be used without paying. **[page's latest dated content is from 2025]** — [Earth Engine access guide](https://developers.google.com/earth-engine/guides/access)
- From 27 April 2026, every noncommercial project has a monthly quota of Earth Engine compute units, applied per project and reset at midnight Pacific Time on the first of each month. — [Noncommercial tiers](https://developers.google.com/earth-engine/guides/noncommercial_tiers)
- Community tier: 150 EECU-hours per month, "Available to all verified noncommercial projects. No additional requirements." — [Noncommercial tiers](https://developers.google.com/earth-engine/guides/noncommercial_tiers)
- Contributor tier: 1,000 EECU-hours per month; requires an active billing account but noncommercial usage is not charged. — [Noncommercial tiers](https://developers.google.com/earth-engine/guides/noncommercial_tiers)
- Partner tier: 100,000 EECU-hours per month; separate application; "Approval may take up to several weeks." — [Noncommercial tiers](https://developers.google.com/earth-engine/guides/noncommercial_tiers)
- Quotas are "not hard cut-off values": after the monthly hours are used, work continues "in a lower-parallelism mode until your credits reset." Spreading work over several projects to get more quota is "quota farming" and breaches the Terms of Service. — [Noncommercial tiers](https://developers.google.com/earth-engine/guides/noncommercial_tiers)
- NASA datasets confirmed in the catalogue (IDs shown as catalogue slugs; replace `_` with `/` for the asset path): `MODIS_061_MCD64A1` (monthly burned area, 500 m), `MODIS_061_MCD43A4` (BRDF-adjusted reflectance), `MODIS_061_MCD12Q1` (yearly land cover), `MODIS_061_MCD15A3H` (LAI/FPAR), `NASA_GPM_L3_IMERG_V07` and `NASA_GPM_L3_IMERG_MONTHLY_V07` (V06 monthly not produced after Sep 2021), `NASA_GRACE_MASS_GRIDS_V04_LAND`, `_OCEAN`, `_MASCON`, `_MASCON_CRI`, `NASA_GLDAS_V021_NOAH_G025_T3H` (GLDAS-2.1, 3-hourly), `NASA_GLDAS_V022_CLSM_G025_DA1D` (GLDAS-2.2, daily), MERRA-2 aerosol collections `NASA_GSFC_MERRA_aer_2` and `NASA_GSFC_MERRA_aer_nv_2`, `FIRMS`, `NASA_FLDAS_NOAH01_C_GL_M_V001`, `NASA_GIMMS_3GV0` (long-term AVHRR NDVI), `NASA_ORNL_DAYMET_V4`, GEDI biomass, GEOS-CF. — [Earth Engine NASA tag page](https://developers.google.com/earth-engine/datasets/tags/nasa)
- GLDAS-2.0 is described as "a temporally consistent series from 1948 through 2014"; MERRA-2 land, radiation and single-level collections (M2T1NXLND, M2T1NXRAD, M2T1NXSLV, V5.12.4) are in the catalogue (search snippet only for these two points). — [Earth Engine NASA tag page](https://developers.google.com/earth-engine/datasets/tags/nasa)
- Xee (Xarray backend for Earth Engine): opens `ee.Image` / `ee.ImageCollection` as lazy `xarray.Dataset`; current line is a **v0.1.0 prerelease** ("major refactor with breaking API changes", install with `pip install --upgrade --pre xee`); Apache-2.0; "not an official Google product"; README recommends the high-volume endpoint `https://earthengine-highvolume.googleapis.com`. Usage: `grid = helpers.extract_grid_params(ic); ds = xr.open_dataset(ic, engine='ee', **grid)`; the README's own example collection is `ECMWF/ERA5_LAND/MONTHLY_AGGR`. — [google/Xee README](https://github.com/google/Xee)
- Earth Engine in BigQuery: the `ST_REGIONSTATS` geography function "is similar to Earth Engine's reduceRegion function" and combines Earth Engine rasters with BigQuery vector data; the Earth Engine API must be enabled; Earth Engine rasters are only usable from queries running in the US region; a `scale` option sets pixel size; also exposed in Python as `bigframes.bigquery.st_regionstats` (search snippets only). — [Work with raster data using Earth Engine in BigQuery](https://docs.cloud.google.com/bigquery/docs/raster-data); [BigQuery integrations guide](https://developers.google.com/earth-engine/guides/bigquery_integrations)

#### AlphaEarth Foundations / Satellite Embedding V1 (see the dedicated key question below for analysis methods)

- Earth Engine ID `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`; 64 bands `A00`-`A63`, 10 m, annual; CC-BY 4.0 with attribution "The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind." — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Also on Cloud Storage at `gs://alphaearth_foundations`; the catalogue page says that as of July 2026 the bucket is set up as "provider pays". — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Custom Satellite Embeddings (Google Maps Platform) is a separate product that "complements our global annual Satellite Embedding dataset ... by providing higher-frequency, on-demand data"; it is a preview aimed at customers, with an academic sample programme whose application deadline was 1 September 2026 (search snippet only). — [Maps Platform blog: Custom Satellite Embeddings](https://mapsplatform.google.com/resources/blog/introducing-custom-satellite-embeddings-powered-by-alphaearth-foundations/)

#### Google Earth AI, Geospatial Reasoning, PDFM, Remote Sensing Foundations

- 14 Oct 2026 Google Research post: a technical report on the Geospatial Reasoning agent (four benchmarks, two new: GeoKTools and GeoExpertQueries), partner testing with WHO AFRO, People in Need, GiveDirectly, Milken Institute and WPP, and "expanded experimental access". — [Putting Earth AI to work](https://research.google/blog/putting-earth-ai-to-work-geospatial-agents-for-our-planets-biggest-challenges/)
- Access as of that post: "Ask Google Earth" deep analysis is an experimental preview "for a limited group of early users"; the Geospatial Reasoning Agent API is an experimental headless Agent-to-Agent (A2A) service "for early partners and developer teams"; the Planetary Prediction Engine is in early preview. Sign-up is via an interest form and an Early Access Pool (https://sites.research.google/gr/earlyaccess/). — [Putting Earth AI to work](https://research.google/blog/putting-earth-ai-to-work-geospatial-agents-for-our-planets-biggest-challenges/)
- The agent connects Gemini to Remote Sensing Foundations, PDFM (surfaced via Population Dynamics Insights), AlphaEarth Foundations (via the annual Satellite Embedding dataset), WeatherNext and Flood Forecasting, plus Google Maps Platform, Earth Engine, Data Commons and Google Dataset Search; users can bring CSV, GeoJSON or cloud tables through the API. — [Putting Earth AI to work](https://research.google/blog/putting-earth-ai-to-work-geospatial-agents-for-our-planets-biggest-challenges/)
- The only open-source component named in that post is the benchmark development splits at GitHub `google-research/geospatial-reasoning-benchmarks` (licence not stated on the page). — [Putting Earth AI to work](https://research.google/blog/putting-earth-ai-to-work-geospatial-agents-for-our-planets-biggest-challenges/)
- **[2025 source]** Geospatial Reasoning was described as under development while PDFM and the remote sensing foundation models were "available now through the trusted tester program" (search snippet only). — [Geospatial Reasoning blog](https://research.google/blog/geospatial-reasoning-unlocking-insights-with-generative-ai-and-multiple-foundation-models/)
- PDFM: the 2024 arXiv abstract says "The full set of embeddings and sample code are publicly available for researchers." — [Google Earth AI research area page](https://research.google/research-areas/google-earth-ai/)
- **[2025 sources, search snippets only]** Population Dynamics coverage was reported as 17 countries with monthly resolution over two years; PDFM embeddings are sold in Preview as "Population Dynamics Insights" from Google Maps Platform, with no-cost access for researchers on request for select use cases. — [the-decoder report](https://the-decoder.com/google-integrates-earth-ai-and-gemini-language-models-for-what-it-calls-geospatial-reasoning/)
- SpeciesNet is described as "an open-source AI tool" for camera-trap species identification (not relevant to trend detection but genuinely open). — [Google Earth AI research area page](https://research.google/research-areas/google-earth-ai/)

#### WeatherNext family (WeatherNext 3, WeatherNext 2 / FGN, Gen / GenCast, Graph / GraphCast, Cyclones)

- WeatherNext 3 (Aug 2026) is the flagship: "15-day global probabilistic forecasts initialized hourly across 64 ensemble members"; 0.05° station-calibrated surface variables, 0.1° surface grids, 0.25° pressure levels, 1-hour timestep; "Recommended for all new projects." — [WeatherNext overview](https://developers.google.com/weathernext); [WeatherNext models guide](https://developers.google.com/weathernext/guides/models)
- WeatherNext 3 is **not open source**: "available only as an operational forecast service." — [WeatherNext open source models guide](https://developers.google.com/weathernext/guides/osmodel)
- WeatherNext 3 data locations: Earth Engine `projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg` (gridded, 19 variables, precomputed statistics mean/p10/p25/p50/p75/p90) and `..._0p05deg` (stations: 2 m temperature and dew point only); Cloud Storage `gs://weathernext3_spatial/` (full 64-member ensemble, pressure levels, Zarr) and `gs://weathernext3_statistics_spatial/`; BigQuery tables of the same names. Historical forecasts run from 2024 to present (8 initialisations per day in 2024-2025, 24 per day from 2026). — [WeatherNext Earth Engine guide](https://developers.google.com/weathernext/guides/earth-engine); [WeatherNext forecast data access](https://developers.google.com/weathernext/guides/access-forecast)
- Access to WeatherNext forecast data requires the WeatherNext Data Request Form; "Requests are reviewed on a rolling basis, typically within 5-7 business days"; open to anyone with a Google Account including students; no paid contract required; one approval covers Cloud Storage, BigQuery and Earth Engine. — [WeatherNext forecast data access](https://developers.google.com/weathernext/guides/access-forecast)
- WeatherNext 2 in Earth Engine: `projects/gcp-public-data-weathernext/assets/weathernext_2_0_0` (and `_mean`); available 2022-01-01 to present; 0.25°; 64 members; initialisations every 6 hours; lead times in 6-hour steps to 15 days; requires the same request form; Zarr at `gs://weathernext/weathernext_2_0_0/zarr`. — [Earth Engine catalogue: WeatherNext 2](https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_weathernext_2_0_0)
- WeatherNext Gen and Graph datasets on Earth Engine and BigQuery were deprecated effective 29 July 2026 (deprecation page and release notes); the Earth Engine catalogue pages for those datasets say 15 July 2026 instead (search snippets only; dates conflict). — [WeatherNext deprecation page](https://developers.google.com/weathernext/guides/deprecation); [WeatherNext release notes](https://developers.google.com/weathernext/release-notes)
- Accuracy note: after ECMWF's IFS Cycle 50r1 update on 12 May 2026, "WeatherNext 2 users may experience some accuracy regression"; WeatherNext 3 was trained with post-update data (search snippet only). — [WeatherNext deprecation page](https://developers.google.com/weathernext/guides/deprecation)
- Open models: the repo is now `google-deepmind/weathernext` (weights and sample data in GCS bucket `dm_graphcast`). It contains WeatherNext 2 (FGN; 0.25° operational and 1° mini variants), WeatherNext Cyclones and Cyclones Mini, plus WeatherNext Gen (GenCast, conditional diffusion) and WeatherNext Graph (GraphCast, deterministic GNN) as legacy models "kept for benchmarking". — [WeatherNext open source models guide](https://developers.google.com/weathernext/guides/osmodel); [google-deepmind/weathernext README](https://github.com/google-deepmind/weathernext)
- Compute for open WeatherNext 2 / Cyclones: "The non-Mini models require H100 for sufficient VRAM"; "The Mini models should manage inference on a P100"; TPU recommended; the demo notebook (`docs/weathernext2/wn2_demo.ipynb`) defaults to the Mini model on a free Colab `v5e-1` TPU runtime. WeatherNext 2 is designed to start from operational HRES initial conditions. — [google-deepmind/weathernext README](https://github.com/google-deepmind/weathernext)
- Custom inference (Vertex AI Model Garden, now described as Gemini Enterprise Agent Platform) is an Early Access Program limited to allowlisted customers; newer page wording says to contact your Google Cloud account team (search snippet only). — [Accessing WeatherNext custom inference](https://developers.google.com/weathernext/guides/access-vmg)
- PARDIG and SatWeave observational datasets are "Public, no form needed", CC BY 4.0. — [WeatherNext forecast data access](https://developers.google.com/weathernext/guides/access-forecast)
- PARDIG-LR (Long-Record): AI precipitation estimates trained on GPM CORRA with ERA5, GridSat-B1 and microwave sounder inputs; 1999-01-01 to 2023-12-31; 15-minute cadence; 0.1°; band `precipitation` in m/h; Earth Engine `projects/gcp-public-data-weathernext/assets/PARDIG_1_LR`; Zarr at `gs://pardig_1/LR/`; companion `PARDIG_1_NRT` for near-real-time. Labelled experimental. — [Earth Engine catalogue: PARDIG-LR](https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_PARDIG_1_LR)

#### Weather Lab

- Interactive site showing WeatherNext 3, WeatherNext 2 (FGN) and Global MetNet (precipitation, 12-hour horizon), plus WeatherNext Cyclones tracks with ECMWF ENS and HRES baselines. — [Weather Lab guide](https://developers.google.com/weathernext/guides/weatherlab)
- Cyclone data can be downloaded as CSV or ATCF: predicted tracks (position, intensity, timing), ensemble member tracks and paired observed tracks; coverage "approximately 2023 to present". — [Weather Lab guide](https://developers.google.com/weathernext/guides/weatherlab)
- "Experimental research forecasts, not an officially supported Google product." — [Weather Lab guide](https://developers.google.com/weathernext/guides/weatherlab)

#### NeuralGCM

- Python library for hybrid ML/physics atmospheric models; code Apache-2.0; trained weights CC BY-SA 4.0. — [NeuralGCM README](https://github.com/google-research/neuralgcm/blob/main/README.md)
- Checkpoints at `gs://neuralgcm/models/`: deterministic 0.7°, 1.4°, 2.8°; stochastic 1.4°; stochastic 2.8° precipitation and evaporation models (`v1_precip/`). — [NeuralGCM checkpoints docs](https://neuralgcm.readthedocs.io/en/latest/checkpoints.html)
- Stability guidance: higher-resolution models are not stable for long runs; unmodified 1.4° stochastic is reliable for about 6 months and 1.4° deterministic for about 2 years; "For multi-decadal simulations, use the 2.8° stochastic models"; precipitation/evaporation models "are stable for 20-year atmosphere-only simulations". — [NeuralGCM checkpoints docs](https://neuralgcm.readthedocs.io/en/latest/checkpoints.html)
- Atmosphere only: the user must supply sea surface temperature and sea ice concentration forcing. — [NeuralGCM checkpoints docs](https://neuralgcm.readthedocs.io/en/latest/checkpoints.html)
- **[2024 source]** Precomputed NeuralGCM atmosphere-only climate simulations "are now available for download on Google Cloud Storage" (search snippet only). — [neuralgcm-announce, Dec 2024](https://groups.google.com/g/neuralgcm-announce/c/Fyjs-L1ORiM)

#### TimesFM

- Versions: 1.0 / 2.0 archived (`timesfm==1.3.0`); 2.5 released 15 Sep 2025 (200M parameters, up to 16k context, continuous quantile forecast up to 1k horizon via optional 30M quantile head, XReg covariates added 29 Oct 2025); **3.0 released Aug 2026** (multivariate, native past and future covariates, median plus 9 quantiles; Hugging Face `google/timesfm-3.0-pytorch`; contexts over 15,360 are truncated). — [google-research/timesfm README](https://github.com/google-research/timesfm)
- Licence split: code Apache-2.0; weights up to 2.5 Apache-2.0; 3.0 weights under `timesfm-non-commercial-license-v1.0`, "restricted to non-commercial, non-production use"; commercial use of 3.0 only through Google Cloud services such as BigQuery ML. — [google-research/timesfm README](https://github.com/google-research/timesfm)
- Install: `pip install timesfm[torch]` or `pip install timesfm[mlx]` (Apple silicon); no minimum hardware stated; a LoRA fine-tuning example was added 9 Apr 2026. — [google-research/timesfm README](https://github.com/google-research/timesfm)
- Hugging Face Transformers has a `timesfm2_5` model class with default `context_length` 16384 (search snippet only). — [Transformers docs: TimesFM 2.5](https://huggingface.co/docs/transformers/model_doc/timesfm2_5)
- BigQuery `AI.FORECAST`: built in, no model-creation step; TimesFM 2.5 is the default (context window 64 to 15,360 points, horizon 1 to 10,000); TimesFM 3.0 is in Preview (context window 64 to 2,048 points, horizon 1 to 1,024; needed for multivariate); minimum 3 data points; `AI.EVALUATE` for evaluation. — [BigQuery AI.FORECAST reference](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/bigqueryml-syntax-ai-forecast)
- BigQuery pricing: billed at the BigQuery ML on-demand evaluation/prediction rate; "TimesFM 3.0 will use a token based pricing from 12/01/2026 onwards." — [BigQuery AI.FORECAST reference](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/bigqueryml-syntax-ai-forecast)
- TimesFM 3.0 also listed in Google Sheets (Connected Sheets) and Vertex Model Garden (Dockerised endpoint). — [google-research/timesfm README](https://github.com/google-research/timesfm)

#### Flood Hub, Flood Forecasting API, GRRR, related flood datasets

- Flood Forecasting API: real-time riverine flood forecasts (same as Flood Hub); "public and offered at no charge"; data CC BY 4.0; access requires joining a waitlist, receiving an approval email, an API key and enabling the API in a Cloud project; no approval timeline stated. — [Flood Forecasting API](https://developers.google.com/flood-forecasting)
- "the use of the flood forecasting API is primarily limited to non-commercial use." — [Google Research floods resources](https://sites.research.google/gr/floodforecasting/resources/)
- GRRR (Google Runoff Reanalysis & Reforecast): global river discharge estimates 1980-2023, accessed through a linked Colab notebook. — [Flood Forecasting API](https://developers.google.com/flood-forecasting)
- **[2024 source]** GRRR contains reanalysis for 1980-2023 and an historical re-forecast for 2016-2023 (search snippet only). — [Google Research blog: flood forecasting model](https://research.google/blog/a-flood-forecasting-ai-model-trained-and-evaluated-globally/)
- Inundation History dataset: water occurrence 1999-2020, 128 m pixels, GCS `flood-forecasting/inundation_history`, CC-BY-4.0. — [Google Research floods resources](https://sites.research.google/gr/floodforecasting/resources/)
- Groundsource flash flood dataset: 2.6 million historical flood events extracted from news articles with Gemini, 150+ countries, on Zenodo. Flood Hub model code is on GitHub `google-research/flood-forecasting` under Apache 2.0. Caravan streamflow dataset is linked as open data. — [Google Research floods resources](https://sites.research.google/gr/floodforecasting/resources/)
- Flood Hub covers river basins in 150+ countries (search snippet only). — [Google Research floods site](https://sites.research.google/floodforecasting)

#### FireSat

- First three operational FireSat satellites reached orbit on 7 July 2026; about three months of checkout; data to Early Adopters (fire agencies and scientists) at least twice daily in Q4 2026; expanded availability through 2027; global access anticipated by 2028 (search snippets, trade press). — [HeliOps: first EFA operational FireSats reach orbit](https://www.heliopsmag.com/airattack/news/first-efa-operational-firesats-reach-orbit/)

#### Dynamic World and Open Buildings

- Dynamic World V1: `GOOGLE/DYNAMICWORLD/V1`; 2015-06-27 to present (catalogue end timestamp 2026-11-14); 10 m; nine class-probability bands plus `label`; one image per Sentinel-2 L1C scene with cloud cover at or below 35% (revisit 2-5 days); CC-BY 4.0 with attribution to the Dynamic World Project, Google, National Geographic Society and WRI. — [Earth Engine catalogue: Dynamic World V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1)
- Dynamic World caveat: single-image classification, so top-1 probabilities can be low for changeable covers such as crops and for sand, sunglint and bright arid surfaces; the page recommends thresholding top-1 probability. — [Earth Engine catalogue: Dynamic World V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1)
- Open Buildings 2.5D Temporal: `GOOGLE/Research/open-buildings-temporal/v1`; annual 2016-2023; effective resolution 4 m (0.5 m pixels); bands `building_presence`, `building_fractional_count`, `building_height`; covers Africa, South Asia, South-East Asia, Latin America and the Caribbean; CC-BY 4.0 or ODbL v1.0; presence confidence is uncalibrated and can vary by location and time. — [Earth Engine catalogue: Open Buildings 2.5D Temporal](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1)

#### ARCO-ERA5 and WeatherBench 2

- ARCO-ERA5 analysis-ready store: `gs://gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3` (pressure and surface levels, 0.25°, hourly, 2.05 PB); model-level store `ar/model-level-1h-0p25deg.zarr-v1`; README says coverage is 1979 to present; stable ERA5 updated monthly with about a 3-month delay, ERA5T about a week behind; opened with `xarray.open_zarr(..., chunks=None, storage_options=dict(token='anon'))`; use the `valid_time_start` / `valid_time_stop` attributes to clip. Bucket is in us-central1. — [google-research/arco-era5 README](https://github.com/google-research/arco-era5)
- ARCO-ERA5 gotchas: the "cloud-optimised" wind and surface stores are spherical-harmonic coefficients, not grids; repo code is Apache-2.0 but the page does not state a licence for the ERA5 data itself. — [google-research/arco-era5 README](https://github.com/google-research/arco-era5)
- WeatherBench 2 public bucket `gs://weatherbench2/datasets`: ERA5 1959-2023 at several resolutions including `era5/1959-2023_01_10-6h-240x121_equiangular_with_poles_conservative.zarr` (1.5°) and `..._6h-64x32_equiangular_conservative.zarr` (about 5.6°); ERA5 hourly climatologies for 1990-2017 and 1990-2019; HRES t=0 analysis 2016-2022. — [WeatherBench 2 data guide](https://weatherbench2.readthedocs.io/en/latest/data-guide.html)
- WeatherBench 2 licensing is per dataset: "Some datasets allow commercial use. Others only permit research use." — [WeatherBench 2 data guide](https://weatherbench2.readthedocs.io/en/latest/data-guide.html)

#### Gemini API features for an agentic "data detective"

- Built-in tools: Google Search grounding, Google Maps grounding, Code Execution (model writes and runs Python), URL Context, File Search (managed RAG), Computer Use (client executes actions). — [Gemini API tools docs](https://aistudio.google.com/docs/tools)
- "Gemini 4 and Gemini 3 series models can combine built-in tools with custom function calls in a single turn"; this is in preview and needs a combination flag. Tool costs are on the pricing page. — [Gemini API tools docs](https://aistudio.google.com/docs/tools)
- Google Search and Google Maps tools run server-side; custom functions run client-side in the application (search snippet only). — [Google blog: Gemini API tooling updates](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-tooling-updates/)
- There is no first-party "Earth Engine tool" in the Gemini API tool list; the built-in list is the six tools above. — [Gemini API tools docs](https://aistudio.google.com/docs/tools)
- A third-party write-up describes building Earth Engine search agents with Google's Agent Development Kit (search snippet only). — [Plug and Play Earth Engine Search Agents with ADK](https://datacommons.substack.com/p/plug-and-play-earth-engine-search)

### Inferences

- The fastest credible stack for a 48-hour build is: Earth Engine Community tier (history from NASA and Google catalogues, plus AlphaEarth embeddings) + ARCO-ERA5 or WeatherBench 2 Zarr (long reanalysis history without any Earth Engine quota) + TimesFM 2.5 run locally (forecast layer) + Gemini API with function calling over the team's own Python tools (AI layer). All four parts are open and none needs approval.
- The team should build its own "geospatial reasoning" agent with Gemini function calling over Earth Engine and xarray, because the Google Earth AI agent, A2A API and Planetary Prediction Engine are early-access only. The October 2026 Earth AI post is useful as a design reference and for citing related work, not as a dependency.
- WeatherNext 3 and WeatherNext 2 forecast data are out of reach for a weekend if the form has not already been submitted (5-7 business days). If the team wants to try anyway, submit the form immediately; the same approval covers all three access routes. The fallback for a forecast layer is TimesFM on the local series, or running the WeatherNext Mini model on a free Colab TPU.
- 150 EECU-hours per month on the Community tier is a real budget, not a formality. One project is one budget, and using several projects to multiply it breaches the terms. The team should cache every extracted series to disk or a bucket rather than recomputing on demand, and consider upgrading the project to the Contributor tier (1,000 EECU-hours; needs a billing account, not charged) before the event.
- For multi-decade point or small-region series, reading ARCO-ERA5 or WeatherBench 2 Zarr from GCS avoids Earth Engine quota entirely. The WeatherBench 2 1.5° and 64x32 stores are small enough for laptop-scale global trend maps; the 0.25° hourly ARCO store is 2.05 PB and should only be sliced by point or small box.
- BigQuery `AI.FORECAST` with TimesFM 2.5 is a low-effort hosted alternative to running TimesFM locally, but it needs a Cloud project with BigQuery enabled and the cost is not zero; the local Apache-2.0 model is simpler for a demo.
- Xee is still a prerelease with breaking API changes in v0.1.0, so older tutorials and snippets may not run unchanged; pin the version.

### Gaps

- **Earth Engine extraction speed**: I found no official figure for how long a multi-decade regional time series takes or how many EECU-hours it consumes. This needs a quick empirical test by the team.
- **Earth Engine dataset IDs not confirmed in this session** (the NASA tag page was truncated). From memory only, to be checked in the catalogue: `MODIS/061/MOD13Q1` (vegetation indices), `MODIS/061/MOD11A2` (land surface temperature), SMAP `NASA/SMAP/SPL4SMGP/...` and `NASA/SMAP/SPL3SMP_E/...`, `NASA/GSFC/MERRA/slv/2`, `NASA/GLDAS/V20/NOAH/G025/T3H`, VIIRS night lights `NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG` and `NASA/VIIRS/002/VNP46A2`, and static `GOOGLE/Research/open-buildings/v3/polygons`. Date ranges for MODIS and GRACE were also not confirmed here.
- **Whether a hackathon team qualifies as "noncommercial"** under the Earth Engine questionnaire: the access page gives only an educational-class example. Likely yes for a NASA Space Apps entry, but I found no explicit statement.
- **Gemini API free tier**: I could not confirm current free-tier rate limits or whether Search/Maps grounding and code execution are included in it; the docs point to the pricing page, which I did not retrieve. Code execution limits (libraries, runtime, file I/O) were also not on the page I read.
- **Remote Sensing Foundations**: no 2026 source describing how to get access; the only statement is the 2025 "trusted tester" wording. I found no open weights.
- **PDFM**: "embeddings and sample code are publicly available for researchers" comes from a 2024 abstract; I did not confirm the repository, coverage or request process as of 2026.
- **Earth Engine + Gemini reference agents**: a search summary mentioned open-source ADK reference agents for sustainable sourcing and forest monitoring announced by Google Earth around 18 June 2026, and a consumer Gemini feature for Google AI Pro/Ultra subscribers in the US. I could not trace either to a primary page.
- **GRRR access path**: only a Colab notebook link is given; I did not confirm the bucket path, spatial resolution or licence.
- **FireSat**: sources are trade press; I did not confirm on the Earth Fire Alliance site whether any public sample data exists.
- **WeatherNext custom inference**: page titles alternate between "Vertex" and "Gemini Enterprise Agent Platform"; I did not confirm pricing or current naming.
- **Model names**: the Gemini docs I read refer to "Gemini 4 and Gemini 3 series"; I did not check which specific model IDs are current or free.

## For AlphaEarth embeddings specifically: what practical analyses are possible (year-to-year change magnitude, similarity search, clustering), and what are the documented limitations?

### Takeaway
The Satellite Embedding dataset gives one unit-length 64-dimensional vector per 10 m pixel per calendar year (2017-2024, with 2025 reported as rolling out), and the documented recipes are: dot product between two years for change magnitude, dot product against reference pixels for similarity search, k-means for clustering, and small-sample classifiers or regressors. It is a 2017-onward annual product, so it supports "what changed and where" rather than multi-decade trends, and independent work says embedding displacement is a useful portable change signal but not a replacement for task-specific indices.

### Cited Findings

#### What the dataset is
- Earth Engine `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`; 64 bands `A00`-`A63`, values -1 to 1, 10 m pixels; vectors are unit length and need no normalisation; bands are not individually interpretable and "all 64 should be used together". — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Each image covers about 163.84 km x 163.84 km in its local UTM zone (`UTM_ZONE` property) and is tagged with the start and end of its calendar year. — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Catalogue availability is listed as 2017-01-01 to 2025-01-01, i.e. annual layers for 2017 through 2024. — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Some localised versions of the catalogue page say that from 29 January 2026, 2025 embeddings are being added to the collection on a continuous basis by UTM zone and that users should check the collection for current coverage (search snippet only; conflicts with the English page's listed end date). — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Versions: embeddings come from AlphaEarth Foundations model v2.1 (the paper evaluated v2.0); v2.1 added Antarctic training samples and USDA CDL as a target, lowered NLCD and CDL loss weights from 0.50 to 0.25 and reduced sensor and tiling artifacts. As of 17 Nov 2025 layers carry `DATASET_VERSION` 1.1, including a regenerated 2017 layer with additional Sentinel-1 acquisitions. — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Google commits to at least one year's advance notice of any anticipated change in delivery, subject to USGS and ESA input availability. — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Licence CC-BY 4.0 with the attribution line "The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind." — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)

#### Documented analysis recipes
- Year-to-year change: multiply the two years' embedding images band by band and sum across bands (`multiply` then `reduce(ee.Reducer.sum())`); for unit vectors this dot product is the cosine of the angle between them; the catalogue example maps it so brighter pixels mean less similar surfaces. — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Similarity search (official tutorial): build a one-year mosaic, sample embeddings at a few reference points with `sampleRegions`, compute the dot product of each reference vector against every pixel, average across references, threshold (the example uses `gt(0.90)`), then `reduceToVectors` and take centroids. — [Satellite Embedding tutorial 5: similarity search](https://developers.google.com/earth-engine/tutorials/community/satellite-embedding-05-similarity-search)
- Embeddings are linearly composable: averaging neighbouring pixels gives a valid embedding for a coarser pixel, so searches can run at 20 m or 1000 m for larger objects. — [Satellite Embedding tutorial 5: similarity search](https://developers.google.com/earth-engine/tutorials/community/satellite-embedding-05-similarity-search)
- Clustering (official tutorial): `ee.Clusterer.wekaKMeans` trained on 1,000 sampled pixels with 3, 5 and 10 clusters; clusters separated seasonal water and different crop types. Quick visualisation: RGB composite of three bands such as A01, A16, A09. — [Satellite Embedding tutorial 1: introduction](https://developers.google.com/earth-engine/tutorials/community/satellite-embedding-01-introduction)
- The tutorial series also covers unsupervised classification, supervised classification and regression. — [Satellite Embedding tutorial 1: introduction](https://developers.google.com/earth-engine/tutorials/community/satellite-embedding-01-introduction)

#### Documented limitations and gotchas
- Coverage: land and shallow water only, not deep ocean; polar coverage limited by orbits and instrument coverage. — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- "Some large-scale swath and data availability artifacts remain", described as usually minor vector offsets that rarely affect downstream results. — [Earth Engine catalogue: Satellite Embedding V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Projection trap: `mosaic()` resets the projection to default WGS84 at 1-degree scale, so `crs` and `scale` must be set explicitly when sampling or exporting; for large-area work, `map()` over the collection to keep each tile's UTM projection. — [Satellite Embedding tutorial 1: introduction](https://developers.google.com/earth-engine/tutorials/community/satellite-embedding-01-introduction)
- Similarity search caveats: false positives are expected and thresholds are object- and scale-dependent; embeddings come from public Earth observation data, not the high-resolution basemap, so the object must exist in the chosen year; vectorisation "is a memory and compute-intensive operation" and should be exported to avoid "Computation Timed Out" or "Tile Error". — [Satellite Embedding tutorial 5: similarity search](https://developers.google.com/earth-engine/tutorials/community/satellite-embedding-05-similarity-search)
- Independent NeurIPS 2026 paper "Reusable Change Signal: An Outcome-Blind Audit of Annual Earth Embeddings" tests whether AlphaEarth embedding displacement tracks mapped disturbances and adds value beyond burn-ratio and vegetation-index baselines; per the abstract summary, annual embeddings work as portable change representations but do not replace task-specific measures or operational hazard detectors (abstract seen via search only). — [NeurIPS 2026 virtual poster 157096](https://neurips.cc/virtual/2026/157096)
- Practitioner finding: raw embedding distances "do not live on a consistent scale across pixels", motivating per-pixel robust z-score normalisation and leave-one-out medoid scoring across years (search snippet only). — [Wherobots: AlphaEarth change detection part 2](https://wherobots.com/blog/alphaearth-foundations-change-detection-part-2/)
- Per a third-party summary of the AlphaEarth paper, for unsupervised land use change detection the model was slightly exceeded by a simpler ViT baseline (71.4% versus 72.9% balanced accuracy) (secondary source, search snippet only). **[2025 source]** — [arXivIQ summary of the AlphaEarth paper](https://arxiviq.substack.com/p/alphaearth-foundations-an-embedding)
- Pixel-level embeddings allow change-intensity maps (example 2018 versus 2024) where earlier embedding approaches were patch-level (search snippet only). **[2025 source]** — [Element 84: exploring AlphaEarth embeddings](https://element84.com/machine-learning/exploring-alphaearth-embeddings/)

### Inferences

- With at most eight or nine annual vectors per pixel (2017-2024, perhaps 2025), the embeddings cannot support classical multi-decade trend tests or most early-warning statistics (rising variance, lag-1 autocorrelation), which need long series. Their natural role in Canary is a "what changed on the ground" layer that complements the long physical-variable series from reanalysis and NASA products.
- A sensible change metric is `1 - dot(year_a, year_b)` per pixel, averaged over the area of interest. Because distance scale varies by pixel and by land cover, the more defensible approach is to compare each year-pair's distance against that pixel's own history of year-to-year distances (a z-score), rather than using one global threshold.
- The regenerated 2017 layer and the reported data-availability artifacts suggest treating the earliest year with extra caution, and any single year-pair jump as provisional until it persists.
- If the area of interest falls in a UTM zone where 2025 has not yet been added, a "latest year" query will silently differ by location. The app should query the collection for the years actually present at the point rather than assume a fixed range.
- Similarity search ("find places that look like this one") is cheap to compute and visually strong for a demo, but it is appearance similarity for one calendar year, not climatic or trend similarity.
- Since deep ocean is excluded, embedding-based features will be unavailable for open-ocean locations; the app needs a graceful fallback.

### Gaps

- I could not confirm from the English catalogue page whether the 2025 annual layer is complete globally as of November 2026; the rolling-by-UTM-zone statement came from localised page snippets. No 2026 annual layer or "V2" dataset was found.
- No official tutorial dedicated to change detection was found; the only official change recipe is the two-year dot product example on the catalogue page.
- I did not read the full NeurIPS 2026 audit paper, so I cannot report its quantitative results or its analysis of spurious year-to-year change.
- I found no official statement on whether embeddings from different `DATASET_VERSION`s or model versions are mutually comparable.
- The bucket's billing mode ("provider pays" as of July 2026) is as reported from the catalogue page; I did not test access to `gs://alphaearth_foundations`.

## Which assets give multi-decade history (useful for trends) versus forecasts only?

### Takeaway
Multi-decade history comes from the reanalysis and NASA archives that Google hosts (ARCO-ERA5 from 1979, WeatherBench 2 ERA5 1959-2023, GLDAS-2.0 1948-2014, GRRR river discharge 1980-2023, PARDIG-LR precipitation 1999-2023) rather than from Google's AI models. The headline DeepMind models (WeatherNext, Weather Lab, Flood Forecasting API, TimesFM) are forecast tools with at most a few years of archived forecasts, and the Google-made observational products (AlphaEarth 2017+, Dynamic World 2015+, Open Buildings 2016-2023) span about a decade or less.

### Cited Findings

| Asset | Record | Type | Source |
|---|---|---|---|
| WeatherBench 2 ERA5 Zarr | 1959-2023, 6-hourly and hourly, 0.25° / 1.5° / 64x32 | History (reanalysis) | [WeatherBench 2 data guide](https://weatherbench2.readthedocs.io/en/latest/data-guide.html) |
| ARCO-ERA5 Zarr | 1979 to present, hourly, 0.25°, about 3-month lag (ERA5T about 1 week) | History (reanalysis) | [arco-era5 README](https://github.com/google-research/arco-era5) |
| GLDAS-2.0 in Earth Engine | 1948-2014 | History (land surface model) | [EE NASA tag page](https://developers.google.com/earth-engine/datasets/tags/nasa) |
| GLDAS-2.1 / 2.2, IMERG V07, GRACE mass grids, MODIS products, FIRMS, MERRA-2, FLDAS, GIMMS NDVI3g in Earth Engine | Present in catalogue; date ranges not confirmed in this session | History | [EE NASA tag page](https://developers.google.com/earth-engine/datasets/tags/nasa) |
| GRRR river discharge | Reanalysis 1980-2023 | History (model reanalysis) | [Flood Forecasting API page](https://developers.google.com/flood-forecasting) |
| Inundation History | 1999-2020, 128 m | History | [Google Research floods resources](https://sites.research.google/gr/floodforecasting/resources/) |
| PARDIG-LR precipitation | 1999-2023, 15-minute, 0.1° | History (AI-derived estimate) | [EE catalogue: PARDIG-LR](https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_PARDIG_1_LR) |
| Dynamic World V1 | 2015-06-27 to present, 10 m, per Sentinel-2 scene | History (about 11 years) | [EE catalogue: Dynamic World](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1) |
| Open Buildings 2.5D Temporal | Annual 2016-2023 | History (8 years) | [EE catalogue: Open Buildings temporal](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1) |
| Satellite Embedding V1 | Annual 2017-2024 (2025 rolling) | History (8-9 years) | [EE catalogue: Satellite Embedding](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL) |
| NeuralGCM | Simulator; 2.8° stochastic models for multi-decadal runs; precipitation models stable for 20-year atmosphere-only runs | Simulation (not observations) | [NeuralGCM checkpoints](https://neuralgcm.readthedocs.io/en/latest/checkpoints.html) |
| WeatherNext 2 | Forecast archive 2022 to present, 15-day lead | Forecasts only | [EE catalogue: WeatherNext 2](https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_weathernext_2_0_0) |
| WeatherNext 3 | Forecast archive 2024 to present, 15-day lead | Forecasts only | [WeatherNext models guide](https://developers.google.com/weathernext/guides/models) |
| Weather Lab cyclone tracks | About 2023 to present | Forecasts plus paired observed tracks | [Weather Lab guide](https://developers.google.com/weathernext/guides/weatherlab) |
| GRRR reforecast | 2016-2023 **[2024 source]** | Reforecasts | [Google Research flood model blog](https://research.google/blog/a-flood-forecasting-ai-model-trained-and-evaluated-globally/) |
| Flood Forecasting API | Real-time riverine forecasts | Forecasts only | [Flood Forecasting API page](https://developers.google.com/flood-forecasting) |
| TimesFM 2.5 / 3.0 | No data; forecasts whatever series is supplied (context up to about 16k points) | Forecast model | [timesfm README](https://github.com/google-research/timesfm) |

- NeuralGCM models were trained on ECMWF data from 1979 to 2019 at 0.7°, 1.4° and 2.8° (search snippet only). **[2024 source]** — [Google Research blog: NeuralGCM](https://research.google/blog/fast-accurate-climate-modeling-with-neuralgcm/)
- ERA5 hourly climatologies for 1990-2017 and 1990-2019 are precomputed in the WeatherBench 2 bucket, which gives a ready-made anomaly baseline. — [WeatherBench 2 data guide](https://weatherbench2.readthedocs.io/en/latest/data-guide.html)

### Inferences

- For trend, significance and early-warning statistics, the backbone should be ERA5 (via WeatherBench 2 for 1959-2023 at coarse resolution, or ARCO-ERA5 for 1979 to near-present at 0.25°) and the NASA products in Earth Engine. Google's own AI products add recent-decade context (land cover, built area, embeddings) and forecasts, not long records.
- TimesFM 2.5's context limit fits the project's series comfortably: 40 years of daily data is 40 x 365.25 = 14,610 points, under the 15,360-16,384 limit, and 65 years of monthly data is 780 points. TimesFM 3.0 inside BigQuery is capped at 2,048 context points, which covers monthly series but not multi-decade daily series; TimesFM 2.5 in BigQuery accepts up to 15,360.
- PARDIG-LR is a noteworthy find for precipitation: 25 years at 0.1° and 15-minute cadence, open without a form. But it is labelled experimental and is partly derived from ERA5 inputs, so it is not an independent check on ERA5-based precipitation trends; IMERG is the more defensible primary source and PARDIG-LR a comparison.
- Running NeuralGCM for multi-year simulations is not a realistic 48-hour deliverable: it needs SST and sea-ice forcing files, a GPU, and validation. The precomputed NeuralGCM simulation outputs on GCS could be cited or sampled, but I did not confirm their paths.
- Dynamic World (2015 onward) gives roughly an 11-year land-cover record: enough for change accounting, marginal for trend significance.

### Gaps

- Exact start and end dates for MODIS, GRACE/GRACE-FO, IMERG, SMAP, MERRA-2 and VIIRS collections in Earth Engine were not confirmed in this session; GRACE has a known gap between missions that the team should check in the catalogue.
- The ARCO-ERA5 README says "1979 to present"; I did not confirm whether the 1940-1978 ERA5 back-extension has been added to the ARCO stores (WeatherBench 2 does carry 1959-2023).
- GCS paths and licence for the precomputed NeuralGCM climate simulations were not confirmed (2024 mailing-list announcement only).
- I found no Google-hosted long-record ocean product in this pass (sea level, ocean heat, sea ice); ERA5 SST is available in the ARCO store.

## What are the licence restrictions on using model outputs in a public hackathon demo?

### Takeaway
Most assets a team can actually reach are CC BY 4.0 or Apache-2.0 and are fine for a public non-commercial demo with attribution. The traps are: TimesFM 3.0 weights (non-commercial, non-production), real-time WeatherNext and Weather Lab data less than one hour old (separate experimental terms), the "experimental, not for real-world use" disclaimers on WeatherNext and PARDIG, share-alike on NeuralGCM weights, the non-commercial lean of the Flood Forecasting API, and an unresolved question over legacy GraphCast/GenCast weights.

### Cited Findings

- Satellite Embedding V1: CC-BY 4.0; required attribution "The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind." — [EE catalogue: Satellite Embedding](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- Dynamic World: CC-BY 4.0 with attribution to the Dynamic World Project, Google, National Geographic Society and World Resources Institute; Sentinel data notice also applies. — [EE catalogue: Dynamic World](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1)
- Open Buildings 2.5D Temporal: CC-BY 4.0 or ODbL v1.0 at the user's choice; Copernicus Sentinel legal notice applies. — [EE catalogue: Open Buildings temporal](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1)
- Earth Engine platform: free use depends on the project being verified as noncommercial; "If Google determines a project is commercial, it can't be used without paying." — [Earth Engine access guide](https://developers.google.com/earth-engine/guides/access)
- TimesFM: code Apache-2.0; weights up to 2.5 Apache-2.0; 3.0 weights "restricted to non-commercial, non-production use" under `timesfm-non-commercial-license-v1.0`. — [timesfm README](https://github.com/google-research/timesfm)
- NeuralGCM: code Apache-2.0; trained weights CC BY-SA 4.0 (share-alike, commercial use allowed). — [NeuralGCM README](https://github.com/google-research/neuralgcm/blob/main/README.md)
- NeuralGCM weights were previously CC BY-NC-SA; a December 2024 announcement said checkpoints moved to CC BY-SA 4.0, "which removes the previous 'Non-Commercial' restriction" (search snippet only). **[2024 source]** — [neuralgcm-announce, Dec 2024](https://groups.google.com/g/neuralgcm-announce/c/Fyjs-L1ORiM)
- WeatherNext open models: "The Colab notebooks and the associated code are licensed under the Apache License, Version 2.0"; "All other materials are licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0)"; the README does not name model weights explicitly and makes no commercial-use statement; models are "part of an experimental research project". — [google-deepmind/weathernext README](https://github.com/google-deepmind/weathernext); [WeatherNext open source models guide](https://developers.google.com/weathernext/guides/osmodel)
- WeatherNext forecast data and Weather Lab downloads: historical data (relating to a time one hour ago or more) is CC BY 4.0; real-time data (less than one hour old, or future) falls under the "GDM Real-Time Weather Forecasting Experimental Data Terms of Use" and converts to CC BY 4.0 automatically once an hour old. — [Weather Lab guide](https://developers.google.com/weathernext/guides/weatherlab); [WeatherNext forecast data access](https://developers.google.com/weathernext/guides/access-forecast)
- The WeatherNext 2 Earth Engine page defines the split differently: historic data is more than 48 hours old and real-time is within the last 48 hours; historic is CC BY 4.0 and real-time is under the GDM terms. — [EE catalogue: WeatherNext 2](https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_weathernext_2_0_0)
- Required citation wording for WeatherNext 2 historic data includes: "This data is intended for experimental modelling only and is not intended, validated, or approved for real world use." Third-party materials (ECMWF, Copernicus) may carry separate terms. — [EE catalogue: WeatherNext 2](https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_weathernext_2_0_0)
- WeatherNext custom inference terms bar reverse engineering, using WeatherNext 2 or its forecasts to build a competing product, and using forecasts to create or improve similar models except through authorised fine-tuning (search snippet only). — [Accessing WeatherNext custom inference](https://developers.google.com/weathernext/guides/access-vmg)
- PARDIG-LR: CC BY 4.0, specified citation wording, described as "intended for experimental modelling only" and not validated or approved for real-world use. — [EE catalogue: PARDIG-LR](https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_PARDIG_1_LR)
- Flood Forecasting API: data CC BY 4.0, but "the use of the flood forecasting API is primarily limited to non-commercial use." Inundation History is CC-BY-4.0. Flood Hub model code is Apache 2.0. — [Flood Forecasting API page](https://developers.google.com/flood-forecasting); [Google Research floods resources](https://sites.research.google/gr/floodforecasting/resources/)
- WeatherBench 2: licence is per dataset via a LICENSE file in each bucket path; "Some datasets allow commercial use. Others only permit research use." — [WeatherBench 2 data guide](https://weatherbench2.readthedocs.io/en/latest/data-guide.html)
- ARCO-ERA5: repository code is Apache-2.0; the README does not state the licence of the ERA5 data itself. — [arco-era5 README](https://github.com/google-research/arco-era5)
- Xee: Apache-2.0. — [google/Xee README](https://github.com/google/Xee)
- Weather Lab disclaimer: "experimental research forecasts, not an officially supported Google product"; users are directed to their local meteorological agency for official forecasts and warnings. — [Weather Lab guide](https://developers.google.com/weathernext/guides/weatherlab)

### Inferences

- A NASA Space Apps demo is non-commercial, so even the non-commercial items (TimesFM 3.0 weights, the Flood Forecasting API) would be permissible in principle. The practical recommendation is still TimesFM 2.5: Apache-2.0 removes any doubt if the project continues after the hackathon, and "non-production use" in the 3.0 licence could be read to exclude a publicly hosted app.
- An attribution footer in the demo should cover at least: the AlphaEarth attribution sentence, Dynamic World's four-party attribution, Copernicus/ECMWF for ERA5 and Sentinel-derived layers, NASA data sources, and the model licences (TimesFM Apache-2.0; NeuralGCM CC BY-SA 4.0 if used).
- If NeuralGCM weights are modified and redistributed, the share-alike clause applies to the derived weights; merely showing simulation outputs in a demo is lower risk but outputs should still be attributed.
- Any forecast or early-warning output shown publicly should carry an "experimental, not an official warning" disclaimer, mirroring Google's own wording for Weather Lab, WeatherNext and PARDIG. This matters for a tool that talks about tipping points.
- If the team does get WeatherNext access, displaying forecasts for future valid times in a public demo falls under the real-time experimental terms rather than CC BY 4.0, and those terms were not read in this session; showing archived forecasts older than the threshold is the safe use.

### Gaps

- **Legacy GraphCast / GenCast weights**: the pre-2026 `google-deepmind/graphcast` README stated, from memory, that model weights were under CC BY-NC-SA 4.0 (non-commercial, share-alike). The current `google-deepmind/weathernext` README says only that "all other materials" are CC BY 4.0 and does not name weights. I could not open the legacy model READMEs (404), so whether the non-commercial restriction still applies to GraphCast and GenCast checkpoints is unresolved. Check the LICENSE or README alongside each checkpoint in `gs://dm_graphcast` before redistributing outputs.
- I did not read the full text of the "GDM Real-Time Weather Forecasting Experimental Data Terms of Use", the `timesfm-non-commercial-license-v1.0`, or the Earth Engine Terms of Service definition of noncommercial use.
- ERA5 data licence: not stated on the ARCO-ERA5 page I read. Copernicus licence terms and required attribution should be confirmed from the Copernicus Climate Data Store.
- GRRR, Groundsource and Caravan licences were not stated on the pages I read.
- Gemini API terms on displaying grounded Search or Maps results (attribution and display requirements) were not checked.
- Licence of the Geospatial Reasoning benchmark repository was not stated.
