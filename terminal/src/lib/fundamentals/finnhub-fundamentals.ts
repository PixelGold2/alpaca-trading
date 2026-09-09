import "server-only";
import { env } from "@/lib/env";
import { withQuoteCache } from "@/lib/market-data/quote-cache";
import { getCompanyOverview } from "@/lib/market-data/company-overview";
import type { ProviderResult } from "@/lib/providers/types";
import type {
  BalanceSheetPeriod,
  CashFlowPeriod,
  CompanyProfile,
  IncomeStatementPeriod,
  MetricsPeriod,
  RatiosSnapshot,
  StatementPeriod,
} from "@/lib/fundamentals/types";

const PROVIDER_NAME = "finnhub";
const REQUEST_TIMEOUT_MS = 10_000;

// FMP's plan has been unreachable ("Limit Reach") for the entire session, with no
// sign of recovery — profile, Key Metrics, and Financial Statements are all
// sourced from Finnhub now. getProfile reshapes the same data that powers the
// "Stock Overview" card (lib/market-data/company-overview.ts) into the
// CompanyProfile shape FundamentalsPanel expects.

export async function getProfile(symbol: string): Promise<ProviderResult<CompanyProfile>> {
  const overview = await getCompanyOverview(symbol);
  if (!overview.data) {
    return { data: null, meta: overview.meta };
  }
  const o = overview.data;
  const data: CompanyProfile = {
    symbol: o.symbol,
    companyName: o.name,
    sector: null, // not on Finnhub's free profile endpoint
    industry: o.industry,
    exchange: o.exchange,
    description: null,
    ceo: null,
    employees: null,
    website: o.website,
    price: o.price,
    marketCap: o.marketCap,
    currency: o.currency,
  };
  return { data, meta: overview.meta };
}

function notConfigured<T>(): ProviderResult<T> {
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

function errorResult<T>(message: string): ProviderResult<T> {
  return {
    data: null,
    meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "error", message },
  };
}

async function finnhubFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams({ ...params, token: env.finnhubApiKey! });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`https://finnhub.io/api/v1/${path}?${query}`, { signal: controller.signal, cache: "no-store" });
    } catch {
      // The request URL carries the API key — never let a raw fetch()/network
      // exception propagate. Same guard as lib/news/finnhub-provider.ts.
      throw new Error(`Network error contacting Finnhub while requesting ${path}.`);
    }
    if (!res.ok) {
      throw new Error(`Finnhub request to ${path} failed (HTTP ${res.status}).`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Ratios ----------

function pickRatio(m: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = m[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

async function fetchRatiosUncached(symbol: string, period: MetricsPeriod): Promise<ProviderResult<RatiosSnapshot>> {
  if (!env.finnhubApiKey) return notConfigured();
  try {
    const body = (await finnhubFetch("stock/metric", { symbol, metric: "all" })) as { metric?: Record<string, unknown> };
    const m = body.metric;
    if (!m) throw new Error(`No metrics found for ${symbol}.`);

    // Finnhub's response is one snapshot with per-suffix fields (Annual/Quarterly/TTM)
    // rather than FMP's one-row-per-period shape — pick the suffix matching what was
    // asked for, falling back to whatever variant actually exists rather than guessing.
    const suffix = period === "annual" ? "Annual" : period === "quarter" ? "Quarterly" : "TTM";
    const alt = period === "ttm" ? "Annual" : "TTM";

    const data: RatiosSnapshot = {
      date: new Date().toISOString().slice(0, 10),
      fiscalYear: new Date().getFullYear().toString(),
      period,
      peRatio: pickRatio(m, `pe${suffix}`, `pe${alt}`, "peTTM", "peAnnual", "peInclExtraTTM") ?? NaN,
      pegRatio: pickRatio(m, "pegTTM", "forwardPEG") ?? NaN,
      priceToSalesRatio: pickRatio(m, `ps${suffix}`, `ps${alt}`, "psTTM", "psAnnual") ?? NaN,
      priceToBookRatio: pickRatio(m, `pb${suffix}`, `pb${alt}`, "pb", "pbAnnual") ?? NaN,
      grossProfitMargin: pickRatio(m, `grossMargin${suffix}`, `grossMargin${alt}`, "grossMarginTTM", "grossMarginAnnual") ?? NaN,
      operatingProfitMargin:
        pickRatio(m, `operatingMargin${suffix}`, `operatingMargin${alt}`, "operatingMarginTTM", "operatingMarginAnnual") ?? NaN,
      netProfitMargin:
        pickRatio(m, `netProfitMargin${suffix}`, `netProfitMargin${alt}`, "netProfitMarginTTM", "netProfitMarginAnnual") ?? NaN,
      returnOnEquity: pickRatio(m, "roeTTM", "roeRfy") ?? NaN,
      returnOnInvestedCapital: pickRatio(m, `roi${suffix}`, `roi${alt}`, "roiTTM", "roiAnnual") ?? NaN,
      evToEBITDA: null, // not available on Finnhub's free metrics endpoint — see types.ts
      currentRatio: pickRatio(m, `currentRatio${suffix}`, `currentRatio${alt}`, "currentRatioAnnual", "currentRatioQuarterly") ?? NaN,
      debtToEquityRatio:
        pickRatio(m, `totalDebt/totalEquity${suffix}`, `totalDebt/totalEquity${alt}`, "totalDebt/totalEquityAnnual") ?? NaN,
    };

    // Every field genuinely missing (all NaN/null) means Finnhub simply doesn't
    // cover this symbol's ratios — report it honestly rather than an empty shell.
    const allMissing = Object.values(data).every((v) => typeof v !== "number" || Number.isNaN(v));
    if (allMissing) throw new Error(`No ratio data available for ${symbol}.`);

    return { data, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : "Unknown error fetching ratios.");
  }
}

export function getRatios(symbol: string, period: MetricsPeriod): Promise<ProviderResult<RatiosSnapshot>> {
  return withQuoteCache(`finnhub-ratios:${symbol}:${period}`, () => fetchRatiosUncached(symbol, period));
}

// ---------- Statements (SEC XBRL via financials-reported) ----------

interface XbrlLine {
  concept: string;
  value: unknown;
}
interface Filing {
  year: number;
  quarter: number;
  form: string;
  startDate: string;
  endDate: string;
  report: { bs?: XbrlLine[]; ic?: XbrlLine[]; cf?: XbrlLine[] };
}

function pick(lines: XbrlLine[] | undefined, ...concepts: string[]): number | null {
  if (!lines) return null;
  for (const c of concepts) {
    const row = lines.find((l) => l.concept === c);
    if (row && typeof row.value === "number") return row.value;
  }
  return null;
}

function periodLabel(filing: Filing): string {
  if (filing.quarter === 0) return "FY";
  return `Q${filing.quarter}`;
}

async function fetchFilings(symbol: string, period: StatementPeriod): Promise<Filing[]> {
  const body = (await finnhubFetch("stock/financials-reported", {
    symbol,
    freq: period === "annual" ? "annual" : "quarterly",
  })) as { data?: Filing[] };
  return Array.isArray(body.data) ? body.data : [];
}

async function fetchIncomeUncached(
  symbol: string,
  period: StatementPeriod,
  limit: number,
): Promise<ProviderResult<IncomeStatementPeriod[]>> {
  if (!env.finnhubApiKey) return notConfigured();
  try {
    const filings = await fetchFilings(symbol, period);
    const data: IncomeStatementPeriod[] = [];
    for (const filing of filings) {
      const ic = filing.report.ic;
      const revenue = pick(
        ic,
        "us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax",
        "us-gaap_RevenueFromContractWithCustomerIncludingAssessedTax",
        "us-gaap_Revenues",
      );
      const costOfRevenue = pick(ic, "us-gaap_CostOfGoodsAndServicesSold", "us-gaap_CostOfRevenue");
      const grossProfit = pick(ic, "us-gaap_GrossProfit") ?? (revenue !== null && costOfRevenue !== null ? revenue - costOfRevenue : null);
      const operatingExpenses = pick(ic, "us-gaap_OperatingExpenses", "us-gaap_CostsAndExpenses");
      const operatingIncome = pick(ic, "us-gaap_OperatingIncomeLoss");
      const netIncome = pick(ic, "us-gaap_NetIncomeLoss", "us-gaap_ProfitLoss");
      const eps = pick(ic, "us-gaap_EarningsPerShareBasic");
      const epsDiluted = pick(ic, "us-gaap_EarningsPerShareDiluted");
      const weightedAverageShsOut = pick(
        ic,
        "us-gaap_WeightedAverageNumberOfDilutedSharesOutstanding",
        "us-gaap_WeightedAverageNumberOfSharesOutstandingBasic",
      );
      const da = pick(filing.report.cf, "us-gaap_DepreciationDepletionAndAmortization", "us-gaap_DepreciationAmortizationAndAccretionNet");
      const ebitda = operatingIncome !== null && da !== null ? operatingIncome + da : null;

      // Never show a fabricated $0 for a genuinely-missing line — skip the whole
      // period instead if any core figure can't be found in this filing.
      if (
        revenue === null || costOfRevenue === null || grossProfit === null || operatingExpenses === null ||
        operatingIncome === null || netIncome === null || eps === null || epsDiluted === null ||
        weightedAverageShsOut === null || ebitda === null
      ) {
        continue;
      }

      data.push({
        date: filing.endDate.slice(0, 10),
        fiscalYear: String(filing.year),
        period: periodLabel(filing),
        revenue, costOfRevenue, grossProfit, operatingExpenses, operatingIncome, ebitda, netIncome, eps, epsDiluted,
        weightedAverageShsOut,
      });
      if (data.length >= limit) break;
    }
    if (data.length === 0) throw new Error(`No income statement data available for ${symbol}.`);
    return { data, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : "Unknown error fetching income statement.");
  }
}

async function fetchBalanceUncached(
  symbol: string,
  period: StatementPeriod,
  limit: number,
): Promise<ProviderResult<BalanceSheetPeriod[]>> {
  if (!env.finnhubApiKey) return notConfigured();
  try {
    const filings = await fetchFilings(symbol, period);
    const data: BalanceSheetPeriod[] = [];
    for (const filing of filings) {
      const bs = filing.report.bs;
      const cash = pick(bs, "us-gaap_CashAndCashEquivalentsAtCarryingValue");
      const marketableSecuritiesCurrent = pick(bs, "us-gaap_MarketableSecuritiesCurrent");
      const cashAndShortTermInvestments =
        cash !== null && marketableSecuritiesCurrent !== null ? cash + marketableSecuritiesCurrent : cash;
      const totalCurrentAssets = pick(bs, "us-gaap_AssetsCurrent");
      const totalAssets = pick(bs, "us-gaap_Assets");
      const totalCurrentLiabilities = pick(bs, "us-gaap_LiabilitiesCurrent");
      const longTermDebt = pick(bs, "us-gaap_LongTermDebtNoncurrent");
      const totalLiabilities = pick(bs, "us-gaap_Liabilities");
      const totalStockholdersEquity = pick(bs, "us-gaap_StockholdersEquity");

      if (
        cashAndShortTermInvestments === null || totalCurrentAssets === null || totalAssets === null ||
        totalCurrentLiabilities === null || longTermDebt === null || totalLiabilities === null ||
        totalStockholdersEquity === null
      ) {
        continue;
      }

      data.push({
        date: filing.endDate.slice(0, 10),
        fiscalYear: String(filing.year),
        period: periodLabel(filing),
        cashAndShortTermInvestments, totalCurrentAssets, totalAssets, totalCurrentLiabilities, longTermDebt,
        totalLiabilities, totalStockholdersEquity,
      });
      if (data.length >= limit) break;
    }
    if (data.length === 0) throw new Error(`No balance sheet data available for ${symbol}.`);
    return { data, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : "Unknown error fetching balance sheet.");
  }
}

async function fetchCashFlowUncached(
  symbol: string,
  period: StatementPeriod,
  limit: number,
): Promise<ProviderResult<CashFlowPeriod[]>> {
  if (!env.finnhubApiKey) return notConfigured();
  try {
    const filings = await fetchFilings(symbol, period);
    const data: CashFlowPeriod[] = [];
    for (const filing of filings) {
      const cf = filing.report.cf;
      const ic = filing.report.ic;
      const netIncome = pick(ic, "us-gaap_NetIncomeLoss", "us-gaap_ProfitLoss");
      const operatingCashFlow = pick(cf, "us-gaap_NetCashProvidedByUsedInOperatingActivities");
      const capitalExpenditure = pick(cf, "us-gaap_PaymentsToAcquirePropertyPlantAndEquipment");
      const freeCashFlow = operatingCashFlow !== null && capitalExpenditure !== null ? operatingCashFlow - capitalExpenditure : null;
      const commonDividendsPaid = pick(cf, "us-gaap_PaymentsOfDividends", "us-gaap_PaymentsOfDividendsCommonStock");
      const commonStockRepurchased = pick(cf, "us-gaap_PaymentsForRepurchaseOfCommonStock");

      if (
        netIncome === null || operatingCashFlow === null || capitalExpenditure === null || freeCashFlow === null ||
        commonDividendsPaid === null || commonStockRepurchased === null
      ) {
        continue;
      }

      data.push({
        date: filing.endDate.slice(0, 10),
        fiscalYear: String(filing.year),
        period: periodLabel(filing),
        netIncome, operatingCashFlow, capitalExpenditure, freeCashFlow, commonDividendsPaid, commonStockRepurchased,
      });
      if (data.length >= limit) break;
    }
    if (data.length === 0) throw new Error(`No cash flow data available for ${symbol}.`);
    return { data, meta: { provider: PROVIDER_NAME, timestamp: new Date().toISOString(), status: "live" } };
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : "Unknown error fetching cash flow statement.");
  }
}

export function getIncomeStatement(symbol: string, period: StatementPeriod, limit: number) {
  return withQuoteCache(`finnhub-income:${symbol}:${period}:${limit}`, () => fetchIncomeUncached(symbol, period, limit));
}
export function getBalanceSheet(symbol: string, period: StatementPeriod, limit: number) {
  return withQuoteCache(`finnhub-balance:${symbol}:${period}:${limit}`, () => fetchBalanceUncached(symbol, period, limit));
}
export function getCashFlow(symbol: string, period: StatementPeriod, limit: number) {
  return withQuoteCache(`finnhub-cashflow:${symbol}:${period}:${limit}`, () => fetchCashFlowUncached(symbol, period, limit));
}
