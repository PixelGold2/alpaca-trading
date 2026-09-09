"""Static starter asset universe.

Phase 1 scope: a curated, hand-picked list of liquid large/mid-cap US
stocks with sector tags, the four broad-market ETFs, and the two most
liquid crypto pairs. This is NOT dynamic/fundamentals-driven screening
(that's a later phase, spec section 4) — it's just enough breadth to
exercise the data layer across sectors and asset classes.
"""
from data.types import Asset, AssetClass

STOCKS: list[Asset] = [
    # Technology
    Asset("AAPL", AssetClass.EQUITY, sector="Technology"),
    Asset("MSFT", AssetClass.EQUITY, sector="Technology"),
    Asset("NVDA", AssetClass.EQUITY, sector="Technology"),
    Asset("AVGO", AssetClass.EQUITY, sector="Technology"),
    Asset("AMD", AssetClass.EQUITY, sector="Technology"),
    Asset("CRM", AssetClass.EQUITY, sector="Technology"),
    # Communication Services
    Asset("GOOGL", AssetClass.EQUITY, sector="Communication Services"),
    Asset("META", AssetClass.EQUITY, sector="Communication Services"),
    Asset("NFLX", AssetClass.EQUITY, sector="Communication Services"),
    # Consumer Discretionary
    Asset("AMZN", AssetClass.EQUITY, sector="Consumer Discretionary"),
    Asset("TSLA", AssetClass.EQUITY, sector="Consumer Discretionary"),
    Asset("HD", AssetClass.EQUITY, sector="Consumer Discretionary"),
    Asset("NKE", AssetClass.EQUITY, sector="Consumer Discretionary"),
    # Financials
    Asset("JPM", AssetClass.EQUITY, sector="Financials"),
    Asset("GS", AssetClass.EQUITY, sector="Financials"),
    Asset("V", AssetClass.EQUITY, sector="Financials"),
    Asset("MA", AssetClass.EQUITY, sector="Financials"),
    # Healthcare
    Asset("UNH", AssetClass.EQUITY, sector="Healthcare"),
    Asset("MRK", AssetClass.EQUITY, sector="Healthcare"),
    Asset("AMGN", AssetClass.EQUITY, sector="Healthcare"),
    Asset("ABBV", AssetClass.EQUITY, sector="Healthcare"),
    # Energy
    Asset("XOM", AssetClass.EQUITY, sector="Energy"),
    Asset("CVX", AssetClass.EQUITY, sector="Energy"),
    # Industrials
    Asset("CAT", AssetClass.EQUITY, sector="Industrials"),
    Asset("BA", AssetClass.EQUITY, sector="Industrials"),
    # Consumer Staples
    Asset("COST", AssetClass.EQUITY, sector="Consumer Staples"),
    Asset("WMT", AssetClass.EQUITY, sector="Consumer Staples"),
]

BROAD_MARKET_ETFS: list[Asset] = [
    Asset("SPY", AssetClass.ETF, sector=None),
    Asset("QQQ", AssetClass.ETF, sector=None),
    Asset("IWM", AssetClass.ETF, sector=None),
    Asset("DIA", AssetClass.ETF, sector=None),
]

CRYPTO: list[Asset] = [
    Asset("BTC/USD", AssetClass.CRYPTO, sector=None),
    Asset("ETH/USD", AssetClass.CRYPTO, sector=None),
]

# FRED series IDs standing in for the spec's "VIX / Treasury / DXY / Gold"
# broad-market macro inputs. Not tradable — used as regime/context data in
# later phases.
MACRO_SERIES: dict[str, str] = {
    "VIX": "VIXCLS",           # CBOE Volatility Index, daily close
    "UST_10Y": "DGS10",        # 10-Year Treasury constant maturity yield
    "UST_2Y": "DGS2",          # 2-Year Treasury constant maturity yield
    "UST_3M": "DGS3MO",        # 3-Month Treasury yield
    "DXY_PROXY": "DTWEXBGS",   # Trade Weighted U.S. Dollar Index, broad
    "GOLD": "GOLDPMGBD228NLBM",  # Gold Fixing Price, London, PM
}


def all_tradable_assets() -> list[Asset]:
    """Every non-macro asset (stocks + ETFs + crypto) as a flat list."""
    return [*STOCKS, *BROAD_MARKET_ETFS, *CRYPTO]
