"""Alpaca provider: multi-timeframe OHLCV + latest quotes for stocks, ETFs,
and crypto, plus account/positions read. Uses the same APCA_* credentials as
the existing PowerShell bots.
"""
from __future__ import annotations

import logging
from datetime import datetime

import pandas as pd
from alpaca.data.historical.crypto import CryptoHistoricalDataClient
from alpaca.data.historical.stock import StockHistoricalDataClient
from alpaca.data.requests import (
    CryptoBarsRequest,
    CryptoLatestQuoteRequest,
    StockBarsRequest,
    StockLatestQuoteRequest,
)
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
from alpaca.trading.client import TradingClient

import config
from data.providers.base import MarketDataProvider
from data.types import DataResult, DataStatus, Timeframe

logger = logging.getLogger(__name__)

_TIMEFRAME_MAP = {
    Timeframe.MIN_15: TimeFrame(15, TimeFrameUnit.Minute),
    Timeframe.HOUR_1: TimeFrame(1, TimeFrameUnit.Hour),
    Timeframe.HOUR_4: TimeFrame(4, TimeFrameUnit.Hour),
    Timeframe.DAY_1: TimeFrame(1, TimeFrameUnit.Day),
}


def _is_crypto(symbol: str) -> bool:
    return "/" in symbol


class AlpacaProvider(MarketDataProvider):
    name = "alpaca"

    def __init__(self) -> None:
        self._stock_client = StockHistoricalDataClient(
            config.APCA_API_KEY_ID, config.APCA_API_SECRET_KEY
        )
        self._crypto_client = CryptoHistoricalDataClient(
            config.APCA_API_KEY_ID, config.APCA_API_SECRET_KEY
        )
        self._trading_client = TradingClient(
            config.APCA_API_KEY_ID,
            config.APCA_API_SECRET_KEY,
            paper="paper-api" in config.APCA_API_BASE_URL,
        )

    def get_bars(
        self, symbol: str, timeframe: Timeframe, start: datetime, end: datetime
    ) -> DataResult[pd.DataFrame]:
        alpaca_tf = _TIMEFRAME_MAP[timeframe]
        try:
            if _is_crypto(symbol):
                req = CryptoBarsRequest(
                    symbol_or_symbols=symbol, timeframe=alpaca_tf, start=start, end=end
                )
                bars = self._crypto_client.get_crypto_bars(req)
            else:
                req = StockBarsRequest(
                    symbol_or_symbols=symbol, timeframe=alpaca_tf, start=start, end=end
                )
                bars = self._stock_client.get_stock_bars(req)
        except Exception as exc:  # noqa: BLE001 - any SDK/HTTP failure becomes an error result
            logger.warning("AlpacaProvider.get_bars failed for %s %s: %s", symbol, timeframe, exc)
            return DataResult.error(self.name, f"{symbol} {timeframe.value}: {exc}")

        df = bars.df
        if df is None or df.empty:
            return DataResult.error(self.name, f"{symbol} {timeframe.value}: no bars returned")

        # bars.df is multi-indexed (symbol, timestamp) when queried per-symbol; flatten it.
        if isinstance(df.index, pd.MultiIndex):
            df = df.droplevel("symbol")
        df = df[["open", "high", "low", "close", "volume"]]
        return DataResult.ok_result(self.name, df)

    def get_latest_quote(self, symbol: str) -> DataResult[dict]:
        try:
            if _is_crypto(symbol):
                req = CryptoLatestQuoteRequest(symbol_or_symbols=symbol)
                quotes = self._crypto_client.get_crypto_latest_quote(req)
            else:
                req = StockLatestQuoteRequest(symbol_or_symbols=symbol)
                quotes = self._stock_client.get_stock_latest_quote(req)
        except Exception as exc:  # noqa: BLE001
            logger.warning("AlpacaProvider.get_latest_quote failed for %s: %s", symbol, exc)
            return DataResult.error(self.name, f"{symbol}: {exc}")

        quote = quotes.get(symbol)
        if quote is None:
            return DataResult.error(self.name, f"{symbol}: no quote returned")

        return DataResult.ok_result(
            self.name,
            {
                "symbol": symbol,
                "bid_price": quote.bid_price,
                "ask_price": quote.ask_price,
                "timestamp": quote.timestamp,
            },
        )

    def get_account(self) -> DataResult[dict]:
        try:
            account = self._trading_client.get_account()
        except Exception as exc:  # noqa: BLE001
            logger.warning("AlpacaProvider.get_account failed: %s", exc)
            return DataResult.error(self.name, str(exc))
        return DataResult.ok_result(
            self.name,
            {
                "equity": float(account.equity),
                "cash": float(account.cash),
                "buying_power": float(account.buying_power),
                "status": str(account.status),
            },
        )

    def get_positions(self) -> DataResult[list[dict]]:
        try:
            positions = self._trading_client.get_all_positions()
        except Exception as exc:  # noqa: BLE001
            logger.warning("AlpacaProvider.get_positions failed: %s", exc)
            return DataResult.error(self.name, str(exc))
        return DataResult.ok_result(
            self.name,
            [
                {
                    "symbol": p.symbol,
                    "qty": float(p.qty),
                    "side": str(p.side),
                    "avg_entry_price": float(p.avg_entry_price),
                    "unrealized_pl": float(p.unrealized_pl),
                }
                for p in positions
            ],
        )
