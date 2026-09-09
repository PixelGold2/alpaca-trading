import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";
import { withQuoteCache } from "@/lib/market-data/quote-cache";

const PROVIDER_NAME = "finnhub";
const REQUEST_TIMEOUT_MS = 8000;

export interface CompanyOverview {
  symbol: string;
  name: string;
  industry: string | null;
  exchange: string | null;
  country: string | null;
  currency: string | null;
  marketCap: number | null; // real dollars, not millions
  sharesOutstanding: number | null;
  website: string | null;
  logoUrl: string | null;
  ipoDate: string | null;
  price: number | null;
}

/**
 * Company overview via Finnhub — deliberately independent of the FMP-backed
 * FundamentalsPanel (profile/ratios/statements), so a stuck FMP quota doesn't
 * take out every piece of company context on the ticker page. Narrower field
 * set than FMP's profile (no sector/CEO/employees/description — Finnhub's
 * free profile2 endpoint doesn't have them); never fabricated, honest error
 * status on failure like every other provider in this app.
 */
async function fetchCompanyOverviewUncached(symbol: string): Promise<ProviderResult<CompanyOverview>> {
  if (!env.finnhubApiKey) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: "Finnhub API key is not configured.",
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let profileRes: Response;
    let quoteRes: Response;
    try {
      [profileRes, quoteRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${env.finnhubApiKey}`, {
          signal: controller.signal,
          cache: "no-store",
        }),
        fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${env.finnhubApiKey}`, {
          signal: controller.signal,
          cache: "no-store",
        }),
      ]);
    } catch {
      // The request URL carries the API key — never let a raw fetch()/network
      // exception propagate. Same guard as lib/news/finnhub-provider.ts.
      throw new Error("Network error contacting Finnhub.");
    }
    if (!profileRes.ok) {
      throw new Error(`Finnhub profile request failed (HTTP ${profileRes.status}).`);
    }
    const row = await profileRes.json();
    if (!row || typeof row !== "object" || !row.name) {
      throw new Error(`No company overview found for ${symbol}.`);
    }
    // The quote call is a bonus (fills the profile card's "Price" field) — never
    // let its failure take down the whole overview, which is real either way.
    const quote = quoteRes.ok ? await quoteRes.json().catch(() => null) : null;

    const data: CompanyOverview = {
      symbol,
      name: String(row.name),
      industry: typeof row.finnhubIndustry === "string" ? row.finnhubIndustry : null,
      exchange: typeof row.exchange === "string" ? row.exchange : null,
      country: typeof row.country === "string" ? row.country : null,
      currency: typeof row.currency === "string" ? row.currency : null,
      marketCap: typeof row.marketCapitalization === "number" ? row.marketCapitalization * 1e6 : null,
      sharesOutstanding: typeof row.shareOutstanding === "number" ? row.shareOutstanding * 1e6 : null,
      website: typeof row.weburl === "string" && row.weburl ? row.weburl : null,
      logoUrl: typeof row.logo === "string" && row.logo ? row.logo : null,
      ipoDate: typeof row.ipo === "string" && row.ipo ? row.ipo : null,
      price: quote && typeof quote.c === "number" && quote.c > 0 ? quote.c : null,
    };

    return { data, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
  } catch (err) {
    return {
      data: null,
      meta: {
        provider: PROVIDER_NAME,
        timestamp: new Date().toISOString(),
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error fetching company overview.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function getCompanyOverview(symbol: string): Promise<ProviderResult<CompanyOverview>> {
  return withQuoteCache(`finnhub-overview:${symbol}`, () => fetchCompanyOverviewUncached(symbol));
}
