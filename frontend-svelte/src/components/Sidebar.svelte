<script lang="ts">
  import { onMount } from "svelte";
  import { METRICS } from "../lib/types";

  let now = $state("");

  onMount(() => {
    now = new Date().toLocaleString();
    const id = setInterval(() => (now = new Date().toLocaleString()), 1000);
    return () => clearInterval(id);
  });
</script>

<aside
  class="hidden w-64 shrink-0 border-r border-slate-800 bg-slate-900/60 p-5 md:block"
>
  <div class="mb-6">
    <div class="text-xs uppercase tracking-widest text-slate-500">webgrapgh</div>
    <div class="mt-1 text-lg font-semibold">Realtime Dashboard</div>
    <div class="mt-1 text-[10px] uppercase tracking-widest text-sky-400/70">
      Svelte edition
    </div>
  </div>

  <nav>
    <div class="mb-2 text-xs uppercase tracking-widest text-slate-500">
      Metrics
    </div>
    <ul class="space-y-1">
      {#each METRICS as m (m)}
        <li class="rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800">
          {m}
        </li>
      {/each}
    </ul>
  </nav>

  <div class="mt-10 text-xs text-slate-500">
    <div>main thread: Svelte UI shell only</div>
    <div>worker: WS + parse + downsample</div>
    <div>render: uPlot (Canvas)</div>
    <div class="mt-4 font-mono text-[10px] text-slate-600">{now}</div>
  </div>
</aside>
