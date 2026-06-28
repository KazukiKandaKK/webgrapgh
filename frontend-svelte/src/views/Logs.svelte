<script lang="ts">
  import { useWorker } from "../lib/workerController.svelte";
  import LogTable from "../components/LogTable.svelte";

  const controller = useWorker();
</script>

<section class="flex flex-1 flex-col p-6">
  <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Logs</h1>
      <p class="text-sm text-slate-400">
        Virtualized · full dataset held in the worker · Svelte
      </p>
    </div>
    <div class="text-sm text-slate-400">
      {controller.logTotal.toLocaleString()} entries
    </div>
  </header>

  <LogTable />
</section>
