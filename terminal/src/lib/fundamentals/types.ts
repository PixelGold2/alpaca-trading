import type { ProviderResult } from "@/lib/providers/types";

export type StatementPeriod = "annual" | "quarter";
export type MetricsPeriod = "annual" | "quarter" | "ttm";

export interface CompanyProfile {
  symbol: string;
  companyName: string;
  // sector/ceo/employees/description are null, not fabricated placeholders:
  // Finnhub's free profile endpoint (this app's source since FMP's plan has
  // been unreachable) doesn't report them. See finnhub-fundamentals.ts.
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  description: string | null;
  ceo: string | null;
  employees: number | null;
  website: string | null;
  price: number | null;
  marketCap: number | null;
  currency: string | null;
}

export interface IncomeStatementPeriod {
  date: string;
  fiscalYear: string;
  period: string; // FY, Q1, Q2, Q3, Q4
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  ebitda: number;
  netIncome: number;
  eps: number;
  epsDiluted: number;
  weightedAverageShsOut: number;
}

export interface BalanceSheetPeriod {
  date: string;
  fiscalYear: string;
  period: string;
  cashAndShortTermInvestments: number;
  totalCurrentAssets: number;
  totalAssets: number;
  totalCurrentLiabilities: number;
  longTermDebt: number;
  totalLiabilities: number;
  totalStockholdersEquity: number;
}

export interface CashFlowPeriod {
  date: string;
  fiscalYear: string;
  period: string;
  netIncome: number;
  operatingCashFlow: number;
  capitalExpenditure: number;
  freeCashFlow: number;
  commonDividendsPaid: number;
  commonStockRepurchased: number;
}

export interface RatiosSnapshot {
  date: string;
  fiscalYear: string;
  period: string;
  peRatio: number;
  pegRatio: number;
  priceToSalesRatio: number;
  priceToBookRatio: number;
  grossProfitMargin: number;
  operatingProfitMargin: number;
  netProfitMargin: number;
  returnOnEquity: number;
  returnOnInvestedCapital: number;
  // null, not a fallback zero: Finnhub's free metrics endpoint (this app's
  // fundamentals source) has no direct EV/EBITDA field — see finnhub-fundamentals.ts.
  evToEBITDA: number | null;
  currentRatio: number;
  debtToEquityRatio: number;
}

/**
 * Fundamentals/financials data source (FMP today). Same abstraction rules as
 * MarketDataProvider: return the error envelope on any failure, never fabricate
 * a number, never throw.
 */
export interface FundamentalsProvider {
  readonly name: string;
  getProfile(symbol: string): Promise<ProviderResult<CompanyProfile>>;
  getIncomeStatement(
    symbol: string,
    period: StatementPeriod,
    limit: number
  ): Promise<ProviderResult<IncomeStatementPeriod[]>>;
  getBalanceSheet(
    symbol: string,
    period: StatementPeriod,
    limit: number
  ): Promise<ProviderResult<BalanceSheetPeriod[]>>;
  getCashFlow(
    symbol: string,
    period: StatementPeriod,
    limit: number
  ): Promise<ProviderResult<CashFlowPeriod[]>>;
  getRatios(symbol: string, period: MetricsPeriod): Promise<ProviderResult<RatiosSnapshot>>;
}
