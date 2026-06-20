/// <reference lib="webworker" />

import type {
  HistoryResponse,
  MainToWorker,
  MetricName,
  WireSample,
  WorkerToMain,
} from "@/lib/types";

declare const self: DedicatedWorkerGlobalScope;

type RingBuffer = {
  t: Float64Array;
  v: Float64Array;
  /** Index of the next write slot (modulo capacity). */
  head: number;
  /** Number of points currently populated (≤ capacity). */
  size: number;
};

type State = {
  metrics: readonly MetricName[];
  buffers: Map<MetricName, RingBuffer>;
  bufferSize: number;
  maxRenderPoints: number;
  flushIntervalMs: number;
  ws: WebSocket | null;
  reconnectDelayMs: number;
  flushTimer: number | null;
  dirty: boolean;
  apiBase: string;
  wsUrl: string;
  stopped: boolean;
};

const state: State = {
  metrics: [],
  buffers: new Map(),
  bufferSize: 5000,
  maxRenderPoints: 2000,
  flushIntervalMs: 33, // ~30Hz cap
  ws: null,
  reconnectDelayMs: 500,
  flushTimer: null,
  dirty: false,
  apiBase: "",
  wsUrl: "",
  stopped: false,
};

self.addEventListener("message", (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    initialize(msg);
  } else if (msg.type === "stop") {
    teardown();
  }
});

function initialize(msg: Extract<MainToWorker, { type: "init" }>) {
  state.stopped = false;
  state.metrics = msg.metrics;
  state.bufferSize = msg.bufferSize;
  state.maxRenderPoints = msg.maxRenderPoints;
  state.flushIntervalMs = Math.max(1, Math.round(1000 / msg.flushHz));
  state.apiBase = msg.apiBase;
  state.wsUrl = msg.wsUrl;

  state.buffers.clear();
  for (const name of state.metrics) {
    state.buffers.set(name, makeBuffer(state.bufferSize));
  }

  startFlushLoop();
  void loadHistory().then(() => connect());
}

function teardown() {
  state.stopped = true;
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }
  if (state.flushTimer !== null) {
    self.clearInterval(state.flushTimer);
    state.flushTimer = null;
  }
}

function makeBuffer(capacity: number): RingBuffer {
  return {
    t: new Float64Array(capacity),
    v: new Float64Array(capacity),
    head: 0,
    size: 0,
  };
}

function pushPoint(buf: RingBuffer, t: number, v: number) {
  const cap = buf.t.length;
  buf.t[buf.head] = t;
  buf.v[buf.head] = v;
  buf.head = (buf.head + 1) % cap;
  if (buf.size < cap) buf.size++;
}

async function loadHistory() {
  try {
    post({ type: "status", state: "connecting", detail: "history" });
    const url = `${state.apiBase}/api/history?metrics=${state.metrics.join(
      ","
    )}&minutes=60`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`history ${res.status}`);
    const body = (await res.json()) as HistoryResponse;
    for (const name of state.metrics) {
      const series = body.metrics[name];
      if (!series) continue;
      const buf = state.buffers.get(name);
      if (!buf) continue;
      // History can exceed the ring buffer; keep only the most recent N points.
      const start = Math.max(0, series.t.length - buf.t.length);
      for (let i = start; i < series.t.length; i++) {
        pushPoint(buf, series.t[i], series.v[i]);
      }
    }
    state.dirty = true;
  } catch (err) {
    post({
      type: "status",
      state: "error",
      detail: `history: ${(err as Error).message}`,
    });
  }
}

function connect() {
  if (state.stopped) return;
  post({ type: "status", state: "connecting", detail: "ws" });
  let ws: WebSocket;
  try {
    ws = new WebSocket(state.wsUrl);
  } catch (err) {
    scheduleReconnect();
    return;
  }
  state.ws = ws;

  ws.onopen = () => {
    state.reconnectDelayMs = 500;
    post({ type: "status", state: "open" });
  };
  ws.onerror = () => {
    post({ type: "status", state: "error" });
  };
  ws.onclose = () => {
    post({ type: "status", state: "closed" });
    state.ws = null;
    scheduleReconnect();
  };
  ws.onmessage = (ev) => onMessage(ev.data as string);
}

function scheduleReconnect() {
  if (state.stopped) return;
  const delay = state.reconnectDelayMs;
  state.reconnectDelayMs = Math.min(delay * 2, 10_000);
  self.setTimeout(connect, delay);
}

function onMessage(data: string) {
  // JSON.parse happens HERE (in the worker), not on the main thread —
  // that's the entire reason this file exists.
  let msg: WireSample;
  try {
    msg = JSON.parse(data) as WireSample;
  } catch {
    return;
  }
  const t = msg.t;
  for (const name of state.metrics) {
    const v = msg.v[name];
    if (typeof v !== "number") continue;
    const buf = state.buffers.get(name);
    if (!buf) continue;
    pushPoint(buf, t, v);
  }
  state.dirty = true;
}

function startFlushLoop() {
  if (state.flushTimer !== null) self.clearInterval(state.flushTimer);
  state.flushTimer = self.setInterval(flush, state.flushIntervalMs) as unknown as number;
}

/**
 * Drain ring buffers into chronological Float64Arrays, downsample by stride
 * if necessary, and ship them to the main thread. Float64Arrays go through
 * postMessage's transferable list so the buffers move without a copy.
 */
function flush() {
  if (!state.dirty) return;
  state.dirty = false;

  const payload: Record<string, { t: Float64Array; v: Float64Array }> = {};
  const transfers: ArrayBuffer[] = [];

  for (const name of state.metrics) {
    const buf = state.buffers.get(name);
    if (!buf || buf.size === 0) continue;

    const stride = Math.max(1, Math.ceil(buf.size / state.maxRenderPoints));
    const outLen = Math.ceil(buf.size / stride);
    const t = new Float64Array(outLen);
    const v = new Float64Array(outLen);

    // Walk the ring chronologically: oldest sample is at `head` when full,
    // otherwise at index 0.
    const cap = buf.t.length;
    const startIdx = buf.size < cap ? 0 : buf.head;
    let writeIdx = 0;
    for (let i = 0; i < buf.size; i += stride) {
      const readIdx = (startIdx + i) % cap;
      // uPlot wants seconds-since-epoch on the time axis.
      t[writeIdx] = buf.t[readIdx] / 1000;
      v[writeIdx] = buf.v[readIdx];
      writeIdx++;
    }

    payload[name] = { t, v };
    transfers.push(t.buffer, v.buffer);
  }

  if (Object.keys(payload).length === 0) return;
  const message: WorkerToMain = { type: "frame", metrics: payload as never };
  self.postMessage(message, transfers);
}

function post(msg: WorkerToMain) {
  self.postMessage(msg);
}
