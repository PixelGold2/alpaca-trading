import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("fmp provider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.FMP_API_KEY = "test-fmp-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.FMP_API_KEY;
    vi.resetModules();
  });

  it("returns status 'error' with no fabricated data when the key is missing", async () => {
    delete process.env.FMP_API_KEY;
    const { fmpProvider } = await import("@/lib/fundamentals/fmp-provider");

    const result = await fmpProvider.getProfile("AAPL");
    expect(result.data).toBeNull();
    expect(result.meta.status).toBe("error");
    expect(result.meta.message).toMatch(/not configured/i);
  });

  it("parses a successful profile response as 'live'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          symbol: "AAPL",
          companyName: "Apple Inc.",
          sector: "Technology",
          industry: "Consumer Electronics",
          exchange: "NASDAQ",
          description: "Makes phones.",
          ceo: "Tim Cook",
          fullTimeEmployees: "164000",
          website: "https://apple.com",
          price: 311.3,
          marketCap: 4572173922800,
          currency: "USD",
        },
      ],
    }) as unknown as typeof fetch;

    const { fmpProvider } = await import("@/lib/fundamentals/fmp-provider");
    const result = await fmpProvider.getProfile("aapl");

    expect(result.meta.status).toBe("live");
    expect(result.data).toMatchObject({
      symbol: "AAPL",
      companyName: "Apple Inc.",
      employees: 164000,
    });
  });

  it("returns an error envelope for an unknown symbol (empty array response)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as unknown as typeof fetch;

    const { fmpProvider } = await import("@/lib/fundamentals/fmp-provider");
    const result = await fmpProvider.getProfile("ZZZZ");

    expect(result.data).toBeNull();
    expect(result.meta.status).toBe("error");
    expect(result.meta.message).toMatch(/unknown symbol/i);
  });

  it("returns an error envelope on a non-OK HTTP response, without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    }) as unknown as typeof fetch;

    const { fmpProvider } = await import("@/lib/fundamentals/fmp-provider");
    const result = await fmpProvider.getIncomeStatement("AAPL", "annual", 5);

    expect(result.data).toBeNull();
    expect(result.meta.status).toBe("error");
    expect(result.meta.message).toMatch(/429/);
  });

  it("merges ratios + key-metrics endpoints into one snapshot for annual periods", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const isRatios = url.includes("/ratios?");
      return Promise.resolve({
        ok: true,
        json: async () =>
          isRatios
            ? [
                {
                  date: "2025-09-27",
                  fiscalYear: "2025",
                  period: "FY",
                  priceToEarningsRatio: 34.1,
                  priceToEarningsGrowthRatio: 1.5,
                  priceToSalesRatio: 9.2,
                  priceToBookRatio: 51.8,
                  grossProfitMargin: 0.47,
                  operatingProfitMargin: 0.32,
                  netProfitMargin: 0.27,
                  currentRatio: 0.89,
                  debtToEquityRatio: 1.52,
                },
              ]
            : [
                {
                  returnOnEquity: 1.52,
                  returnOnInvestedCapital: 0.52,
                  evToEBITDA: 26.97,
                },
              ],
      });
    }) as unknown as typeof fetch;

    const { fmpProvider } = await import("@/lib/fundamentals/fmp-provider");
    const result = await fmpProvider.getRatios("AAPL", "annual");

    expect(result.meta.status).toBe("live");
    expect(result.data).toMatchObject({
      peRatio: 34.1,
      returnOnEquity: 1.52,
      evToEBITDA: 26.97,
    });
  });

  it("reads the TTM-suffixed fields when period is 'ttm'", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const isRatios = url.includes("/ratios-ttm?");
      return Promise.resolve({
        ok: true,
        json: async () =>
          isRatios
            ? [{ priceToEarningsRatioTTM: 40, grossProfitMarginTTM: 0.49 }]
            : [{ returnOnEquityTTM: 1.6, evToEBITDATTM: 27.4 }],
      });
    }) as unknown as typeof fetch;

    const { fmpProvider } = await import("@/lib/fundamentals/fmp-provider");
    const result = await fmpProvider.getRatios("AAPL", "ttm");

    expect(result.data).toMatchObject({
      date: "TTM",
      peRatio: 40,
      returnOnEquity: 1.6,
    });
  });
});
