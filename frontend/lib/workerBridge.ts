"use client";

import type {
  LogEvent,
  MainToWorker,
  MetricName,
  MetricSABs,
  WorkerToMain,
} from "@/lib/types";

export type FrameHandler = (
  metrics: Record<MetricName, { t: Float64Array; v: Float64Array }>
) => void;

export type StatusHandler = (
  channel: "metrics" | "logs",
  state: "connecting" | "open" | "closed" | "error",
  detail?: string
) => void;

export type LogTotalHandler = (total: number) => void;
export type LogSliceHandler = (
  requestId: number,
  offset: number,
  items: LogEvent[]
) => void;

export type StartOptions = {
  wsUrl: string;
  wsLogsUrl: string;
  apiBase: string;
  metrics: readonly MetricName[];
  bufferSize?: number;
  maxRenderPoints?: number;
  flushHz?: number;
  logBufferSize?: number;
  logTotalHz?: number;
};

/**
 * Long-lived controller around the data Worker. Multiple components
 * (DashboardGrid, LogTable) subscribe via on*() — the worker is shared.
 */
export type WorkerController = {
  stop: () => void;
  /** Ask the worker for a slice of the log ring. */
  requestLogs: (requestId: number, offset: number, limit: number) => void;
  /** Restrict chart frames to the last `windowMs`. null = unfiltered. */
  setRange: (windowMs: number | null) => void;
  onFrame: (h: FrameHandler) => () => void;
  onStatus: (h: StatusHandler) => () => void;
  onLogTotal: (h: LogTotalHandler) => () => void;
  onLogSlice: (h: LogSliceHandler) => () => void;
};

export function startWorker(opts: StartOptions): WorkerController {
  const worker = new Worker(
    new URL("../workers/dataWorker.ts", import.meta.url),
    { type: "module" }
  );

  const frameHandlers = new Set<FrameHandler>();
  const statusHandlers = new Set<StatusHandler>();
  const logTotalHandlers = new Set<LogTotalHandler>();
  const logSliceHandlers = new Set<LogSliceHandler>();

  // SAB view cache. Populated once on `sabInit`. Reused forever after.
  type ViewPair = { tA: Float64Array; vA: Float64Array; tB: Float64Array; vB: Float64Array };
  const sabViews = new Map<MetricName, ViewPair>();
  // Reused payload object for the sabTick → onFrame handoff. The {t, v}
  // objects are mutated in place to avoid per-tick allocation.
  type Slot = { t: Float64Array; v: Float64Array };
  const sabFramePayload: Record<string, Slot> = {};
  const sabFrameSlots = new Map<MetricName, Slot>();

  worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
    const msg = ev.data;
    switch (msg.type) {
      case "frame":
        frameHandlers.forEach((h) => h(msg.metrics));
        return;
      case "sabInit":
        sabViews.clear();
        sabFrameSlots.clear();
        for (const [name, s] of Object.entries(msg.sabs) as [MetricName, MetricSABs][]) {
          sabViews.set(name, {
            tA: new Float64Array(s.tA),
            vA: new Float64Array(s.vA),
            tB: new Float64Array(s.tB),
            vB: new Float64Array(s.vB),
          });
          sabFrameSlots.set(name, {
            t: new Float64Array(0),
            v: new Float64Array(0),
          });
        }
        return;
      case "sabTick": {
        const useA = (msg.gen & 1) === 1;
        for (const k in sabFramePayload) delete sabFramePayload[k];
        for (const [name, size] of Object.entries(msg.sizes) as [MetricName, number][]) {
          const views = sabViews.get(name);
          const slot = sabFrameSlots.get(name);
          if (!views || !slot) continue;
          const tFull = useA ? views.tA : views.tB;
          const vFull = useA ? views.vA : views.vB;
          // subarray() shares the backing SAB — no copy, no allocation of
          // the underlying memory; just a tiny Float64Array wrapper.
          slot.t = tFull.subarray(0, size);
          slot.v = vFull.subarray(0, size);
          sabFramePayload[name] = slot;
        }
        frameHandlers.forEach((h) =>
          h(sabFramePayload as Record<MetricName, { t: Float64Array; v: Float64Array }>)
        );
        return;
      }
      case "status":
        statusHandlers.forEach((h) => h(msg.channel, msg.state, msg.detail));
        return;
      case "logTotal":
        logTotalHandlers.forEach((h) => h(msg.total));
        return;
      case "logSlice":
        logSliceHandlers.forEach((h) => h(msg.requestId, msg.offset, msg.items));
        return;
    }
  };

  const init: MainToWorker = {
    type: "init",
    wsUrl: opts.wsUrl,
    wsLogsUrl: opts.wsLogsUrl,
    apiBase: opts.apiBase,
    metrics: opts.metrics,
    bufferSize: opts.bufferSize ?? 5000,
    maxRenderPoints: opts.maxRenderPoints ?? 2000,
    flushHz: opts.flushHz ?? 30,
    logBufferSize: opts.logBufferSize ?? 30000,
    logTotalHz: opts.logTotalHz ?? 5,
  };
  worker.postMessage(init);

  return {
    stop() {
      worker.postMessage({ type: "stop" } satisfies MainToWorker);
      worker.terminate();
    },
    requestLogs(requestId, offset, limit) {
      worker.postMessage({
        type: "getLogs",
        requestId,
        offset,
        limit,
      } satisfies MainToWorker);
    },
    setRange(windowMs) {
      worker.postMessage({ type: "setRange", windowMs } satisfies MainToWorker);
    },
    onFrame(h) {
      frameHandlers.add(h);
      return () => {
        frameHandlers.delete(h);
      };
    },
    onStatus(h) {
      statusHandlers.add(h);
      return () => {
        statusHandlers.delete(h);
      };
    },
    onLogTotal(h) {
      logTotalHandlers.add(h);
      return () => {
        logTotalHandlers.delete(h);
      };
    },
    onLogSlice(h) {
      logSliceHandlers.add(h);
      return () => {
        logSliceHandlers.delete(h);
      };
    },
  };
}
