"""Shared data types for the quant system's data layer.

The central rule: a provider NEVER fabricates or interpolates data on
failure. Every fetch returns a DataResult; callers must branch on `status`
rather than assume `data` is present and correct.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Generic, Optional, TypeVar

T = TypeVar("T")


class DataStatus(str, Enum):
    LIVE = "live"
    STALE = "stale"
    ERROR = "error"


class AssetClass(str, Enum):
    EQUITY = "equity"
    ETF = "etf"
    CRYPTO = "crypto"
    MACRO = "macro"  # FRED series (VIX, Treasury yields, DXY proxy, gold)


class Timeframe(str, Enum):
    MIN_15 = "15Min"
    HOUR_1 = "1H"
    HOUR_4 = "4H"
    DAY_1 = "1D"


@dataclass
class DataResult(Generic[T]):
    """Envelope returned by every provider call.

    status="error" always implies data=None. Never set both a non-None
    `data` and status="error" — that would let a caller accidentally use
    fabricated data.
    """

    data: Optional[T]
    status: DataStatus
    provider: str
    message: str = ""
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self) -> None:
        if self.status == DataStatus.ERROR and self.data is not None:
            raise ValueError("DataResult with status=ERROR must have data=None")

    @property
    def ok(self) -> bool:
        return self.status != DataStatus.ERROR

    @classmethod
    def error(cls, provider: str, message: str) -> "DataResult":
        return cls(data=None, status=DataStatus.ERROR, provider=provider, message=message)

    @classmethod
    def ok_result(cls, provider: str, data: T, status: DataStatus = DataStatus.LIVE) -> "DataResult[T]":
        return cls(data=data, status=status, provider=provider)


@dataclass(frozen=True)
class Asset:
    symbol: str
    asset_class: AssetClass
    sector: Optional[str] = None  # only meaningful for AssetClass.EQUITY
