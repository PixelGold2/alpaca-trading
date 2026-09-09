"""FRED provider: macro/broad-market series (VIX, Treasury yields, DXY
proxy, gold) via plain REST — no SDK needed for a handful of series.
"""
from __future__ import annotations

import logging
from datetime import datetime

import pandas as pd
import requests

import config
from data.types import DataResult

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"


class FredProvider:
    name = "fred"

    def get_series(
        self, series_id: str, start: datetime, end: datetime
    ) -> DataResult[pd.DataFrame]:
        if not config.FRED_API_KEY:
            return DataResult.error(self.name, "FRED_API_KEY not set in quant/.env")

        params = {
            "series_id": series_id,
            "api_key": config.FRED_API_KEY,
            "file_type": "json",
            "observation_start": start.strftime("%Y-%m-%d"),
            "observation_end": end.strftime("%Y-%m-%d"),
        }
        try:
            resp = requests.get(_BASE_URL, params=params, timeout=15)
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("FredProvider.get_series failed for %s: %s", series_id, exc)
            return DataResult.error(self.name, f"{series_id}: {exc}")

        observations = payload.get("observations", [])
        if not observations:
            return DataResult.error(self.name, f"{series_id}: no observations returned")

        df = pd.DataFrame(observations)[["date", "value"]]
        df["date"] = pd.to_datetime(df["date"])
        # FRED uses "." for missing values (holidays/no data) on that date.
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
        df = df.dropna(subset=["value"]).set_index("date")

        if df.empty:
            return DataResult.error(self.name, f"{series_id}: all observations missing/non-numeric")

        return DataResult.ok_result(self.name, df)
