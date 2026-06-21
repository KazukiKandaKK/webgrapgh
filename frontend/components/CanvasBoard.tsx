"use client";

import { useEffect, useRef, useState } from "react";
import type {
  WhiteboardFrameMsg,
  WhiteboardMainToWorker,
  WhiteboardWorkerToMain,
} from "@/lib/whiteboardTypes";

type LocalShapes = {
  ids: string[];
  colors: string[];
  /** [x, y, w, h] per shape, 4 floats each. Mutated in place during drag. */
  coords: Float64Array;
};

type DragState = {
  id: string;
  /** Mouse → shape origin offset captured at mousedown (so the cursor
   *  sticks to the same point on the shape during the whole drag). */
  offsetX: number;
  offsetY: number;
};

const EMPTY: LocalShapes = {
  ids: [],
  colors: [],
  coords: new Float64Array(),
};

export function CanvasBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);

  // The canonical "what to draw" state lives in a ref, NOT React state, so
  // the worker can write into it 20 times a second without triggering
  // re-renders. The Canvas pulls from it on every rAF.
  const shapesRef = useRef<LocalShapes>(EMPTY);

  const dragRef = useRef<DragState | null>(null);
  const drawScheduledRef = useRef(false);
  const dprRef = useRef(1);

  // Only true UI state: connection indicator.
  const [status, setStatus] = useState<string>("init");
  const [shapeCount, setShapeCount] = useState(0);

  // ---------- worker bootstrap ----------
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/whiteboardWorker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    let firstFrameLogged = false;
    worker.onmessage = (ev: MessageEvent<WhiteboardWorkerToMain>) => {
      const msg = ev.data;
      if (msg.type === "frame") {
        if (!firstFrameLogged) {
          firstFrameLogged = true;
          // eslint-disable-next-line no-console
          console.info(`[whiteboard] first frame: ${msg.ids.length} shapes`);
        }
        applyFrame(msg);
        scheduleDraw();
        setShapeCount(msg.ids.length);
        return;
      }
      if (msg.type === "status") {
        // eslint-disable-next-line no-console
        console.info(`[whiteboard] status: ${msg.state}`);
        setStatus(msg.state);
        return;
      }
    };

    const wsUrl =
      process.env.NEXT_PUBLIC_WS_CANVAS_URL ?? "ws://localhost:8080/ws/canvas";
    const init: WhiteboardMainToWorker = {
      type: "init",
      wsUrl,
      // Use a single global room for now. To partition by board, embed an
      // id into the URL.
      room: "main",
    };
    worker.postMessage(init);

    return () => {
      worker.postMessage({ type: "stop" } as never);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // ---------- canvas setup (DPR-correct) ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const rect = canvas.getBoundingClientRect();
      // Backing store in physical pixels…
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      // …while CSS pixels stay the same.
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // After resize the transform is reset; re-apply DPR scale so all
        // drawing code below uses CSS-pixel coordinates.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      scheduleDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ---------- frame application ----------
  // Replaces the local shape table with the worker's snapshot. We adopt the
  // worker's Float64Array directly (it was transferred to us — zero copy).
  function applyFrame(msg: WhiteboardFrameMsg) {
    shapesRef.current = {
      ids: msg.ids,
      colors: msg.colors,
      coords: msg.coords,
    };
  }

  // ---------- redraw loop ----------
  function scheduleDraw() {
    if (drawScheduledRef.current) return;
    drawScheduledRef.current = true;
    requestAnimationFrame(() => {
      drawScheduledRef.current = false;
      draw();
    });
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = dprRef.current;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    // Subtle grid background.
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.strokeStyle = "rgba(148,163,184,0.07)";
    ctx.lineWidth = 1;
    const gridStep = 32;
    for (let x = 0; x < cssW; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, cssH);
      ctx.stroke();
    }
    for (let y = 0; y < cssH; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(cssW, y + 0.5);
      ctx.stroke();
    }

    // Shapes.
    const { ids, colors, coords } = shapesRef.current;
    for (let i = 0; i < ids.length; i++) {
      const o = i * 4;
      const x = coords[o];
      const y = coords[o + 1];
      const w = coords[o + 2];
      const h = coords[o + 3];
      ctx.fillStyle = colors[i];
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(15,23,42,0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      // ID label
      ctx.fillStyle = "rgba(15,23,42,0.8)";
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.fillText(ids[i], x + 6, y + 14);
    }
  }

  // ---------- mouse events ----------
  function clientToCanvas(e: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function hitTest(x: number, y: number): number {
    const { ids, coords } = shapesRef.current;
    // Iterate back-to-front so the "topmost" shape wins.
    for (let i = ids.length - 1; i >= 0; i--) {
      const o = i * 4;
      const sx = coords[o];
      const sy = coords[o + 1];
      const sw = coords[o + 2];
      const sh = coords[o + 3];
      if (x >= sx && x <= sx + sw && y >= sy && y <= sy + sh) return i;
    }
    return -1;
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = clientToCanvas(e);
    const idx = hitTest(x, y);
    if (idx < 0) return;
    const { ids, coords } = shapesRef.current;
    dragRef.current = {
      id: ids[idx],
      offsetX: x - coords[idx * 4],
      offsetY: y - coords[idx * 4 + 1],
    };
    e.preventDefault();
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = clientToCanvas(e);
    const newX = x - drag.offsetX;
    const newY = y - drag.offsetY;

    // Optimistic local update: mutate our cached coords directly so the
    // next rAF redraws with the new position WITHOUT waiting for the
    // worker's roundtrip. Yjs will retroactively reconcile.
    const { ids, coords } = shapesRef.current;
    const idx = ids.indexOf(drag.id);
    if (idx >= 0) {
      coords[idx * 4] = newX;
      coords[idx * 4 + 1] = newY;
      scheduleDraw();
    }

    // And tell the worker (which will throttle into a Yjs transaction).
    workerRef.current?.postMessage({
      type: "move",
      id: drag.id,
      x: newX,
      y: newY,
    } satisfies WhiteboardMainToWorker);
  }

  function onMouseUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Flush any pending throttled move so the final position is broadcast
    // immediately rather than waiting up to 50ms.
    workerRef.current?.postMessage({ type: "commit" } satisfies WhiteboardMainToWorker);
  }

  function onMouseLeave() {
    onMouseUp();
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <StatusPill state={status} />
        <span className="font-mono">{shapeCount} shapes</span>
        <span className="text-slate-500">drag the boxes; open a second tab to see CRDT sync</span>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        className="w-full flex-1 cursor-crosshair rounded-lg border border-slate-800"
        style={{ minHeight: 480 }}
      />
    </div>
  );
}

function StatusPill({ state }: { state: string }) {
  const color =
    state === "open"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-700"
      : state === "error"
        ? "bg-rose-500/20 text-rose-300 border-rose-700"
        : "bg-slate-500/20 text-slate-300 border-slate-700";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${color}`}>
      canvas ws: {state}
    </span>
  );
}
