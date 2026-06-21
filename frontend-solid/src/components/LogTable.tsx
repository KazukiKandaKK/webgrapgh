import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import type { LogEvent } from "../lib/types";
import { useWorker } from "../lib/workerController";
import { LogRow } from "./LogRow";

const ROW_HEIGHT = 28;
const OVERSCAN = 12;

/**
 * Virtualized log table. The full dataset lives in the Worker; we only ever
 * hold:
 *   - controller.logTotal()  : current row count signal
 *   - slice()                : the most recently fetched window of items
 *
 * Range changes trigger a `getLogs` request to the worker; the response
 * arrives via onLogSlice → setSlice.
 */
export function LogTable() {
  const controller = useWorker();
  let scrollEl!: HTMLDivElement;

  const [slice, setSlice] = createSignal<{ offset: number; items: LogEvent[] }>(
    { offset: 0, items: [] },
  );
  let requestIdSeq = 0;
  let pinned = true;
  let autoScrolling = false;

  const virtualizer = createVirtualizer({
    get count() {
      return controller.logTotal();
    },
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Slice response handler — accept only the latest request, discard stale.
  onMount(() => {
    const off = controller.onLogSlice((requestId, offset, items) => {
      if (requestId !== requestIdSeq) return;
      setSlice({ offset, items });
    });
    onCleanup(off);
  });

  // When total grows AND user is pinned, scroll to bottom.
  createEffect(
    on(
      () => controller.logTotal(),
      (total, prev) => {
        if (prev == null || total === prev) return;
        if (pinned && total > 0) {
          autoScrolling = true;
          queueMicrotask(() => {
            virtualizer.scrollToIndex(total - 1, { align: "end" });
            queueMicrotask(() => {
              autoScrolling = false;
            });
          });
        }
      },
      { defer: true },
    ),
  );

  // Compute current visible range and request that slice from the worker.
  const requestRange = (offset: number, limit: number) => {
    const id = ++requestIdSeq;
    controller.requestLogs(id, offset, limit);
  };

  // Effect: whenever the rendered range changes, fetch that window.
  createEffect(() => {
    const total = controller.logTotal();
    const items = virtualizer.getVirtualItems();
    if (items.length === 0 || total === 0) return;
    const first = items[0].index;
    const last = items[items.length - 1].index;
    const padding = OVERSCAN;
    const offset = Math.max(0, first - padding);
    const limit = last - first + 1 + padding * 2;
    requestRange(offset, limit);
  });

  const onScroll = () => {
    if (autoScrolling) return;
    const el = scrollEl;
    if (!el) return;
    pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  };

  const jumpToLatest = () => {
    const total = controller.logTotal();
    if (total === 0) return;
    pinned = true;
    autoScrolling = true;
    virtualizer.scrollToIndex(total - 1, { align: "end" });
    queueMicrotask(() => {
      autoScrolling = false;
    });
  };

  return (
    <section class="rounded-lg border border-slate-800 bg-slate-900/60">
      <header class="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div class="flex items-baseline gap-3">
          <h2 class="text-sm font-semibold text-slate-200">Logs</h2>
          <span class="font-mono text-xs text-slate-500">
            {controller.logTotal().toLocaleString()} events
          </span>
        </div>
        <button
          type="button"
          onClick={jumpToLatest}
          class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          ↓ latest
        </button>
      </header>
      <div
        ref={scrollEl!}
        onScroll={onScroll}
        class="h-[520px] overflow-auto font-mono text-xs"
      >
        <div
          style={{
            height: virtualizer.getTotalSize() + "px",
            position: "relative",
          }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(vRow) => {
              const ev = () => {
                const idx = vRow.index;
                const s = slice();
                if (idx >= s.offset && idx < s.offset + s.items.length) {
                  return s.items[idx - s.offset];
                }
                return undefined;
              };
              return (
                <LogRow
                  topPx={vRow.start}
                  heightPx={ROW_HEIGHT}
                  id={ev()?.id ?? -(vRow.index + 1)}
                  timeMs={ev()?.t ?? 0}
                  level={ev()?.level ?? ""}
                  source={ev()?.src ?? ""}
                  message={ev()?.msg ?? "…"}
                />
              );
            }}
          </For>
        </div>
      </div>
    </section>
  );
}
