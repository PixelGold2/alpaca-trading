import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/dal", () => ({
  verifySession: vi.fn().mockResolvedValue({ id: "u1", role: "user" }),
}));

const getBarsMock = vi.fn();
vi.mock("@/lib/market-data/alpaca-provider", () => ({
  alpacaProvider: { getBars: getBarsMock },
}));

function makeRequest(query: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/market-data/bars?${query}`));
}

describe("GET /api/market-data/bars", () => {
  beforeEach(() => {
    getBarsMock.mockReset();
  });

  it("rejects a request missing 'symbol' with 400", async () => {
    const { GET } = await import("@/app/api/market-data/bars/route");
    const res = await GET(makeRequest("timeframe=1Day&start=2026-01-01"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/symbol/i);
    expect(getBarsMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid 'timeframe' with 400", async () => {
    const { GET } = await import("@/app/api/market-data/bars/route");
    const res = await GET(makeRequest("symbol=AAPL&timeframe=3Min&start=2026-01-01"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/timeframe/i);
  });

  it("rejects a request missing 'start' with 400", async () => {
    const { GET } = await import("@/app/api/market-data/bars/route");
    const res = await GET(makeRequest("symbol=AAPL&timeframe=1Day"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/start/i);
  });

  it("passes valid params through and returns the provider's envelope untouched", async () => {
    const fakeResult = {
      data: [{ time: "2026-01-01T00:00:00Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
      meta: { provider: "alpaca", timestamp: "2026-01-01T00:00:00Z", status: "live" },
    };
    getBarsMock.mockResolvedValue(fakeResult);

    const { GET } = await import("@/app/api/market-data/bars/route");
    const res = await GET(makeRequest("symbol=aapl&timeframe=1Day&start=2026-01-01"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fakeResult);
    expect(getBarsMock).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "aapl", timeframe: "1Day", start: "2026-01-01" })
    );
  });

  it("propagates the provider's error envelope on failure, without throwing", async () => {
    const fakeResult = {
      data: null,
      meta: { provider: "alpaca", timestamp: "2026-01-01T00:00:00Z", status: "error", message: "Unknown symbol." },
    };
    getBarsMock.mockResolvedValue(fakeResult);

    const { GET } = await import("@/app/api/market-data/bars/route");
    const res = await GET(makeRequest("symbol=ZZZZ&timeframe=1Day&start=2026-01-01"));

    expect(res.status).toBe(200); // the envelope carries the error, not the HTTP status
    const body = await res.json();
    expect(body.meta.status).toBe("error");
  });
});
