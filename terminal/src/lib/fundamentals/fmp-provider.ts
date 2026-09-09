import "server-only";
import { env } from "@/lib/env";
import type { ProviderResult } from "@/lib/providers/types";
import type {
  BalanceSheetPeriod,
  CashFlowPeriod,
  CompanyProfile,
  FundamentalsProvider,
  IncomeStatementPeriod,
  MetricsPeriod,
  RatiosSnapshot,
  StatementPeriod,
} from "@/lib/fundamentals/types";

const PROVIDER_NAME = "fmp";
const BASE_URL = "https://financialmodelingprep.com/stable";
const REQUEST_TIMEOUT_MS = 8000;

function notConfigured<T>(): ProviderResult<T> {
  return {
    data: null,
    meta: {
      provider: PROVIDER_NAME,
      timestamp: new Date().toISOString(),
      status: "error",
      message: "FMP API key is not configured.",
    },
  };
}

function errorResult<T>(message: string): ProviderResult<T> {
  return {
    data: null,
    meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "error", message },
  };
}

function liveResult<T>(data: T): ProviderResult<T> {
  return { data, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
}

async function fmpFetch(path: string, params: Record<string, string>): Promise<unknown[]> {
  const query = new URLSearchParams({ ...params, apikey: env.fmpApiKey! });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    try {
      res = await fetch(`${BASE_URL}/${path}?${query}`, {
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      // The request URL carries the API key as a query param (FMP has no header-auth
      // option) — never let a raw fetch()/network exception (whose message shape isn't
      // ours to control, and could in principle include the URL) reach a caller that
      // might surface it to the client. Every other error path below throws a
      // hand-written, secret-free message instead.
      throw new Error(`Network error contacting FMP while requesting ${path}.`);
    }
    if (!res.ok) {
      throw new Error(`FMP request to ${path} failed (HTTP ${res.status}).`);
    }
    const body = await res.json();
    if (!Array.isArray(body)) {
      throw new Error(`Unexpected response shape from ${path}.`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

class FmpProvider implements FundamentalsProvider {
  readonly name = PROVIDER_NAME;

  private get configured(): boolean {
    return Boolean(env.fmpApiKey);
  }

  async getProfile(symbol: string): Promise<ProviderResult<CompanyProfile>> {
    if (!this.configured) return notConfigured();
    const sym = symbol.trim().toUpperCase();
    if (!sym) return errorResult("No symbol provided.");

    try {
      const rows = await fmpFetch("profile", { symbol: sym });
      const p = rows[0] as Record<string, unknown> | undefined;
      if (!p) return errorResult(`Unknown symbol "${sym}".`);

      return liveResult<CompanyProfile>({
        symbol: String(p.symbol),
        companyName: String(p.companyName),
        sector: String(p.sector ?? ""),
        industry: String(p.industry ?? ""),
        exchange: String(p.exchange ?? ""),
        description: String(p.description ?? ""),
        ceo: String(p.ceo ?? ""),
        employees: Number(p.fullTimeEmployees) || 0,
        website: String(p.website ?? ""),
        price: Number(p.price),
        marketCap: Number(p.marketCap),
        currency: String(p.currency ?? "USD"),
      });
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error fetching profile.");
    }
  }

  async getIncomeStatement(
    symbol: string,
    period: StatementPeriod,
    limit: number
  ): Promise<ProviderResult<IncomeStatementPeriod[]>> {
    if (!this.configured) return notConfigured();
    const sym = symbol.trim().toUpperCase();

    try {
      const rows = await fmpFetch("income-statement", {
        symbol: sym,
        period,
        limit: String(limit),
      });
      if (rows.length === 0) return errorResult(`No income statement data for "${sym}".`);

      const data = rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          date: String(row.date),
          fiscalYear: String(row.fiscalYear),
          period: String(row.period),
          revenue: Number(row.revenue),
          costOfRevenue: Number(row.costOfRevenue),
          grossProfit: Number(row.grossProfit),
          operatingExpenses: Number(row.operatingExpenses),
          operatingIncome: Number(row.operatingIncome),
          ebitda: Number(row.ebitda),
          netIncome: Number(row.netIncome),
          eps: Number(row.eps),
          epsDiluted: Number(row.epsDiluted),
          weightedAverageShsOut: Number(row.weightedAverageShsOut),
        } satisfies IncomeStatementPeriod;
      });
      return liveResult(data);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error fetching income statement.");
    }
  }

  async getBalanceSheet(
    symbol: string,
    period: StatementPeriod,
    limit: number
  ): Promise<ProviderResult<BalanceSheetPeriod[]>> {
    if (!this.configured) return notConfigured();
    const sym = symbol.trim().toUpperCase();

    try {
      const rows = await fmpFetch("balance-sheet-statement", {
        symbol: sym,
        period,
        limit: String(limit),
      });
      if (rows.length === 0) return errorResult(`No balance sheet data for "${sym}".`);

      const data = rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          date: String(row.date),
          fiscalYear: String(row.fiscalYear),
          period: String(row.period),
          cashAndShortTermInvestments: Number(row.cashAndShortTermInvestments),
          totalCurrentAssets: Number(row.totalCurrentAssets),
          totalAssets: Number(row.totalAssets),
          totalCurrentLiabilities: Number(row.totalCurrentLiabilities),
          longTermDebt: Number(row.longTermDebt),
          totalLiabilities: Number(row.totalLiabilities),
          totalStockholdersEquity: Number(row.totalStockholdersEquity),
        } satisfies BalanceSheetPeriod;
      });
      return liveResult(data);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error fetching balance sheet.");
    }
  }

  async getCashFlow(
    symbol: string,
    period: StatementPeriod,
    limit: number
  ): Promise<ProviderResult<CashFlowPeriod[]>> {
    if (!this.configured) return notConfigured();
    const sym = symbol.trim().toUpperCase();

    try {
      const rows = await fmpFetch("cash-flow-statement", {
        symbol: sym,
        period,
        limit: String(limit),
      });
      if (rows.length === 0) return errorResult(`No cash flow data for "${sym}".`);

      const data = rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          date: String(row.date),
          fiscalYear: String(row.fiscalYear),
          period: String(row.period),
          netIncome: Number(row.netIncome),
          operatingCashFlow: Number(row.operatingCashFlow),
          capitalExpenditure: Number(row.capitalExpenditure),
          freeCashFlow: Number(row.freeCashFlow),
          commonDividendsPaid: Number(row.commonDividendsPaid) || 0,
          commonStockRepurchased: Number(row.commonStockRepurchased) || 0,
        } satisfies CashFlowPeriod;
      });
      return liveResult(data);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error fetching cash flow.");
    }
  }

  async getRatios(symbol: string, period: MetricsPeriod): Promise<ProviderResult<RatiosSnapshot>> {
    if (!this.configured) return notConfigured();
    const sym = symbol.trim().toUpperCase();

    try {
      const isTtm = period === "ttm";
      const suffix = isTtm ? "TTM" : "";
      const ratiosPath = isTtm ? "ratios-ttm" : "ratios";
      const metricsPath = isTtm ? "key-metrics-ttm" : "key-metrics";
      const params: Record<string, string> = isTtm
        ? { symbol: sym }
        : { symbol: sym, period, limit: "1" };

      const [ratiosRows, metricsRows] = await Promise.all([
        fmpFetch(ratiosPath, params),
        fmpFetch(metricsPath, params),
      ]);

      const r = ratiosRows[0] as Record<string, unknown> | undefined;
      const m = metricsRows[0] as Record<string, unknown> | undefined;
      if (!r || !m) return errorResult(`No ratios/metrics data for "${sym}".`);

      const field = (key: string) => Number(r[`${key}${suffix}`]);
      const metricField = (key: string) => Number(m[`${key}${suffix}`]);

      return liveResult<RatiosSnapshot>({
        date: isTtm ? "TTM" : String(r.date ?? ""),
        fiscalYear: isTtm ? "TTM" : String(r.fiscalYear ?? ""),
        period: isTtm ? "TTM" : String(r.period ?? ""),
        peRatio: field("priceToEarningsRatio"),
        pegRatio: field("priceToEarningsGrowthRatio"),
        priceToSalesRatio: field("priceToSalesRatio"),
        priceToBookRatio: field("priceToBookRatio"),
        grossProfitMargin: field("grossProfitMargin"),
        operatingProfitMargin: field("operatingProfitMargin"),
        netProfitMargin: field("netProfitMargin"),
        returnOnEquity: metricField("returnOnEquity"),
        returnOnInvestedCapital: metricField("returnOnInvestedCapital"),
        evToEBITDA: metricField("evToEBITDA"),
        currentRatio: field("currentRatio"),
        debtToEquityRatio: field("debtToEquityRatio"),
      });
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error fetching ratios.");
    }
  }
}

export const fmpProvider = new FmpProvider();
