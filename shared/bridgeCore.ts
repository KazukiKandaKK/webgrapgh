import type {
  LogEvent,
  MainToWorker,
  MetricName,
  MetricSABs,
  WorkerToMain,
} from "./types";

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

export type BridgeCore = {
  stop: () => void;
  requestLogs: (requestId: number, offset: number, limit: number) => void;
  setRange: (windowMs: number | null) => void;
  onFrame: (h: FrameHandler) => () => void;
  onStatus: (h: StatusHandler) => () => void;
  onLogTotal: (h: LogTotalHandler) => () => void;
  onLogSlice: (h: LogSliceHandler) => () => void;
};

/**
 * Framework-agnostic bridge core. Handles the Worker message dispatch,
 * SAB handshake, and subscriber fan-out. Both React and Solid frontends
 * wrap this with their own context/provider layer.
 */
export function createBridgeCore(
  worker: Worker,
  opts: StartOptions
): BridgeCore {
  const frameHandlers = new Set<FrameHandler>();
  const statusHandlers = new Set<StatusHandler>();
  const logTotalHandlers = new Set<LogTotalHandler>();
  const logSliceHandlers = new Set<LogSliceHandler>();

  // SAB view cache. Populated once on `sabInit`. Reused forever after.
  type ViewPair = { tA: Float64Array; vA: Float64Array; tB: Float64Array; vB: Float64Array };
  const sabViews = new Map<MetricName, ViewPair>();
  // Reused payload object for the sabTick → onFrame handoff.
  type Slot = { t: Float64Array; v: Float64Array };
  const sabFramePayload: Record<string, Slot> = {};
  const sabFrameSlots = new Map<MetricName, Slot>();

  let sabInitSeen = false;
  let firstFrameSeen = false;

  worker.onerror = (ev: ErrorEvent) => {
    // eslint-disable-next-line no-console
    console.error("[bridge] worker error:", ev.message, ev);
    statusHandlers.forEach((h) => h("metrics", "error", `worker: ${ev.message}`));
    statusHandlers.forEach((h) => h("logs", "error", `worker: ${ev.message}`));
  };

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
            } metrics, ${frameHandlers.size} handler(s)`
          );
        }
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
        sabInitSeen = true;
        // eslint-disable-next-line no-console
        console.info(
          `[bridge] sabInit received (${sabViews.size} metrics)`
        );
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
            } metrics, ${frameHandlers.size} handler(s))`
          );
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
      // eslint-disable-next-line no-console
      console.info(
        `[bridge] onFrame subscribed (total=${frameHandlers.size}, sabInitSeen=${sabInitSeen})`
      );
      // Kick the worker so a late-attaching handler doesn't miss the first
      // already-drained frame.
      worker.postMessage({ type: "kick" } satisfies MainToWorker);
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
