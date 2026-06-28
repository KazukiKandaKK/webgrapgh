<script lang="ts">
  import { onMount } from "svelte";
  import type { LogEvent } from "../lib/types";
  import { LOG_ROW_HEIGHT, LOG_OVERSCAN } from "@shared/constants";
  import { useWorker } from "../lib/workerController.svelte";
  import { type LogFilter, matchesFilter } from "../lib/logFilter";
  import LogRow from "./LogRow.svelte";

  type Props = {
    filter: LogFilter;
    /** Reports (matched, scanned) back to the parent for the count display. */
    onCounts?: (matched: number, scanned: number) => void;
  };

  let { filter, onCounts }: Props = $props();

  const ROW_HEIGHT = LOG_ROW_HEIGHT;
  const OVERSCAN = LOG_OVERSCAN;
  const VIEWPORT_HEIGHT = 520;

  /**
   * Filtering happens on the main thread over the most recent `windowCount`
   * events (the worker holds the full ring but only exposes offset/limit
   * slices). We poll that window at 2 Hz and filter + virtualize the result
   * in memory — no dependency, scoped to a bounded buffer.
   */
  const controller = useWorker();
  let scrollEl: HTMLDivElement;

  let buffer = $state<LogEvent[]>([]);
  let scrollTop = $state(0);
  let requestId = 0;

  const filtered = $derived(buffer.filter((ev) => matchesFilter(ev, filter)));
  const total = $derived(filtered.length);
  const totalSize = $derived(total * ROW_HEIGHT);

  $effect(() => {
    onCounts?.(filtered.length, buffer.length);
  });

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

  function fetchWindow() {
    const t = controller.logTotal;
    if (t === 0) return;
    const count = Math.min(t, filter.windowCount);
    const offset = Math.max(0, t - count);
    controller.requestLogs(++requestId, offset, count);
  }

  onMount(() => {
    const off = controller.onLogSlice((id, _offset, items) => {
      if (id !== requestId) return;
      buffer = items;
    });
    fetchWindow();
    // Poll the tail at 2 Hz so the filtered view keeps up with new events
    // without re-fetching on every single append.
    const timer = setInterval(fetchWindow, 500);
    return () => {
      off();
      clearInterval(timer);
    };
  });

  // Refetch immediately when the window size changes.
  $effect(() => {
    void filter.windowCount;
    fetchWindow();
  });

  function onScroll() {
    scrollTop = scrollEl.scrollTop;
  }
</script>

<section class="flex flex-1 flex-col rounded-lg border border-slate-800 bg-slate-900/60">
  <header
    class="flex items-center justify-between border-b border-slate-800 px-4 py-2"
  >
    <div class="flex items-baseline gap-3">
      <h2 class="text-sm font-semibold text-slate-200">Filtered logs</h2>
      <span class="font-mono text-xs text-slate-500">
        {total.toLocaleString()} matched · scanning last {buffer.length.toLocaleString()}
      </span>
    </div>
  </header>
  <div
    bind:this={scrollEl}
    onscroll={onScroll}
    class="h-[520px] overflow-auto font-mono text-xs"
  >
    {#if total === 0}
      <div class="px-4 py-6 text-sm text-slate-500">
        一致するログがありません(直近 {buffer.length.toLocaleString()} 件を検索)。
      </div>
    {:else}
      <div style="height: {totalSize}px; position: relative;">
        {#each rows as i (i)}
          {@const ev = filtered[i]}
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
    {/if}
  </div>
</section>
