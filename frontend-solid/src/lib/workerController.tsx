import {
  createSignal,
  createContext,
  useContext,
  onCleanup,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { METRICS } from "@shared/types";
import {
  createBridgeCore,
  type BridgeCore,
  type FrameHandler,
  type LogSliceHandler,
} from "@shared/bridgeCore";

export type { FrameHandler, LogSliceHandler } from "@shared/bridgeCore";

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

  const bridge: BridgeCore = createBridgeCore(worker, {
    ...opts,
    metrics: METRICS,
  });

  // Wire the bridge's status and logTotal callbacks into Solid signals.
  bridge.onStatus((channel, state, detail) => {
    setStatus((prev) => ({ ...prev, [channel]: { state, detail } }));
  });
  bridge.onLogTotal((total) => {
    setLogTotal(total);
  });

  return {
    status,
    logTotal,
    requestLogs: bridge.requestLogs,
    setRange: bridge.setRange,
    stop: bridge.stop,
    onFrame: bridge.onFrame,
    onLogSlice: bridge.onLogSlice,
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
