/** Summary statistics over a metric's downsampled value window. */
export type Stats = {
  count: number;
  current: number;
  min: number;
  max: number;
  avg: number;
  p95: number;
};

const EMPTY: Stats = {
  count: 0,
  current: Number.NaN,
  min: Number.NaN,
  max: Number.NaN,
  avg: Number.NaN,
  p95: Number.NaN,
};

/** Compute min/max/avg/p95 (+ current) over a Float64Array of samples. */
export function computeStats(v: Float64Array): Stats {
  const n = v.length;
  if (n === 0) return EMPTY;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = v[i];
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }

  // p95 via a sorted copy. Windows are downsampled (<= maxRenderPoints), so the
  // O(n log n) sort is cheap even at the flush rate.
  const sorted = Float64Array.from(v).sort();
  const idx = Math.min(n - 1, Math.floor(0.95 * (n - 1)));

  return {
    count: n,
    current: v[n - 1],
    min,
    max,
    avg: sum / n,
    p95: sorted[idx],
  };
}
