"""Phase 1 proof-of-life: pulls sample data from both providers across
asset classes and timeframes, prints the DataResult status for each call.
Any status="error" is investigated before Phase 1 is considered done.

Run from quant/: python scripts/fetch_check.py
"""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from data.providers.alpaca_provider import AlpacaProvider  # noqa: E402
from data.providers.fred_provider import FredProvider  # noqa: E402
from data.types import DataStatus, Timeframe  # noqa: E402
from data.universe import BROAD_MARKET_ETFS, CRYPTO, MACRO_SERIES, STOCKS  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def _print_result(label: str, result) -> None:
    icon = "OK  " if result.status == DataStatus.LIVE else "FAIL"
    extra = ""
    if result.status == DataStatus.LIVE:
        extra = f"rows={len(result.data)}"
    else:
        extra = result.message
    print(f"[{icon}] {label:45s} status={result.status.value:6s} {extra}")


def main() -> None:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=10)

    alpaca = AlpacaProvider()
    fred = FredProvider()

    print("\n=== Alpaca: account/positions ===")
    _print_result("account", alpaca.get_account())
    _print_result("positions", alpaca.get_positions())

    print("\n=== Alpaca: sample stocks x all timeframes ===")
    sample_stocks = STOCKS[:3]
    for asset in sample_stocks:
        for tf in Timeframe:
            _print_result(f"{asset.symbol} {tf.value}", alpaca.get_bars(asset.symbol, tf, start, end))

    print("\n=== Alpaca: broad-market ETFs (1D) ===")
    for etf in BROAD_MARKET_ETFS:
        _print_result(f"{etf.symbol} 1D", alpaca.get_bars(etf.symbol, Timeframe.DAY_1, start, end))

    print("\n=== Alpaca: crypto x all timeframes ===")
    for crypto in CRYPTO:
        for tf in Timeframe:
            _print_result(f"{crypto.symbol} {tf.value}", alpaca.get_bars(crypto.symbol, tf, start, end))

    print("\n=== FRED: macro series ===")
    macro_start = end - timedelta(days=30)
    for label, series_id in MACRO_SERIES.items():
        _print_result(f"{label} ({series_id})", fred.get_series(series_id, macro_start, end))

    print()


if __name__ == "__main__":
    main()
