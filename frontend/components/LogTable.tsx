"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEvent } from "@/lib/types";
import { useWorker } from "@/lib/workerContext";
import { LOG_ROW_HEIGHT, LOG_OVERSCAN } from "@shared/constants";
import { LogRow } from "./LogRow";

/**
 * Virtualized log table. The full dataset lives in the Worker; we only ever
 * hold:
 *   - `total`  : current row count (drives the virtualizer)
 *   - `slice`  : the most recently fetched window of items (≈ visible + overscan)
 *
 * Re-renders are limited to:
 *   - `total` ticks (throttled to ~5Hz by the worker)
 *   - rendered range changing (rare, only on scroll)
 *   - slice arrival
 */
export function LogTable() {
  const controller = useWorker();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [total, setTotal] = useState(0);
  const [slice, setSlice] = useState<{ offset: number; items: LogEvent[] }>({
    offset: 0,
    items: [],
  });
  const requestIdRef = useRef(0);
  /** Whether the user is currently pinned to the latest row. */
  const pinnedRef = useRef(true);
  /** Suppresses the auto-pin while the virtualizer programmatically scrolls. */
  const autoScrollingRef = useRef(false);

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: LOG_OVERSCAN,
  });

  const requestRange = useCallback(
    (offset: number, limit: number) => {
      const id = ++requestIdRef.current;
      controller.requestLogs(id, offset, limit);
    },
    [controller]
  );

  // Subscribe to worker for total + slice updates.
  useEffect(() => {
    const offTotal = controller.onLogTotal((next) => {
      setTotal((prev) => {
        if (next === prev) return prev;
        // If the user is at the bottom, follow new logs.
        if (pinnedRef.current && next > 0) {
          autoScrollingRef.current = true;
          // Defer to next tick so the virtualizer sees the new count first.
          queueMicrotask(() => {
            virtualizer.scrollToIndex(next - 1, { align: "end" });
            // Re-arm right after — onScroll runs synchronously on this scroll.
            queueMicrotask(() => {
              autoScrollingRef.current = false;
            });
          });
        }
        return next;
      });
    });
    const offSlice = controller.onLogSlice((requestId, offset, items) => {
      if (requestId !== requestIdRef.current) return; // stale
      setSlice({ offset, items });
    });
    return () => {
      offTotal();
      offSlice();
    };
  }, [controller, virtualizer]);

  // When the visible range (or total) changes, request that window from the
  // worker. virtualItems[] is recomputed by the virtualizer on every relevant
  // change, so its first/last index are a good change signal.
  const virtualItems = virtualizer.getVirtualItems();
  const firstIdx = virtualItems[0]?.index ?? 0;
  const lastIdx = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (virtualItems.length === 0 || total === 0) return;
    const padding = LOG_OVERSCAN;
    const offset = Math.max(0, firstIdx - padding);
    const limit = lastIdx - firstIdx + 1 + padding * 2;
    requestRange(offset, limit);
    // We deliberately ignore virtualItems.length here — the indices fully
    // describe the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstIdx, lastIdx, total, requestRange]);

  // Track whether the user is pinned to bottom by watching scroll events.
  const onScroll = useCallback(() => {
    if (autoScrollingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distanceFromBottom < 8;
  }, []);

  const jumpToLatest = useCallback(() => {
    if (total === 0) return;
    pinnedRef.current = true;
    autoScrollingRef.current = true;
    virtualizer.scrollToIndex(total - 1, { align: "end" });
    queueMicrotask(() => {
      autoScrollingRef.current = false;
    });
  }, [total, virtualizer]);

  const sliceStart = slice.offset;
  const sliceEnd = sliceStart + slice.items.length;
  const totalSize = virtualizer.getTotalSize();

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-slate-200">Logs</h2>
          <span className="font-mono text-xs text-slate-500">
            {total.toLocaleString()} events
          </span>
        </div>
        <button
          type="button"
          onClick={jumpToLatest}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          ↓ latest
        </button>
      </header>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-[520px] overflow-auto font-mono text-xs"
      >
        <div style={{ height: totalSize, position: "relative" }}>
          {virtualItems.map((vRow) => {
            const idx = vRow.index;
            const inSlice = idx >= sliceStart && idx < sliceEnd;
            const ev = inSlice ? slice.items[idx - sliceStart] : undefined;
            return (
              <LogRow
                key={vRow.key}
                topPx={vRow.start}
                heightPx={LOG_ROW_HEIGHT}
                id={ev?.id ?? -(idx + 1)}
                timeMs={ev?.t ?? 0}
                level={ev?.level ?? ""}
                source={ev?.src ?? ""}
                message={ev?.msg ?? "…"}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
