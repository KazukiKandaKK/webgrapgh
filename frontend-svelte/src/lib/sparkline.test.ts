import { describe, expect, it } from "vitest";

// Extracted from Sparkline.svelte: computes SVG polyline points string.
function sparklinePoints(
  values: Float64Array,
  width: number,
  height: number,
): string {
  const n = values.length;
  if (n === 0) return "";
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const x = values[i];
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const range = max - min || 1;
  const step = n > 1 ? width / (n - 1) : 0;
  let out = "";
  for (let i = 0; i < n; i++) {
    const px = i * step;
    const py = height - ((values[i] - min) / range) * height;
    out += `${i === 0 ? "" : " "}${px.toFixed(1)},${py.toFixed(1)}`;
  }
  return out;
}

// Extracted from StatusPill.svelte: maps state to CSS color class.
function pillColor(s: string): string {
  switch (s) {
    case "open":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-700";
    case "error":
      return "bg-rose-500/20 text-rose-300 border-rose-700";
    default:
      return "bg-slate-500/20 text-slate-300 border-slate-700";
  }
}

describe("sparklinePoints", () => {
  it("returns empty string for empty array", () => {
    expect(sparklinePoints(new Float64Array([]), 120, 36)).toBe("");
  });

  it("single point renders at left edge, bottom (range=0 fallback)", () => {
    // Single value: range=0 → fallback 1, (5-5)/1=0, py=36-0=36
    const pts = sparklinePoints(new Float64Array([5]), 120, 36);
    expect(pts).toBe("0.0,36.0");
  });

  it("two equal values produce a flat line at bottom", () => {
    const pts = sparklinePoints(new Float64Array([10, 10]), 120, 36);
    // range = 0 → fallback to 1, both (v-min)/1 = 0, py = 36
    expect(pts).toBe("0.0,36.0 120.0,36.0");
  });

  it("ascending pair maps first to bottom, second to top", () => {
    const pts = sparklinePoints(new Float64Array([0, 100]), 100, 50);
    // first: px=0 py=50-(0/100)*50 = 50
    // second: px=100 py=50-(100/100)*50 = 0
    expect(pts).toBe("0.0,50.0 100.0,0.0");
  });

  it("three values distribute x-coords evenly", () => {
    const pts = sparklinePoints(new Float64Array([0, 50, 100]), 200, 40);
    const coords = pts.split(" ");
    expect(coords).toHaveLength(3);
    expect(coords[0].split(",")[0]).toBe("0.0");
    expect(coords[1].split(",")[0]).toBe("100.0");
    expect(coords[2].split(",")[0]).toBe("200.0");
  });
});

describe("pillColor", () => {
  it("returns emerald for open", () => {
    expect(pillColor("open")).toContain("emerald");
  });

  it("returns rose for error", () => {
    expect(pillColor("error")).toContain("rose");
  });

  it("returns slate for unknown state", () => {
    expect(pillColor("connecting")).toContain("slate");
    expect(pillColor("")).toContain("slate");
  });
});
