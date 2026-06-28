<script lang="ts">
  import { onMount } from "svelte";
  import { METRICS, type MetricName } from "../lib/types";
  import { METRIC_META } from "@shared/constants";
  import { useWorker } from "../lib/workerController.svelte";
  import { navigate } from "../lib/router.svelte";
  import {
    alerts,
    type Comparator,
    type AlertRule,
  } from "../lib/alerts.svelte";

  const controller = useWorker();
  const COMPARATORS: Comparator[] = [">", ">=", "<", "<="];

  // Live current value per metric, for showing each rule's current reading.
  let latest = $state<Partial<Record<MetricName, number>>>({});
  onMount(() => {
    return controller.onFrame((metrics) => {
      const next: Partial<Record<MetricName, number>> = {};
      for (const name of METRICS) {
        const s = metrics[name];
        if (s && s.v.length > 0) next[name] = s.v[s.v.length - 1];
      }
      latest = next;
    });
  });

  // New-rule form state.
  let draftMetric = $state<MetricName>("cpu");
  let draftCmp = $state<Comparator>(">");
  let draftThreshold = $state(80);

  function addRule() {
    if (!Number.isFinite(draftThreshold)) return;
    alerts.add({
      metric: draftMetric,
      comparator: draftCmp,
      threshold: draftThreshold,
      enabled: true,
    });
  }

  function fmt(v: number | undefined): string {
    if (v === undefined || !Number.isFinite(v)) return "–";
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  }

  function duration(sinceMs: number): string {
    const s = Math.max(0, Math.round((Date.now() - sinceMs) / 1000));
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
  }

  const firingList = $derived(
    Object.values(alerts.firing).sort((a, b) => a.since - b.since),
  );

  function ruleFor(id: string): AlertRule | undefined {
    return alerts.rules.find((r) => r.id === id);
  }
</script>

<section class="flex flex-1 flex-col gap-6 p-6">
  <header>
    <h1 class="text-2xl font-semibold">Alerts</h1>
    <p class="text-sm text-slate-400">
      閾値ルール · {alerts.rules.length} rules ·
      <span class={alerts.firingCount > 0 ? "text-rose-400" : "text-slate-400"}>
        {alerts.firingCount} firing
      </span>
    </p>
  </header>

  <!-- Firing now -->
  <div class="rounded-lg border border-slate-800 bg-slate-900/60">
    <div class="border-b border-slate-800 px-4 py-2 text-sm font-semibold">
      Firing now
    </div>
    {#if firingList.length === 0}
      <div class="px-4 py-6 text-sm text-slate-500">
        発火中のアラートはありません。
      </div>
    {:else}
      <ul>
        {#each firingList as f (f.ruleId)}
          {@const r = ruleFor(f.ruleId)}
          {#if r}
            <li
              class="flex items-center justify-between border-b border-slate-800/60 px-4 py-3 last:border-0"
            >
              <div class="flex items-center gap-3">
                <span class="h-2 w-2 animate-pulse rounded-full bg-rose-500"
                ></span>
                <button
                  type="button"
                  class="text-left text-sm font-medium text-slate-200 hover:underline"
                  style="color: var(--accent)"
                  onclick={() => navigate(`/explore/${r.metric}`)}
                >
                  {METRIC_META[r.metric].label}
                </button>
                <span class="font-mono text-xs text-slate-400">
                  {r.comparator} {r.threshold}{METRIC_META[r.metric].unit}
                </span>
              </div>
              <div class="flex items-center gap-4 text-sm">
                <span class="font-mono text-rose-300">
                  {fmt(f.value)}{METRIC_META[r.metric].unit}
                </span>
                <span class="w-16 text-right font-mono text-xs text-slate-500">
                  {duration(f.since)}
                </span>
              </div>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  </div>

  <!-- Rule list + editor -->
  <div class="rounded-lg border border-slate-800 bg-slate-900/60">
    <div class="border-b border-slate-800 px-4 py-2 text-sm font-semibold">
      Rules
    </div>
    <ul>
      {#each alerts.rules as r (r.id)}
        {@const firing = !!alerts.firing[r.id]}
        <li
          class="flex flex-wrap items-center gap-3 border-b border-slate-800/60 px-4 py-3 last:border-0"
        >
          <input
            type="checkbox"
            checked={r.enabled}
            onchange={() => alerts.toggle(r.id)}
            class="h-4 w-4 accent-sky-500"
          />
          <span class="w-28 text-sm font-medium text-slate-200">
            {METRIC_META[r.metric].label}
          </span>
          <select
            value={r.comparator}
            onchange={(e) =>
              alerts.update(r.id, {
                comparator: e.currentTarget.value as Comparator,
              })}
            class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
          >
            {#each COMPARATORS as c (c)}
              <option value={c}>{c}</option>
            {/each}
          </select>
          <input
            type="number"
            value={r.threshold}
            onchange={(e) =>
              alerts.update(r.id, {
                threshold: Number(e.currentTarget.value),
              })}
            class="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm tabular-nums"
          />
          <span class="text-xs text-slate-500">
            {METRIC_META[r.metric].unit}
          </span>
          <span class="ml-auto font-mono text-xs text-slate-400">
            now {fmt(latest[r.metric])}{METRIC_META[r.metric].unit}
          </span>
          {#if firing}
            <span
              class="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-300"
            >
              firing
            </span>
          {:else if !r.enabled}
            <span
              class="rounded bg-slate-700/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-400"
            >
              off
            </span>
          {:else}
            <span
              class="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300"
            >
              ok
            </span>
          {/if}
          <button
            type="button"
            onclick={() => alerts.remove(r.id)}
            class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-rose-300"
          >
            削除
          </button>
        </li>
      {/each}
    </ul>

    <!-- Add rule -->
    <div
      class="flex flex-wrap items-center gap-3 border-t border-slate-800 px-4 py-3"
    >
      <span class="text-xs uppercase tracking-widest text-slate-500">add</span>
      <select
        bind:value={draftMetric}
        class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
      >
        {#each METRICS as m (m)}
          <option value={m}>{METRIC_META[m].label}</option>
        {/each}
      </select>
      <select
        bind:value={draftCmp}
        class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
      >
        {#each COMPARATORS as c (c)}
          <option value={c}>{c}</option>
        {/each}
      </select>
      <input
        type="number"
        bind:value={draftThreshold}
        class="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm tabular-nums"
      />
      <button
        type="button"
        onclick={addRule}
        class="rounded px-3 py-1 text-sm font-medium"
        style="background-color: var(--accent-soft); color: var(--accent)"
      >
        ＋ ルール追加
      </button>
    </div>
  </div>
</section>
