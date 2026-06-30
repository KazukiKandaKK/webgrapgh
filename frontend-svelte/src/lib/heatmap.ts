import { hexToRgba } from "@shared/utils";

export const HEATMAP_COLS = 120;
export const HEATMAP_BUCKETS = 20;

/**
 * Aggregate (t, v) pairs into a density grid of [timeCols × valBuckets].
 *
 * Each column is independently normalized so the densest cell in that column
 * is 1.0 — this reveals distribution shape even in low-activity periods.
 *
 * Returns a flat Float64Array where:
 *   grid[col * valBuckets + bkt] = density ∈ [0, 1]
 */
export function bucketize(
  t: Float64Array,
  v: Float64Array,
  tMin: number,
  tMax: number,
  timeCols: number,
  vMin: number,
  vMax: number,
  valBuckets: number,
): Float64Array {
  const grid = new Float64Array(timeCols * valBuckets);
  const n = Math.min(t.length, v.length);

  if (n === 0 || tMax <= tMin || vMax <= vMin) return grid;

  const colScale = timeCols / (tMax - tMin);
  const bktScale = valBuckets / (vMax - vMin);

  for (let i = 0; i < n; i++) {
    let col = Math.floor((t[i] - tMin) * colScale);
    let bkt = Math.floor((v[i] - vMin) * bktScale);
    // Clamp to valid range (edge values land on boundary)
    if (col < 0) col = 0;
    else if (col >= timeCols) col = timeCols - 1;
    if (bkt < 0) bkt = 0;
    else if (bkt >= valBuckets) bkt = valBuckets - 1;
    grid[col * valBuckets + bkt]++;
  }

  // Per-column normalisation: highest count in each column → 1.0
  for (let col = 0; col < timeCols; col++) {
    let max = 0;
    const base = col * valBuckets;
    for (let bkt = 0; bkt < valBuckets; bkt++) {
      if (grid[base + bkt] > max) max = grid[base + bkt];
    }
    if (max > 0) {
      for (let bkt = 0; bkt < valBuckets; bkt++) {
        grid[base + bkt] /= max;
      }
    }
  }

  return grid;
}

/**
 * Map density ∈ [0, 1] to an rgba string using the given accent hex color.
 * density = 0 → fully transparent; density = 1 → alpha 0.9.
 */
export function interpolateColor(hex: string, density: number): string {
  return hexToRgba(hex, density * 0.9);
}

/** Compute dynamic value bounds from an array, with a minimum spread. */
export function valueBounds(
  v: Float64Array,
  metaMin: number | null,
  metaMax: number | null,
): [number, number] {
  if (v.length === 0) {
    return [metaMin ?? 0, metaMax ?? 1];
  }

  let lo = metaMin ?? Infinity;
  let hi = metaMax ?? -Infinity;

  if (!isFinite(lo) || !isFinite(hi)) {
    for (let i = 0; i < v.length; i++) {
      if (v[i] < lo) lo = v[i];
      if (v[i] > hi) hi = v[i];
    }
  }

  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi)) hi = lo + 1;
  if (hi === lo) { lo -= 0.5; hi += 0.5; }

  return [lo, hi];
}
