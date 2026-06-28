// Shared message types between the main thread and the data Worker.
// Kept dependency-free so it can be imported from both sides.

export const METRICS = [
  "cpu",
  "memory",
  "disk",
  "network",
  "gpu",
  "requests",
  "errors",
  "latency_p50",
  "latency_p99",
  "queue",
] as const;
export type MetricName = (typeof METRICS)[number];

/** REST /api/history response shape. */
export type HistoryResponse = {
  metrics: Record<MetricName, { t: number[]; v: number[] }>;
};

/** WebSocket frame shape from the Go metrics endpoint. */
export type WireSample = {
  t: number;
  v: Record<string, number>;
};

/** Single log event — matches Go's logs.Event JSON shape. */
export type LogEvent = {
  id: number;
  t: number; // unix ms
  level: string; // INFO / WARN / ERROR / DEBUG
  src: string;
  msg: string;
};

// ---------- main thread → worker ----------

export type MainToWorker =
  | {
      type: "init";
      wsUrl: string;
      wsLogsUrl: string;
      apiBase: string;
      metrics: readonly MetricName[];
      /** Max metric points retained per metric in the ring buffer. */
      bufferSize: number;
      /** Max points pushed to the main thread per frame (downsample target). */
      maxRenderPoints: number;
      /** Throttle main-thread frame flushes to this rate (Hz). */
      flushHz: number;
      /** Max log events retained in the worker ring. */
      logBufferSize: number;
      /** Throttle logTotal notifications to this rate (Hz). */
      logTotalHz: number;
    }
  | { type: "stop" }
  | { type: "getLogs"; requestId: number; offset: number; limit: number }
  /** Force the next flush even if no new data arrived — used by the bridge
   *  when a new frame subscriber registers so the chart can paint immediately. */
  | { type: "kick" }
  /**
   * Set the visible time window for chart frames. `null` removes the filter
   * (show every point in the worker buffer). When set, the worker keeps only
   * points with `t >= newest - windowMs` on each flush.
   */
  | { type: "setRange"; windowMs: number | null };

// ---------- worker → main thread ----------

/**
 * Per-metric SAB pair (double-buffered). Worker writes alternating slots; main
 * reads the one identified by `sabTick.gen % 2`.
 */
export type MetricSABs = {
  /** Capacity (max points each slot can hold). */
  capacity: number;
  /** Slot 0: timestamps (seconds). */
  tA: SharedArrayBuffer;
  /** Slot 0: values. */
  vA: SharedArrayBuffer;
  /** Slot 1: timestamps. */
  tB: SharedArrayBuffer;
  /** Slot 1: values. */
  vB: SharedArrayBuffer;
};

export type WorkerToMain =
  | {
      type: "status";
      channel: "metrics" | "logs";
      state: "connecting" | "open" | "closed" | "error";
      detail?: string;
    }
  /**
   * One-time handshake: hands over per-metric SharedArrayBuffer pairs. The
   * bridge wraps these in Float64Array views and caches them. Sent only when
   * `crossOriginIsolated && SharedArrayBuffer` are available; otherwise the
   * worker emits `frame` messages via the transferable fallback path.
   */
  | { type: "sabInit"; sabs: Record<MetricName, MetricSABs> }
  /**
   * Per-flush notification: which generation slot to read from and how many
   * points are valid in each metric's slot. Tiny payload (~200 bytes).
   */
  | { type: "sabTick"; gen: number; sizes: Record<MetricName, number> }
  /**
   * Fallback frame for non-SAB environments. Float64Arrays are transferable
   * so cost nothing to hand off, but the wrapper + ArrayBuffer pair still
   * allocates per flush.
   */
  | {
      type: "frame";
      metrics: Record<MetricName, { t: Float64Array; v: Float64Array }>;
    }
  /** Throttled log-count notification — drives the virtualizer's row count. */
  | { type: "logTotal"; total: number }
  /** Response to a `getLogs` request. requestId matches the original message. */
  | { type: "logSlice"; requestId: number; offset: number; items: LogEvent[] };
