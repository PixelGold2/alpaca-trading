"""Liquidity utilities: rolling average dollar volume computed from fetched
bars. Used later to flag/filter illiquid names out of the tradable universe
(spec section 1: "avoid illiquid/penny stocks").
"""
from __future__ import annotations

import pandas as pd


def avg_dollar_volume(bars: pd.DataFrame, window: int = 20) -> float:
    """Rolling average of close * volume over the last `window` bars.

    `bars` must have "close" and "volume" columns, most-recent bar last.
    Returns NaN if there isn't enough history for a full window.
    """
    dollar_volume = bars["close"] * bars["volume"]
    return dollar_volume.tail(window).mean()


def is_liquid(bars: pd.DataFrame, min_avg_dollar_volume: float = 5_000_000, window: int = 20) -> bool:
    adv = avg_dollar_volume(bars, window=window)
    return bool(pd.notna(adv) and adv >= min_avg_dollar_volume)
