"""Unit tests for the data layer's envelope contract, cache, and liquidity
helpers. No live API keys required — HTTP calls are mocked.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from data import cache
from data.liquidity import avg_dollar_volume, is_liquid
from data.providers.fred_provider import FredProvider
from data.types import DataResult, DataStatus


def test_data_result_error_has_no_data():
    result = DataResult.error("test", "something broke")
    assert result.status == DataStatus.ERROR
    assert result.data is None
    assert result.ok is False


def test_data_result_error_with_data_is_invalid():
    with pytest.raises(ValueError):
        DataResult(data={"x": 1}, status=DataStatus.ERROR, provider="test")


def test_data_result_ok_result():
    result = DataResult.ok_result("test", {"x": 1})
    assert result.status == DataStatus.LIVE
    assert result.ok is True
    assert result.data == {"x": 1}


def test_cache_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "_CACHE_DIR", tmp_path)

    idx = pd.date_range("2026-01-01", periods=3, freq="D", tz="UTC")
    df = pd.DataFrame({"close": [1.0, 2.0, 3.0]}, index=idx)

    cache.write("TEST", "1D", df)
    loaded = cache.read("TEST", "1D")

    assert loaded is not None
    assert list(loaded["close"]) == [1.0, 2.0, 3.0]


def test_cache_write_dedupes_overlapping_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "_CACHE_DIR", tmp_path)

    idx1 = pd.date_range("2026-01-01", periods=3, freq="D", tz="UTC")
    df1 = pd.DataFrame({"close": [1.0, 2.0, 3.0]}, index=idx1)
    cache.write("TEST", "1D", df1)

    # overlaps the last day of df1 and adds one new day, newer value should win
    idx2 = pd.date_range("2026-01-03", periods=2, freq="D", tz="UTC")
    df2 = pd.DataFrame({"close": [30.0, 4.0]}, index=idx2)
    cache.write("TEST", "1D", df2)

    loaded = cache.read("TEST", "1D")
    assert len(loaded) == 4
    assert loaded["close"].iloc[-2] == 30.0  # updated, not duplicated
    assert loaded["close"].iloc[-1] == 4.0


def test_cache_handles_crypto_slash_symbol(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "_CACHE_DIR", tmp_path)
    df = pd.DataFrame({"close": [1.0]}, index=pd.date_range("2026-01-01", periods=1, tz="UTC"))
    cache.write("BTC/USD", "1D", df)
    assert cache.read("BTC/USD", "1D") is not None


def test_avg_dollar_volume():
    df = pd.DataFrame({"close": [10.0, 10.0], "volume": [1_000_000, 2_000_000]})
    assert avg_dollar_volume(df, window=2) == 15_000_000.0


def test_is_liquid_true_and_false():
    liquid = pd.DataFrame({"close": [100.0] * 20, "volume": [1_000_000] * 20})
    illiquid = pd.DataFrame({"close": [1.0] * 20, "volume": [1000] * 20})
    assert is_liquid(liquid) is True
    assert is_liquid(illiquid) is False


def test_fred_provider_missing_key_returns_error(monkeypatch):
    import config

    monkeypatch.setattr(config, "FRED_API_KEY", "")
    provider = FredProvider()
    result = provider.get_series("VIXCLS", datetime.now(timezone.utc) - timedelta(days=5), datetime.now(timezone.utc))
    assert result.status == DataStatus.ERROR
    assert "FRED_API_KEY" in result.message


def test_fred_provider_parses_observations(monkeypatch):
    import config

    monkeypatch.setattr(config, "FRED_API_KEY", "fake-key")

    mock_response = MagicMock()
    mock_response.json.return_value = {
        "observations": [
            {"date": "2026-01-01", "value": "15.2"},
            {"date": "2026-01-02", "value": "."},  # FRED's "missing" marker
            {"date": "2026-01-03", "value": "16.8"},
        ]
    }
    mock_response.raise_for_status = MagicMock()

    with patch("data.providers.fred_provider.requests.get", return_value=mock_response):
        provider = FredProvider()
        result = provider.get_series("VIXCLS", datetime(2026, 1, 1), datetime(2026, 1, 3))

    assert result.status == DataStatus.LIVE
    assert len(result.data) == 2  # the "." row was dropped
    assert result.data["value"].iloc[0] == 15.2


def test_fred_provider_http_failure_returns_error(monkeypatch):
    import config

    monkeypatch.setattr(config, "FRED_API_KEY", "fake-key")

    with patch("data.providers.fred_provider.requests.get", side_effect=ConnectionError("boom")):
        provider = FredProvider()
        result = provider.get_series("VIXCLS", datetime(2026, 1, 1), datetime(2026, 1, 3))

    assert result.status == DataStatus.ERROR
    assert result.data is None
