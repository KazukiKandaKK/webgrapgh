import {
  createSignal,
  createContext,
  useContext,
  onCleanup,
  type Accessor,
  type ParentProps,
} from "solid-js";
import type {
  LogEvent,
  MainToWorker,
  MetricName,
  MetricSABs,
  WorkerToMain,
} from "./types";
import { METRICS } from "./types";

/**
 * Same handler shapes as the React bridge — consumers subscribe to discrete
 * worker events. State that the UI reads reactively (status, log total) is
 * exposed as Solid signals so components can just call `controller.logTotal()`
 * inside JSX / `createEffect` instead of wiring a subscribe.
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

export type WorkerController = {
  // ---------- reactive state (Solid signals) ----------
  status: Accessor<StatusState>;
  logTotal: Accessor<number>;

  // ---------- imperative outbound ----------
  requestLogs: (requestId: number, offset: number, limit: number) => void;
  setRange: (windowMs: number | null) => void;
  stop: () => void;

  // ---------- subscribe APIs (cleanup on returned fn) ----------
  onFrame: (h: FrameHandler) => () => void;
  onLogSlice: (h: LogSliceHandler) => () => void;
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

export function createWorkerController(opts: StartOptions): WorkerController {
  // Vite + worker plugin: emits the dataWorker as a separate hashed chunk.
  const worker = new Worker(
    new URL("../workers/dataWorker.ts", import.meta.url),
    { type: "module" },
  );

  const [status, setStatus] = createSignal<StatusState>({
    metrics: { state: "init" },
    logs: { state: "init" },
  });
  const [logTotal, setLogTotal] = createSignal(0);

  const frameHandlers = new Set<FrameHandler>();
  const logSliceHandlers = new Set<LogSliceHandler>();

  // SAB view cache + reused frame payload (zero per-tick allocation on the
  // main side). Mirrors the React bridge's structure 1:1.
  type ViewPair = { tA: Float64Array; vA: Float64Array; tB: Float64Array; vB: Float64Array };
  const sabViews = new Map<MetricName, ViewPair>();
  type Slot = { t: Float64Array; v: Float64Array };
  const sabFramePayload: Record<string, Slot> = {};
  const sabFrameSlots = new Map<MetricName, Slot>();

  let sabInitSeen = false;
  let firstFrameSeen = false;

  worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
    const msg = ev.data;
    switch (msg.type) {
      case "frame":
        if (!firstFrameSeen) {
          firstFrameSeen = true;
          // eslint-disable-next-line no-console
          console.info(
            `[bridge] first frame (transfer path), ${
              Object.keys(msg.metrics).length
            } metrics, ${frameHandlers.size} handler(s)`,
          );
        }
        frameHandlers.forEach((h) => h(msg.metrics));
        return;
      case "sabInit": {
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
        sabInitSeen = true;
        // eslint-disable-next-line no-console
        console.info(`[bridge] sabInit received (${sabViews.size} metrics)`);
        return;
      }
      case "sabTick": {
        const useA = (msg.gen & 1) === 1;
        for (const k in sabFramePayload) delete sabFramePayload[k];
        for (const [name, size] of Object.entries(msg.sizes) as [MetricName, number][]) {
          const views = sabViews.get(name);
          const slot = sabFrameSlots.get(name);
          if (!views || !slot) continue;
          const tFull = useA ? views.tA : views.tB;
          const vFull = useA ? views.vA : views.vB;
          slot.t = tFull.subarray(0, size);
          slot.v = vFull.subarray(0, size);
          sabFramePayload[name] = slot;
        }
        if (!firstFrameSeen) {
          firstFrameSeen = true;
          // eslint-disable-next-line no-console
          console.info(
            `[bridge] first sabTick (gen=${msg.gen}, ${
              Object.keys(sabFramePayload).length
            } metrics, ${frameHandlers.size} handler(s))`,
          );
        }
        frameHandlers.forEach((h) =>
          h(sabFramePayload as Record<MetricName, { t: Float64Array; v: Float64Array }>),
        );
        return;
      }
      case "status":
        setStatus((prev) => ({ ...prev, [msg.channel]: { state: msg.state, detail: msg.detail } }));
        return;
      case "logTotal":
        setLogTotal(msg.total);
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
    metrics: METRICS,
    bufferSize: opts.bufferSize ?? 5000,
    maxRenderPoints: opts.maxRenderPoints ?? 1000,
    flushHz: opts.flushHz ?? 30,
    logBufferSize: opts.logBufferSize ?? 30000,
    logTotalHz: opts.logTotalHz ?? 2,
  };
  worker.postMessage(init);

  return {
    status,
    logTotal,
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
    stop() {
      worker.postMessage({ type: "stop" } satisfies MainToWorker);
      worker.terminate();
    },
    onFrame(h) {
      frameHandlers.add(h);
      // eslint-disable-next-line no-console
      console.info(
        `[bridge] onFrame subscribed (total=${frameHandlers.size}, sabInitSeen=${sabInitSeen})`,
      );
      // Kick the worker so a late-attaching handler doesn't miss the first
      // already-drained frame.
      worker.postMessage({ type: "kick" } satisfies MainToWorker);
      return () => {
        frameHandlers.delete(h);
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

// ---------- Context wrapper ----------

const WorkerContext = createContext<WorkerController>();

export function WorkerProvider(props: ParentProps) {
  const env = import.meta.env;
  const wsUrl = (env.VITE_WS_URL as string) ?? "ws://localhost:8080/ws";
  const wsLogsUrl =
    (env.VITE_WS_LOGS_URL as string) ?? wsUrl.replace(/\/ws$/, "/ws/logs");
  const apiBase = (env.VITE_API_BASE as string) ?? "http://localhost:8080";

  const controller = createWorkerController({ apiBase, wsUrl, wsLogsUrl });
  onCleanup(() => controller.stop());

  return (
    <WorkerContext.Provider value={controller}>
      {props.children}
    </WorkerContext.Provider>
  );
}

export function useWorker(): WorkerController {
  const c = useContext(WorkerContext);
  if (!c) throw new Error("useWorker must be inside <WorkerProvider>");
  return c;
}
