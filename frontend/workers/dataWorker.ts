/// <reference lib="webworker" />

import type {
  HistoryResponse,
  LogEvent,
  MainToWorker,
  MetricName,
  MetricSABs,
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
  /** Visible time window (ms). null = unfiltered (use entire ring buffer). */
  windowMs: number | null;
  /** SAB output slots (only populated when crossOriginIsolated + SAB). */
  sabSlots: Map<MetricName, SabSlots> | null;
  /** Monotonically increasing generation number for double-buffer indexing. */
  sabGen: number;
};

type SabSlots = {
  tA: Float64Array;
  vA: Float64Array;
  tB: Float64Array;
  vB: Float64Array;
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
  windowMs: null,
  sabSlots: null,
  sabGen: 0,
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
    case "setRange":
      state.windowMs = msg.windowMs;
      state.frameDirty = true; // force the next flush to re-render
      return;
    case "kick":
      // A new subscriber appeared on main; refresh charts on next tick.
      state.frameDirty = true;
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

  // Try to set up SAB output. crossOriginIsolated is the gate set by
  // COOP=same-origin + COEP=credentialless on the document. If false we'll
  // silently fall back to the transferable path.
  setupSABOutput();

  startFlushLoops();

  // Load both histories in parallel, then connect both sockets.
  void Promise.all([loadMetricHistory(), loadLogHistory()]).then(() => {
    connectMetrics();
    connectLogs();
  });
}

/**
 * Allocate two SAB-backed Float64Array slots per metric and post them to the
 * main thread one time. The main bridge wraps them in views and caches them;
 * thereafter we only send tiny `sabTick` messages.
 */
function setupSABOutput() {
  // Feature-detect. In some browsers `crossOriginIsolated` is not on the
  // DedicatedWorkerGlobalScope type, so we read it permissively.
  const hasSAB = typeof SharedArrayBuffer !== "undefined";
  const isolated = (self as unknown as { crossOriginIsolated?: boolean })
    .crossOriginIsolated === true;
  if (!hasSAB || !isolated) {
    state.sabSlots = null;
    // eslint-disable-next-line no-console
    console.info(
      `[worker] SAB unavailable (SAB=${hasSAB}, isolated=${isolated}); ` +
        `falling back to transferable Float64Arrays.`
    );
    return;
  }

  const sabs: Record<string, MetricSABs> = {};
  const slots = new Map<MetricName, SabSlots>();
  const cap = state.maxRenderPoints;
  const byteLen = cap * 8;

  for (const name of state.metrics) {
    const tA = new SharedArrayBuffer(byteLen);
    const vA = new SharedArrayBuffer(byteLen);
    const tB = new SharedArrayBuffer(byteLen);
    const vB = new SharedArrayBuffer(byteLen);
    sabs[name] = { capacity: cap, tA, vA, tB, vB };
    slots.set(name, {
      tA: new Float64Array(tA),
      vA: new Float64Array(vA),
      tB: new Float64Array(tB),
      vB: new Float64Array(vB),
    });
  }
  state.sabSlots = slots;
  state.sabGen = 0;
  // eslint-disable-next-line no-console
  console.info(
    `[worker] SAB output enabled: ${state.metrics.length} metrics × ` +
      `2 slots × ${cap} points = ${
        (state.metrics.length * 2 * byteLen * 2) / 1024
      } KB shared (zero per-flush allocation).`
  );
  post({ type: "sabInit", sabs: sabs as Record<MetricName, MetricSABs> });
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
    // Cap the server-side payload: ask for at most `bufferSize` points per
    // metric. The DB still scans the full range but the response is small.
    const url = `${state.apiBase}/api/history?metrics=${state.metrics.join(
      ","
    )}&minutes=60&max_points=${state.bufferSize}`;
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

// Reused across every flushFrame call so we don't generate a fresh object +
// array per tick. The {t, v} slot objects inside are still allocated per
// metric per flush in the transferable fallback path — small + nursery-
// friendly — but the outer container churn is eliminated.
const reusablePayload: Record<string, { t: Float64Array; v: Float64Array }> = {};
const reusableTransfers: ArrayBuffer[] = [];
// Reused across SAB-path flushes too.
const reusableSabSizes: Record<string, number> = {};

/**
 * Compute the [startOffset, sliceSize, stride, outLen] for one metric given
 * the current windowMs filter. Returns null if the slice is empty.
 */
function computeSlice(buf: RingBuffer, windowMs: number | null, maxRenderPoints: number) {
  const cap = buf.t.length;
  const startIdx = buf.size < cap ? 0 : buf.head;

  let startOffset = 0;
  if (windowMs !== null) {
    const newestReadIdx = (startIdx + buf.size - 1 + cap) % cap;
    const cutoff = buf.t[newestReadIdx] - windowMs;
    startOffset = buf.size;
    for (let i = 0; i < buf.size; i++) {
      const readIdx = (startIdx + i) % cap;
      if (buf.t[readIdx] >= cutoff) {
        startOffset = i;
        break;
      }
    }
  }
  const sliceSize = buf.size - startOffset;
  if (sliceSize <= 0) return null;
  const stride = Math.max(1, Math.ceil(sliceSize / maxRenderPoints));
  const outLen = Math.ceil(sliceSize / stride);
  return { cap, startIdx, startOffset, sliceSize, stride, outLen };
}

/**
 * Drain ring buffers, optionally restricted to the visible time window,
 * downsample by stride, and either:
 *   - SAB path: write into the current generation's SAB slot in-place and
 *     send a tiny `sabTick` notification (zero per-flush allocation), OR
 *   - Transfer path: allocate fresh Float64Arrays and transfer them.
 */
function flushFrame() {
  if (!state.frameDirty) return;
  state.frameDirty = false;
  if (state.sabSlots !== null) {
    flushFrameSAB();
  } else {
    flushFrameTransfer();
  }
}

function flushFrameSAB() {
  const slots = state.sabSlots!;
  const gen = state.sabGen + 1;
  const useA = (gen & 1) === 1;
  // Reset sizes container.
  for (const k in reusableSabSizes) delete reusableSabSizes[k];

  let any = false;
  for (const name of state.metrics) {
    const buf = state.buffers.get(name);
    if (!buf || buf.size === 0) continue;
    const slot = slots.get(name);
    if (!slot) continue;

    const s = computeSlice(buf, state.windowMs, state.maxRenderPoints);
    if (s === null) continue;

    const tOut = useA ? slot.tA : slot.tB;
    const vOut = useA ? slot.vA : slot.vB;
    // Cap to the SAB capacity (should always hold since stride targets
    // maxRenderPoints, but guard against off-by-one).
    const limit = Math.min(s.outLen, tOut.length);

    let writeIdx = 0;
    for (let i = 0; i < s.sliceSize && writeIdx < limit; i += s.stride) {
      const readIdx = (s.startIdx + s.startOffset + i) % s.cap;
      tOut[writeIdx] = buf.t[readIdx] / 1000;
      vOut[writeIdx] = buf.v[readIdx];
      writeIdx++;
    }
    reusableSabSizes[name] = writeIdx;
    any = true;
  }
  if (!any) return;
  state.sabGen = gen;
  self.postMessage({
    type: "sabTick",
    gen,
    sizes: reusableSabSizes,
  } as WorkerToMain);
}

function flushFrameTransfer() {
  for (const k in reusablePayload) delete reusablePayload[k];
  reusableTransfers.length = 0;

  for (const name of state.metrics) {
    const buf = state.buffers.get(name);
    if (!buf || buf.size === 0) continue;

    const s = computeSlice(buf, state.windowMs, state.maxRenderPoints);
    if (s === null) continue;

    const t = new Float64Array(s.outLen);
    const v = new Float64Array(s.outLen);
    let writeIdx = 0;
    for (let i = 0; i < s.sliceSize; i += s.stride) {
      const readIdx = (s.startIdx + s.startOffset + i) % s.cap;
      t[writeIdx] = buf.t[readIdx] / 1000;
      v[writeIdx] = buf.v[readIdx];
      writeIdx++;
    }
    reusablePayload[name] = { t, v };
    reusableTransfers.push(t.buffer, v.buffer);
  }

  if (Object.keys(reusablePayload).length === 0) return;
  const message: WorkerToMain = { type: "frame", metrics: reusablePayload as never };
  self.postMessage(message, reusableTransfers);
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
