"use client";

import type { MainToWorker, MetricName, WorkerToMain } from "@/lib/types";

export type FrameHandler = (
  metrics: Record<MetricName, { t: Float64Array; v: Float64Array }>
) => void;

export type StatusHandler = (state: string, detail?: string) => void;

export type BridgeOptions = {
  wsUrl: string;
  apiBase: string;
  metrics: readonly MetricName[];
  bufferSize?: number;
  maxRenderPoints?: number;
  flushHz?: number;
  onFrame: FrameHandler;
  onStatus?: StatusHandler;
};

/**
 * Spawn the data Worker and wire the message channel. Returns a teardown fn.
 *
 * The Worker URL pattern is the one Webpack/Turbopack require to bundle the
 * file as a Web Worker: `new URL('../workers/dataWorker.ts', import.meta.url)`.
 */
export function startWorker(opts: BridgeOptions): () => void {
  const worker = new Worker(
    new URL("../workers/dataWorker.ts", import.meta.url),
    { type: "module" }
  );

  worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
    const msg = ev.data;
    if (msg.type === "frame") {
      opts.onFrame(msg.metrics);
    } else if (msg.type === "status") {
      opts.onStatus?.(msg.state, msg.detail);
    }
  };

  const init: MainToWorker = {
    type: "init",
    wsUrl: opts.wsUrl,
    apiBase: opts.apiBase,
    metrics: opts.metrics,
    bufferSize: opts.bufferSize ?? 5000,
    maxRenderPoints: opts.maxRenderPoints ?? 2000,
    flushHz: opts.flushHz ?? 30,
  };
  worker.postMessage(init);

  return () => {
    worker.postMessage({ type: "stop" } satisfies MainToWorker);
    worker.terminate();
  };
}
