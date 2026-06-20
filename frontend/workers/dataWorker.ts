/// <reference lib="webworker" />

import type {
  HistoryResponse,
  LogEvent,
  MainToWorker,
  MetricName,
  WireSample,
  WorkerToMain,
} from "@/lib/types";

declare const self: DedicatedWorkerGlobalScope;

// ---------- Metric ring buffer ----------

type RingBuffer = {
  t: Float64Array;
  v: Float64Array;
  /** Index of the next write slot (modulo capacity). */
  head: number;
  /** Number of points currently populated (≤ capacity). */
  size: number;
};

// ---------- Log ring buffer ----------

class LogRing {
  private buf: (LogEvent | undefined)[];
  private head = 0;
  private size = 0;
  constructor(public readonly capacity: number) {
    this.buf = new Array(capacity);
  }
  push(ev: LogEvent) {
    this.buf[this.head] = ev;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }
  total(): number {
    return this.size;
  }
  /** Read `limit` events starting at `offset` (0 = oldest in the ring). */
  slice(offset: number, limit: number): LogEvent[] {
    const out: LogEvent[] = [];
    if (limit <= 0 || offset >= this.size) return out;
    const start = this.size < this.capacity ? 0 : this.head;
    for (let i = 0; i < limit; i++) {
      const idx = offset + i;
      if (idx < 0 || idx >= this.size) break;
      const ev = this.buf[(start + idx) % this.capacity];
      if (ev) out.push(ev);
    }
    return out;
  }
}

// ---------- State ----------

type State = {
  metrics: readonly MetricName[];
  buffers: Map<MetricName, RingBuffer>;
  bufferSize: number;
  maxRenderPoints: number;
  flushIntervalMs: number;
  wsMetrics: WebSocket | null;
  wsLogs: WebSocket | null;
  reconnectMetricMs: number;
  reconnectLogMs: number;
  frameFlushTimer: number | null;
  logFlushTimer: number | null;
  frameDirty: boolean;
  logDirty: boolean;
  logRing: LogRing;
  logTotalIntervalMs: number;
  apiBase: string;
  wsUrl: string;
  wsLogsUrl: string;
  stopped: boolean;
};

const state: State = {
  metrics: [],
  buffers: new Map(),
  bufferSize: 5000,
  maxRenderPoints: 2000,
  flushIntervalMs: 33,
  wsMetrics: null,
  wsLogs: null,
  reconnectMetricMs: 500,
  reconnectLogMs: 500,
  frameFlushTimer: null,
  logFlushTimer: null,
  frameDirty: false,
  logDirty: false,
  logRing: new LogRing(30000),
  logTotalIntervalMs: 200,
  apiBase: "",
  wsUrl: "",
  wsLogsUrl: "",
  stopped: false,
};

self.addEventListener("message", (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "init":
      initialize(msg);
      return;
    case "stop":
      teardown();
      return;
    case "getLogs":
      handleGetLogs(msg.requestId, msg.offset, msg.limit);
      return;
  }
});

// ---------- Lifecycle ----------

function initialize(msg: Extract<MainToWorker, { type: "init" }>) {
  state.stopped = false;
  state.metrics = msg.metrics;
  state.bufferSize = msg.bufferSize;
  state.maxRenderPoints = msg.maxRenderPoints;
  state.flushIntervalMs = Math.max(1, Math.round(1000 / msg.flushHz));
  state.logTotalIntervalMs = Math.max(50, Math.round(1000 / msg.logTotalHz));
  state.apiBase = msg.apiBase;
  state.wsUrl = msg.wsUrl;
  state.wsLogsUrl = msg.wsLogsUrl;
  state.logRing = new LogRing(msg.logBufferSize);

  state.buffers.clear();
  for (const name of state.metrics) {
    state.buffers.set(name, makeBuffer(state.bufferSize));
  }

  startFlushLoops();

  // Load both histories in parallel, then connect both sockets.
  void Promise.all([loadMetricHistory(), loadLogHistory()]).then(() => {
    connectMetrics();
    connectLogs();
  });
}

function teardown() {
  state.stopped = true;
  if (state.wsMetrics) {
    state.wsMetrics.onclose = null;
    state.wsMetrics.close();
    state.wsMetrics = null;
  }
  if (state.wsLogs) {
    state.wsLogs.onclose = null;
    state.wsLogs.close();
    state.wsLogs = null;
  }
  if (state.frameFlushTimer !== null) {
    self.clearInterval(state.frameFlushTimer);
    state.frameFlushTimer = null;
  }
  if (state.logFlushTimer !== null) {
    self.clearInterval(state.logFlushTimer);
    state.logFlushTimer = null;
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

// ---------- History loaders ----------

async function loadMetricHistory() {
  try {
    post({ type: "status", channel: "metrics", state: "connecting", detail: "history" });
    const url = `${state.apiBase}/api/history?metrics=${state.metrics.join(",")}&minutes=60`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`history ${res.status}`);
    const body = (await res.json()) as HistoryResponse;
    for (const name of state.metrics) {
      const series = body.metrics[name];
      if (!series) continue;
      const buf = state.buffers.get(name);
      if (!buf) continue;
      const start = Math.max(0, series.t.length - buf.t.length);
      for (let i = start; i < series.t.length; i++) {
        pushPoint(buf, series.t[i], series.v[i]);
      }
    }
    state.frameDirty = true;
  } catch (err) {
    post({
      type: "status",
      channel: "metrics",
      state: "error",
      detail: `history: ${(err as Error).message}`,
    });
  }
}

async function loadLogHistory() {
  try {
    post({ type: "status", channel: "logs", state: "connecting", detail: "history" });
    const url = `${state.apiBase}/api/logs/history?limit=${state.logRing.capacity}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`logs history ${res.status}`);
    const items = (await res.json()) as LogEvent[];
    for (const ev of items) state.logRing.push(ev);
    state.logDirty = true;
  } catch (err) {
    post({
      type: "status",
      channel: "logs",
      state: "error",
      detail: `history: ${(err as Error).message}`,
    });
  }
}

// ---------- Sockets ----------

function connectMetrics() {
  if (state.stopped) return;
  post({ type: "status", channel: "metrics", state: "connecting", detail: "ws" });
  let ws: WebSocket;
  try {
    ws = new WebSocket(state.wsUrl);
  } catch {
    scheduleReconnect("metrics");
    return;
  }
  state.wsMetrics = ws;
  ws.onopen = () => {
    state.reconnectMetricMs = 500;
    post({ type: "status", channel: "metrics", state: "open" });
  };
  ws.onerror = () => post({ type: "status", channel: "metrics", state: "error" });
  ws.onclose = () => {
    post({ type: "status", channel: "metrics", state: "closed" });
    state.wsMetrics = null;
    scheduleReconnect("metrics");
  };
  ws.onmessage = (ev) => onMetricMessage(ev.data as string);
}

function connectLogs() {
  if (state.stopped) return;
  post({ type: "status", channel: "logs", state: "connecting", detail: "ws" });
  let ws: WebSocket;
  try {
    ws = new WebSocket(state.wsLogsUrl);
  } catch {
    scheduleReconnect("logs");
    return;
  }
  state.wsLogs = ws;
  ws.onopen = () => {
    state.reconnectLogMs = 500;
    post({ type: "status", channel: "logs", state: "open" });
  };
  ws.onerror = () => post({ type: "status", channel: "logs", state: "error" });
  ws.onclose = () => {
    post({ type: "status", channel: "logs", state: "closed" });
    state.wsLogs = null;
    scheduleReconnect("logs");
  };
  ws.onmessage = (ev) => onLogMessage(ev.data as string);
}

function scheduleReconnect(which: "metrics" | "logs") {
  if (state.stopped) return;
  if (which === "metrics") {
    const delay = state.reconnectMetricMs;
    state.reconnectMetricMs = Math.min(delay * 2, 10_000);
    self.setTimeout(connectMetrics, delay);
  } else {
    const delay = state.reconnectLogMs;
    state.reconnectLogMs = Math.min(delay * 2, 10_000);
    self.setTimeout(connectLogs, delay);
  }
}

// ---------- Message handlers ----------

function onMetricMessage(data: string) {
  // JSON.parse happens HERE (in the worker), not on the main thread.
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
  state.frameDirty = true;
}

function onLogMessage(data: string) {
  let ev: LogEvent;
  try {
    ev = JSON.parse(data) as LogEvent;
  } catch {
    return;
  }
  state.logRing.push(ev);
  state.logDirty = true;
}

function handleGetLogs(requestId: number, offset: number, limit: number) {
  const items = state.logRing.slice(offset, limit);
  const msg: WorkerToMain = {
    type: "logSlice",
    requestId,
    offset,
    items,
  };
  self.postMessage(msg);
}

// ---------- Flush loops ----------

function startFlushLoops() {
  if (state.frameFlushTimer !== null) self.clearInterval(state.frameFlushTimer);
  if (state.logFlushTimer !== null) self.clearInterval(state.logFlushTimer);

  state.frameFlushTimer = self.setInterval(flushFrame, state.flushIntervalMs) as unknown as number;
  state.logFlushTimer = self.setInterval(flushLogTotal, state.logTotalIntervalMs) as unknown as number;
}

/**
 * Drain ring buffers into chronological Float64Arrays, downsample by stride
 * if necessary, and ship them to the main thread via transferable buffers.
 */
function flushFrame() {
  if (!state.frameDirty) return;
  state.frameDirty = false;

  const payload: Record<string, { t: Float64Array; v: Float64Array }> = {};
  const transfers: ArrayBuffer[] = [];

  for (const name of state.metrics) {
    const buf = state.buffers.get(name);
    if (!buf || buf.size === 0) continue;

    const stride = Math.max(1, Math.ceil(buf.size / state.maxRenderPoints));
    const outLen = Math.ceil(buf.size / stride);
    const t = new Float64Array(outLen);
    const v = new Float64Array(outLen);

    const cap = buf.t.length;
    const startIdx = buf.size < cap ? 0 : buf.head;
    let writeIdx = 0;
    for (let i = 0; i < buf.size; i += stride) {
      const readIdx = (startIdx + i) % cap;
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

/** Throttled emission of the log total — drives the virtualizer's `count`. */
function flushLogTotal() {
  if (!state.logDirty) return;
  state.logDirty = false;
  post({ type: "logTotal", total: state.logRing.total() });
}

function post(msg: WorkerToMain) {
  self.postMessage(msg);
}
