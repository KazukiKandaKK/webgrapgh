import { getContext, setContext } from "svelte";
import type {
  LogEvent,
  MainToWorker,
  MetricName,
  MetricSABs,
  WorkerToMain,
} from "./types";
import { METRICS } from "./types";

/**
 * Same handler shapes as the React/Solid bridges — consumers subscribe to
 * discrete worker events. State that the UI reads reactively (status, log
 * total) is exposed as Svelte 5 runes (`$state`) on the controller instance,
 * so components can read `controller.status.metrics.state` directly inside
 * markup or an `$effect` instead of wiring a subscribe.
 */
export type FrameHandler = (
  metrics: Record<MetricName, { t: Float64Array; v: Float64Array }>,
) => void;

export type LogSliceHandler = (
  requestId: number,
  offset: number,
  items: LogEvent[],
) => void;

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

type ViewPair = {
  tA: Float64Array;
  vA: Float64Array;
  tB: Float64Array;
  vB: Float64Array;
};
type Slot = { t: Float64Array; v: Float64Array };

export class WorkerController {
  // ---------- reactive state (Svelte runes) ----------
  status = $state<StatusState>({
    metrics: { state: "init" },
    logs: { state: "init" },
  });
  logTotal = $state(0);

  // ---------- internals ----------
  private worker: Worker;
  private frameHandlers = new Set<FrameHandler>();
  private logSliceHandlers = new Set<LogSliceHandler>();

  // SAB view cache + reused frame payload (zero per-tick allocation on the
  // main side). Mirrors the React/Solid bridge structure 1:1.
  private sabViews = new Map<MetricName, ViewPair>();
  private sabFramePayload: Record<string, Slot> = {};
  private sabFrameSlots = new Map<MetricName, Slot>();

  private sabInitSeen = false;
  private firstFrameSeen = false;

  constructor(opts: StartOptions) {
    // Vite + worker plugin: emits the dataWorker as a separate hashed chunk.
    this.worker = new Worker(
      new URL("../workers/dataWorker.ts", import.meta.url),
      { type: "module" },
    );

    this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      const msg = ev.data;
      switch (msg.type) {
        case "frame":
          if (!this.firstFrameSeen) {
            this.firstFrameSeen = true;
            // eslint-disable-next-line no-console
            console.info(
              `[bridge] first frame (transfer path), ${
                Object.keys(msg.metrics).length
              } metrics, ${this.frameHandlers.size} handler(s)`,
            );
          }
          this.frameHandlers.forEach((h) => h(msg.metrics));
          return;
        case "sabInit": {
          this.sabViews.clear();
          this.sabFrameSlots.clear();
          for (const [name, s] of Object.entries(msg.sabs) as [
            MetricName,
            MetricSABs,
          ][]) {
            this.sabViews.set(name, {
              tA: new Float64Array(s.tA),
              vA: new Float64Array(s.vA),
              tB: new Float64Array(s.tB),
              vB: new Float64Array(s.vB),
            });
            this.sabFrameSlots.set(name, {
              t: new Float64Array(0),
              v: new Float64Array(0),
            });
          }
          this.sabInitSeen = true;
          // eslint-disable-next-line no-console
          console.info(`[bridge] sabInit received (${this.sabViews.size} metrics)`);
          return;
        }
        case "sabTick": {
          const useA = (msg.gen & 1) === 1;
          for (const k in this.sabFramePayload) delete this.sabFramePayload[k];
          for (const [name, size] of Object.entries(msg.sizes) as [
            MetricName,
            number,
          ][]) {
            const views = this.sabViews.get(name);
            const slot = this.sabFrameSlots.get(name);
            if (!views || !slot) continue;
            const tFull = useA ? views.tA : views.tB;
            const vFull = useA ? views.vA : views.vB;
            slot.t = tFull.subarray(0, size);
            slot.v = vFull.subarray(0, size);
            this.sabFramePayload[name] = slot;
          }
          if (!this.firstFrameSeen) {
            this.firstFrameSeen = true;
            // eslint-disable-next-line no-console
            console.info(
              `[bridge] first sabTick (gen=${msg.gen}, ${
                Object.keys(this.sabFramePayload).length
              } metrics, ${this.frameHandlers.size} handler(s))`,
            );
          }
          this.frameHandlers.forEach((h) =>
            h(
              this.sabFramePayload as Record<
                MetricName,
                { t: Float64Array; v: Float64Array }
              >,
            ),
          );
          return;
        }
        case "status":
          this.status = {
            ...this.status,
            [msg.channel]: { state: msg.state, detail: msg.detail },
          };
          return;
        case "logTotal":
          this.logTotal = msg.total;
          return;
        case "logSlice":
          this.logSliceHandlers.forEach((h) =>
            h(msg.requestId, msg.offset, msg.items),
          );
          return;
      }
    };

    const init: MainToWorker = {
      type: "init",
      wsUrl: opts.wsUrl,
      wsLogsUrl: opts.wsLogsUrl,
      apiBase: opts.apiBase,
      metrics: METRICS,
      bufferSize: opts.bufferSize ?? 5000,
      maxRenderPoints: opts.maxRenderPoints ?? 1000,
      flushHz: opts.flushHz ?? 30,
      logBufferSize: opts.logBufferSize ?? 30000,
      logTotalHz: opts.logTotalHz ?? 2,
    };
    this.worker.postMessage(init);
  }

  // ---------- imperative outbound ----------

  requestLogs(requestId: number, offset: number, limit: number) {
    this.worker.postMessage({
      type: "getLogs",
      requestId,
      offset,
      limit,
    } satisfies MainToWorker);
  }

  setRange(windowMs: number | null) {
    this.worker.postMessage({ type: "setRange", windowMs } satisfies MainToWorker);
  }

  stop() {
    this.worker.postMessage({ type: "stop" } satisfies MainToWorker);
    this.worker.terminate();
  }

  // ---------- subscribe APIs (cleanup on returned fn) ----------

  onFrame(h: FrameHandler): () => void {
    this.frameHandlers.add(h);
    // eslint-disable-next-line no-console
    console.info(
      `[bridge] onFrame subscribed (total=${this.frameHandlers.size}, sabInitSeen=${this.sabInitSeen})`,
    );
    // Kick the worker so a late-attaching handler doesn't miss the first
    // already-drained frame.
    this.worker.postMessage({ type: "kick" } satisfies MainToWorker);
    return () => {
      this.frameHandlers.delete(h);
    };
  }

  onLogSlice(h: LogSliceHandler): () => void {
    this.logSliceHandlers.add(h);
    return () => {
      this.logSliceHandlers.delete(h);
    };
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
