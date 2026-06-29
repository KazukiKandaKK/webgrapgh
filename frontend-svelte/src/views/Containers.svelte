<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    CONTAINER_METRIC_META,
    type ContainerMetricMeta,
  } from "@shared/constants";
  import { CONTAINER_METRICS } from "../lib/types";
  import { formatBps, formatBytes } from "@shared/utils";
  import { settings } from "../lib/settings.svelte";
  import {
    containers,
    latest,
    type ContainerState,
  } from "../lib/containers.svelte";
  import Sparkline from "../components/Sparkline.svelte";

  // Derive the container WS endpoint from the metrics WS URL (…/ws → …/ws/containers).
  const { wsUrl, apiBase } = settings.current;
  const wsContainersUrl = wsUrl.replace(/\/ws$/, "/ws/containers");

  onMount(() => containers.start(wsContainersUrl, apiBase));
  onDestroy(() => containers.stop());

  function fmt(meta: ContainerMetricMeta, v: number | undefined): string {
    if (v === undefined || !Number.isFinite(v)) return "–";
    switch (meta.format) {
      case "pct":
        return `${v.toFixed(v >= 10 ? 1 : 2)}%`;
      case "bytes":
        return formatBytes(v);
      case "bps":
        return formatBps(v);
    }
  }

  function spark(c: ContainerState, metric: string): Float64Array {
    const s = c.series[metric];
    return s ? new Float64Array(s.v) : new Float64Array();
  }
</script>

<section class="p-6">
  <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Containers</h1>
      <p class="text-sm text-slate-400">
        {containers.list.length} container{containers.list.length === 1
          ? ""
          : "s"} · live Docker metrics · stream {containers.state}
      </p>
    </div>
  </header>

  {#if containers.list.length === 0}
    <div
      class="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center text-slate-400"
    >
      <p class="text-sm">No container metrics yet.</p>
      <p class="mt-2 text-xs text-slate-500">
        Start the collector with the Docker socket mounted:
        <code class="text-slate-300">docker compose up -d collector</code>
      </p>
    </div>
  {:else}
    <div
      class="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3"
    >
      {#each containers.list as c (c.name)}
        <article
          class="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow"
        >
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="truncate font-mono text-sm font-semibold text-slate-200">
              {c.name}
            </h2>
            <span class="text-[10px] uppercase tracking-widest text-slate-500">
              {CONTAINER_METRICS.length} metrics
            </span>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {#each CONTAINER_METRICS as metric (metric)}
              {@const meta = CONTAINER_METRIC_META[metric]}
              {@const v = latest(c, metric)}
              <div class="flex flex-col gap-1">
                <div class="flex items-baseline justify-between">
                  <span class="text-xs text-slate-400">{meta.label}</span>
                </div>
                <span
                  class="text-lg font-semibold tabular-nums"
                  style={`color: ${meta.color}`}>{fmt(meta, v)}</span
                >
                <Sparkline values={spark(c, metric)} color={meta.color} />
              </div>
            {/each}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>
