<script lang="ts">
  import { onMount } from "svelte";
  import type { LogEvent } from "../lib/types";
  import { LOG_ROW_HEIGHT, LOG_OVERSCAN } from "@shared/constants";
  import { useWorker } from "../lib/workerController.svelte";
  import LogRow from "./LogRow.svelte";

  const ROW_HEIGHT = LOG_ROW_HEIGHT;
  const OVERSCAN = LOG_OVERSCAN;
  const VIEWPORT_HEIGHT = 520;

  /**
   * Virtualized log table. The full dataset lives in the Worker; we only ever
   * hold:
   *   - controller.logTotal : current row count (reactive rune)
   *   - slice               : the most recently fetched window of items
   *
   * Range changes trigger a `getLogs` request to the worker; the response
   * arrives via onLogSlice → slice. A tiny hand-rolled windowing computation
   * (no virtualization dependency) maps scrollTop → [startIndex, endIndex].
   */
  const controller = useWorker();
  let scrollEl: HTMLDivElement;

  let slice = $state<{ offset: number; items: LogEvent[] }>({
    offset: 0,
    items: [],
  });
  let scrollTop = $state(0);
  let requestIdSeq = 0;
  let pinned = true;
  let autoScrolling = false;
  let prevTotal = 0;

  const total = $derived(controller.logTotal);
  const totalSize = $derived(total * ROW_HEIGHT);
  const startIndex = $derived(
    total === 0 ? 0 : Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN),
  );
  const endIndex = $derived(
    total === 0
      ? -1
      : Math.min(
          total - 1,
          Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN,
        ),
  );
  const rows = $derived.by(() => {
    const out: number[] = [];
    for (let i = startIndex; i <= endIndex; i++) out.push(i);
    return out;
  });

  // Slice response handler — accept only the latest request, discard stale.
  onMount(() => {
    const off = controller.onLogSlice((requestId, offset, items) => {
      if (requestId !== requestIdSeq) return;
      slice = { offset, items };
    });
    return off;
  });

  // Whenever the rendered range changes, fetch that window from the worker.
  $effect(() => {
    const t = total;
    if (t === 0 || endIndex < startIndex) return;
    const offset = startIndex;
    const limit = endIndex - startIndex + 1;
    const id = ++requestIdSeq;
    controller.requestLogs(id, offset, limit);
  });

  // When total grows AND user is pinned, scroll to bottom.
  $effect(() => {
    const t = total;
    if (t === prevTotal) return;
    const grew = t > prevTotal;
    prevTotal = t;
    if (grew && pinned && t > 0 && scrollEl) {
      autoScrolling = true;
      queueMicrotask(() => {
        scrollEl.scrollTop = scrollEl.scrollHeight;
        queueMicrotask(() => {
          autoScrolling = false;
        });
      });
    }
  });

  function onScroll() {
    scrollTop = scrollEl.scrollTop;
    if (autoScrolling) return;
    pinned =
      scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 8;
  }

  function jumpToLatest() {
    if (total === 0) return;
    pinned = true;
    autoScrolling = true;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    queueMicrotask(() => {
      autoScrolling = false;
    });
  }

  function eventAt(idx: number): LogEvent | undefined {
    if (idx >= slice.offset && idx < slice.offset + slice.items.length) {
      return slice.items[idx - slice.offset];
    }
    return undefined;
  }
</script>

<section class="rounded-lg border border-slate-800 bg-slate-900/60">
  <header
    class="flex items-center justify-between border-b border-slate-800 px-4 py-2"
  >
    <div class="flex items-baseline gap-3">
      <h2 class="text-sm font-semibold text-slate-200">Logs</h2>
      <span class="font-mono text-xs text-slate-500">
        {total.toLocaleString()} events
      </span>
    </div>
    <button
      type="button"
      onclick={jumpToLatest}
      class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
    >
      ↓ latest
    </button>
  </header>
  <div
    bind:this={scrollEl}
    onscroll={onScroll}
    class="h-[520px] overflow-auto font-mono text-xs"
  >
    <div style="height: {totalSize}px; position: relative;">
      {#each rows as i (i)}
        {@const ev = eventAt(i)}
        <LogRow
          topPx={i * ROW_HEIGHT}
          heightPx={ROW_HEIGHT}
          id={ev?.id ?? -(i + 1)}
          timeMs={ev?.t ?? 0}
          level={ev?.level ?? ""}
          source={ev?.src ?? ""}
          message={ev?.msg ?? "…"}
        />
      {/each}
    </div>
  </div>
</section>
