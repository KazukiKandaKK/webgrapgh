<script lang="ts">
  import { onMount } from "svelte";
  import { METRICS, type MetricName } from "../lib/types";
  import { METRIC_META } from "@shared/constants";
  import { useWorker } from "../lib/workerController.svelte";
  import { navigate } from "../lib/router.svelte";
  import Sparkline from "../components/Sparkline.svelte";

  const controller = useWorker();

  type Cell = { value: number; series: Float64Array };
  let cells = $state<Partial<Record<MetricName, Cell>>>({});

  onMount(() => {
    return controller.onFrame((metrics) => {
      const next: Partial<Record<MetricName, Cell>> = {};
      for (const name of METRICS) {
        const s = metrics[name];
        if (!s || s.v.length === 0) continue;
        next[name] = { value: s.v[s.v.length - 1], series: s.v };
      }
      cells = next;
    });
  });

  function fmt(v: number): string {
    if (!Number.isFinite(v)) return "–";
    const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return v.toFixed(digits);
  }

  const streamsOk = $derived(
    [controller.status.metrics.state, controller.status.logs.state].filter(
      (s) => s === "open",
    ).length,
  );
</script>

<section class="p-6">
  <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Overview</h1>
      <p class="text-sm text-slate-400">
        {streamsOk}/2 streams live · {controller.logTotal.toLocaleString()} log
        entries · {METRICS.length} metrics
      </p>
    </div>
  </header>

  <div
    class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
  >
    {#each METRICS as name (name)}
      {@const meta = METRIC_META[name]}
      {@const cell = cells[name]}
      <button
        type="button"
        onclick={() => navigate("/metrics")}
        class="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-left shadow transition hover:border-slate-600"
        style={`border-left: 3px solid ${meta.color}`}
      >
        <div class="flex items-baseline justify-between">
          <span class="text-sm font-medium text-slate-300">{meta.label}</span>
          <span
            class="text-[10px] uppercase tracking-widest text-slate-500"
          >{meta.unit}</span>
        </div>
        <div class="text-3xl font-semibold tabular-nums">
          {cell ? fmt(cell.value) : "–"}
        </div>
        {#if cell}
          <Sparkline values={cell.series} color={meta.color} />
        {:else}
          <div class="h-9"></div>
        {/if}
      </button>
    {/each}
  </div>
</section>
