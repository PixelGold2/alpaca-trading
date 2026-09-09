import "server-only";
import { env } from "@/lib/env";
import { CRYPTO_SYMBOL_SET, toAlpacaCryptoSymbol } from "@/lib/market-data/crypto-symbols";
import type {
  AccountSnapshot,
  Bar,
  GetBarsParams,
  MarketClock,
  MarketDataProvider,
  ProviderResult,
} from "@/lib/market-data/types";

const PROVIDER_NAME = "alpaca";
const REQUEST_TIMEOUT_MS = 8000;
// Historical bars live on a separate host from the trading API (paper-api.alpaca.markets)
// and use the same host regardless of paper/live trading mode.
const DATA_API_BASE_URL = "https://data.alpaca.markets";
// Free-tier-compatible feed. A paid subscription could use "sip" for full market coverage.
const BARS_FEED = "iex";

function notConfigured<T>(): ProviderResult<T> {
  return {
    data: null,
    meta: {
      provider: PROVIDER_NAME,
      timestamp: new Date().toISOString(),
      status: "error",
      message: "Alpaca API keys are not configured.",
    },
  };
}

function errorResult<T>(message: string): ProviderResult<T> {
  return {
    data: null,
    meta: {
      provider: PROVIDER_NAME,
      timestamp: new Date().toISOString(),
      status: "error",
      message,
    },
  };
}

function mapBars(rawBars: unknown[]): Bar[] {
  return rawBars.map((b) => {
    const bar = b as { t: string; o: number; h: number; l: number; c: number; v: number };
    return {
      time: bar.t,
      open: Number(bar.o),
      high: Number(bar.h),
      low: Number(bar.l),
      close: Number(bar.c),
      volume: Number(bar.v),
    };
  });
}

async function alpacaFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": env.alpacaKeyId!,
        "APCA-API-SECRET-KEY": env.alpacaSecretKey!,
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

class AlpacaProvider implements MarketDataProvider {
  readonly name = PROVIDER_NAME;

  private get configured(): boolean {
    return Boolean(env.alpacaKeyId && env.alpacaSecretKey);
  }

  async getAccountSnapshot(): Promise<ProviderResult<AccountSnapshot>> {
    if (!this.configured) return notConfigured();

    try {
      const res = await alpacaFetch(`${env.alpacaBaseUrl}/v2/account`);
      if (!res.ok) {
        return errorResult(`Alpaca account request failed (HTTP ${res.status}).`);
      }
      const body = await res.json();
      const data: AccountSnapshot = {
        accountId: body.account_number,
        equity: Number(body.equity),
        cash: Number(body.cash),
        buyingPower: Number(body.buying_power),
        currency: body.currency,
        paper: env.alpacaBaseUrl.includes("paper"),
      };
      return {
        data,
        meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
      };
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error fetching account.");
    }
  }

  async getMarketClock(): Promise<ProviderResult<MarketClock>> {
    if (!this.configured) return notConfigured();

    try {
      const res = await alpacaFetch(`${env.alpacaBaseUrl}/v2/clock`);
      if (!res.ok) {
        return errorResult(`Alpaca clock request failed (HTTP ${res.status}).`);
      }
      const body = await res.json();
      const data: MarketClock = {
        isOpen: Boolean(body.is_open),
        nextOpen: body.next_open,
        nextClose: body.next_close,
      };
      return {
        data,
        meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
      };
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error fetching clock.");
    }
  }

  async getBars(params: GetBarsParams): Promise<ProviderResult<Bar[]>> {
    if (!this.configured) return notConfigured();

    const symbol = params.symbol.trim().toUpperCase();
    if (!symbol) return errorResult("No symbol provided.");

    return CRYPTO_SYMBOL_SET.has(symbol) ? this.getCryptoBars(symbol, params) : this.getStockBars(symbol, params);
  }

  private async getStockBars(symbol: string, params: GetBarsParams): Promise<ProviderResult<Bar[]>> {
    const query = new URLSearchParams({
      timeframe: params.timeframe,
      start: params.start,
      feed: BARS_FEED,
      limit: String(params.limit ?? 1000),
    });
    if (params.end) query.set("end", params.end);

    try {
      const res = await alpacaFetch(
        `${DATA_API_BASE_URL}/v2/stocks/${encodeURIComponent(symbol)}/bars?${query}`
      );
      if (!res.ok) {
        if (res.status === 404) {
          return errorResult(`Unknown symbol "${symbol}".`);
        }
        return errorResult(`Alpaca bars request failed (HTTP ${res.status}).`);
      }
      const body = await res.json();
      const data = mapBars(Array.isArray(body.bars) ? body.bars : []);

      if (data.length === 0) {
        return errorResult(`No bar data returned for "${symbol}".`);
      }

      return {
        data,
        meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
      };
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error fetching bars.");
    }
  }

  private async getCryptoBars(symbol: string, params: GetBarsParams): Promise<ProviderResult<Bar[]>> {
    const cryptoSymbol = toAlpacaCryptoSymbol(symbol);
    const query = new URLSearchParams({
      symbols: cryptoSymbol,
      timeframe: params.timeframe,
      limit: String(params.limit ?? 1000),
      start: params.start,
    });
    if (params.end) query.set("end", params.end);

    try {
      const res = await alpacaFetch(`${DATA_API_BASE_URL}/v1beta3/crypto/us/bars?${query}`);
      if (!res.ok) {
        return errorResult(`Alpaca crypto bars request failed (HTTP ${res.status}).`);
      }
      const body = await res.json();
      const data = mapBars(Array.isArray(body.bars?.[cryptoSymbol]) ? body.bars[cryptoSymbol] : []);

      if (data.length === 0) {
        return errorResult(`No bar data returned for "${symbol}".`);
      }

      return {
        data,
        meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" },
      };
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error fetching crypto bars.");
    }
  }
}

export const alpacaProvider = new AlpacaProvider();
