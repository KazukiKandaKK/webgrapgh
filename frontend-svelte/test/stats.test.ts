import { describe, expect, it } from "vitest";
import { computeStats } from "../src/lib/stats";

describe("computeStats", () => {
  it("returns NaN-filled empty stats for a zero-length window", () => {
    const s = computeStats(new Float64Array(0));
    expect(s.count).toBe(0);
    expect(Number.isNaN(s.current)).toBe(true);
    expect(Number.isNaN(s.avg)).toBe(true);
  });

  it("computes min/max/avg/current over a simple window", () => {
    const s = computeStats(Float64Array.from([10, 20, 30, 40]));
    expect(s.count).toBe(4);
    expect(s.min).toBe(10);
    expect(s.max).toBe(40);
    expect(s.avg).toBe(25);
    expect(s.current).toBe(40); // last element
  });

  it("computes p95 as the value at floor(0.95*(n-1))", () => {
    const v = Float64Array.from(Array.from({ length: 100 }, (_, i) => i + 1)); // 1..100
    const s = computeStats(v);
    // idx = floor(0.95 * 99) = 94 -> sorted[94] = 95
    expect(s.p95).toBe(95);
  });

  it("handles a single-element window", () => {
    const s = computeStats(Float64Array.from([7]));
    expect(s).toMatchObject({
      count: 1,
      min: 7,
      max: 7,
      avg: 7,
      current: 7,
      p95: 7,
    });
  });

  it("does not mutate the input array (sorts a copy)", () => {
    const v = Float64Array.from([3, 1, 2]);
    computeStats(v);
    expect(Array.from(v)).toEqual([3, 1, 2]);
  });
});
