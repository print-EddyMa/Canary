"""Global annual grids for every catalogue variable.

Read once from NASA POWER's public Zarr stores on AWS (no login) and kept on
disk, so that a regional average for any variable is instant afterwards.
One variable is about 40 MB; the first read takes a few seconds.

    python -m canary.cube        # fetch every variable now
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np

from .catalogue import BY_ID, VARIABLES
from .sources.cache import CACHE_DIR

STORES = {
    "merra2": "nasa-power/merra2/temporal/power_merra2_annual_temporal_utc.zarr",
    "syn1deg": "nasa-power/syn1deg/temporal/power_syn1deg_annual_temporal_utc.zarr",
}
LAST_YEAR = 2025  # the stores reserve empty years beyond the last complete one


@dataclass
class Cube:
    years: np.ndarray  # (t,)
    lats: np.ndarray  # (y,) south to north
    lons: np.ndarray  # (x,) west to east
    data: np.ndarray  # (t, y, x) float32, NaN where there is no value


_memory: dict[str, Cube] = {}
_locks: dict[str, threading.Lock] = {v.id: threading.Lock() for v in VARIABLES}
_datasets: dict[str, object] = {}
_dataset_lock = threading.Lock()


def _path(variable_id: str):
    return CACHE_DIR / "cubes" / f"{variable_id}.npy"


def _meta_path(variable_id: str):
    return CACHE_DIR / "cubes" / f"{variable_id}.axes.npz"


def _dataset(store: str):
    with _dataset_lock:
        if store not in _datasets:
            import s3fs
            import xarray as xr
            fs = s3fs.S3FileSystem(anon=True)
            _datasets[store] = xr.open_zarr(fs.get_mapper(STORES[store]), consolidated=True)
        return _datasets[store]


def _download(variable_id: str) -> Cube:
    v = BY_ID[variable_id]
    ds = _dataset(v.store)
    da = ds[v.parameter]
    years_all = da.time.dt.year.values
    keep = years_all <= LAST_YEAR
    if v.start_year:
        keep &= years_all >= v.start_year
    data = da.isel(time=np.flatnonzero(keep)).load().values.astype(np.float32)
    data[data <= -900] = np.nan
    data *= np.float32(v.factor)
    years = years_all[keep].astype(np.int32)
    has_data = np.isfinite(data).any(axis=(1, 2))
    data, years = data[has_data], years[has_data]
    if v.min_mean is not None:
        # e.g. snow in the tropics: no signal to analyse, so leave those cells out.
        with np.errstate(all="ignore"):
            data[:, np.nan_to_num(np.nanmean(data, axis=0)) < v.min_mean] = np.nan
    return Cube(years, ds.lat.values.astype(np.float64), ds.lon.values.astype(np.float64), data)


def ready(variable_id: str) -> bool:
    return variable_id in _memory or (_path(variable_id).exists() and _meta_path(variable_id).exists())


def load(variable_id: str) -> Cube:
    """The annual cube for one variable, from memory, disk or NASA, in that order."""
    if variable_id in _memory:
        return _memory[variable_id]
    with _locks[variable_id]:
        if variable_id in _memory:
            return _memory[variable_id]
        path, meta = _path(variable_id), _meta_path(variable_id)
        if not (path.exists() and meta.exists()):
            cube = _download(variable_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp.npy")
            np.save(tmp, cube.data)
            tmp.replace(path)
            np.savez(meta, years=cube.years, lats=cube.lats, lons=cube.lons)
        # Memory-mapped: only the cells a region touches are read into memory.
        with np.load(meta) as f:
            cube = Cube(f["years"], f["lats"], f["lons"], np.load(path, mmap_mode="r"))
        _memory[variable_id] = cube
        return cube


def warm(log=None) -> None:
    """Fetch every variable that is not on disk yet."""
    for v in VARIABLES:
        try:
            if not ready(v.id) and log:
                log(f"fetching {v.id}")
            load(v.id)
        except Exception as exc:  # noqa: BLE001 - one variable failing must not stop the rest
            if log:
                log(f"{v.id} failed: {exc}")


def warm_in_background() -> None:
    threading.Thread(target=warm, name="canary-cube-warm", daemon=True).start()


if __name__ == "__main__":
    warm(print)
