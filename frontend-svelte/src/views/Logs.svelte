<script lang="ts">
  import { useWorker } from "../lib/workerController.svelte";
  import {
    type LogFilter,
    emptyFilter,
    isFilterActive,
  } from "../lib/logFilter";
  import LogTable from "../components/LogTable.svelte";
  import FilteredLogTable from "../components/FilteredLogTable.svelte";
  import LogFilters from "../components/LogFilters.svelte";

  const controller = useWorker();

  let filter = $state<LogFilter>(emptyFilter());
  let matched = $state(0);
  let scanned = $state(0);

  const active = $derived(isFilterActive(filter));

  function patch(p: Partial<LogFilter>) {
    filter = { ...filter, ...p };
  }

  function clear() {
    filter = { ...emptyFilter(), windowCount: filter.windowCount };
  }
</script>

<section class="flex flex-1 flex-col gap-4 p-6">
  <header class="flex flex-wrap items-center justify-between gap-3">
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

  <LogFilters
    levels={filter.levels}
    source={filter.source}
    search={filter.search}
    windowCount={filter.windowCount}
    {matched}
    {scanned}
    onChange={patch}
    onClear={clear}
  />

  {#if active}
    <FilteredLogTable
      {filter}
      onCounts={(m, s) => {
        matched = m;
        scanned = s;
      }}
    />
  {:else}
    <LogTable />
  {/if}
</section>
