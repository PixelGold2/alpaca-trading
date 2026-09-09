"""Abstract provider interface.

Later phases (strategy engine, backtester) consume data through this
interface and must not care which concrete provider backs a given symbol.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

import pandas as pd

from data.types import DataResult, Timeframe


class MarketDataProvider(ABC):
    name: str

    @abstractmethod
    def get_bars(
        self, symbol: str, timeframe: Timeframe, start: datetime, end: datetime
    ) -> DataResult[pd.DataFrame]:
        """OHLCV bars indexed by UTC timestamp, columns: open, high, low, close, volume."""

    @abstractmethod
    def get_latest_quote(self, symbol: str) -> DataResult[dict]:
        """Latest quote/price snapshot for `symbol`."""
