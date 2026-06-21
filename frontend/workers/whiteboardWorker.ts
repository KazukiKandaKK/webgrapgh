/// <reference lib="webworker" />

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type {
  WhiteboardFrameMsg,
  WhiteboardMainToWorker,
  WhiteboardStatusMsg,
} from "@/lib/whiteboardTypes";

declare const self: DedicatedWorkerGlobalScope;

// ---------- Yjs document ----------

const doc = new Y.Doc();
// Y.Map<id → { x, y, w, h, color }>. We use plain object values rather than
// nested Y.Maps — the values are atomic from Yjs' point of view, which is
// fine for "move shape" semantics (no sub-field concurrent edits).
type Shape = { x: number; y: number; w: number; h: number; color: string };
const shapes = doc.getMap<Shape>("shapes");

let provider: WebsocketProvider | null = null;

// ---------- Pending-moves buffer (Backpressure) ----------
//
// While the user is dragging, the main thread sends a `move` per
// requestAnimationFrame (~60Hz). We coalesce them into a single Yjs
// transaction every 50ms (=20Hz) so the WebSocket sees at most 20 deltas/sec.
const pending = new Map<string, { x: number; y: number }>();
let flushTimer: number | null = null;
const FLUSH_INTERVAL_MS = 50;

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = self.setTimeout(flushPending, FLUSH_INTERVAL_MS) as unknown as number;
}

function flushPending() {
  flushTimer = null;
  if (pending.size === 0) return;
  doc.transact(() => {
    for (const [id, pos] of pending) {
      const s = shapes.get(id);
      if (!s) continue;
      // Re-set the whole record — Y.Map stores values atomically. Mutation
      // of the captured object would NOT propagate; we must call .set().
      shapes.set(id, { ...s, x: pos.x, y: pos.y });
    }
    pending.clear();
  }, /* origin */ "local-drag");
}

// ---------- Frame packer (output to main thread) ----------
//
// Reusable Float64Array. We grow it when shape count exceeds capacity but
// otherwise reuse to avoid steady-state allocation.
let outCoords: Float64Array = new Float64Array(0);

function packAndPost() {
  // Stable iteration order — Y.Map iteration is insertion-order, which is
  // fine for our purposes (no z-index reordering yet).
  const ids: string[] = [];
  const colors: string[] = [];
  shapes.forEach((_v, k) => ids.push(k));
  ids.sort(); // deterministic across peers

  const need = ids.length * 4;
  if (outCoords.length < need) {
    outCoords = new Float64Array(need);
  }
  for (let i = 0; i < ids.length; i++) {
    const s = shapes.get(ids[i])!;
    const o = i * 4;
    outCoords[o] = s.x;
    outCoords[o + 1] = s.y;
    outCoords[o + 2] = s.w;
    outCoords[o + 3] = s.h;
    colors.push(s.color);
  }

  // Take a fresh subarray view of just the valid slots and copy into a new
  // buffer so we can transfer ownership (subarrays of a SharedArrayBuffer
  // can't be transferred; for a plain ArrayBuffer, subarray() returns a
  // view of the SAME buffer which would detach `outCoords` if we transferred).
  // Cheap: ids.length * 4 floats = small.
  const out = new Float64Array(need);
  out.set(outCoords.subarray(0, need));

  const msg: WhiteboardFrameMsg = {
    type: "frame",
    ids,
    colors,
    coords: out,
  };
  self.postMessage(msg, [out.buffer]);
}

// ---------- Observe local + remote changes ----------

shapes.observe(() => {
  packAndPost();
});

// ---------- Status passthrough ----------

function postStatus(state: WhiteboardStatusMsg["state"]) {
  const msg: WhiteboardStatusMsg = { type: "status", state };
  self.postMessage(msg);
}

// ---------- Init ----------

function initialize(wsUrl: string, room: string) {
  if (provider) {
    return; // idempotent
  }
  // y-websocket's WebsocketProvider works inside a worker — it relies on
  // the global `WebSocket` constructor, which is available in
  // DedicatedWorkerGlobalScope.
  provider = new WebsocketProvider(wsUrl, room, doc, {
    connect: true,
  });

  provider.on("status", (e: { status: string }) => {
    if (e.status === "connected") postStatus("open");
    else if (e.status === "connecting") postStatus("connecting");
    else if (e.status === "disconnected") postStatus("closed");
  });
  provider.on("connection-error", () => postStatus("error"));

  // Push an empty frame straight away so the canvas knows it can start its
  // rAF loop and paint the background grid even before shapes exist.
  packAndPost();

  // Seed shapes after a short delay so any incoming state from peers that
  // joined earlier has time to land. We do NOT use `provider.once('sync')`
  // because the Go server is a dumb relay — if this is the FIRST peer, no
  // sync-step-2 ever arrives and the event never fires. The per-key
  // `.has()` guard below keeps later joiners from clobbering moves that
  // earlier peers have already made.
  self.setTimeout(seedIfMissing, 500);
}

function seedIfMissing() {
  const seeds: { id: string; shape: Shape }[] = [
    { id: "s-1", shape: { x: 120, y: 100, w: 140, h: 90, color: "#38bdf8" } },
    { id: "s-2", shape: { x: 320, y: 160, w: 120, h: 120, color: "#a78bfa" } },
    { id: "s-3", shape: { x: 540, y: 80, w: 160, h: 80, color: "#facc15" } },
    { id: "s-4", shape: { x: 240, y: 320, w: 180, h: 100, color: "#34d399" } },
  ];
  // Only set keys that don't already exist — joining peers must not
  // overwrite moves made before they connected.
  doc.transact(() => {
    for (const { id, shape } of seeds) {
      if (!shapes.has(id)) shapes.set(id, shape);
    }
  }, "seed");
}

// ---------- Message dispatch ----------

self.addEventListener("message", (ev: MessageEvent<WhiteboardMainToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "init":
      initialize(msg.wsUrl, msg.room);
      return;
    case "move":
      pending.set(msg.id, { x: msg.x, y: msg.y });
      scheduleFlush();
      return;
    case "commit":
      flushPending();
      return;
  }
});
