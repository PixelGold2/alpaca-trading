import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("alpaca provider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.ALPACA_API_KEY_ID = "test-key";
    process.env.ALPACA_API_SECRET_KEY = "test-secret";
    process.env.ALPACA_API_BASE_URL = "https://paper-api.alpaca.markets";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ALPACA_API_KEY_ID;
    delete process.env.ALPACA_API_SECRET_KEY;
    vi.resetModules();
  });

  it("returns status 'error' with no fabricated data when keys are missing", async () => {
    delete process.env.ALPACA_API_KEY_ID;
    delete process.env.ALPACA_API_SECRET_KEY;
    const { alpacaProvider } = await import("@/lib/market-data/alpaca-provider");

    const result = await alpacaProvider.getAccountSnapshot();
    expect(result.data).toBeNull();
    expect(result.meta.status).toBe("error");
    expect(result.meta.message).toMatch(/not configured/i);
  });

  it("parses a successful account response as 'live'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        account_number: "PA123",
        equity: "10000.50",
        cash: "5000.25",
        buying_power: "20000.00",
        currency: "USD",
      }),
    }) as unknown as typeof fetch;

    const { alpacaProvider } = await import("@/lib/market-data/alpaca-provider");
    const result = await alpacaProvider.getAccountSnapshot();

    expect(result.meta.status).toBe("live");
    expect(result.data).toEqual({
      accountId: "PA123",
      equity: 10000.5,
      cash: 5000.25,
      buyingPower: 20000,
      currency: "USD",
      paper: true,
    });
  });

  it("returns status 'error' on a non-OK HTTP response, without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { alpacaProvider } = await import("@/lib/market-data/alpaca-provider");
    const result = await alpacaProvider.getAccountSnapshot();

    expect(result.data).toBeNull();
    expect(result.meta.status).toBe("error");
    expect(result.meta.message).toMatch(/401/);
  });
});
