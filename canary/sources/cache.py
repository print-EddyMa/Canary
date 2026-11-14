"""Tiny on-disk cache for downloaded data, so repeat lookups are instant."""

from __future__ import annotations

import os
import time
from pathlib import Path

CACHE_DIR = Path(os.environ.get("CANARY_CACHE", Path(__file__).resolve().parents[2] / ".cache"))


def cached_text(namespace: str, key: str, fetch, max_age_days: float) -> str:
    """Return cached text for `key`, calling `fetch()` when missing or stale."""
    path = CACHE_DIR / namespace / key
    if path.exists() and (time.time() - path.stat().st_mtime) < max_age_days * 86400:
        return path.read_text()
    try:
        text = fetch()
    except Exception:
        # A stale copy beats no data when the upstream service is down.
        if path.exists():
            return path.read_text()
        raise
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)
    return text
