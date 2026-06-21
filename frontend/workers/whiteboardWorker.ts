/// <reference lib="webworker" />

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type {
  ShapeRecord,
  WhiteboardFrameMsg,
  WhiteboardMainToWorker,
  WhiteboardStatusMsg,
} from "@/lib/whiteboardTypes";

declare const self: DedicatedWorkerGlobalScope;

// ---------- Yjs document ----------

const doc = new Y.Doc();
const shapes = doc.getMap<ShapeRecord>("shapes");

let provider: WebsocketProvider | null = null;

// ---------- Pending-moves buffer (Backpressure) ----------
//
// Drag generates a `move` per rAF (~60Hz). We coalesce them into a single
// Yjs transaction every 50ms (=20Hz) so the WebSocket sees at most 20
// deltas/sec.
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
      // Re-set the whole record — Y.Map values are atomic. We must NOT
      // mutate the captured object (the mutation wouldn't propagate).
      shapes.set(id, { ...s, x: pos.x, y: pos.y });
    }
    pending.clear();
  }, "local-drag");
}

// ---------- Frame packer (output to main thread) ----------

// Reusable scratch buffer. Grown when shape count exceeds capacity; in steady
// state nothing is allocated per frame on this line.
let scratchCoords: Float64Array = new Float64Array(0);
let scratchFonts: Float64Array = new Float64Array(0);

function packAndPost() {
  const ids: string[] = [];
  shapes.forEach((_v, k) => ids.push(k));
  ids.sort(); // deterministic across peers

  const n = ids.length;
  const needCoords = n * 4;
  if (scratchCoords.length < needCoords) {
    scratchCoords = new Float64Array(needCoords);
  }
  if (scratchFonts.length < n) {
    scratchFonts = new Float64Array(n);
  }

  const kinds: ShapeRecord["kind"][] = new Array(n);
  const colors: string[] = new Array(n);
  const texts: string[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const s = shapes.get(ids[i])!;
    const o = i * 4;
    scratchCoords[o] = s.x;
    scratchCoords[o + 1] = s.y;
    scratchCoords[o + 2] = s.w;
    scratchCoords[o + 3] = s.h;
    scratchFonts[i] = s.fontSize;
    kinds[i] = s.kind;
    colors[i] = s.color;
    texts[i] = s.text;
  }

  // Copy the valid prefix into fresh ArrayBuffers so we can transfer them
  // (transferring `scratchCoords.buffer` would detach our scratch, defeating
  // the reuse). The copies are tiny — needCoords floats × 8 bytes.
  const coords = new Float64Array(needCoords);
  coords.set(scratchCoords.subarray(0, needCoords));
  const fontSizes = new Float64Array(n);
  fontSizes.set(scratchFonts.subarray(0, n));

  const msg: WhiteboardFrameMsg = {
    type: "frame",
    ids,
    kinds,
    colors,
    texts,
    fontSizes,
    coords,
  };
  self.postMessage(msg, [coords.buffer, fontSizes.buffer]);
}

shapes.observe(() => {
  packAndPost();
});

// ---------- Status passthrough ----------

function postStatus(state: WhiteboardStatusMsg["state"]) {
  const msg: WhiteboardStatusMsg = { type: "status", state };
  self.postMessage(msg);
}

// ---------- Default content ----------

const DEFAULT_SEEDS: { id: string; shape: ShapeRecord }[] = [
  {
    id: "s-rect-1",
    shape: { kind: "rect", x: 120, y: 100, w: 140, h: 90, color: "#38bdf8", text: "", fontSize: 16 },
  },
  {
    id: "s-rect-2",
    shape: { kind: "rect", x: 320, y: 160, w: 120, h: 120, color: "#a78bfa", text: "", fontSize: 16 },
  },
  {
    id: "s-text-1",
    shape: { kind: "text", x: 540, y: 100, w: 220, h: 36, color: "#fbbf24", text: "double-click to edit", fontSize: 18 },
  },
];

function seedIfMissing() {
  doc.transact(() => {
    for (const { id, shape } of DEFAULT_SEEDS) {
      if (!shapes.has(id)) shapes.set(id, shape);
    }
  }, "seed");
}

// ---------- Init ----------

function initialize(wsUrl: string, room: string) {
  if (provider) return; // idempotent
  provider = new WebsocketProvider(wsUrl, room, doc, { connect: true });

  provider.on("status", (e: { status: string }) => {
    if (e.status === "connected") postStatus("open");
    else if (e.status === "connecting") postStatus("connecting");
    else if (e.status === "disconnected") postStatus("closed");
  });
  provider.on("connection-error", () => postStatus("error"));

  // Paint immediately so the canvas can show its grid.
  packAndPost();

  // Wait briefly for any incoming state from peers that joined earlier
  // before we seed. The per-key .has() guard inside seedIfMissing prevents
  // a late joiner from clobbering moves earlier peers already made. We do
  // NOT use `provider.once('sync')` here — the Go relay is stateless, so
  // the first peer never sees a sync-step-2 and the event never fires.
  self.setTimeout(seedIfMissing, 500);
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
    case "create":
      doc.transact(() => {
        shapes.set(msg.id, msg.shape);
      }, "create");
      return;
    case "delete":
      // Flush any in-flight move for this id first so we don't resurrect it.
      pending.delete(msg.id);
      doc.transact(() => {
        shapes.delete(msg.id);
      }, "delete");
      return;
    case "setText":
      doc.transact(() => {
        const s = shapes.get(msg.id);
        if (!s) return;
        // Auto-size text shapes to fit their content (loose estimate, lets
        // the input overlay match the rendered text width).
        const charW = s.fontSize * 0.6;
        const w = Math.max(60, Math.ceil(msg.text.length * charW) + 24);
        const h = Math.max(28, Math.round(s.fontSize * 1.6));
        shapes.set(msg.id, { ...s, text: msg.text, w, h });
      }, "setText");
      return;
    case "clear":
      doc.transact(() => {
        shapes.forEach((_v, k) => shapes.delete(k));
      }, "clear");
      return;
  }
});
