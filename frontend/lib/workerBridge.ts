"use client";

import type {
  LogEvent,
  MainToWorker,
  MetricName,
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

  worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
    const msg = ev.data;
    switch (msg.type) {
      case "frame":
        frameHandlers.forEach((h) => h(msg.metrics));
        return;
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
