"""On-disk parquet cache for OHLCV bars, keyed by (symbol, timeframe).

Exists so the smoke test and every later phase (especially the backtester)
reuse fetched history instead of re-hitting Alpaca/FRED on every run.
Crypto symbols contain "/" which isn't filesystem-safe, so it's replaced
with "_" in the cache filename only — never in the data itself.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

_CACHE_DIR = Path(__file__).parent.parent / "data_cache"


def _cache_path(symbol: str, timeframe: str) -> Path:
    safe_symbol = symbol.replace("/", "_")
    return _CACHE_DIR / f"{safe_symbol}_{timeframe}.parquet"


def read(symbol: str, timeframe: str) -> pd.DataFrame | None:
    path = _cache_path(symbol, timeframe)
    if not path.exists():
        return None
    return pd.read_parquet(path)


def write(symbol: str, timeframe: str, df: pd.DataFrame) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(symbol, timeframe)

    existing = read(symbol, timeframe)
    if existing is not None:
        combined = pd.concat([existing, df])
        combined = combined[~combined.index.duplicated(keep="last")].sort_index()
    else:
        combined = df.sort_index()

    combined.to_parquet(path)
