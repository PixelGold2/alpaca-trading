# quant

Phase 1 of a professional, multi-asset (stocks / broad-market ETFs / crypto)
automated trading research system. This phase is the **data layer only** —
no strategy, scoring, risk, or execution logic yet. See
`C:\Users\PC\.claude\plans\nested-dancing-parnas.md` for the full Phase 1
plan and rationale.

This is a separate subsystem from the PowerShell bots at the repo root
(`scripts/*.ps1`, `config.ps1`) — nothing there is modified or depended on
except reusing the same Alpaca credential env var names.

## Setup

```bash
cd quant
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Fill in `.env`:
- `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`, `APCA_API_BASE_URL` — same values
  as `../config.ps1` (same paper-trading account used by the PowerShell bots).
- `FRED_API_KEY` — free key from https://fred.stlouisfed.org/docs/api/api_key.html.
  Until this is set, FRED-backed calls (VIX, Treasury yields, DXY proxy, gold)
  correctly return `status="error"` rather than failing silently.

## Verify it works

```bash
python scripts/fetch_check.py
```

Prints a `DataResult` status line for a sample of stocks, all four
broad-market ETFs, BTC/USD and ETH/USD (across all four timeframes), and
the FRED macro series. Every line should say `status=live`; investigate any
`status=error` before building on top of this.

```bash
pytest tests/
```

Runs the mocked-provider unit tests (no live keys required).

## Layout

- `config.py` — loads/validates env vars, fails loud if a required one is missing.
- `data/types.py` — `DataResult` envelope (`live | stale | error`), `Asset`,
  `AssetClass`, `Timeframe`. The hard rule for the whole system: **never
  fabricate data on failure** — return `status="error", data=None` instead.
- `data/providers/base.py` — `MarketDataProvider` abstract interface.
- `data/providers/alpaca_provider.py` — multi-timeframe OHLCV for
  stocks/ETFs/crypto via `alpaca-py`, plus account/positions read.
- `data/providers/fred_provider.py` — VIX, Treasury yields (10Y/2Y/3M), a
  dollar-index proxy, and gold, via FRED's REST API.
- `data/universe.py` — static starter universe: ~26 liquid large/mid-cap US
  stocks with sector tags, SPY/QQQ/IWM/DIA, BTC/USD + ETH/USD. Dynamic
  fundamentals-driven selection is a later phase.
- `data/cache.py` — local parquet cache under `data_cache/` (gitignored) so
  later phases (especially the backtester) don't re-fetch history.
- `data/liquidity.py` — rolling avg-dollar-volume calc, for flagging
  illiquid names out of the universe.
- `scripts/fetch_check.py` — the Phase 1 proof-of-life smoke test.
- `tests/` — mocked unit tests for the envelope contract, cache, and
  liquidity helpers.

## What's NOT here yet

Regime detection, strategy logic, scoring, the Gemini AI filter, risk
management, backtesting, walk-forward validation, the scanner, and the
paper-trading logger are all later phases per the original spec.
