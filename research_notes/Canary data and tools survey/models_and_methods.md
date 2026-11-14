# Models and methods for trend detection, tipping-point early warning, causal discovery, attribution and forecasting on Earth-system time series (state as of 14 November 2026)

**How to read these notes (provenance tags).** The research was stopped early by the coordinator, so not every item was checked against a live source. Each line carries one of these tags:

- **[PyPI 2026-11-14]** / **[HF 2026-11-14]**: version, release date, licence or model metadata read directly from the PyPI JSON API or the Hugging Face model API on 14 Nov 2026. These are the most reliable version facts in this file.
- **[fetched]**: read from the linked page in this session.
- **[measured]**: timed or tested in this session in a throwaway virtualenv (Python 3.13.18, numpy 2.5.4, scipy 1.18.1, numba 0.68.1, statsmodels 0.15.0, pymannkendall 1.4.3, ewstools 2.1.3, tigramite 5.2.10.1) on a 4-vCPU Intel Xeon 2.3 GHz container with 15 GB RAM. No URL exists for these; the benchmark script was `/tmp/claude-0/-home-user-Canary/7c3957c5-e6c5-5cc9-a0f2-4ace5db6cb56/scratchpad/bench1.py` (scratch space, may be cleared).
- **[UNVERIFIED - prior knowledge]**: stated from the researcher's training knowledge (cutoff mid-2026), with a DOI or URL believed correct but not re-opened in this session. Treat numbers in these lines as needing a check before they go on a slide.

---

## Key question 1: What is the scientifically defensible minimum recipe for (i) a gridded trend + significance map and (ii) a critical-slowing-down map, and what Python calls implement each?

### Takeaway
(i) Deseasonalise to anomalies, estimate the slope with Theil-Sen, test with a Mann-Kendall variant that corrects for autocorrelation (or OLS with a lag-1 effective sample size), then control the false discovery rate across the grid with Benjamini-Hochberg before stippling. (ii) Use a single-sensor record, remove trend and seasonality with STL, compute AR(1) and variance in a sliding window of about 5 years, summarise the change with Kendall tau, and get significance from surrogates, never from the naive tau p-value: in a null test here the naive p-value flagged 80% of pure-noise cells.

### Cited Findings

#### (i) Trend + significance: libraries and calls
- `pymannkendall` latest is 1.4.3, released 2023-01-14, MIT, first release 2019; no release for almost four years. Install `pip install pymannkendall`. — [PyPI 2026-11-14](https://pypi.org/project/pymannkendall/)
- [measured] pymannkendall 1.4.3 still imports and runs on Python 3.13 with numpy 2.5.4. It exposes 13 callables: `original_test`, `hamed_rao_modification_test(x, alpha=0.05, lag=None)`, `yue_wang_modification_test(x, alpha=0.05, lag=None)`, `pre_whitening_modification_test`, `trend_free_pre_whitening_modification_test`, `seasonal_test(x, period=12, alpha=0.05)`, `correlated_seasonal_test`, `regional_test`, `multivariate_test`, `correlated_multivariate_test`, `partial_test`, `sens_slope`, `seasonal_sens_slope`. Every test returns a named tuple `(trend, h, p, z, Tau, s, var_s, slope, intercept)`, so the Theil-Sen slope comes free with each call.
- scipy is 1.18.1 (2026-08-21) and now requires Python >= 3.12. — [PyPI 2026-11-14](https://pypi.org/project/scipy/)
- [measured] scipy 1.18.1 alternatives and signatures: `scipy.stats.kendalltau(x, y, *, nan_policy='propagate', method='auto', variant='b', alternative='two-sided', axis=None, keepdims=False)`, `scipy.stats.theilslopes(y, x=None, alpha=0.95, method='separate', *, axis=None, ...)`, `scipy.stats.linregress`, and `scipy.stats.false_discovery_control(ps, *, axis=0, method='bh')` for Benjamini-Hochberg. scipy has no autocorrelation-corrected Mann-Kendall.
- `xarrayMannKendall` latest is 1.4.5, released 2023-03-16, MIT; three releases in total, none since. — [PyPI 2026-11-14](https://pypi.org/project/xarrayMannKendall/)
- xarrayMannKendall "computes linear trends over 2D and 3D arrays" and uses xarray parallelism; no numba or dask performance figures were found for it. — [PyPI project page via search](https://pypi.org/project/xarrayMannKendall/)
- `xclim` reached 1.0.0 on 2026-11-05 (Apache-2.0, Python >= 3.11); `xskillscore` is 0.0.29 (2026-02-18, Apache); `climpred` is 2.6.0 (2026-02-19, MIT). — [PyPI xclim](https://pypi.org/project/xclim/), [PyPI xskillscore](https://pypi.org/project/xskillscore/), [PyPI climpred](https://pypi.org/project/climpred/)
- A newer package, Skyborn (`skyborn.calc` Mann-Kendall), advertises compiled batch kernels that accept NumPy, xarray and Dask input and self-reports about 1,800 grid points per second on a 40 x 192 x 288 grid and about 600 per second on 100 x 360 x 720. These numbers are the project's own and were not independently checked. — [Skyborn docs](https://skyborn.readthedocs.io/en/latest/api/mann_kendall.html)
- `statsmodels` is 0.15.0 (2026-08-27, BSD-3). [measured] signatures: `STL(endog, period=None, seasonal=7, trend=None, low_pass=None, seasonal_deg=1, trend_deg=1, low_pass_deg=1, robust=False, ...)` and `MSTL(endog, periods=None, windows=None, lmbda=None, iterate=2, stl_kwargs=None)` in `statsmodels.tsa.seasonal`; FDR via `statsmodels.stats.multitest.multipletests(p, alpha, method='fdr_bh')`. — [PyPI statsmodels](https://pypi.org/project/statsmodels/)
- Wilks (2016), BAMS 97(12), 2263-2274, reviews the multiple-testing problem in atmospheric science and "illustrates a statistically principled and computationally easy approach", namely control of the false discovery rate. — [Wilks 2016, DOI 10.1175/BAMS-D-15-00267.1](https://doi.org/10.1175/BAMS-D-15-00267.1)
- FDR "controls a priori the expected proportion of falsely rejected tests out of all rejected tests" (Ventura, Paciorek & Risbey 2004, the earlier J. Climate treatment). — [Ventura et al. 2004](https://www.stat.berkeley.edu/~paciorek/files/jclim/vent.etal.2004.pdf)
- [measured] On 259,200 simulated null cells (AR(1) noise, phi = 0.3, n = 276, no trend): naive OLS t-test rejected 15.0% at p < 0.05; with a lag-1 effective-sample-size correction it rejected 5.4% (13,950 cells would still be stippled); after Benjamini-Hochberg at alpha_FDR = 0.10 only 2 cells survived. This is the exact failure Wilks describes, reproduced.

#### (i) Change-point tools
- `ruptures` 1.1.10 (2025-09-10, BSD-2-Clause, declares Python < 3.14). [measured] it installs on 3.13; API is `rpt.Pelt(model='l2', custom_cost=None, min_size=2, jump=5, params=None).fit(signal).predict(pen)`. — [PyPI ruptures](https://pypi.org/project/ruptures/)
- Python `bfast` (BFASTmonitor port) is 0.7, released 2021-04-22, GPL; unmaintained for 5.5 years. — [PyPI bfast](https://pypi.org/project/bfast/)
- `nrt` (near-real-time monitoring, includes BFASTmonitor-style, CCDC, EWMA, CUSUM monitors) is 0.3.0, released 2024-08-29, EUPL-1.2. — [PyPI nrt](https://pypi.org/project/nrt/)
- `Rbeast` (Bayesian change point + trend + seasonality, BEAST) is 0.1.25, released 2026-04-15, actively released. — [PyPI Rbeast](https://pypi.org/project/Rbeast/)

#### (ii) Critical slowing down: tooling
- `ewstools` (Bury) is 2.1.3, released 2026-07-29, Python >= 3.9, MIT; "Early warning signals (EWS) for bifurcations in time series data"; install `pip install ewstools`. — [PyPI ewstools](https://pypi.org/project/ewstools/), [ewstools docs](https://ewstools.readthedocs.io/en/latest/)
- [measured] ewstools 2.1.3 API: `ts = ewstools.TimeSeries(data, transition=None)`; `ts.detrend(method='Gaussian', bandwidth=0.2, span=0.2)` (Lowess is the other method); `ts.compute_var(rolling_window=0.25)`; `ts.compute_auto(rolling_window=0.25, lag=1)`; also `compute_std`, `compute_cv`, `compute_skew`, `compute_kurt`, `compute_dfa`, `compute_entropy`, `compute_spectrum`, `compute_smax`, `compute_spec_type`; `ts.compute_ktau(tmin='earliest', tmax='latest')`; `ts.apply_classifier(classifier, tmin, tmax)`, `apply_classifier_inc(classifier, inc=10)`; `ts.make_plotly()`. There is also `ewstools.MultiTimeSeries`. The default rolling window is 25% of the series and the default Gaussian bandwidth 20%.
- [measured] ewstools' deep-learning support is an optional extra pinned to `tensorflow<2.16,>=2.10` (and excluded on Windows); a plain `pip install ewstools` installs no TensorFlow, and no model weights ship inside the package (the package directory holds only `core.py`, `helpers.py`, `models.py`).
- The Bury et al. (2021) PNAS code repository trains 20 networks (10 padded both sides, 10 left-padded) that classify fold, Hopf, transcritical or null; classifiers exist for inputs of 500 or 1,500 points; requirements are Python 3.9+ and TensorFlow 2.15.0; licence is CC BY-NC-SA 4.0. The repository page does not state that trained weights are included (training writes them to `dl_train/best_models/`). — [deep-early-warnings-pnas](https://github.com/ThomasMBury/deep-early-warnings-pnas)
- Smith, Zotta, Boulton, Lenton, Dorigo & Boers (2023), Earth Syst. Dynam. 14, 173-183: changes in the noise structure of a merged multi-instrument record propagate into lag-1 autocorrelation and variance; merging sensors with different uncertainty can bias resilience estimates; the bias is typically stronger when metrics are aggregated by land cover or region, while individual series stay reliable at reasonable signal-to-noise ratios. — [ESD 14, 173 (2023)](https://esd.copernicus.org/articles/14/173/2023/)
- Ben-Yami, Morr, Bathiany & Boers (2024), Science Advances 10, eadl4841: uncertainties are too large to predict tipping times from historical data; using different fingerprints and data sets, AMOC tipping-time estimates ranged from 2050 to 8065, against the 2025-2095 window published earlier. — [PIK repository copy](https://publications.pik-potsdam.de/pubman/item/item_30214), [EurekAlert release](https://www.eurekalert.org/news-releases/1052809)
- [measured] Null test of the standard recipe: 259,200 stationary AR(1) series (phi = 0.3, n = 276 months), rolling AR(1) with a 60-month window, then Kendall tau of the AR(1) indicator against time. Tau had mean 0.000 and standard deviation 0.317; 19.6% of null cells had tau > 0.3 and 11.6% had |tau| > 0.5. Using the naive `scipy.stats.kendalltau` p-value on the overlapping-window series flagged 80.2% of null cells at p < 0.05 (3,000-cell sample).

#### Unverified this session (prior knowledge; check before quoting)
- [UNVERIFIED] Theory: Scheffer et al. 2009, "Early-warning signals for critical transitions", Nature 461, 53-59 — [DOI 10.1038/nature08227](https://doi.org/10.1038/nature08227). Dakos et al. 2012, PLoS ONE 7(7) e41010, is the methods cookbook (Gaussian-kernel detrending, rolling window of half the series, AR(1), standard deviation, skewness, Kendall tau, sensitivity analysis over bandwidth and window, surrogate significance) — [DOI 10.1371/journal.pone.0041010](https://doi.org/10.1371/journal.pone.0041010). Lenton 2011, "Early warning of climate tipping points", Nat. Clim. Change 1, 201-209 — [DOI 10.1038/nclimate1143](https://doi.org/10.1038/nclimate1143).
- [UNVERIFIED] Boulton, Lenton & Boers 2022 (Nat. Clim. Change 12, 271-278): VODCA Ku-band vegetation optical depth, monthly, 0.25 degree, 1991-2016; STL to remove trend and seasonal cycle; AR(1) in a 5-year sliding window; Kendall tau of the AR(1) series; significance from surrogate series; headline that about three-quarters of the Amazon has lost resilience since the early 2000s. — [DOI 10.1038/s41558-022-01287-8](https://doi.org/10.1038/s41558-022-01287-8)
- [UNVERIFIED] Smith, Traxl & Boers 2022 (Nat. Clim. Change 12, 477-484): global VOD and AVHRR NDVI; STL residuals; 5-year rolling AR(1) and variance; validated AR(1)/variance against recovery rates measured after real disturbances. — [DOI 10.1038/s41558-022-01352-2](https://doi.org/10.1038/s41558-022-01352-2)
- [UNVERIFIED] Forzieri et al. 2022 (Nature 608, 534-539): single-sensor MODIS kNDVI 2000-2020, lag-1 temporal autocorrelation in a rolling multi-year window, machine learning to separate drivers. — [DOI 10.1038/s41586-022-04959-9](https://doi.org/10.1038/s41586-022-04959-9)
- [UNVERIFIED] AMOC: Boers 2021, Nat. Clim. Change 11, 680-688 — [DOI 10.1038/s41558-021-01097-4](https://doi.org/10.1038/s41558-021-01097-4); Ditlevsen & Ditlevsen 2023, Nat. Commun. 14, 4254 (central estimate around mid-century, 95% range 2025-2095) — [DOI 10.1038/s41467-023-39810-w](https://doi.org/10.1038/s41467-023-39810-w). The 2025-2095 range is corroborated by the Ben-Yami coverage cited above.
- [UNVERIFIED] Bury et al. 2021, "Deep learning for early warning signals of tipping points", PNAS 118(39) e2106140118 — [DOI 10.1073/pnas.2106140118](https://doi.org/10.1073/pnas.2106140118); ewstools paper: Bury 2023, JOSS 8(82), 5038 — [DOI 10.21105/joss.05038](https://doi.org/10.21105/joss.05038).
- [UNVERIFIED] Mann-Kendall variants: Hamed & Rao 1998 (variance correction from significant rank autocorrelations) — [DOI 10.1016/S0022-1694(97)00125-X](https://doi.org/10.1016/S0022-1694(97)00125-X); Yue & Wang 2004 (effective sample size) — [DOI 10.1023/B:WARM.0000043140.61082.60](https://doi.org/10.1023/B:WARM.0000043140.61082.60); pyMannKendall paper, Hussain & Mahmud 2019, JOSS 4(39), 1556 — [DOI 10.21105/joss.01556](https://doi.org/10.21105/joss.01556). OLS with lag-1 effective sample size: Santer et al. 2000 — [DOI 10.1029/1999JD901105](https://doi.org/10.1029/1999JD901105).
- [UNVERIFIED] Wilks (2016) rule of thumb: for spatially correlated fields choose alpha_FDR = 2 x alpha_global (so alpha_FDR = 0.10 for a 5% global test); the search in this session could not confirm the factor of 2 from the paper text. The Benjamini-Hochberg threshold is p* = max{ p_(i) : p_(i) <= (i/N) x alpha_FDR } over the N sorted p-values.
- [UNVERIFIED] `xskillscore` offers xarray wrappers `xs.linslope`, `xs.pearson_r_eff_p_value` (effective sample size) and `xs.multipletests` (statsmodels FDR on a DataArray); xclim itself has no Mann-Kendall function. Check with `dir(xskillscore)` before relying on it.
- [UNVERIFIED] Change-point papers: PELT, Killick et al. 2012 — [DOI 10.1080/01621459.2012.737745](https://doi.org/10.1080/01621459.2012.737745); ruptures, Truong et al. 2020 — [DOI 10.1016/j.sigpro.2019.107299](https://doi.org/10.1016/j.sigpro.2019.107299); BFAST, Verbesselt et al. 2010 — [DOI 10.1016/j.rse.2009.08.014](https://doi.org/10.1016/j.rse.2009.08.014); BEAST, Zhao et al. 2019 — [DOI 10.1016/j.rse.2019.04.034](https://doi.org/10.1016/j.rse.2019.04.034).

### Inferences
- **Minimum trend recipe (defensible in front of scientists):**
  1. Build monthly anomalies: subtract each calendar month's climatology over a stated base period (`da.groupby('time.month') - clim`), or use annual means if the question is about the long-term rate (n = 20-25 points, far less autocorrelation).
  2. Slope: Theil-Sen (`pymannkendall` result field `slope`, or `scipy.stats.theilslopes`), reported per decade with its confidence interval.
  3. Significance: `mk.hamed_rao_modification_test` or `mk.yue_wang_modification_test` on anomalies; or `mk.seasonal_test(period=12)` on raw monthly data; or OLS with the lag-1 effective sample size. State which one and why.
  4. Field significance: `scipy.stats.false_discovery_control(p_flat, method='bh')` or `multipletests(..., method='fdr_bh')` over all valid cells, then stipple where adjusted p < alpha_FDR.
  5. Show the slope map everywhere and stipple (or hatch the non-significant area); report the share of area with FDR-significant trends.
- **Minimum critical-slowing-down recipe:**
  1. One sensor, one processing version, no gap-filled or merged record (for example MODIS-only vegetation index, or one GRACE solution; see Smith et al. 2023).
  2. `STL(x, period=12, robust=True).fit().resid` per cell (or Gaussian detrend via ewstools for single regional series).
  3. Rolling AR(1) and variance with a 60-month window (the window used in the Amazon and global vegetation papers); check sensitivity with 36 and 84 months.
  4. Kendall tau of each indicator against time.
  5. Significance by surrogates: generate at least a few hundred phase-randomised or fitted-AR(1) surrogates of the residual, recompute tau, take the percentile. Then apply FDR across cells.
  6. Require AR(1) and variance to rise together before calling a cell "losing resilience", and call the output "resilience indicator trend", not "distance to tipping".
- With 20-25 years of monthly data and a 5-year window there are only about four to five independent windows per cell, so single-cell tau values are weak evidence; regional aggregates of a single-sensor product are more defensible than a speckled global map.
- The Bury deep-learning classifier is a poor fit for this project: inputs were trained at 500 or 1,500 points, a 23-year monthly series has 276; the licence is non-commercial; and TensorFlow < 2.16 does not match a current Python 3.12/3.13 environment. Classical AR(1)/variance indicators are the realistic choice.
- pymannkendall is stale but small and stable; because the kernel is trivial, a 30-line numba version (below, key question 2) is safer for million-cell grids than depending on xarrayMannKendall (also stale since 2023).

### Gaps
- The exact STL parameters, surrogate type and surrogate count used by Boulton et al. (2022) and Smith et al. (2022) were not re-read in this session; confirm from the papers' Methods before claiming "same recipe as the literature".
- The Wilks (2016) alpha_FDR = 2 x alpha_global recommendation was not confirmed from the full text.
- Not checked: whether `xskillscore`, `xclim` 1.0 or `climpred` 2.6 currently expose a Mann-Kendall or FDR helper, and whether `xarrayMannKendall` still works with xarray 2026.x.
- Not checked: whether trained weights for the Bury classifiers are downloadable anywhere other than by re-training.
- Lenton's and Dakos's R package `earlywarnings` status was not checked.

---

## Key question 2: How long would each computation take on a laptop for a global 0.5 degree monthly grid over 20-25 years?

### Takeaway
Everything in the core pipeline fits in seconds to a few minutes on a 4-core machine if the per-cell loops are compiled with numba or vectorised with numpy; the only slow steps are per-cell Python calls (pymannkendall, `scipy.stats.theilslopes`, robust STL), which cost 10-50 minutes single-core at 0.5 degree and one to several hours at 0.25 degree unless restricted to land cells or parallelised.

### Cited Findings
All rows are [measured] in this session on a 4-vCPU Xeon 2.3 GHz, 15 GB RAM; the grid is 360 x 720 = 259,200 cells; "monthly" is n = 276 (23 years) and "annual" is n = 23. Library-call rows are single-core and extrapolated from 20-50 cells; numba rows used 4 threads and 20,000-259,200 cells.

| Computation | Per cell | 259,200 cells (0.5 degree) | 1,036,800 cells (0.25 degree) |
|---|---|---|---|
| `mk.original_test`, n = 276 | 3.2 ms | 13.9 min | 55.6 min |
| `mk.hamed_rao_modification_test`, n = 276 | 5.3 ms | 23.1 min | 92.2 min |
| `mk.yue_wang_modification_test`, n = 276 | 3.1 ms | 13.3 min | 53.2 min |
| `mk.trend_free_pre_whitening_modification_test`, n = 276 | 4.4 ms | 19.1 min | 76.2 min |
| `mk.seasonal_test(period=12)`, n = 276 | 2.8 ms | 12.2 min | about 49 min |
| `mk.original_test`, n = 23 (annual) | 0.50 ms | 2.2 min | 8.6 min |
| `mk.hamed_rao_modification_test`, n = 23 | 0.66 ms | 2.9 min | 11.4 min |
| `scipy.stats.theilslopes`, n = 276 | 4.9 ms | 21.2 min | 84.8 min |
| `scipy.stats.kendalltau`, n = 276 | 0.21 ms | 0.9 min | 3.7 min |
| `scipy.stats.linregress`, n = 276 | 0.28 ms | 1.2 min | 4.8 min |
| `STL(period=12)`, n = 276 | 1.8 ms | 7.8 min | about 31 min |
| `STL(period=12, robust=True)`, n = 276 | 11.4 ms | 49.1 min | about 3.3 h |
| numba (4 threads) MK S-statistic + Theil-Sen, n = 276 | - | 28.7 s | 114.7 s |
| numba (4 threads) MK S-statistic only, n = 276 | - | 5.1 s | 20.2 s |
| numba (4 threads) MK + Theil-Sen, n = 23 | - | 0.3 s | 1.2 s |
| numpy vectorised OLS slope + lag-1 effective-sample-size t-test, n = 276 | - | 0.61 s | - |
| Benjamini-Hochberg on 259,200 p-values (`multipletests`) | - | 11 ms | - |
| Benjamini-Hochberg (`scipy.stats.false_discovery_control`) | - | 28 ms | - |
| numba rolling AR(1) + variance, 60-month window, n = 276 | - | 1.1 s | - |
| numba Kendall tau of the rolling AR(1) series | - | 2.2 s | - |

- [measured] The numba kernel that produced the 28.7 s figure is a double loop over pairs `(i, j)` accumulating `sign(x[j]-x[i])` into S and storing `(x[j]-x[i])/(j-i)` for `np.median`, wrapped in `@njit(parallel=True)` with `prange` over cells. It gives S and the Theil-Sen slope; the p-value follows from `z = (S -/+ 1)/sqrt(var_s)` with `var_s = n(n-1)(2n+5)/18` (no ties), optionally inflated by `(1+r1)/(1-r1)` for lag-1 autocorrelation.
- Skyborn self-reports about 600 grid points per second on a 100 x 360 x 720 array, which would be about 7 minutes for 259,200 cells; unverified project claim. — [Skyborn docs](https://skyborn.readthedocs.io/en/latest/api/mann_kendall.html)
- Chronos-2 processes "over 300 forecasts per second on a single A10G GPU"; the model card gives no CPU throughput. — [amazon/chronos-2 model card](https://huggingface.co/amazon/chronos-2)
- Granite TTM-R3's card reports about 180 samples per second on CPU (about 800 for the Lite variant) and about 7,500 per second on GPU, hardware unspecified. — [granite-timeseries-ttm-r3 model card](https://huggingface.co/ibm-granite/granite-timeseries-ttm-r3)

### Inferences
- Only about 30% of a global grid is land; for land variables at 0.5 degree that is roughly 60-80 thousand cells, so even the slow per-cell library calls drop to about 3-15 minutes single-core, and robust STL to about 15 minutes. Masking before computing is the cheapest speed-up.
- Surrogate significance for the slowing-down map multiplies the rolling-AR(1) + tau cost (about 3.3 s per pass at 0.5 degree) by the number of surrogates: 200 surrogates is about 11 minutes, 1,000 about an hour, on 4 threads. This is the real budget item of layer (a), and it can run overnight or on land cells only.
- Memory is not a constraint: 259,200 x 276 float32 is about 286 MB; a 0.25 degree grid is about 1.1 GB per variable.
- Recommended split: numba/numpy for the global map; pymannkendall (Hamed-Rao, seasonal) for the handful of regional mean series that are shown as line plots, where its named, citable variants matter more than speed.
- A laptop of 2023 or later generally has faster cores than the 2.3 GHz Xeon used here, so these numbers should be an upper bound for 4 threads.

### Gaps
- tigramite PCMCI runtime was not measured (the session was stopped before that benchmark). Expectation from prior knowledge, unverified: with `ParCorr`, about 20 variables, about 276 monthly steps and `tau_max` of 6-12, PCMCI runs in seconds to about a minute on a laptop; `GPDC` and `CMIknn` are orders of magnitude slower and not realistic for a hackathon without a GPU.
- No CPU timing was measured for Chronos-Bolt, Chronos-2 or TTM; only vendor GPU/CPU figures are available.
- xarrayMannKendall, Skyborn and Rbeast speeds were not measured.
- Data download and regridding time (often the true bottleneck) is outside this note's scope.

---

## Key question 3: Which pretrained forecasting model gives the best accuracy-for-effort on CPU, and what is the honest evidence about forecasting climate series with it?

### Takeaway
Chronos-2 (Apache-2.0, 120M parameters, native covariates, quantile output, one `pip install`) or its 28M "small" sibling is the best effort-to-capability choice, with Chronos-Bolt-small/tiny as the fastest CPU fallback; statsforecast baselines must be run beside it. No standard benchmark of these models on gridded monthly climate series was found, so any skill claim has to come from the team's own rolling-origin backtest against climatology, persistence and seasonal-naive forecasts.

### Cited Findings

#### Pretrained general time-series models
- Chronos family (Amazon): `chronos-forecasting` 2.3.2 (2026-09-08), Apache-2.0, Python >= 3.10, 22 releases. — [PyPI chronos-forecasting](https://pypi.org/project/chronos-forecasting/)
- Model line-up and sizes: `amazon/chronos-2` 120M; `autogluon/chronos-2-small` 28M; `autogluon/chronos-2-synth` 120M; `amazon/chronos-bolt-tiny/mini/small/base` 9M/21M/48M/205M; `amazon/chronos-t5-tiny...large` 8M-710M. Chronos-2 was released 20 Oct 2025; the only 2026 news item is a June 2026 AWS deployment guide, so no newer Chronos model is listed. — [chronos-forecasting README](https://github.com/amazon-science/chronos-forecasting)
- Chronos-2: encoder-only, max context 8,192 steps, max horizon 1,024 steps (Chronos-Bolt: 2,048 and 64; original Chronos: 512 and 64); supports multivariate targets, past-only covariates and known-future covariates (real and categorical), cross-series "group attention"; multi-step quantile forecasts; CPU and GPU inference; Apache-2.0. API: `from chronos import Chronos2Pipeline; pipe = Chronos2Pipeline.from_pretrained("amazon/chronos-2", device_map="cpu"); pipe.predict_df(context_df, future_df=..., prediction_length=..., quantile_levels=[0.1, 0.5, 0.9], id_column=..., timestamp_column=..., target=...)`. The card claims state-of-the-art zero-shot accuracy among public models on fev-bench, GIFT-Eval and Chronos Benchmark II, without numbers on the page. — [amazon/chronos-2 model card](https://huggingface.co/amazon/chronos-2)
- Chronos-Bolt was announced as about 5% more accurate, up to 250x faster and 20x more memory-efficient than original Chronos models of the same size. — [chronos-forecasting README](https://github.com/amazon-science/chronos-forecasting)
- Hugging Face metadata: `amazon/chronos-2` created 2025-10-30, last modified 2026-06-05, licence apache-2.0, papers arXiv:2403.07815 and arXiv:2510.15821; `autogluon/chronos-2-small` created 2025-12-03. — [HF amazon/chronos-2](https://huggingface.co/amazon/chronos-2), [HF autogluon/chronos-2-small](https://huggingface.co/autogluon/chronos-2-small)
- Moirai (Salesforce): every public checkpoint, including `Salesforce/moirai-2.0-R-small` (created 2025-08-06, modified 2026-01-29, arXiv:2511.11698), `moirai-1.1-R-*` and `moirai-moe-1.0-R-*`, is tagged licence **cc-by-nc-4.0** (non-commercial). The `uni2ts` library is 2.0.0 (2025-11-04), Apache-2.0, no release in the past year. — [HF Salesforce/moirai-2.0-R-small](https://huggingface.co/Salesforce/moirai-2.0-R-small), [PyPI uni2ts](https://pypi.org/project/uni2ts/)
- Lag-Llama: the weights repo `time-series-foundation-models/Lag-Llama` (Apache-2.0, arXiv:2310.08278) was last modified 2024-05-14, and there is no `lag-llama` package on PyPI. — [HF Lag-Llama](https://huggingface.co/time-series-foundation-models/Lag-Llama), [PyPI lookup returned no project](https://pypi.org/project/lag-llama/)
- IBM Granite TinyTimeMixers: `granite-tsfm` 0.3.12 (2026-10-29), Apache-2.0, Python >= 3.11 and < 3.14. Checkpoints: `granite-timeseries-ttm-r1` (2024), `-ttm-r2` (created 2024-10-08, modified 2025-02-26), and **`-ttm-r3` (created 2026-05-21, modified 2026-07-02)**, all Apache-2.0. — [PyPI granite-tsfm](https://pypi.org/project/granite-tsfm/), [HF ibm-granite/granite-timeseries-ttm-r3](https://huggingface.co/ibm-granite/granite-timeseries-ttm-r3)
- TTM-R3 card: 1-35M parameters (Lite 1-18M), multivariate, exogenous/control variables, multi-quantile probabilistic head, about 180 samples/s on CPU; GIFT-Eval MASE 0.727 / CRPS 0.523 for the pretrained model. The card does not state supported context lengths, forecast lengths or whether monthly data are in scope, and has no code example. — [granite-timeseries-ttm-r3 model card](https://huggingface.co/ibm-granite/granite-timeseries-ttm-r3)
- Other IBM 2026 releases seen on the Hub: `granite-timeseries-flowstate-r1` (2025-09), `granite-timeseries-patchtst-fm-r1` (2026-03) and `-r2` (2026-08), `granite-timeseries-ensemble-r1` (2026-09). — [HF ibm-granite](https://huggingface.co/ibm-granite)
- Nixtla: `nixtla` (TimeGPT client) 0.9.0 (2026-09-21), `statsforecast` 2.1.1 (2026-07-16), `neuralforecast` 3.3.1 (2026-11-10), all Apache-2.0. — [PyPI nixtla](https://pypi.org/project/nixtla/), [PyPI statsforecast](https://pypi.org/project/statsforecast/), [PyPI neuralforecast](https://pypi.org/project/neuralforecast/)
- Wrappers: `autogluon.timeseries` 1.6.3 (2026-09-18, Apache-2.0); `gluonts` 0.17.0 (2026-07-31). — [PyPI autogluon.timeseries](https://pypi.org/project/autogluon.timeseries/), [PyPI gluonts](https://pypi.org/project/gluonts/)
- Other open models now on the Hub (for comparison only): `NX-AI/TiRex-2` (created 2026-06-16, Apache-2.0; the original `NX-AI/TiRex` carries a custom "other" licence; `tirex-ts` 1.4.2), Datadog `Toto-2.0` family from 4M to 2.5B parameters (April 2026, Apache-2.0; `toto-ts` 0.2.0), `thuml/sundial-base-128m` (Apache-2.0). — [HF NX-AI/TiRex-2](https://huggingface.co/NX-AI/TiRex-2), [HF Datadog/Toto-2.0-22m](https://huggingface.co/Datadog/Toto-2.0-22m), [HF thuml/sundial-base-128m](https://huggingface.co/thuml/sundial-base-128m)
- Google comparison point: `google/timesfm-2.5-200m-pytorch` (2025-09, Apache-2.0) and a newer `google/timesfm-3.0-pytorch` (created 2026-08-24) whose licence tag is "other", not Apache; PyPI `timesfm` is 3.0.2 (2026-09-09). — [HF google/timesfm-3.0-pytorch](https://huggingface.co/google/timesfm-3.0-pytorch), [PyPI timesfm](https://pypi.org/project/timesfm/)

#### Evidence on climate / geophysical series
- A search for a head-to-head benchmark of these models on climate variables found none; what exists are scattered application studies: a NeurIPS 2026 entry on zero-shot TimesFM for 15-minute in-situ soil moisture and temperature at 27 stations, including CPU cost; an IJCA 2026 paper comparing Chronos-2, TimesFM 2.5, Moirai and Sundial with ARIMA for dengue using temperature, precipitation and vegetation covariates; a KIT study where Chronos improved 3-day cooling-demand forecasts when given outdoor temperature. These came from abstracts and aggregator snippets and were not read in full. — [NeurIPS 2026 listing](https://neurips.cc/virtual/2026/174613), [IJCA 2026 paper](https://ijcaonline.org/archives/volume187/number141/machchar-ijca-2026-b17db3823872.pdf), [KIT study](https://publikationen.bibliothek.kit.edu/1000189856/177665554)

#### Earth-specific foundation models
- Prithvi-EO-2.0 (NASA/IBM): ViT masked autoencoder with 3D patch embeddings, pretrained on about 4.2M samples of NASA HLS V2 at 30 m, six bands (Blue, Green, Red, Narrow NIR, SWIR1, SWIR2). Variants: tiny-TL (about 5M), 100M-TL, 300M, 300M-TL, 600M, 600M-TL ("TL" = temporal and location embeddings). 600M-TL beats the earlier Prithvi by 8% on GEO-Bench. Fine-tuning notebooks for crop segmentation, landslide segmentation and carbon-flux regression run on a Colab T4. TerraTorch call: `from terratorch.registry import BACKBONE_REGISTRY; BACKBONE_REGISTRY.build("prithvi_eo_v2_tiny_tl", pretrained=True)`. Apache-2.0; paper arXiv:2412.02732. — [Prithvi-EO-2.0-300M-TL model card](https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL)
- The `ibm-nasa-geospatial` Hub organisation lists 15 models; the newest are `Prithvi-EO-2.0-tiny-TL` and `Prithvi-EO-2.0-100M-TL` (both created 2025-09-01); released fine-tunes are `Prithvi-EO-2.0-300M-TL-Sen1Floods11` and `Prithvi-EO-2.0-300M-BurnScars`. No new Earth-observation Prithvi generation created in 2026 appears in that listing. — [HF ibm-nasa-geospatial](https://huggingface.co/ibm-nasa-geospatial)
- Prithvi WxC: 2.3-billion-parameter weather/climate model trained on 160 MERRA-2 variables; pretraining tasks are forecasting and masked reconstruction; a separate rollout checkpoint (6-hour steps) is recommended for forecasting; fine-tunes exist for downscaling (`granite-geospatial-wxc-downscaling`, Colab T4 notebook) and gravity-wave parameterisation; licence CDLA-Permissive-2.0 for the base weights; code at NASA-IMPACT/Prithvi-WxC. The card gives no GPU memory requirement for the full model. — [Prithvi-WxC-1.0-2300M model card](https://huggingface.co/ibm-nasa-geospatial/Prithvi-WxC-1.0-2300M)
- TerraMind (IBM/ESA): `TerraMind-1.0-tiny/small/base/large` plus modality tokenizers (S2 L2A, S1 GRD/RTC, DEM, NDVI, LULC, coordinates), Apache-2.0, arXiv:2504.11171; fine-tunes `TerraMind-base-Fire` and `TerraMind-base-Flood` (created 2025-11-18). — [HF ibm-esa-geospatial](https://huggingface.co/ibm-esa-geospatial)
- Clay: `made-with-clay/Clay` on the Hub (Apache-2.0, last modified 2026-04-05); PyPI `claymodel` 1.5.0 (2025-05-28, single release). — [HF made-with-clay/Clay](https://huggingface.co/made-with-clay/Clay), [PyPI claymodel](https://pypi.org/project/claymodel/)
- TerraTorch: 1.2.14 (2026-11-04), "Apache-2.0 AND MIT", 39 releases, actively maintained. — [PyPI terratorch](https://pypi.org/project/terratorch/)
- The NASA/IBM science organisation's 2026 release is a Lunar foundation model (September 2026), not an Earth model; Surya (heliophysics, 2025) is out of scope. — [HF nasa-ibm-ai4science](https://huggingface.co/nasa-ibm-ai4science)

#### Unverified this session (prior knowledge)
- [UNVERIFIED] TimeGPT is a closed model behind Nixtla's API: it needs an API key and sends the series to Nixtla's servers; only the client is open source.
- [UNVERIFIED] TTM r1/r2 were pretrained mainly on minutely-to-hourly data with fixed context lengths (512/1024/1536) and horizons up to 720; a 276-point monthly series is shorter than the smallest standard context, so TTM is an awkward fit for monthly climate data.
- [UNVERIFIED] GIFT-Eval and fev-bench contain some "nature"/weather-type series (station weather, river flow, solar), but they are dominated by energy, retail, web and transport data; they are not evidence about decadal climate trends.
- [UNVERIFIED] Key papers: Chronos, Ansari et al. 2024, TMLR — [arXiv:2403.07815](https://arxiv.org/abs/2403.07815); Chronos-2 — [arXiv:2510.15821](https://arxiv.org/abs/2510.15821); Moirai — [arXiv:2402.02592](https://arxiv.org/abs/2402.02592); Lag-Llama — [arXiv:2310.08278](https://arxiv.org/abs/2310.08278); TTM — [arXiv:2401.03955](https://arxiv.org/abs/2401.03955); Prithvi WxC — [arXiv:2409.13598](https://arxiv.org/abs/2409.13598).

### Inferences
- **Ranking for this project (accuracy-for-effort on CPU):** (1) Chronos-2 or chronos-2-small: permissive licence, covariates (e.g. ENSO index, CO2, precipitation as drivers of water storage), quantiles, a pandas-in/pandas-out call, and a context limit (8,192) far above 276 monthly points. (2) Chronos-Bolt-small/tiny: univariate only, but the lightest proven CPU option. (3) statsforecast `AutoETS`, `AutoARIMA`, `AutoTheta`, `SeasonalNaive`: mandatory baselines, run in seconds. Avoid Moirai (non-commercial licence and stale library), Lag-Llama (unmaintained since 2024, no pip package), TimeGPT (data leaves the laptop, closed weights) and TimesFM 3.0 unless the licence is read first.
- For a few hundred regional series, CPU inference with a 28M-120M model is practical; forecasting every grid cell is not worth it and adds nothing scientifically.
- The honest framing for judges: these models are pattern extrapolators trained mostly on non-climate data; on deseasonalised monthly anomalies the predictable part is the trend plus any ENSO-type persistence, so the forecast should be shown as "statistical continuation with uncertainty band, conditional on no regime change", validated by hold-out (train to 2019, test 2020-2025), with skill scores relative to climatology and persistence. A zero-shot model that fails to beat seasonal-naive should be reported as such.
- **Earth foundation models, 48-hour verdict:** Prithvi-EO-2.0, TerraMind and Clay work on high-resolution image patches (HLS/Sentinel, 10-30 m) and solve segmentation or regression after fine-tuning; they do not consume 0.5 degree monthly time series and do not produce trends. Prithvi WxC is a 2.3B-parameter model on 6-hourly MERRA-2 fields, built for weather rollouts and downscaling, not for multi-decadal trend detection. None of them adds value to the core pipeline in 48 hours. The only cheap, defensible use is a side illustration: run an existing fine-tuned checkpoint (flood or burn-scar segmentation) on one before/after scene in a hotspot region as "ground truth zoom-in", on a single T4-class GPU.

### Gaps
- No leaderboard page (fev-bench or GIFT-Eval) was opened, so the current rank order among Chronos-2, TimesFM 2.5/3.0, TiRex-2, Toto-2.0 and TTM-R3 as of November 2026 is not established here; the Chronos-2 "state of the art" statement is the vendor's.
- No measured CPU latency for any model.
- TTM-R3's context/horizon limits and its handling of monthly data are not documented on the model card.
- The licence text behind TimesFM 3.0's "other" tag was not read.
- Whether any 2026 Earth foundation model exists outside the organisations checked (for example new NASA or ESA releases under other Hub accounts) was not searched.
- GPU memory needed for Prithvi WxC inference was not found.

---

## Key question 4: What are the top reviewer criticisms of each advanced method that the team should pre-empt in the demo?

### Takeaway
Each layer has one well-known failure that judges will look for: uncorrected autocorrelation and multiple testing in trend maps; sensor-merging artefacts, short records and "predicting the tipping date" in early-warning work; GRACE's coarse footprint and model-dependent soil-moisture term in water-balance attribution; hidden confounders and non-stationarity in causal graphs; unvalidated extrapolation in forecasts; and unverified numbers produced by language-model agents.

### Cited Findings

#### Trend and significance
- Wilks (2016) is the standard reference that gridded significance maps "routinely" overstate results when local tests are stippled without multiplicity control. — [Wilks 2016](https://doi.org/10.1175/BAMS-D-15-00267.1)
- [measured] With modest autocorrelation (phi = 0.3) and no real trend, an uncorrected OLS test declares 15% of cells significant at the 5% level, three times the nominal rate; with the lag-1 correction 5.4%; after FDR control essentially none.

#### Tipping-point early warning
- Merging satellite instruments with different noise levels changes variance and lag-1 autocorrelation by itself, and the artefact is worst in regional or land-cover aggregates. — [Smith et al. 2023, ESD](https://esd.copernicus.org/articles/14/173/2023/)
- Tipping-time extrapolation from historical data is not robust: AMOC estimates spanned 2050 to 8065 depending on the fingerprint and data set, and the authors conclude uncertainties are too large to predict tipping times. — [Ben-Yami et al. 2024 (PIK copy)](https://publications.pik-potsdam.de/pubman/item/item_30214), [Phys.org summary](https://phys.org/news/2024-08-day-tomorrow-climate.html)
- [measured] On stationary noise, 1 cell in 5 shows Kendall tau > 0.3 for rolling AR(1) by chance, and the naive tau p-value marks 80% of cells "significant", because overlapping windows are strongly dependent.
- The Bury classifier code is licensed CC BY-NC-SA 4.0 and built for 500- or 1,500-point inputs. — [deep-early-warnings-pnas](https://github.com/ThomasMBury/deep-early-warnings-pnas)

#### Water-balance attribution (GRACE)
- Rodell et al. (2018), Nature 557, 651-659, quantified 34 trends in terrestrial water storage observed by GRACE during 2002-2016 and attributed each to natural interannual variability, unsustainable groundwater consumption, climate change, or combinations. — [NASA NTRS record](https://ntrs.nasa.gov/citations/20180003130), [DOI 10.1038/s41586-018-0123-1](https://doi.org/10.1038/s41586-018-0123-1)
- The attribution in that paper was built region by region from several lines of evidence; for Xinjiang, the loss of 5.5 gigatonnes per year required piecing together multiple factors, and reduced rainfall was not the cause. — [EurekAlert release](https://www.eurekalert.org/news-releases/784016)
- [UNVERIFIED] The groundwater residual equation used by Rodell et al. (2009) and Famiglietti et al. (2011): dGW = dTWS(GRACE) - dSM - dSWE - dSW, where soil moisture (SM) and snow water equivalent (SWE) come from GLDAS land-surface models (ensemble of Noah, CLM, VIC, Mosaic) and surface water (SW) from reservoir or altimetry records where it matters; the full balance is dTWS/dt = P - ET - R. Rodell et al. 2009 reported about 4.0 +/- 1.0 cm/yr equivalent water height, about 17.7 +/- 4.5 km3/yr, over Rajasthan, Punjab and Haryana (August 2002 - October 2008). — [Rodell et al. 2009, DOI 10.1038/nature08238](https://doi.org/10.1038/nature08238), [Famiglietti et al. 2011, DOI 10.1029/2010GL046442](https://doi.org/10.1029/2010GL046442)
- [UNVERIFIED] Typical terms and data: TWS from GRACE/GRACE-FO mascons (JPL RL06 on 3-degree mascons delivered at 0.5 degree, CSR RL06, GSFC); SM, SWE and canopy from GLDAS-2.x Noah or CLSM; P from GPCP or IMERG; ET from MOD16, GLEAM or GLDAS; runoff from GRDC or GLDAS. GRACE's effective resolution is about 300 km (roughly 100,000-200,000 km2); gridded 0.25-0.5 degree products are interpolated and do not add information. There is an 11-month gap between GRACE (ended 2017) and GRACE-FO (from mid-2018).

#### Causal discovery and teleconnections
- tigramite 5.2.10.1 was released 2026-01-14 (GPL-3.0, 49 releases); the README states Python 3.10+, numpy, scipy and numba. — [PyPI tigramite](https://pypi.org/project/tigramite/), [tigramite README](https://github.com/jakobrunge/tigramite)
- Assumptions per method, beyond the causal Markov condition and faithfulness: PCMCI needs causal stationarity, no contemporaneous causal links and no hidden variables; PCMCI+ needs causal stationarity and no hidden variables (allows contemporaneous links, returns a time-series CPDAG); LPCMCI needs only causal stationarity (allows latent confounders, returns a PAG); RPCMCI handles regimes; J-PCMCI+ handles multiple data sets. — [tigramite README](https://github.com/jakobrunge/tigramite)
- Independence tests and their assumptions: `ParCorr` (linear, Gaussian noise), `RobustParCorr` (linear, non-Gaussian marginals), `ParCorrWLS` (heteroskedastic), `GPDC`/`GPDCtorch` (additive nonlinear), `CMIknn` (general, permutation-based), `Gsquared`, `CMIsymb`, `RegressionCI`, `CMIknnMixed`. — [tigramite README](https://github.com/jakobrunge/tigramite)
- [measured] API in 5.2.10.1: `PCMCI(dataframe=pp.DataFrame(data, var_names=...), cond_ind_test=ParCorr()).run_pcmci(tau_max=..., pc_alpha=...)`, `.run_pcmciplus(...)`, `.get_corrected_pvalues(p_matrix, fdr_method='fdr_bh')`; `LPCMCI(...).run_lpcmci(...)`; modules include `pcmci`, `lpcmci`, `rpcmci`, `jpcmciplus`, `causal_effects`, `data_processing`, `plotting`, `models`.
- [measured] **Install trap:** after `pip install tigramite`, `from tigramite.pcmci import PCMCI` fails with `ModuleNotFoundError: No module named 'joblib'`, because joblib, numba, scikit-learn, matplotlib and networkx are only in the optional `all` extra. Use `pip install "tigramite[all]"` or add `joblib numba scikit-learn matplotlib networkx` explicitly.
- Alternatives and status: `causal-learn` 0.1.4.8 (2026-07-11); `dowhy` 0.14 (2025-11-08, MIT, Python < 3.14); `pyEDM` 2.5.7 (2026-08-29, convergent cross mapping and empirical dynamic modelling, custom UCSD licence); `pyunicorn` 1.0.0 (2026-07-17, BSD-3, climate networks); older CCM packages `causal-ccm` 0.4.0 (2023) and `skccm` (2017) are stale. — [PyPI causal-learn](https://pypi.org/project/causal-learn/), [PyPI dowhy](https://pypi.org/project/dowhy/), [PyPI pyEDM](https://pypi.org/project/pyEDM/), [PyPI pyunicorn](https://pypi.org/project/pyunicorn/)
- EOF packages: `xeofs` 3.0.6 (2026-10-23, MIT, Python >= 3.10, 40 releases, active; xarray/dask-native, includes rotated/varimax EOFs); `eofs` 2.0.0 (2024-11-15, GPL-3.0, slow release cadence). — [PyPI xeofs](https://pypi.org/project/xeofs/), [PyPI eofs](https://pypi.org/project/eofs/)
- [UNVERIFIED] Papers: PCMCI, Runge et al. 2019, Science Advances 5, eaau4996 — [DOI 10.1126/sciadv.aau4996](https://doi.org/10.1126/sciadv.aau4996); perspective on causal inference in Earth sciences, Runge et al. 2019, Nat. Commun. 10, 2553 — [DOI 10.1038/s41467-019-10105-3](https://doi.org/10.1038/s41467-019-10105-3); review, Runge et al. 2023, Nat. Rev. Earth Environ. — [DOI 10.1038/s43017-023-00431-y](https://doi.org/10.1038/s43017-023-00431-y); PCA-varimax modes as nodes, Runge et al. 2015, Nat. Commun. 6, 8502 — [DOI 10.1038/ncomms9502](https://doi.org/10.1038/ncomms9502) and Nowack et al. 2020 — [DOI 10.1038/s41467-020-15195-y](https://doi.org/10.1038/s41467-020-15195-y); CCM, Sugihara et al. 2012 — [DOI 10.1126/science.1227079](https://doi.org/10.1126/science.1227079). Granger causality is `statsmodels.tsa.stattools.grangercausalitytests` (bivariate, linear, no control for third variables).

#### Equation discovery
- `pysindy` 2.1.0 (2026-01-08, MIT, Python >= 3.10, 38 releases); `pysr` 2.7.2 (2026-10-19, Apache-2.0, 228 releases, very active). — [PyPI pysindy](https://pypi.org/project/pysindy/), [PyPI pysr](https://pypi.org/project/pysr/)
- [UNVERIFIED] SINDy (Brunton, Proctor & Kutz 2016, PNAS — [DOI 10.1073/pnas.1517384113](https://doi.org/10.1073/pnas.1517384113)) needs numerical time derivatives, which are noise-dominated for monthly anomalies of a few hundred points; PySR (Cranmer 2023 — [arXiv:2305.01582](https://arxiv.org/abs/2305.01582)) installs a Julia backend on first import and can need minutes to hours of search.

#### LLM agent tooling
- Earth-Agent (Feng et al., ICLR 2026) is an agent framework using an MCP-based tool ecosystem of 104 tools in five kits (Index, Inversion, Perception, Analysis, Statistics); its Earth-Bench has 13,729 images and 248 expert-curated questions over 14 tasks, with auto-planning and instruction-following modes, scoring both trajectories and final answers; general agents often failed completely on some task groups and long reasoning chains remain hard. Code: github.com/opendatalab/Earth-Agent. — [Earth-Agent project page](https://opendatalab.github.io/Earth-Agent), [ICLR 2026 poster](https://iclr.cc/virtual/2026/poster/10008386)
- OpenEarth-Agent (2026) argues predefined-tool agents are limiting and lets the agent create tools; OpenEarth-Bench has 596 real-world full-pipeline cases in seven domains. — [arXiv 2603.22148](https://arxiv.org/html/2603.22148)
- Evidence on agents doing data analysis (from search snippets, not full papers): the DAB benchmark groups failures into failing before planning, wrong solution plan, wrong data selection, wrong implementation and runtime error; AIDABench reports the best model at 59.43 pass@1; LongDS-Bench finds long analyses fail mostly through cascading and state errors; a 2026 JMIR pilot found an LLM agent reliable at drafting analysis plans but needing expert checks of formula composition and cohort logic before results were reported. — [AgenticDataBench / DAB](https://arxiv.org/pdf/2607.01647), [arXiv 2603.15636](https://arxiv.org/html/2603.15636v1), [JMIR 2026](https://www.jmir.org/2026/1/e99597)
- [UNVERIFIED] Related projects: Microsoft's GeoLLM-Engine / GeoLLM-QA (2024) tool-use benchmarks for remote-sensing copilots; NASA's "Earth Copilot" prototype with Microsoft (2024); ClimateGPT and ChatClimate (text question-answering, not data analysis). Not checked in this session.

### Inferences
**Pre-emption checklist, one line per likely objection:**

| Layer | Likely objection | What to show |
|---|---|---|
| Trend map | "Did you account for autocorrelation?" | Named corrected test (Hamed-Rao / Yue-Wang / effective sample size); compare naive vs corrected stippled area |
| Trend map | "With 100,000+ tests, 5% are significant by chance" | FDR-adjusted stippling (Wilks 2016), state alpha_FDR |
| Trend map | "20 years is not climate; this could be ENSO or decadal variability" | Call results "trends over 2002-2025", show sensitivity to start/end year, avoid the word "climate change" unless attribution supports it |
| Trend map | "Why linear?" | Theil-Sen plus a change-point check (ruptures/Rbeast) on headline regions |
| Slowing down | "Your AR(1) rise is a sensor change" | Single-sensor record only; cite Smith et al. 2023; mark known instrument transitions on the plot |
| Slowing down | "Record too short, window dependence" | Sensitivity panel over window length and detrending bandwidth; surrogates for significance |
| Slowing down | "Rising AR(1) is not proof of a tipping point" | Wording: "loss of resilience indicator", not "collapse in year X"; cite Ben-Yami et al. 2024; note that rising variance or redder forcing also raises AR(1) |
| Slowing down | "Gap-filling and smoothing inflate autocorrelation" | Use unsmoothed, un-interpolated data; state missing-data handling |
| Water balance | "GRACE cannot resolve your region" | Work at basin scale (>= about 150,000 km2); never interpret single 0.5 degree pixels |
| Water balance | "Groundwater is a residual of model soil moisture" | Error bars from the spread of land-surface models; say GLDAS (Noah) has no irrigation or groundwater pumping, so the residual mixes human use with model error |
| Water balance | "Nature vs humans is not that binary" | Use Rodell et al. 2018's three categories plus "mixed"; support with precipitation trend and irrigation maps, as that paper did |
| Water balance | "GRACE / GRACE-FO gap and leakage" | Mark the 2017-2018 gap; use mascon solutions with their scale factors |
| Causal graph | "Correlation of two trends is not causation" | Detrend and deseasonalise before PCMCI; links are between anomalies, not trends |
| Causal graph | "Hidden common driver (ENSO)" | Include ENSO/IOD/NAO indices as nodes; mention LPCMCI; call links "consistent with a causal influence under stated assumptions" |
| Causal graph | "Too many variables for 276 time steps" | Reduce to about 10-20 nodes (regional means or varimax-rotated EOF modes via xeofs); report `pc_alpha`, `tau_max`, FDR-corrected p-values |
| Causal graph | "Linear test, stationarity" | State ParCorr assumptions; show the result is stable across `tau_max` and sub-periods |
| Forecast | "Does it beat climatology?" | Rolling-origin backtest with seasonal-naive, persistence and AutoETS; report skill score and interval coverage |
| Forecast | "A language-style model cannot know physics or forcing" | Present as statistical continuation with quantile band; no claims past a few years |
| Equation discovery | "Overfitted formula" | Keep as optional; if shown, restrict to a simple water-balance bucket fit with held-out validation |
| LLM agents | "Did the model invent that number?" | Agents call deterministic tools only; every figure in the narrative is pulled from a tool result with a logged call; the skeptic agent re-runs with a different test, period and data set |

- For the "detective plus skeptic" design, the documented failure pattern (wrong plan, wrong data selection, cascading state errors) argues for: a small fixed tool set with typed inputs (load region, compute trend, compute FDR map, compute resilience indicator, run PCMCI), numbers never typed by the model, a skeptic whose checklist is the table above (autocorrelation, multiplicity, sensor change, period sensitivity, alternative data set), and a saved provenance log judges can open.
- PCA-varimax or regional-mean dimension reduction is not optional for layer (c): PCMCI on raw grid cells would have thousands of strongly redundant variables against fewer than 300 samples.
- PySINDy is mature as software but a poor match for noisy monthly climate anomalies; PySR is practical only for a small, well-posed regression (few inputs, a few hundred rows) and costs a Julia install. Both are "nice to have" and the first things to cut.
- Licences that matter if the project is ever reused: tigramite, eofs and Python bfast are GPL; Moirai weights and the Bury classifier code are non-commercial; pyEDM has a custom UCSD licence; everything in the recommended core (numpy, scipy, statsmodels, numba, pymannkendall, ewstools, xeofs, Chronos, statsforecast) is permissive.

### Gaps
- GRACE-specific numbers (resolution, mascon versions, uncertainty magnitudes, current GRACE-FO release) are from prior knowledge and were not checked against JPL/CSR/GSFC documentation in this session; the Rodell 2009 figures likewise.
- Critique literature not re-opened: Boettiger & Hastings 2012 (prosecutor's fallacy), Ditlevsen & Johnsen 2010 (need both variance and autocorrelation to rise), and any published comments specifically disputing Boulton et al. 2022 or Forzieri et al. 2022. Their existence is recalled, not verified here.
- PCMCI runtime and a worked teleconnection example were not produced.
- No source was found that directly quantifies LLM errors on statistical test selection or fabricated p-values; the agent failure evidence above is from general data-analysis benchmarks read only as search snippets.
- Earth-data agent projects from NASA/IBM specifically (beyond the Earth-Agent academic work) were not verified.
- Google/DeepMind models (TimesFM, GraphCast, AlphaEarth, NeuralGCM) are covered by another researcher; only TimesFM's Hub metadata is noted above for comparison.
