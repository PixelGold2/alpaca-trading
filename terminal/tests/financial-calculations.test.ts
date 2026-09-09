import { describe, it, expect } from "vitest";
import { percentChange } from "@/lib/fundamentals/calculations";

describe("percentChange", () => {
  it("computes a simple positive change", () => {
    expect(percentChange(110, 100)).toBeCloseTo(10, 5);
  });

  it("computes a simple negative change", () => {
    expect(percentChange(90, 100)).toBeCloseTo(-10, 5);
  });

  it("handles a swing from negative to positive using absolute value of the base", () => {
    // Going from a $100 loss to a $50 profit is a +150% swing relative to the loss's size.
    expect(percentChange(50, -100)).toBeCloseTo(150, 5);
  });

  it("returns null when the previous value is zero (undefined percent change)", () => {
    expect(percentChange(100, 0)).toBeNull();
  });

  it("returns null for non-finite input", () => {
    expect(percentChange(NaN, 100)).toBeNull();
    expect(percentChange(100, Infinity)).toBeNull();
  });
});
