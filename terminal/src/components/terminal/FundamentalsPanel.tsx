"use client";

import { useEffect, useState } from "react";
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
import { percentChange } from "@/lib/fundamentals/calculations";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";

function formatMoney(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function formatRatio(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatChange(value: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function useFetch<T>(url: string | null): { result: ProviderResult<T> | null; loading: boolean } {
  const [result, setResult] = useState<ProviderResult<T> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    // See PriceChart.tsx's identical pattern for why this is intentional (React's own
    // documented data-fetching effect shape).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(url)
      .then((res) => res.json())
      .then((body: ProviderResult<T>) => {
        if (!cancelled) setResult(body);
      })
      .catch(() => {
        if (!cancelled) {
          setResult({
            data: null,
            meta: {
              provider: "fmp",
              timestamp: new Date().toISOString(),
              status: "error",
              message: "Network error.",
            },
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { result, loading };
}

function DataState({ result, loading }: { result: ProviderResult<unknown> | null; loading: boolean }) {
  if (loading || !result) return <div className="p-4 text-center text-xs text-text-muted">Loading…</div>;
  if (result.meta.status === "error") {
    return (
      <div className="p-4 text-center text-xs text-text-muted">
        Data unavailable{result.meta.message ? ` — ${result.meta.message}` : "."}
      </div>
    );
  }
  return null;
}

// Small inline SVG bar chart — no charting library, matching this app's
// existing minimal-dependency approach (lightweight-charts is reserved for
// the real price chart). Revenue and net income share a zero baseline;
// negative net income (a real, not-uncommon case) extends below it rather
// than being clamped away.
function RevenueTrendChart({ periods, periodType }: { periods: IncomeStatementPeriod[]; periodType: StatementPeriod }) {
  if (periods.length === 0) return null;
  const ordered = [...periods].reverse(); // oldest -> newest, left to right

  const width = 480;
  const barsAreaHeight = 120;
  const revenues = ordered.map((p) => p.revenue);
  const netIncomes = ordered.map((p) => p.netIncome);
  const maxPositive = Math.max(...revenues, ...netIncomes.map((v) => Math.max(v, 0)), 1);
  const maxNegative = Math.max(...netIncomes.map((v) => Math.max(-v, 0)), 0);
  const posHeight = maxNegative > 0 ? barsAreaHeight * 0.75 : barsAreaHeight;
  const negHeight = barsAreaHeight - posHeight;
  const baselineY = posHeight;
  const groupWidth = width / ordered.length;
  const barWidth = Math.min(28, groupWidth / 2.5);

  return (
    <div className="rounded-lg border border-border bg-bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Revenue &amp; Net Income Trend
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: "var(--accent)" }} />
            Revenue
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: "var(--positive)" }} />
            Net Income
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${barsAreaHeight + 20}`} className="w-full" style={{ height: 150 }}>
        <line x1={0} y1={baselineY} x2={width} y2={baselineY} stroke="var(--border)" strokeWidth={1} />
        {ordered.map((p, i) => {
          const groupX = i * groupWidth + groupWidth / 2;
          const revH = (revenues[i] / maxPositive) * posHeight;
          const ni = netIncomes[i];
          const niH = ni >= 0 ? (ni / maxPositive) * posHeight : (Math.abs(ni) / (maxNegative || 1)) * negHeight;
          return (
            <g key={p.date}>
              <rect
                x={groupX - barWidth}
                y={baselineY - revH}
                width={barWidth * 0.9}
                height={Math.max(revH, 1)}
                fill="var(--accent)"
                rx={1}
              />
              <rect
                x={groupX + barWidth * 0.1}
                y={ni >= 0 ? baselineY - niH : baselineY}
                width={barWidth * 0.9}
                height={Math.max(niH, 1)}
                fill={ni >= 0 ? "var(--positive)" : "var(--negative)"}
                rx={1}
              />
              <text x={groupX} y={barsAreaHeight + 15} textAnchor="middle" fill="var(--text-muted)" fontSize={9}>
                {p.period} {p.date.slice(0, 4)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[10px] text-text-muted">
        {periodType === "annual" ? "Annual" : "Quarterly"} figures, oldest to newest, from the reported statements above.
      </p>
    </div>
  );
}

function StatementTable<T extends { date: string; period: string }>({
  title,
  periods,
  rows,
  periodType,
}: {
  title: string;
  periods: T[];
  rows: { label: string; get: (p: T) => number; format?: (v: number) => string }[];
  periodType: StatementPeriod;
}) {
  const fmt = (v: number, custom?: (v: number) => string) => (custom ? custom(v) : formatMoney(v));

  return (
    <div className="rounded-lg border border-border bg-bg-panel p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-xs">
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th className="py-2 pr-4 font-medium">Line item</th>
              {periods.map((p) => (
                <th key={p.date} className="py-2 pr-4 text-right font-medium">
                  {p.period} {p.date.slice(0, 4)}
                </th>
              ))}
              <th className="py-2 text-right font-medium">
                {periodType === "annual" ? "YoY" : "QoQ"}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const values = periods.map((p) => row.get(p));
              const change = values.length >= 2 ? percentChange(values[0], values[1]) : null;
              return (
                <tr key={row.label} className="border-b border-border/50">
                  <td className="py-2 pr-4 text-text-secondary">{row.label}</td>
                  {values.map((v, i) => (
                    <td key={i} className="py-2 pr-4 text-right font-mono text-text-primary">
                      {fmt(v, row.format)}
                    </td>
                  ))}
                  <td
                    className={`py-2 text-right font-mono ${
                      change === null
                        ? "text-text-muted"
                        : change >= 0
                          ? "text-positive"
                          : "text-negative"
                    }`}
                  >
                    {formatChange(change)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-text-muted">
        Figures from SEC filings via Finnhub. The {periodType === "annual" ? "YoY" : "QoQ"} column is
        calculated here, not reported.
      </p>
    </div>
  );
}

export function FundamentalsPanel({ symbol }: { symbol: string }) {
  const [statementPeriod, setStatementPeriod] = useState<StatementPeriod>("annual");
  const [metricsPeriod, setMetricsPeriod] = useState<MetricsPeriod>("ttm");

  const profile = useFetch<CompanyProfile>(
    symbol ? `/api/fundamentals/profile?symbol=${encodeURIComponent(symbol)}` : null
  );
  const metrics = useFetch<RatiosSnapshot>(
    symbol
      ? `/api/fundamentals/metrics?symbol=${encodeURIComponent(symbol)}&period=${metricsPeriod}`
      : null
  );
  const income = useFetch<IncomeStatementPeriod[]>(
    symbol
      ? `/api/fundamentals/statements?symbol=${encodeURIComponent(symbol)}&type=income&period=${statementPeriod}&limit=5`
      : null
  );
  const balance = useFetch<BalanceSheetPeriod[]>(
    symbol
      ? `/api/fundamentals/statements?symbol=${encodeURIComponent(symbol)}&type=balance&period=${statementPeriod}&limit=5`
      : null
  );
  const cashFlow = useFetch<CashFlowPeriod[]>(
    symbol
      ? `/api/fundamentals/statements?symbol=${encodeURIComponent(symbol)}&type=cashflow&period=${statementPeriod}&limit=5`
      : null
  );

  return (
    <div className="space-y-4">
      {/* Profile */}
      <div className="rounded-lg border border-border bg-bg-panel p-4">
        <DataState result={profile.result} loading={profile.loading} />
        {profile.result?.data && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-text-primary">
                  {profile.result.data.companyName} ({profile.result.data.symbol})
                </h2>
                <p className="text-xs text-text-muted">
                  {[profile.result.data.sector, profile.result.data.industry, profile.result.data.exchange]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              <DataStatusBadge status={profile.result.meta.status} />
            </div>
            <div className="grid grid-cols-4 gap-4 font-mono text-xs">
              <div>
                <div className="text-[10px] uppercase text-text-muted">Price</div>
                <div className="text-text-primary">
                  {profile.result.data.currency ?? ""} {formatMoney(profile.result.data.price)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-text-muted">Market Cap</div>
                <div className="text-text-primary">{formatMoney(profile.result.data.marketCap)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-text-muted">CEO</div>
                <div className="text-text-primary">{profile.result.data.ceo || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-text-muted">Employees</div>
                <div className="text-text-primary">
                  {profile.result.data.employees !== null ? profile.result.data.employees.toLocaleString("en-US") : "—"}
                </div>
              </div>
            </div>
            {profile.result.data.description && (
              <p className="text-xs text-text-secondary">
                {profile.result.data.description.slice(0, 400)}
                {profile.result.data.description.length > 400 ? "…" : ""}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Key metrics / ratios */}
      <div className="rounded-lg border border-border bg-bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Key Metrics
          </h3>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            {(["annual", "quarter", "ttm"] as MetricsPeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setMetricsPeriod(p)}
                className={`rounded px-2 py-1 text-[11px] ${
                  metricsPeriod === p
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {p === "ttm" ? "TTM" : p === "annual" ? "Annual" : "Quarterly"}
              </button>
            ))}
          </div>
        </div>
        <DataState result={metrics.result} loading={metrics.loading} />
        {metrics.result?.data && (
          <div className="grid grid-cols-4 gap-4 font-mono text-xs sm:grid-cols-6">
            {[
              ["P/E", formatRatio(metrics.result.data.peRatio)],
              ["PEG", formatRatio(metrics.result.data.pegRatio)],
              ["EV/EBITDA", formatRatio(metrics.result.data.evToEBITDA)],
              ["P/S", formatRatio(metrics.result.data.priceToSalesRatio)],
              ["P/B", formatRatio(metrics.result.data.priceToBookRatio)],
              ["Current Ratio", formatRatio(metrics.result.data.currentRatio)],
              ["Gross Margin", formatPercent(metrics.result.data.grossProfitMargin)],
              ["Operating Margin", formatPercent(metrics.result.data.operatingProfitMargin)],
              ["Net Margin", formatPercent(metrics.result.data.netProfitMargin)],
              ["ROE", formatPercent(metrics.result.data.returnOnEquity)],
              ["ROIC", formatPercent(metrics.result.data.returnOnInvestedCapital)],
              ["Debt/Equity", formatRatio(metrics.result.data.debtToEquityRatio)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[10px] uppercase text-text-muted">{label}</div>
                <div className="text-text-primary">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Statements */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Financial Statements
        </h3>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {(["annual", "quarter"] as StatementPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setStatementPeriod(p)}
              className={`rounded px-2 py-1 text-[11px] ${
                statementPeriod === p ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
              }`}
            >
              {p === "annual" ? "Annual" : "Quarterly"}
            </button>
          ))}
        </div>
      </div>

      <DataState result={income.result} loading={income.loading} />
      {income.result?.data && income.result.data.length > 0 && (
        <RevenueTrendChart periods={income.result.data} periodType={statementPeriod} />
      )}
      {income.result?.data && (
        <StatementTable
          title="Income Statement"
          periods={income.result.data}
          periodType={statementPeriod}
          rows={[
            { label: "Revenue", get: (p) => p.revenue },
            { label: "Gross Profit", get: (p) => p.grossProfit },
            { label: "Operating Income", get: (p) => p.operatingIncome },
            { label: "EBITDA", get: (p) => p.ebitda },
            { label: "Net Income", get: (p) => p.netIncome },
            { label: "EPS (diluted)", get: (p) => p.epsDiluted, format: (v) => v.toFixed(2) },
          ]}
        />
      )}

      <DataState result={balance.result} loading={balance.loading} />
      {balance.result?.data && (
        <StatementTable
          title="Balance Sheet"
          periods={balance.result.data}
          periodType={statementPeriod}
          rows={[
            { label: "Cash & ST Investments", get: (p) => p.cashAndShortTermInvestments },
            { label: "Total Current Assets", get: (p) => p.totalCurrentAssets },
            { label: "Total Assets", get: (p) => p.totalAssets },
            { label: "Total Current Liabilities", get: (p) => p.totalCurrentLiabilities },
            { label: "Long-Term Debt", get: (p) => p.longTermDebt },
            { label: "Total Liabilities", get: (p) => p.totalLiabilities },
            { label: "Stockholders' Equity", get: (p) => p.totalStockholdersEquity },
          ]}
        />
      )}

      <DataState result={cashFlow.result} loading={cashFlow.loading} />
      {cashFlow.result?.data && (
        <StatementTable
          title="Cash Flow Statement"
          periods={cashFlow.result.data}
          periodType={statementPeriod}
          rows={[
            { label: "Operating Cash Flow", get: (p) => p.operatingCashFlow },
            { label: "Capital Expenditure", get: (p) => p.capitalExpenditure },
            { label: "Free Cash Flow", get: (p) => p.freeCashFlow },
            { label: "Dividends Paid", get: (p) => Math.abs(p.commonDividendsPaid) },
            { label: "Stock Buybacks", get: (p) => Math.abs(p.commonStockRepurchased) },
          ]}
        />
      )}
    </div>
  );
}
