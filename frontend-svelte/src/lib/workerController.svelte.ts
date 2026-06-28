import {
  type BridgeCore,
  type FrameHandler,
  type LogSliceHandler,
  createBridgeCore,
} from "@shared/bridgeCore";
import { METRICS } from "@shared/types";
import { getContext, setContext } from "svelte";

export type { FrameHandler, LogSliceHandler } from "@shared/bridgeCore";

export type StatusState = {
  metrics: { state: string; detail?: string };
  logs: { state: string; detail?: string };
};

export type StartOptions = {
  wsUrl: string;
  wsLogsUrl: string;
  apiBase: string;
  bufferSize?: number;
  maxRenderPoints?: number;
  flushHz?: number;
  logBufferSize?: number;
  logTotalHz?: number;
};

/**
 * Svelte wrapper around the framework-agnostic bridge core (`@shared`). The
 * message dispatch / SAB handshake lives in the shared module; here we only
 * expose the reactive surface as Svelte 5 runes (`$state`) so components can
 * read `controller.status.metrics.state` directly in markup.
 */
export class WorkerController {
  // ---------- reactive state (Svelte runes) ----------
  status = $state<StatusState>({
    metrics: { state: "init" },
    logs: { state: "init" },
  });
  logTotal = $state(0);

  private bridge: BridgeCore;

  constructor(opts: StartOptions) {
    // Vite + worker plugin: emits the dataWorker as a separate hashed chunk.
    const worker = new Worker(
      new URL("../workers/dataWorker.ts", import.meta.url),
      { type: "module" },
    );

    this.bridge = createBridgeCore(worker, { ...opts, metrics: METRICS });

    this.bridge.onStatus((channel, state, detail) => {
      this.status = { ...this.status, [channel]: { state, detail } };
    });
    this.bridge.onLogTotal((total) => {
      this.logTotal = total;
    });
  }

  // ---------- imperative outbound ----------

  requestLogs(requestId: number, offset: number, limit: number) {
    this.bridge.requestLogs(requestId, offset, limit);
  }

  setRange(windowMs: number | null) {
    this.bridge.setRange(windowMs);
  }

  stop() {
    this.bridge.stop();
  }

  // ---------- subscribe APIs (cleanup on returned fn) ----------

  onFrame(h: FrameHandler): () => void {
    return this.bridge.onFrame(h);
  }

  onLogSlice(h: LogSliceHandler): () => void {
    return this.bridge.onLogSlice(h);
  }
}

// ---------- Context wrapper ----------

const WORKER_KEY = Symbol("webgrapgh:worker");

export function provideWorker(controller: WorkerController) {
  setContext(WORKER_KEY, controller);
}

export function useWorker(): WorkerController {
  const c = getContext<WorkerController | undefined>(WORKER_KEY);
  if (!c) throw new Error("useWorker must be used under <App> / provideWorker");
  return c;
}
