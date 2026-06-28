import type { MetricName } from "./types";

// ---------- Metric metadata (used by DashboardGrid in both frontends) ----------

export type MetricMeta = {
  label: string;
  color: string;
  unit: string;
  /** [min, max]; null on either side means auto-fit. */
  yRange: [number | null, number | null];
};

export const METRIC_META: Record<MetricName, MetricMeta> = {
  cpu: { label: "CPU", color: "#38bdf8", unit: "%", yRange: [0, 100] },
  memory: { label: "Memory", color: "#a78bfa", unit: "%", yRange: [0, 100] },
  disk: { label: "Disk", color: "#facc15", unit: "%", yRange: [0, 100] },
  network: {
    label: "Network",
    color: "#f472b6",
    unit: "MB/s",
    yRange: [0, null],
  },
  gpu: { label: "GPU", color: "#34d399", unit: "%", yRange: [0, 100] },
  requests: {
    label: "Requests",
    color: "#60a5fa",
    unit: "req/s",
    yRange: [0, null],
  },
  errors: {
    label: "Errors",
    color: "#fb7185",
    unit: "err/s",
    yRange: [0, null],
  },
  latency_p50: {
    label: "Latency p50",
    color: "#fbbf24",
    unit: "ms",
    yRange: [0, null],
  },
  latency_p99: {
    label: "Latency p99",
    color: "#f97316",
    unit: "ms",
    yRange: [0, null],
  },
  queue: {
    label: "Queue Depth",
    color: "#c084fc",
    unit: "items",
    yRange: [0, null],
  },
};

// ---------- Time range presets (used by TimeRangeControls in both frontends) ----------

export type TimeRangePreset = { label: string; windowMs: number | null };

export const TIME_RANGE_PRESETS: TimeRangePreset[] = [
  { label: "1m", windowMs: 60_000 },
  { label: "5m", windowMs: 5 * 60_000 },
  { label: "15m", windowMs: 15 * 60_000 },
  { label: "1h", windowMs: 60 * 60_000 },
  { label: "All", windowMs: null },
];

// ---------- Layout constants ----------

export const CHART_HEIGHT = 180;
export const LOG_ROW_HEIGHT = 28;
export const LOG_OVERSCAN = 12;
