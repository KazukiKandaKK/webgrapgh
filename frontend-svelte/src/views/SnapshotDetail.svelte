<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { snapshotStore, extractSnapshotId } from "../lib/snapshots.svelte";
  import { settings } from "../lib/settings.svelte";
  import { navigate, router } from "../lib/router.svelte";
  import { METRIC_META } from "@shared/constants";
  import type { MetricName } from "../lib/types";
  import UplotChart from "../components/UplotChart.svelte";
  import CommentThread from "../components/CommentThread.svelte";
  import type { UplotChartHandle } from "../lib/chart";

  const apiBase = settings.current.apiBase;
  const id = extractSnapshotId(router.path);

  onMount(() => {
    if (!id) {
      navigate("/snapshots");
      return;
    }
    snapshotStore.reset();
    snapshotStore.loadSnapshot(apiBase, id);
    snapshotStore.loadComments(apiBase, id);
    snapshotStore.connectWS(apiBase, id);
  });

  onDestroy(() => {
    snapshotStore.disconnectWS();
  });

  async function handleDelete() {
    if (!id) return;
    const ok = await snapshotStore.deleteSnapshot(apiBase, id);
    if (ok) navigate("/snapshots");
  }

  function fmt(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  function onChartReady(metricName: string, api: UplotChartHandle) {
    const series = snapshotStore.current?.series_data[metricName];
    if (!series) return;
    api.setData(
      Float64Array.from(series.t.map((ms) => ms / 1000)),
      Float64Array.from(series.v),
    );
  }
</script>

<div class="flex flex-col gap-6 p-6">
  <header class="flex items-center gap-3">
    <button
      class="text-sm text-slate-400 hover:text-slate-200 transition"
      onclick={() => navigate("/snapshots")}
    >
      ← Back
    </button>
    {#if snapshotStore.current}
      <h1 class="flex-1 text-xl font-semibold text-slate-100 truncate">
        {snapshotStore.current.name}
      </h1>
      <time class="text-xs text-slate-400 shrink-0">
        {fmt(snapshotStore.current.created_at)}
      </time>
      <button
        class="rounded px-2 py-1 text-xs bg-rose-900/60 hover:bg-rose-800/80 text-rose-300 transition"
        onclick={handleDelete}
      >
        Delete
      </button>
    {/if}
  </header>

  {#if snapshotStore.loading}
    <p class="text-sm text-slate-400">Loading…</p>
  {:else if snapshotStore.error}
    <p class="text-sm text-rose-400">{snapshotStore.error}</p>
  {:else if snapshotStore.current}
    <!-- One chart per metric -->
    <div class="flex flex-col gap-4">
      {#each snapshotStore.current.metric_names as metricName (metricName)}
        {@const meta = METRIC_META[metricName as MetricName]}
        <section class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
          <h2 class="mb-2 text-sm font-medium text-slate-300">
            {meta?.label ?? metricName}
            {#if meta?.unit}
              <span class="text-slate-500 font-normal">({meta.unit})</span>
            {/if}
          </h2>
          <UplotChart
            title=""
            color={meta?.color ?? "#94a3b8"}
            yRange={meta?.yRange ?? [null, null]}
            onReady={(api) => onChartReady(metricName, api)}
          />
        </section>
      {/each}
    </div>

    <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
      {#if id}
        <CommentThread snapshotId={id} />
      {/if}
    </div>
  {/if}
</div>
