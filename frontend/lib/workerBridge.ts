"use client";

import {
  createBridgeCore,
  type BridgeCore,
  type StartOptions,
} from "@shared/bridgeCore";

// Re-export types so existing consumers don't need to change their imports.
export type { FrameHandler, StatusHandler, LogTotalHandler, LogSliceHandler, StartOptions } from "@shared/bridgeCore";
export type WorkerController = BridgeCore;

/**
 * Long-lived controller around the data Worker. Multiple components
 * (DashboardGrid, LogTable) subscribe via on*() — the worker is shared.
 */
export function startWorker(opts: StartOptions): WorkerController {
  const worker = new Worker(
    new URL("../workers/dataWorker.ts", import.meta.url),
    { type: "module" }
  );
  return createBridgeCore(worker, opts);
}
