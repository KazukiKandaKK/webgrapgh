<script lang="ts">
  import { onMount } from "svelte";
  import { snapshotStore } from "../lib/snapshots.svelte";
  import { settings } from "../lib/settings.svelte";
  import SnapshotCard from "../components/SnapshotCard.svelte";
  import SnapshotModal from "../components/SnapshotModal.svelte";

  const apiBase = settings.current.apiBase;
  let showModal = $state(false);

  onMount(() => {
    snapshotStore.loadSnapshots(apiBase);
  });

  async function handleDelete(id: number) {
    await snapshotStore.deleteSnapshot(apiBase, id);
  }

  function handleSaved() {
    showModal = false;
    snapshotStore.loadSnapshots(apiBase);
  }
</script>

<div class="flex flex-col gap-6 p-6">
  <header class="flex items-center justify-between">
    <h1 class="text-xl font-semibold text-slate-100">Snapshots</h1>
    <button
      data-testid="snapshots-save-button"
      class="rounded px-3 py-1.5 text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition"
      onclick={() => (showModal = true)}
    >
      Save Snapshot
    </button>
  </header>

  {#if snapshotStore.loading}
    <p class="text-sm text-slate-400">Loading…</p>
  {:else if snapshotStore.error}
    <p class="text-sm text-rose-400">{snapshotStore.error}</p>
  {:else if snapshotStore.snapshots.length === 0}
    <p class="text-sm text-slate-500">No snapshots yet. Click "Save Snapshot" to capture the current metrics.</p>
  {:else}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each snapshotStore.snapshots as snap (snap.id)}
        <SnapshotCard snapshot={snap} onDelete={handleDelete} />
      {/each}
    </div>
  {/if}
</div>

<SnapshotModal open={showModal} onClose={() => (showModal = false)} onSaved={handleSaved} />
