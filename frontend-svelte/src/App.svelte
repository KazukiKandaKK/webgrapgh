<script lang="ts">
  import { onDestroy } from "svelte";
  import { WorkerController, provideWorker } from "./lib/workerController.svelte";
  import { router } from "./lib/router.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Overview from "./views/Overview.svelte";
  import Metrics from "./views/Metrics.svelte";
  import Logs from "./views/Logs.svelte";

  const env = import.meta.env;
  const wsUrl = env.VITE_WS_URL ?? "ws://localhost:8080/ws";
  const wsLogsUrl = env.VITE_WS_LOGS_URL ?? wsUrl.replace(/\/ws$/, "/ws/logs");
  const apiBase = env.VITE_API_BASE ?? "http://localhost:8080";

  // Single worker for the whole app, shared by every view via context. Views
  // mount/unmount on navigation but the stream and ring buffers stay alive.
  const controller = new WorkerController({ apiBase, wsUrl, wsLogsUrl });
  provideWorker(controller);

  onDestroy(() => controller.stop());
</script>

<div class="flex min-h-screen">
  <Sidebar />
  <main class="flex flex-1 flex-col">
    {#if router.path === "/metrics"}
      <Metrics />
    {:else if router.path === "/logs"}
      <Logs />
    {:else}
      <Overview />
    {/if}
  </main>
</div>
