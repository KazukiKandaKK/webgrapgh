<script lang="ts">
  import { METRICS, type MetricName } from "../lib/types";
  import { METRIC_META } from "@shared/constants";
  import HeatmapChart from "../components/HeatmapChart.svelte";

  // Initially show cpu and memory.
  let selected = $state(new Set<MetricName>(["cpu", "memory"]));

  function toggle(m: MetricName) {
    const next = new Set(selected);
    if (next.has(m)) {
      if (next.size === 1) return; // keep at least one
      next.delete(m);
    } else {
      next.add(m);
    }
    selected = next;
  }
</script>

<div class="flex flex-col gap-6 p-6">
  <header class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h1 class="text-xl font-semibold text-slate-100">Heatmap</h1>
      <p class="text-xs text-slate-400 mt-0.5">
        Value distribution over time — color intensity = sample density per time column
      </p>
    </div>

    <!-- Metric selector -->
    <div class="flex flex-wrap gap-2">
      {#each METRICS as m (m)}
        {@const meta = METRIC_META[m as MetricName]}
        <button
          data-testid="heatmap-toggle-{m}"
          class="rounded px-2.5 py-1 text-xs font-medium border transition {selected.has(m as MetricName)
            ? 'border-sky-500 bg-sky-500/10 text-sky-300'
            : 'border-slate-700 bg-transparent text-slate-500 hover:text-slate-300 hover:border-slate-500'}"
          onclick={() => toggle(m as MetricName)}
        >
          {meta.label}
        </button>
      {/each}
    </div>
  </header>

  <div class="flex flex-col gap-6">
    {#each METRICS as m (m)}
      {#if selected.has(m as MetricName)}
        {@const meta = METRIC_META[m as MetricName]}
        <section class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
          <h2 class="mb-2 text-sm font-medium text-slate-300">
            {meta.label}
            <span class="text-slate-500 font-normal text-xs">({meta.unit})</span>
          </h2>
          <HeatmapChart metricName={m as MetricName} height={180} />
        </section>
      {/if}
    {/each}
  </div>
</div>
