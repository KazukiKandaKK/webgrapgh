// Shared message types between the main thread and the data Worker.
// Kept dependency-free so it can be imported from both sides.

export const METRICS = ["cpu", "memory", "network", "disk"] as const;
export type MetricName = (typeof METRICS)[number];

/** REST /api/history response shape. */
export type HistoryResponse = {
  metrics: Record<MetricName, { t: number[]; v: number[] }>;
};

/** WebSocket frame shape from the Go backend. */
export type WireSample = {
  t: number;
  v: Record<string, number>;
};

// ---------- main thread → worker ----------

export type MainToWorker =
  | {
      type: "init";
      wsUrl: string;
      apiBase: string;
      metrics: readonly MetricName[];
      /** Max points retained per metric in the ring buffer. */
      bufferSize: number;
      /** Max points pushed to the main thread per frame (downsample target). */
      maxRenderPoints: number;
      /** Throttle main-thread flushes to this rate (Hz). */
      flushHz: number;
    }
  | { type: "stop" };

// ---------- worker → main thread ----------

export type WorkerToMain =
  | { type: "status"; state: "connecting" | "open" | "closed" | "error"; detail?: string }
  /**
   * The render payload. Float64Arrays are transferable so they cost nothing to
   * hand off. The main thread feeds them straight to `uplot.setData`.
   */
  | {
      type: "frame";
      metrics: Record<MetricName, { t: Float64Array; v: Float64Array }>;
    };
