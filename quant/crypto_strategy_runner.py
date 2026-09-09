"""Recurring crypto runner for the EMA/RSI/ATR strategy (same rules as
simple_strategy_backtest.py). Meant to be invoked periodically by Task
Scheduler. Each run:

  1. For any symbol with an open position AND tracked state: recompute the
     ATR chandelier trailing stop from the latest completed daily bar and
     exit (market sell) if it's breached.
  2. For any symbol with no open position: check the entry signal on the
     latest completed daily bar; if it fires, place a market buy sized the
     same way the backtest sizes trades and record stop-tracking state.

State (entry price / stop / trailing high) persists across runs in
crypto_live_state.json since the trailing stop depends on the running max
close since entry, which a single stateless check can't reconstruct.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
from alpaca.data.historical.crypto import CryptoHistoricalDataClient
from alpaca.data.requests import CryptoBarsRequest
from alpaca.data.timeframe import TimeFrame
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.trading.requests import MarketOrderRequest

sys.path.insert(0, str(Path(__file__).parent))
import config  # noqa: E402
from simple_strategy_backtest import (  # noqa: E402
    ATR_STOP_MULT,
    ATR_TRAIL_MULT,
    MAX_POSITION_FRACTION,
    RISK_PER_TRADE,
    add_indicators,
)

CRYPTO_SYMBOLS = ["BTC/USD", "ETH/USD"]
STATE_PATH = Path(__file__).parent / "crypto_live_state.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
logger = logging.getLogger("crypto_strategy_runner")


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {}


def save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2, default=str))


def fetch_crypto_daily(client: CryptoHistoricalDataClient, symbol: str) -> pd.DataFrame | None:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=400)
    req = CryptoBarsRequest(symbol_or_symbols=symbol, timeframe=TimeFrame.Day, start=start, end=end)
    bars = client.get_crypto_bars(req)
    df = bars.df
    if df is None or df.empty:
        return None
    if isinstance(df.index, pd.MultiIndex):
        df = df.droplevel("symbol")
    return df[["open", "high", "low", "close", "volume"]].sort_index()


def handle_exit(trading_client: TradingClient, symbol: str, df: pd.DataFrame, sym_state: dict, existing_qty: float) -> bool:
    """Returns True if a position was closed this run."""
    last = df.iloc[-1]
    highest_close = max(sym_state["highest_close"], float(last["close"]))
    trail_stop = highest_close - ATR_TRAIL_MULT * float(last["atr14"])
    effective_stop = max(sym_state["initial_stop"], trail_stop, sym_state.get("trail_stop", trail_stop))

    sym_state["highest_close"] = highest_close
    sym_state["trail_stop"] = effective_stop

    logger.info(
        "%s: open position, close=%.2f effective_stop=%.2f (initial=%.2f trail=%.2f)",
        symbol, last["close"], effective_stop, sym_state["initial_stop"], trail_stop,
    )

    if float(last["low"]) <= effective_stop:
        order = MarketOrderRequest(
            symbol=symbol, qty=existing_qty, side=OrderSide.SELL, time_in_force=TimeInForce.GTC,
        )
        result = trading_client.submit_order(order)
        logger.info("%s: STOP BREACHED, closing position. order id=%s status=%s", symbol, result.id, result.status)
        return True

    return False


def handle_entry(trading_client: TradingClient, symbol: str, df: pd.DataFrame, sleeve_equity: float) -> dict | None:
    last = df.iloc[-1]
    if not bool(last["entry_signal"]):
        logger.info("%s: no position, no entry signal (rsi14=%.1f)", symbol, float(last["rsi14"]))
        return None

    entry_price = float(last["close"])
    initial_stop = entry_price - ATR_STOP_MULT * float(last["atr14"])
    risk_per_unit = entry_price - initial_stop
    if risk_per_unit <= 0:
        logger.warning("%s: entry signal fired but invalid stop distance, skipping", symbol)
        return None

    risk_amount = sleeve_equity * RISK_PER_TRADE
    qty = risk_amount / risk_per_unit
    max_qty = (sleeve_equity * MAX_POSITION_FRACTION) / entry_price
    qty = round(min(qty, max_qty), 6)
    if qty <= 0:
        return None

    order = MarketOrderRequest(symbol=symbol, qty=qty, side=OrderSide.BUY, time_in_force=TimeInForce.GTC)
    result = trading_client.submit_order(order)
    logger.info(
        "%s: SIGNAL FIRED, bought qty=%s (~$%.2f) initial_stop=%.2f order id=%s status=%s",
        symbol, qty, qty * entry_price, initial_stop, result.id, result.status,
    )

    return {
        "entry_date": str(last.name),
        "entry_price": entry_price,
        "initial_stop": initial_stop,
        "highest_close": entry_price,
        "trail_stop": entry_price - ATR_TRAIL_MULT * float(last["atr14"]),
        "qty": qty,
    }


def main() -> None:
    data_client = CryptoHistoricalDataClient(config.APCA_API_KEY_ID, config.APCA_API_SECRET_KEY)
    trading_client = TradingClient(config.APCA_API_KEY_ID, config.APCA_API_SECRET_KEY, paper=True)

    account = trading_client.get_account()
    equity = float(account.equity)
    sleeve_equity = equity / len(CRYPTO_SYMBOLS)
    positions = {p.symbol: p for p in trading_client.get_all_positions()}

    state = load_state()

    for symbol in CRYPTO_SYMBOLS:
        alpaca_symbol = symbol.replace("/", "")
        df = fetch_crypto_daily(data_client, symbol)
        if df is None or len(df) < 210:
            logger.warning("%s: insufficient history, skipping", symbol)
            continue
        df = add_indicators(df)

        held = positions.get(symbol) or positions.get(alpaca_symbol)
        sym_state = state.get(symbol)

        if held is not None and sym_state is not None:
            closed = handle_exit(trading_client, symbol, df, sym_state, float(held.qty))
            if closed:
                state.pop(symbol, None)
            else:
                state[symbol] = sym_state
        elif held is not None and sym_state is None:
            logger.warning("%s: position exists but no tracked state (opened outside this runner?) -- not managing it", symbol)
        else:
            new_state = handle_entry(trading_client, symbol, df, sleeve_equity)
            if new_state is not None:
                state[symbol] = new_state

    save_state(state)


if __name__ == "__main__":
    main()
