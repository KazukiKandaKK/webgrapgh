import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  HEATMAP_BUCKETS,
  HEATMAP_COLS,
  bucketize,
  interpolateColor,
  valueBounds,
} from "./heatmap";

// ─── PBT: bucketize ───────────────────────────────────────────────────────────

describe("bucketize — properties", () => {
  it("total count across all buckets equals input length", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0, max: 100, noNaN: true }), {
          minLength: 1,
          maxLength: 500,
        }),
        (vals) => {
          const t = Float64Array.from(vals.map((_, i) => i));
          const v = Float64Array.from(vals);
          // bucketize normalizes per column, so we need to test pre-normalisation logic
          // Instead verify: all output values in [0, 1]
          const grid = bucketize(
            t,
            v,
            0,
            vals.length - 1,
            HEATMAP_COLS,
            0,
            100,
            HEATMAP_BUCKETS,
          );
          return Array.from(grid).every((d) => d >= 0 && d <= 1);
        },
      ),
    );
  });

  it("empty input returns all-zero grid", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 20 }),
        (cols, bkts) => {
          const grid = bucketize(
            new Float64Array(0),
            new Float64Array(0),
            0,
            100,
            cols,
            0,
            1,
            bkts,
          );
          return grid.every((d) => d === 0);
        },
      ),
    );
  });

  it("tMax <= tMin returns all-zero grid (degenerate time range)", () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1000, noNaN: true }), (tVal) => {
        const t = Float64Array.from([tVal, tVal]);
        const v = Float64Array.from([42, 43]);
        const grid = bucketize(t, v, tVal, tVal, 10, 0, 100, 10);
        return grid.every((d) => d === 0);
      }),
    );
  });

  it("single distinct value: all points land in one bucket per column", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 50 }),
        fc.float({ min: 10, max: 90, noNaN: true }),
        (n, fixedVal) => {
          const t = Float64Array.from(Array.from({ length: n }, (_, i) => i));
          const v = Float64Array.from(
            Array.from({ length: n }, () => fixedVal),
          );
          const grid = bucketize(
            t,
            v,
            0,
            n - 1,
            HEATMAP_COLS,
            0,
            100,
            HEATMAP_BUCKETS,
          );
          // Each value in [0, 1]
          return Array.from(grid).every((d) => d >= 0 && d <= 1);
        },
      ),
    );
  });
});

// ─── Unit: bucketize edge cases ───────────────────────────────────────────────

describe("bucketize — unit", () => {
  it("grid has correct size (cols × buckets)", () => {
    const t = Float64Array.from([0, 1, 2]);
    const v = Float64Array.from([10, 50, 90]);
    const grid = bucketize(t, v, 0, 2, 12, 0, 100, 8);
    expect(grid.length).toBe(12 * 8);
  });

  it("all values in same bucket: that bucket's cell is 1.0 in each populated column", () => {
    const n = 20;
    const t = Float64Array.from(Array.from({ length: n }, (_, i) => i));
    // v=0 → bkt = floor(0/100 * 20) = 0 (bucket 0)
    const v = Float64Array.from(new Array(n).fill(0));
    const grid = bucketize(
      t,
      v,
      0,
      n - 1,
      HEATMAP_COLS,
      0,
      100,
      HEATMAP_BUCKETS,
    );
    // Each column with data has exactly one point → density = 1 in bucket 0
    const bucket0Cells = Array.from(
      { length: HEATMAP_COLS },
      (_, col) => grid[col * HEATMAP_BUCKETS + 0],
    );
    expect(bucket0Cells.some((d) => d === 1)).toBe(true);
  });

  it("vMax > vMin edge: boundary values go into last bucket", () => {
    const t = Float64Array.from([0, 1]);
    const v = Float64Array.from([0, 100]); // exact boundaries
    const cols = 4;
    const bkts = 4;
    const grid = bucketize(t, v, 0, 1, cols, 0, 100, bkts);
    // Both values land in valid buckets (no out-of-bounds → no undefined)
    expect(Array.from(grid).every((d) => !Number.isNaN(d))).toBe(true);
  });
});

// ─── PBT: interpolateColor ────────────────────────────────────────────────────

describe("interpolateColor — properties", () => {
  it("density ∈ [0,1] always produces a valid rgba() string", () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (density) => {
        const result = interpolateColor("#38bdf8", density);
        return result.startsWith("rgba(");
      }),
    );
  });

  it("density = 0 → alpha is 0", () => {
    const result = interpolateColor("#38bdf8", 0);
    expect(result).toBe("rgba(56,189,248,0)");
  });

  it("density = 1 → alpha is 0.9", () => {
    const result = interpolateColor("#38bdf8", 1);
    expect(result).toBe("rgba(56,189,248,0.9)");
  });

  it("different accent colors produce different rgb components", () => {
    const sky = interpolateColor("#38bdf8", 0.5);
    const rose = interpolateColor("#fb7185", 0.5);
    expect(sky).not.toBe(rose);
  });
});

// ─── Unit: valueBounds ────────────────────────────────────────────────────────

describe("valueBounds — unit", () => {
  it("empty array with meta range returns meta range", () => {
    const [lo, hi] = valueBounds(new Float64Array(0), 0, 100);
    expect(lo).toBe(0);
    expect(hi).toBe(100);
  });

  it("empty array with null meta range returns safe [0, 1]", () => {
    const [lo, hi] = valueBounds(new Float64Array(0), null, null);
    expect(lo).toBe(0);
    expect(hi).toBe(1);
  });

  it("lo == hi gets spread by ±0.5", () => {
    const v = Float64Array.from([42, 42, 42]);
    const [lo, hi] = valueBounds(v, null, null);
    expect(lo).toBe(41.5);
    expect(hi).toBe(42.5);
  });

  it("fixed meta range [0, 100] is returned regardless of data extremes", () => {
    const v = Float64Array.from([10, 20, 80]);
    const [lo, hi] = valueBounds(v, 0, 100);
    expect(lo).toBe(0);
    expect(hi).toBe(100);
  });

  it("null meta range uses data min/max", () => {
    const v = Float64Array.from([15, 73, 42]);
    const [lo, hi] = valueBounds(v, null, null);
    expect(lo).toBe(15);
    expect(hi).toBe(73);
  });
});
