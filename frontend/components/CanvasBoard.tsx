"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ShapeKind,
  ShapeRecord,
  WhiteboardFrameMsg,
  WhiteboardMainToWorker,
  WhiteboardWorkerToMain,
} from "@/lib/whiteboardTypes";

type LocalShapes = {
  ids: string[];
  kinds: ShapeKind[];
  colors: string[];
  texts: string[];
  fontSizes: Float64Array;
  /** [x, y, w, h] per shape (4 floats each). Mutated in place during drag. */
  coords: Float64Array;
};

type Tool = "select" | "rect" | "text";

type DragState = {
  id: string;
  offsetX: number;
  offsetY: number;
};

type DrawPreview = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

const EMPTY: LocalShapes = {
  ids: [],
  kinds: [],
  colors: [],
  texts: [],
  fontSizes: new Float64Array(),
  coords: new Float64Array(),
};

const RECT_PALETTE = [
  "#38bdf8", "#a78bfa", "#34d399", "#fbbf24",
  "#f472b6", "#f97316", "#60a5fa", "#facc15",
];

let paletteIdx = 0;
function nextRectColor() {
  const c = RECT_PALETTE[paletteIdx % RECT_PALETTE.length];
  paletteIdx++;
  return c;
}

function newShapeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function CanvasBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);

  // The canonical "what to draw" state lives in a ref, NOT React state, so
  // the worker can write into it 20 times a second without triggering
  // re-renders. The Canvas pulls from it on every rAF.
  const shapesRef = useRef<LocalShapes>(EMPTY);

  const dragRef = useRef<DragState | null>(null);
  const drawRef = useRef<DrawPreview | null>(null);
  const drawScheduledRef = useRef(false);
  const dprRef = useRef(1);

  // React state — only changes on infrequent UI events.
  const [tool, setTool] = useState<Tool>("select");
  const [status, setStatus] = useState<string>("init");
  const [shapeCount, setShapeCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  /** Where the text-editor overlay should sit (CSS pixels relative to container). */
  const [editorBox, setEditorBox] = useState<{ x: number; y: number; w: number; h: number; fontSize: number } | null>(null);
  const editorValueRef = useRef<string>("");

  // Keep tool selection accessible inside non-React callbacks (mouse handlers
  // captured at mount).
  const toolRef = useRef<Tool>("select");
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

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
        // If we're editing text and the worker updated this shape, sync the
        // overlay's position+size to track the (possibly auto-sized) shape.
        if (editingTextId) {
          updateEditorBoxFor(editingTextId);
        }
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
      room: "main",
    };
    worker.postMessage(init);

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // editingTextId in deps would re-spawn the worker — capture latest via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- canvas DPR-correct resize ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
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
  function applyFrame(msg: WhiteboardFrameMsg) {
    shapesRef.current = {
      ids: msg.ids,
      kinds: msg.kinds,
      colors: msg.colors,
      texts: msg.texts,
      fontSizes: msg.fontSizes,
      coords: msg.coords,
    };
  }

  // ---------- redraw loop ----------
  const scheduleDraw = useCallback(() => {
    if (drawScheduledRef.current) return;
    drawScheduledRef.current = true;
    requestAnimationFrame(() => {
      drawScheduledRef.current = false;
      draw();
    });
  }, []);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = dprRef.current;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    // Background + grid
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

    // Shapes
    const { ids, kinds, colors, texts, fontSizes, coords } = shapesRef.current;
    for (let i = 0; i < ids.length; i++) {
      const o = i * 4;
      const x = coords[o];
      const y = coords[o + 1];
      const w = coords[o + 2];
      const h = coords[o + 3];
      const selected = ids[i] === selectedId;

      if (kinds[i] === "rect") {
        ctx.fillStyle = colors[i];
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = selected ? "#f8fafc" : "rgba(15,23,42,0.6)";
        ctx.lineWidth = selected ? 2 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      } else {
        // text
        // Hide canvas text while the input overlay is editing this shape —
        // otherwise it stutters during typing.
        if (editingTextId === ids[i]) {
          // Just draw a subtle box outline.
          ctx.strokeStyle = selected ? "#f8fafc" : "rgba(148,163,184,0.4)";
          ctx.lineWidth = selected ? 2 : 1;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        } else {
          if (selected) {
            ctx.fillStyle = "rgba(56,189,248,0.10)";
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = "#f8fafc";
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          }
          ctx.fillStyle = colors[i];
          const fs = fontSizes[i] || 16;
          ctx.font = `${fs}px system-ui, -apple-system, sans-serif`;
          ctx.textBaseline = "middle";
          const label = texts[i] || "(empty)";
          ctx.fillText(label, x + 8, y + h / 2);
        }
      }
    }

    // In-progress draw preview (rectangle tool)
    const dp = drawRef.current;
    if (dp) {
      const x = Math.min(dp.startX, dp.endX);
      const y = Math.min(dp.startY, dp.endY);
      const w = Math.abs(dp.endX - dp.startX);
      const h = Math.abs(dp.endY - dp.startY);
      ctx.strokeStyle = "rgba(56,189,248,0.9)";
      ctx.fillStyle = "rgba(56,189,248,0.15)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.setLineDash([]);
    }
  }

  // ---------- helpers ----------
  function clientToCanvas(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function hitTest(x: number, y: number): number {
    const { ids, coords } = shapesRef.current;
    for (let i = ids.length - 1; i >= 0; i--) {
      const o = i * 4;
      if (x >= coords[o] && x <= coords[o] + coords[o + 2]
          && y >= coords[o + 1] && y <= coords[o + 1] + coords[o + 3]) {
        return i;
      }
    }
    return -1;
  }

  function shapeRect(id: string): { x: number; y: number; w: number; h: number; fontSize: number } | null {
    const { ids, coords, fontSizes } = shapesRef.current;
    const i = ids.indexOf(id);
    if (i < 0) return null;
    return {
      x: coords[i * 4],
      y: coords[i * 4 + 1],
      w: coords[i * 4 + 2],
      h: coords[i * 4 + 3],
      fontSize: fontSizes[i] || 16,
    };
  }

  // Position the text-editor overlay over the shape with this id, accounting
  // for the offset between the container (overlay's positioning root) and
  // the canvas. Called whenever the underlying shape moves/resizes.
  function updateEditorBoxFor(id: string) {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const cBox = container.getBoundingClientRect();
    const cvBox = canvas.getBoundingClientRect();
    const offX = cvBox.left - cBox.left;
    const offY = cvBox.top - cBox.top;
    const shape = shapeRect(id);
    if (!shape) {
      setEditorBox(null);
      return;
    }
    setEditorBox({
      x: shape.x + offX,
      y: shape.y + offY,
      w: shape.w,
      h: shape.h,
      fontSize: shape.fontSize,
    });
  }

  // ---------- pointer events ----------
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);

    const t = toolRef.current;

    if (t === "rect") {
      drawRef.current = { startX: x, startY: y, endX: x, endY: y };
      setSelectedId(null);
      scheduleDraw();
      e.preventDefault();
      return;
    }

    if (t === "text") {
      // Place a new text shape and immediately enter edit mode.
      const id = newShapeId("text");
      const shape: ShapeRecord = {
        kind: "text",
        x,
        y: y - 18,
        w: 200,
        h: 36,
        color: "#fbbf24",
        text: "",
        fontSize: 20,
      };
      workerRef.current?.postMessage({
        type: "create",
        id,
        shape,
      } satisfies WhiteboardMainToWorker);
      setSelectedId(id);
      // Editor overlay will reposition itself when the frame arrives.
      editorValueRef.current = "";
      setEditingTextId(id);
      // Editor box uses the approximate location until the worker frame
      // confirms the actual shape geometry.
      const container = containerRef.current!;
      const cBox = container.getBoundingClientRect();
      const cvBox = canvas.getBoundingClientRect();
      setEditorBox({
        x: shape.x + (cvBox.left - cBox.left),
        y: shape.y + (cvBox.top - cBox.top),
        w: shape.w,
        h: shape.h,
        fontSize: shape.fontSize,
      });
      e.preventDefault();
      return;
    }

    // select mode — hit-test and drag
    const idx = hitTest(x, y);
    if (idx < 0) {
      setSelectedId(null);
      return;
    }
    const { ids, coords } = shapesRef.current;
    const id = ids[idx];
    dragRef.current = {
      id,
      offsetX: x - coords[idx * 4],
      offsetY: y - coords[idx * 4 + 1],
    };
    setSelectedId(id);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = clientToCanvas(e.clientX, e.clientY);

    // Draw preview update
    if (drawRef.current) {
      drawRef.current.endX = x;
      drawRef.current.endY = y;
      scheduleDraw();
      return;
    }

    // Drag update
    const drag = dragRef.current;
    if (!drag) return;
    const newX = x - drag.offsetX;
    const newY = y - drag.offsetY;

    // Optimistic local mutation — redraws WITHOUT waiting for the worker
    // roundtrip. Yjs will reconcile.
    const { ids, coords } = shapesRef.current;
    const idx = ids.indexOf(drag.id);
    if (idx >= 0) {
      coords[idx * 4] = newX;
      coords[idx * 4 + 1] = newY;
      scheduleDraw();
      if (editingTextId === drag.id) {
        updateEditorBoxFor(drag.id);
      }
    }

    workerRef.current?.postMessage({
      type: "move",
      id: drag.id,
      x: newX,
      y: newY,
    } satisfies WhiteboardMainToWorker);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    canvasRef.current?.releasePointerCapture(e.pointerId);

    // Commit any in-progress draw
    const dp = drawRef.current;
    if (dp) {
      drawRef.current = null;
      const x = Math.min(dp.startX, dp.endX);
      const y = Math.min(dp.startY, dp.endY);
      const w = Math.abs(dp.endX - dp.startX);
      const h = Math.abs(dp.endY - dp.startY);
      if (w > 6 && h > 6) {
        const id = newShapeId("rect");
        workerRef.current?.postMessage({
          type: "create",
          id,
          shape: {
            kind: "rect",
            x, y, w, h,
            color: nextRectColor(),
            text: "",
            fontSize: 16,
          },
        } satisfies WhiteboardMainToWorker);
        setSelectedId(id);
        // Auto-switch back to select after creating, so the user can drag.
        setTool("select");
      }
      scheduleDraw();
      return;
    }

    // End drag
    if (dragRef.current) {
      dragRef.current = null;
      workerRef.current?.postMessage({ type: "commit" } satisfies WhiteboardMainToWorker);
    }
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    const idx = hitTest(x, y);
    if (idx < 0) return;
    const { ids, kinds, texts } = shapesRef.current;
    if (kinds[idx] !== "text") return;
    setSelectedId(ids[idx]);
    editorValueRef.current = texts[idx];
    setEditingTextId(ids[idx]);
    updateEditorBoxFor(ids[idx]);
  }

  // ---------- keyboard ----------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editingTextId) return; // typing into the input — leave it alone

      // Tool shortcuts (V/R/T) — only when the user isn't typing somewhere.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        if (e.key === "v" || e.key === "V") { setTool("select"); return; }
        if (e.key === "r" || e.key === "R") { setTool("rect"); return; }
        if (e.key === "t" || e.key === "T") { setTool("text"); return; }
      }

      if ((e.key === "Backspace" || e.key === "Delete") && selectedId) {
        e.preventDefault();
        workerRef.current?.postMessage({
          type: "delete",
          id: selectedId,
        } satisfies WhiteboardMainToWorker);
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editingTextId]);

  // ---------- text editor commit ----------
  const commitText = useCallback(() => {
    if (!editingTextId) return;
    workerRef.current?.postMessage({
      type: "setText",
      id: editingTextId,
      text: editorValueRef.current,
    } satisfies WhiteboardMainToWorker);
    setEditingTextId(null);
    setEditorBox(null);
  }, [editingTextId]);

  // Subtle: when selection changes, redraw so the highlight reflects it.
  useEffect(() => {
    scheduleDraw();
  }, [selectedId, editingTextId, scheduleDraw]);

  // ---------- render ----------
  const cursorClass = useMemo(() => {
    switch (tool) {
      case "rect": return "cursor-crosshair";
      case "text": return "cursor-text";
      default: return "cursor-default";
    }
  }, [tool]);

  return (
    <div ref={containerRef} className="relative flex flex-1 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
          <ToolButton active={tool === "select"} onClick={() => setTool("select")} hint="V">
            ↖ Select
          </ToolButton>
          <ToolButton active={tool === "rect"} onClick={() => setTool("rect")} hint="R">
            ▭ Rectangle
          </ToolButton>
          <ToolButton active={tool === "text"} onClick={() => setTool("text")} hint="T">
            T Text
          </ToolButton>
          <div className="mx-1 h-5 w-px bg-slate-700" />
          <button
            type="button"
            onClick={() => {
              if (selectedId) {
                workerRef.current?.postMessage({
                  type: "delete",
                  id: selectedId,
                } satisfies WhiteboardMainToWorker);
                setSelectedId(null);
              }
            }}
            disabled={!selectedId}
            className="rounded px-3 py-1 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ✕ Delete
          </button>
          <button
            type="button"
            onClick={() => {
              workerRef.current?.postMessage({ type: "clear" } satisfies WhiteboardMainToWorker);
              setSelectedId(null);
            }}
            className="rounded px-3 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-800"
          >
            ⌫ Clear all
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <StatusPill state={status} />
          <span className="font-mono">{shapeCount} shapes</span>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Drag to move · drag on empty canvas in <kbd>Rectangle</kbd> mode to create · click in <kbd>Text</kbd> mode to add text · double-click a text to edit · Backspace/Delete to remove · open a second tab to see CRDT sync
      </p>

      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        className={`w-full flex-1 rounded-lg border border-slate-800 ${cursorClass}`}
        style={{ minHeight: 480, touchAction: "none" }}
      />

      {/* Text editor overlay */}
      {editingTextId && editorBox && (
        <input
          autoFocus
          defaultValue={editorValueRef.current}
          onChange={(e) => {
            editorValueRef.current = e.target.value;
            workerRef.current?.postMessage({
              type: "setText",
              id: editingTextId,
              text: e.target.value,
            } satisfies WhiteboardMainToWorker);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            } else if (e.key === "Escape") {
              e.preventDefault();
              commitText();
            }
          }}
          onBlur={commitText}
          style={{
            position: "absolute",
            top: editorBox.y,
            left: editorBox.x,
            width: editorBox.w,
            height: editorBox.h,
            fontSize: editorBox.fontSize,
          }}
          className="rounded border border-sky-500/60 bg-slate-900/95 px-2 text-slate-100 outline-none ring-2 ring-sky-500/30"
        />
      )}
    </div>
  );
}

function ToolButton(props: {
  active: boolean;
  onClick: () => void;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={`Shortcut: ${props.hint}`}
      className={`rounded px-3 py-1 text-xs font-medium transition ${
        props.active
          ? "bg-sky-500/20 text-sky-200"
          : "text-slate-400 hover:bg-slate-800"
      }`}
    >
      {props.children}
    </button>
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
