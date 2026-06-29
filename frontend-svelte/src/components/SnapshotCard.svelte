<script lang="ts">
  import { navigate } from "../lib/router.svelte";
  import type { SnapshotSummary } from "../lib/snapshots.svelte";

  type Props = {
    snapshot: SnapshotSummary;
    onDelete: (id: number) => void;
  };

  let { snapshot, onDelete }: Props = $props();

  function fmt(iso: string): string {
    return new Date(iso).toLocaleString();
  }
</script>

<article
  data-testid="snapshot-card-{snapshot.id}"
  class="rounded-lg border border-slate-700 bg-slate-800/60 p-4 flex flex-col gap-3"
>
  <header class="flex items-start justify-between gap-2">
    <span class="font-semibold text-slate-100 truncate">{snapshot.name}</span>
    <time class="text-xs text-slate-400 shrink-0">{fmt(snapshot.created_at)}</time>
  </header>

  <div class="flex flex-wrap gap-1">
    {#each snapshot.metric_names as m (m)}
      <span class="rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-700 text-slate-300">
        {m}
      </span>
    {/each}
  </div>

  <footer class="flex items-center gap-3 text-xs text-slate-400">
    <span>💬 {snapshot.comment_count}</span>
    <span>{snapshot.range_minutes}min</span>
    <div class="ml-auto flex gap-2">
      <button
        class="rounded px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 transition"
        onclick={() => navigate(`/snapshots/${snapshot.id}`)}
      >
        View
      </button>
      <button
        data-testid="snapshot-card-delete-{snapshot.id}"
        class="rounded px-2 py-1 text-xs bg-rose-900/60 hover:bg-rose-800/80 text-rose-300 transition"
        onclick={() => onDelete(snapshot.id)}
      >
        Delete
      </button>
    </div>
  </footer>
</article>
