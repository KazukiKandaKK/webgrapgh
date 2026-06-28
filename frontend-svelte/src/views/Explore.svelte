<script lang="ts">
  import { onMount } from "svelte";
  import { METRICS, type MetricName } from "../lib/types";
  import { METRIC_META } from "@shared/constants";
  import { useWorker } from "../lib/workerController.svelte";
  import { router, navigate } from "../lib/router.svelte";
  import { settings } from "../lib/settings.svelte";
  import { computeStats, type Stats } from "../lib/stats";
  import type { UplotChartHandle } from "../lib/chart";
  import UplotChart from "../components/UplotChart.svelte";
  import TimeRangeControls from "../components/TimeRangeControls.svelte";

  const controller = useWorker();

  // Selected metric comes from the URL (#/explore/<metric>); fall back to the
  // first metric for a bare #/explore.
  const metric = $derived.by<MetricName>(() => {
    const seg = router.path.split("/")[2] as MetricName | undefined;
    return seg && (METRICS as readonly string[]).includes(seg)
      ? seg
      : METRICS[0];
  });
  const meta = $derived(METRIC_META[metric]);

  let windowMs = $state<number | null>(settings.current.defaultRangeMs);
  let stats = $state<Stats | null>(null);

  let handle: UplotChartHandle | null = null;
  // Latest frame slice for the selected metric, kept so a metric switch can
  // repaint immediately from the same buffer.
  let latest: { t: Float64Array; v: Float64Array } | null = null;

  onMount(() => {
    return controller.onFrame((metrics) => {
      const m = metric;
      const s = metrics[m];
      latest = s ?? null;
      if (s) {
        handle?.setData(s.t, s.v);
        stats = computeStats(s.v);
      } else {
        stats = null;
      }
    });
  });

  // Re-arm the chart + stats when the user switches metric (the onFrame closure
  // reads `metric` live, but repaint from the cached frame so it's instant).
  $effect(() => {
    void metric;
    if (latest) {
      handle?.setData(latest.t, latest.v);
      stats = computeStats(latest.v);
    } else {
      stats = null;
    }
  });

  $effect(() => {
    controller.setRange(windowMs);
  });

  function fmt(v: number): string {
    if (!Number.isFinite(v)) return "–";
    const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
    return v.toFixed(digits);
  }

  const summary: { key: keyof Stats; label: string }[] = [
    { key: "current", label: "Current" },
    { key: "min", label: "Min" },
    { key: "max", label: "Max" },
    { key: "avg", label: "Avg" },
    { key: "p95", label: "p95" },
  ];
</script>

<section class="flex flex-1 flex-col p-6">
  <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Explore</h1>
      <p class="text-sm text-slate-400">
        単一メトリクスの詳細 · {stats?.count ?? 0} pts in window
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-2 text-xs text-slate-400">
        <span class="uppercase tracking-widest">metric</span>
        <select
          class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
          value={metric}
          onchange={(e) => navigate(`/explore/${e.currentTarget.value}`)}
        >
          {#each METRICS as m (m)}
            <option value={m}>{METRIC_META[m].label}</option>
          {/each}
        </select>
      </label>
      <TimeRangeControls {windowMs} onChange={(v) => (windowMs = v)} />
    </div>
  </header>

  <div
    class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
  >
    {#each summary as s (s.key)}
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <div class="text-[10px] uppercase tracking-widest text-slate-500">
          {s.label}
        </div>
        <div class="mt-1 text-2xl font-semibold tabular-nums">
          {stats ? fmt(stats[s.key] as number) : "–"}
          <span class="text-xs font-normal text-slate-500">{meta.unit}</span>
        </div>
      </div>
    {/each}
  </div>

  <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
    <div
      class="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500"
    >
      <span>{meta.label}</span>
      <span>{meta.unit}</span>
    </div>
    {#key metric}
      <UplotChart
        title={meta.label}
        color={meta.color}
        height={360}
        yRange={meta.yRange}
        onReady={(api) => (handle = api)}
      />
    {/key}
  </div>
</section>
