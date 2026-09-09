"""
A single, self-contained strategy + backtest — no separate AI layer, no
regime-detection framework, no walk-forward harness. Just one sensible
long-only trend + pullback strategy on a handful of liquid names, tested on
real historical daily bars, with the stats read directly off the trade log.

Strategy: EMA Trend Filter + RSI Pullback Recovery + ATR Trailing Stop
-----------------------------------------------------------------------
Trend filter (only long when true):
    EMA50 > EMA200  AND  close > EMA200

Entry (all on the same daily close, executed at next day's open):
    RSI14 crosses back above 35 (was below 35 the prior day) -- a
    pullback within the uptrend that's starting to recover
    AND today's volume > 20-day average volume (confirms the recovery
    has real participation, not just drift)

Initial stop: entry - 2 x ATR14 (as of the entry signal day)
Exit: ATR chandelier trailing stop -- stop = highest close since entry
    minus 3 x ATR14, only ever moves up, exit (at the stop price) the
    first day the low touches or breaches it.

Costs: 0.05% slippage on both entry and exit fills, $0 commission
    (matches Alpaca's commission-free paper account).

Position sizing: each symbol gets an equal capital sleeve
    ($100,000 / N symbols). Within a sleeve, one position at a time,
    sized to risk 1% of that sleeve's current equity based on stop
    distance, capped so no trade uses more than 95% of sleeve equity
    (no leverage).

This is intentionally simple -- one indicator set, one entry idea, one
exit idea, no curve-fitted parameter grid. Read the results as "is this
one reasonable idea worth pursuing further," not as a finished product.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from alpaca.data.historical.stock import StockHistoricalDataClient
from alpaca.data.enums import DataFeed
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame

sys.path.insert(0, str(Path(__file__).parent))
import config  # noqa: E402

SYMBOLS = [
    "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "GOOGL",
    "AMZN", "META", "JPM", "XOM", "UNH", "HD",
]
LOOKBACK_YEARS = 3
STARTING_CAPITAL = 100_000.0
RISK_PER_TRADE = 0.01          # 1% of sleeve equity
SLIPPAGE = 0.0005              # 0.05% each way
RSI_PERIOD = 14
ATR_PERIOD = 14
RSI_PULLBACK_LEVEL = 35.0
ATR_STOP_MULT = 2.0
ATR_TRAIL_MULT = 3.0
MAX_POSITION_FRACTION = 0.95   # no leverage


@dataclass
class Trade:
    symbol: str
    entry_date: pd.Timestamp
    entry_price: float
    initial_stop: float
    shares: float
    exit_date: pd.Timestamp | None = None
    exit_price: float | None = None
    exit_reason: str = ""

    @property
    def r_multiple(self) -> float | None:
        if self.exit_price is None:
            return None
        risk = self.entry_price - self.initial_stop
        if risk <= 0:
            return None
        return (self.exit_price - self.entry_price) / risk

    @property
    def pnl(self) -> float | None:
        if self.exit_price is None:
            return None
        return (self.exit_price - self.entry_price) * self.shares


def fetch_daily_bars(client: StockHistoricalDataClient, symbol: str, start: datetime, end: datetime) -> pd.DataFrame | None:
    req = StockBarsRequest(symbol_or_symbols=symbol, timeframe=TimeFrame.Day, start=start, end=end, feed=DataFeed.IEX)
    try:
        bars = client.get_stock_bars(req)
    except Exception as exc:  # noqa: BLE001
        print(f"  [FETCH ERROR] {symbol}: {exc}")
        return None
    df = bars.df
    if df is None or df.empty:
        print(f"  [FETCH ERROR] {symbol}: no bars returned")
        return None
    if isinstance(df.index, pd.MultiIndex):
        df = df.droplevel("symbol")
    return df[["open", "high", "low", "close", "volume"]].sort_index()


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
    df["ema200"] = df["close"].ewm(span=200, adjust=False).mean()

    delta = df["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / RSI_PERIOD, min_periods=RSI_PERIOD, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / RSI_PERIOD, min_periods=RSI_PERIOD, adjust=False).mean()
    rs = avg_gain / avg_loss
    df["rsi14"] = 100 - (100 / (1 + rs))

    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    df["atr14"] = tr.ewm(alpha=1 / ATR_PERIOD, min_periods=ATR_PERIOD, adjust=False).mean()

    df["avg_vol20"] = df["volume"].rolling(20).mean()

    trend_ok = (df["ema50"] > df["ema200"]) & (df["close"] > df["ema200"])
    rsi_cross_up = (df["rsi14"].shift(1) < RSI_PULLBACK_LEVEL) & (df["rsi14"] >= RSI_PULLBACK_LEVEL)
    vol_confirm = df["volume"] > df["avg_vol20"]
    df["entry_signal"] = trend_ok & rsi_cross_up & vol_confirm

    return df


def simulate_symbol(symbol: str, df: pd.DataFrame, sleeve_capital: float) -> tuple[list[Trade], list[tuple[pd.Timestamp, float]]]:
    """Sequential, single-position-at-a-time backtest for one symbol.
    Returns (closed trades, equity curve as (date, equity) after each closed trade)."""
    trades: list[Trade] = []
    equity_curve: list[tuple[pd.Timestamp, float]] = [(df.index[0], sleeve_capital)]
    equity = sleeve_capital

    open_trade: Trade | None = None
    trail_stop = None
    highest_close_since_entry = None

    dates = df.index
    for i in range(1, len(dates)):
        today = dates[i]
        row = df.iloc[i]
        prev_row = df.iloc[i - 1]

        if open_trade is not None:
            highest_close_since_entry = max(highest_close_since_entry, prev_row["close"])
            candidate_trail = highest_close_since_entry - ATR_TRAIL_MULT * prev_row["atr14"]
            trail_stop = max(trail_stop, candidate_trail) if trail_stop is not None else candidate_trail
            effective_stop = max(open_trade.initial_stop, trail_stop)

            if row["low"] <= effective_stop:
                fill = effective_stop * (1 - SLIPPAGE)
                open_trade.exit_date = today
                open_trade.exit_price = fill
                open_trade.exit_reason = "trailing_stop" if effective_stop > open_trade.initial_stop else "initial_stop"
                equity += open_trade.pnl
                equity_curve.append((today, equity))
                trades.append(open_trade)
                open_trade = None
                trail_stop = None
                highest_close_since_entry = None
                continue

        if open_trade is None and bool(prev_row.get("entry_signal", False)):
            entry_price = row["open"] * (1 + SLIPPAGE)
            initial_stop = entry_price - ATR_STOP_MULT * prev_row["atr14"]
            risk_per_share = entry_price - initial_stop
            if risk_per_share <= 0 or pd.isna(risk_per_share):
                continue
            risk_amount = equity * RISK_PER_TRADE
            shares = risk_amount / risk_per_share
            max_shares = (equity * MAX_POSITION_FRACTION) / entry_price
            shares = min(shares, max_shares)
            if shares <= 0:
                continue
            open_trade = Trade(symbol=symbol, entry_date=today, entry_price=entry_price, initial_stop=initial_stop, shares=shares)
            highest_close_since_entry = row["close"]
            trail_stop = highest_close_since_entry - ATR_TRAIL_MULT * row["atr14"]

    return trades, equity_curve


def compute_stats(all_trades: list[Trade], combined_equity: pd.Series) -> dict:
    closed = [t for t in all_trades if t.exit_price is not None]
    r_multiples = [t.r_multiple for t in closed if t.r_multiple is not None]
    pnls = [t.pnl for t in closed if t.pnl is not None]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    win_rate = len(wins) / len(closed) if closed else float("nan")
    avg_win = np.mean(wins) if wins else 0.0
    avg_loss = np.mean(losses) if losses else 0.0
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
    expectancy_r = np.mean(r_multiples) if r_multiples else float("nan")
    expectancy_dollars = np.mean(pnls) if pnls else float("nan")

    running_max = combined_equity.cummax()
    drawdown = (combined_equity - running_max) / running_max
    max_drawdown = drawdown.min()

    total_return = (combined_equity.iloc[-1] / combined_equity.iloc[0]) - 1
    years = (combined_equity.index[-1] - combined_equity.index[0]).days / 365.25
    cagr = (combined_equity.iloc[-1] / combined_equity.iloc[0]) ** (1 / years) - 1 if years > 0 else float("nan")

    trade_returns = combined_equity.pct_change().dropna()
    sharpe = (trade_returns.mean() / trade_returns.std() * np.sqrt(len(trade_returns))) if trade_returns.std() > 0 else float("nan")

    downside = trade_returns[trade_returns < 0]
    sortino = (trade_returns.mean() / downside.std() * np.sqrt(len(trade_returns))) if len(downside) > 0 and downside.std() > 0 else float("nan")

    # longest losing streak (by trade sequence, chronological across all symbols)
    closed_sorted = sorted(closed, key=lambda t: t.exit_date)
    streak = max_streak = 0
    for t in closed_sorted:
        if t.pnl is not None and t.pnl <= 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0

    return {
        "num_trades": len(closed),
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "expectancy_r": expectancy_r,
        "expectancy_dollars": expectancy_dollars,
        "total_return_pct": total_return * 100,
        "cagr_pct": cagr * 100,
        "sharpe": sharpe,
        "sortino": sortino,
        "max_drawdown_pct": max_drawdown * 100,
        "max_consecutive_losses": max_streak,
    }


def main() -> None:
    client = StockHistoricalDataClient(config.APCA_API_KEY_ID, config.APCA_API_SECRET_KEY)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=365 * LOOKBACK_YEARS + 30)

    sleeve_capital = STARTING_CAPITAL / len(SYMBOLS)
    all_trades: list[Trade] = []
    sleeve_equity_curves: dict[str, list[tuple[pd.Timestamp, float]]] = {}

    print(f"Fetching {LOOKBACK_YEARS}y of daily bars for {len(SYMBOLS)} symbols...\n")
    for symbol in SYMBOLS:
        df = fetch_daily_bars(client, symbol, start, end)
        if df is None or len(df) < 210:  # need enough history for EMA200 to warm up
            print(f"  [SKIP] {symbol}: insufficient history")
            continue
        df = add_indicators(df)
        trades, curve = simulate_symbol(symbol, df, sleeve_capital)
        all_trades.extend(trades)
        sleeve_equity_curves[symbol] = curve
        print(f"  {symbol}: {len(trades)} closed trades")

    if not all_trades:
        print("\nNo trades were generated -- nothing to report.")
        return

    # Build a combined equity curve: each sleeve's equity is a step function
    # held between its own trade-close events, summed across sleeves onto
    # the union of all trade-close dates.
    combined_index = sorted(set().union(*[{d for d, _ in curve} for curve in sleeve_equity_curves.values()]))
    combined_index = pd.DatetimeIndex(combined_index)

    sleeve_series = {}
    for symbol, curve in sleeve_equity_curves.items():
        s = pd.Series({d: e for d, e in curve})
        s = s.reindex(combined_index).ffill().bfill()
        sleeve_series[symbol] = s

    combined_equity = pd.DataFrame(sleeve_series).sum(axis=1)
    combined_equity.name = "equity"

    stats = compute_stats(all_trades, combined_equity)

    print("\n" + "=" * 60)
    print("STRATEGY: EMA Trend Filter + RSI Pullback + ATR Trail Stop")
    print("=" * 60)
    print(f"Universe: {', '.join(SYMBOLS)}")
    print(f"Lookback: ~{LOOKBACK_YEARS} years, daily bars")
    print(f"Starting capital: ${STARTING_CAPITAL:,.0f}  (equal sleeves)")
    print("-" * 60)
    print(f"Number of closed trades:   {stats['num_trades']}")
    print(f"Win rate:                  {stats['win_rate']*100:.1f}%")
    print(f"Avg win ($):               ${stats['avg_win']:,.2f}")
    print(f"Avg loss ($):              ${stats['avg_loss']:,.2f}")
    print(f"Profit factor:             {stats['profit_factor']:.2f}")
    print(f"Expectancy (R):            {stats['expectancy_r']:.2f}R")
    print(f"Expectancy ($/trade):      ${stats['expectancy_dollars']:,.2f}")
    print(f"Total return:              {stats['total_return_pct']:.1f}%")
    print(f"CAGR:                      {stats['cagr_pct']:.1f}%")
    print(f"Sharpe (trade-event basis):{stats['sharpe']:.2f}")
    print(f"Sortino (trade-event basis):{stats['sortino']:.2f}")
    print(f"Max drawdown:              {stats['max_drawdown_pct']:.1f}%")
    print(f"Max consecutive losses:    {stats['max_consecutive_losses']}")
    print("=" * 60)

    print("\nPer-symbol trade counts:")
    for symbol in SYMBOLS:
        n = len([t for t in all_trades if t.symbol == symbol])
        print(f"  {symbol}: {n}")

    # dump trade log for inspection
    log_path = Path(__file__).parent / "simple_strategy_trades.csv"
    rows = [
        {
            "symbol": t.symbol,
            "entry_date": t.entry_date,
            "entry_price": t.entry_price,
            "initial_stop": t.initial_stop,
            "shares": t.shares,
            "exit_date": t.exit_date,
            "exit_price": t.exit_price,
            "exit_reason": t.exit_reason,
            "pnl": t.pnl,
            "r_multiple": t.r_multiple,
        }
        for t in sorted(all_trades, key=lambda t: t.entry_date)
    ]
    pd.DataFrame(rows).to_csv(log_path, index=False)
    print(f"\nFull trade log written to {log_path}")


if __name__ == "__main__":
    main()
