<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { WorkerController, provideWorker } from "./lib/workerController.svelte";
  import { router } from "./lib/router.svelte";
  import { settings, ACCENTS } from "./lib/settings.svelte";
  import { alerts } from "./lib/alerts.svelte";
  import { METRICS, type MetricName } from "./lib/types";
  import Sidebar from "./components/Sidebar.svelte";
  import Overview from "./views/Overview.svelte";
  import Metrics from "./views/Metrics.svelte";
  import Containers from "./views/Containers.svelte";
  import Explore from "./views/Explore.svelte";
  import Logs from "./views/Logs.svelte";
  import Alerts from "./views/Alerts.svelte";
  import Settings from "./views/Settings.svelte";

  // Endpoints come from settings (localStorage override → env default). They are
  // read once here; changing them in Settings requires a reload to rebuild the
  // Worker, which is intentional (a single long-lived connection per session).
  const { wsUrl, wsLogsUrl, apiBase } = settings.current;

  // Single worker for the whole app, shared by every view via context. Views
  // mount/unmount on navigation but the stream and ring buffers stay alive.
  // The worker keeps ingesting WS data into the ring buffers continuously; the
  // flush rates below only govern how often the UI is repainted. 1 Hz is plenty
  // for an at-a-glance dashboard and keeps the main thread near-idle.
  const controller = new WorkerController({
    apiBase,
    wsUrl,
    wsLogsUrl,
    flushHz: 1,
    logTotalHz: 1,
  });
  provideWorker(controller);

  // Apply the accent color as CSS variables so themed bits (nav, active range)
  // restyle live without a reload.
  $effect(() => {
    const a = ACCENTS[settings.current.accent];
    const root = document.documentElement;
    root.style.setProperty("--accent", a.color);
    root.style.setProperty("--accent-soft", a.soft);
  });

  onMount(() => {
    controller.setRange(settings.current.defaultRangeMs);
    // App-level alert evaluation: one subscription drives the firing state used
    // by every screen + the sidebar badge.
    const off = controller.onFrame((metrics) => {
      const latest: Partial<Record<MetricName, number>> = {};
      for (const name of METRICS) {
        const s = metrics[name];
        if (s && s.v.length > 0) latest[name] = s.v[s.v.length - 1];
      }
      alerts.evaluate(latest);
    });
    return off;
  });

  onDestroy(() => controller.stop());
</script>

<div class="flex min-h-screen">
  <Sidebar />
  <main class="flex flex-1 flex-col">
    {#if router.path === "/metrics"}
      <Metrics />
    {:else if router.path === "/containers"}
      <Containers />
    {:else if router.section === "/explore"}
      <Explore />
    {:else if router.path === "/logs"}
      <Logs />
    {:else if router.path === "/alerts"}
      <Alerts />
    {:else if router.path === "/settings"}
      <Settings />
    {:else}
      <Overview />
    {/if}
  </main>
</div>
