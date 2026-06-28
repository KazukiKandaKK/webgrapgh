<script lang="ts">
  import { onDestroy } from "svelte";
  import { WorkerController, provideWorker } from "./lib/workerController.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import DashboardGrid from "./components/DashboardGrid.svelte";
  import LogTable from "./components/LogTable.svelte";

  const env = import.meta.env;
  const wsUrl = env.VITE_WS_URL ?? "ws://localhost:8080/ws";
  const wsLogsUrl = env.VITE_WS_LOGS_URL ?? wsUrl.replace(/\/ws$/, "/ws/logs");
  const apiBase = env.VITE_API_BASE ?? "http://localhost:8080";

  const controller = new WorkerController({ apiBase, wsUrl, wsLogsUrl });
  provideWorker(controller);

  onDestroy(() => controller.stop());
</script>

<div class="flex min-h-screen">
  <Sidebar />
  <main class="flex flex-1 flex-col gap-6 pb-8">
    <DashboardGrid />
    <div class="px-6">
      <LogTable />
    </div>
  </main>
</div>
