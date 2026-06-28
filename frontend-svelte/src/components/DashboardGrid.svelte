<script lang="ts">
  import { onMount } from "svelte";
  import { METRICS, type MetricName } from "../lib/types";
  import { METRIC_META, CHART_HEIGHT } from "@shared/constants";
  import { useWorker } from "../lib/workerController.svelte";
  import TimeRangeControls from "./TimeRangeControls.svelte";
  import UplotChart from "./UplotChart.svelte";
  import StatusPill from "./StatusPill.svelte";
  import type { UplotChartHandle } from "../lib/chart";

  const controller = useWorker();

  // Imperative chart handles keyed by metric. Filled by UplotChart.onReady.
  const chartHandles = new Map<MetricName, UplotChartHandle>();

  // Default window: 5 minutes. Updated on user click; the effect below pushes
  // the change to the worker which immediately re-flushes.
  let windowMs = $state<number | null>(5 * 60_000);

  let firstFrameLogged = false;
  onMount(() => {
    const offFrame = controller.onFrame((metrics) => {
      if (!firstFrameLogged) {
        firstFrameLogged = true;
        const refsReady = METRICS.filter((m) => chartHandles.has(m)).length;
        const firstMetric = METRICS.find((m) => metrics[m]);
        const sample = firstMetric ? metrics[firstMetric] : undefined;
        // eslint-disable-next-line no-console
        console.info(
          `[grid] first onFrame: ${Object.keys(metrics).length} metrics, ` +
            `${refsReady}/${METRICS.length} chart refs ready, ` +
            `sample ${firstMetric}: ${sample?.t.length ?? 0} pts`,
        );
      }
      for (const name of METRICS) {
        const series = metrics[name];
        if (!series) continue;
        chartHandles.get(name)?.setData(series.t, series.v);
      }
    });
    return offFrame;
  });

  // Push range changes whenever the value changes.
  $effect(() => {
    controller.setRange(windowMs);
  });
</script>

<section class="p-6">
  <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">System Metrics</h1>
      <p class="text-sm text-slate-400">
        {METRICS.length} metrics · Worker → uPlot direct setData · Svelte
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <TimeRangeControls {windowMs} onChange={(v) => (windowMs = v)} />
      <div class="flex gap-2">
        <StatusPill
          label="metrics"
          state={controller.status.metrics.state}
          detail={controller.status.metrics.detail}
        />
        <StatusPill
          label="logs"
          state={controller.status.logs.state}
          detail={controller.status.logs.detail}
        />
      </div>
    </div>
  </header>

  <div
    class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
  >
    {#each METRICS as name (name)}
      {@const meta = METRIC_META[name]}
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-3 shadow">
        <div
          class="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500"
        >
          <span>{name}</span>
          <span>{meta.unit}</span>
        </div>
        <UplotChart
          title={meta.label}
          color={meta.color}
          height={CHART_HEIGHT}
          yRange={meta.yRange}
          onReady={(api) => chartHandles.set(name, api)}
        />
      </div>
    {/each}
  </div>
</section>
