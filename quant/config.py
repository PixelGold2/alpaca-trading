"""Loads and validates environment configuration for the quant system.

Fails loud on missing required values rather than silently defaulting —
mirrors the convention used by analyst_ratings/monitor.py.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")


def _require(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable '{key}'. "
            f"Copy quant/.env.example to quant/.env and fill it in."
        )
    return value


APCA_API_KEY_ID = _require("APCA_API_KEY_ID")
APCA_API_SECRET_KEY = _require("APCA_API_SECRET_KEY")
APCA_API_BASE_URL = _require("APCA_API_BASE_URL")

# FRED is optional at import time — individual FredProvider calls fail with a
# clean DataResult(status="error") if this is unset, rather than crashing
# every script that merely imports config.
FRED_API_KEY = os.environ.get("FRED_API_KEY", "")
