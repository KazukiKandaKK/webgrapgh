// Pure ring-buffer + downsampling primitives shared by the data worker.
// Extracted from dataWorker.ts so this index-heavy, bug-prone logic can be
// unit-tested in isolation (no Worker globals required).

import type { LogEvent } from "./types";

// ---------- Metric ring buffer ----------

export type RingBuffer = {
  t: Float64Array;
  v: Float64Array;
  /** Index of the next write slot (modulo capacity). */
  head: number;
  /** Number of points currently populated (≤ capacity). */
  size: number;
};

export function makeBuffer(capacity: number): RingBuffer {
  return {
    t: new Float64Array(capacity),
    v: new Float64Array(capacity),
    head: 0,
    size: 0,
  };
}

export function pushPoint(buf: RingBuffer, t: number, v: number) {
  const cap = buf.t.length;
  buf.t[buf.head] = t;
  buf.v[buf.head] = v;
  buf.head = (buf.head + 1) % cap;
  if (buf.size < cap) buf.size++;
}

export type SlicePlan = {
  cap: number;
  startIdx: number;
  startOffset: number;
  sliceSize: number;
  stride: number;
  outLen: number;
};

/**
 * Compute the read plan for draining a ring buffer, optionally restricted to
 * the most recent `windowMs`, downsampled by stride so the result has at most
 * `maxRenderPoints` points. Returns null when the window contains no points.
 */
export function computeSlice(
  buf: RingBuffer,
  windowMs: number | null,
  maxRenderPoints: number,
): SlicePlan | null {
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

// ---------- Log ring buffer ----------

export class LogRing {
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
