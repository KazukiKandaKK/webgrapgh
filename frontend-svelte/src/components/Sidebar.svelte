<script lang="ts">
  import { onMount } from "svelte";
  import { ROUTES, router, navigate, isActive } from "../lib/router.svelte";
  import { useWorker } from "../lib/workerController.svelte";
  import { alerts } from "../lib/alerts.svelte";
  import StatusPill from "./StatusPill.svelte";

  const controller = useWorker();

  let now = $state("");
  onMount(() => {
    now = new Date().toLocaleString();
    const id = setInterval(() => (now = new Date().toLocaleString()), 1000);
    return () => clearInterval(id);
  });
</script>

<aside
  class="hidden w-64 shrink-0 border-r border-slate-800 bg-slate-900/60 p-5 md:flex md:flex-col"
>
  <div class="mb-6">
    <div class="text-xs uppercase tracking-widest text-slate-500">webgrapgh</div>
    <div class="mt-1 text-lg font-semibold">Realtime Dashboard</div>
    <div
      class="mt-1 text-[10px] uppercase tracking-widest"
      style="color: var(--accent)"
    >
      Svelte edition
    </div>
  </div>

  <nav class="space-y-1">
    {#each ROUTES as r (r.path)}
      {@const active = isActive(r.path, router.path)}
      <button
        type="button"
        onclick={() => navigate(r.path)}
        class={`flex w-full items-center gap-3 rounded px-3 py-2 text-sm transition ${
          active ? "" : "text-slate-300 hover:bg-slate-800"
        }`}
        style={active
          ? "background-color: var(--accent-soft); color: var(--accent)"
          : ""}
      >
        <span class="w-4 text-center">{r.icon}</span>
        <span class="flex-1 text-left">{r.label}</span>
        {#if r.path === "/alerts" && alerts.firingCount > 0}
          <span
            class="rounded-full bg-rose-500/90 px-1.5 text-[10px] font-semibold text-white"
          >
            {alerts.firingCount}
          </span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="mt-6">
    <div class="mb-2 text-xs uppercase tracking-widest text-slate-500">
      Streams
    </div>
    <div class="flex flex-col gap-2">
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

  <div class="mt-auto pt-10 text-xs text-slate-500">
    <div>main thread: Svelte UI shell only</div>
    <div>worker: WS + parse + downsample</div>
    <div>render: uPlot (Canvas)</div>
    <div class="mt-4 font-mono text-[10px] text-slate-600">{now}</div>
  </div>
</aside>
