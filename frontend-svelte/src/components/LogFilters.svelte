<script lang="ts">
  import { LOG_LEVELS } from "../lib/logFilter";
  import { levelClass } from "@shared/utils";

  type Props = {
    levels: Set<string>;
    source: string;
    search: string;
    windowCount: number;
    matched: number;
    scanned: number;
    onChange: (patch: {
      levels?: Set<string>;
      source?: string;
      search?: string;
      windowCount?: number;
    }) => void;
    onClear: () => void;
  };

  let {
    levels,
    source,
    search,
    windowCount,
    matched,
    scanned,
    onChange,
    onClear,
  }: Props = $props();

  const WINDOWS = [500, 1000, 2000, 5000];

  function toggleLevel(level: string) {
    const next = new Set(levels);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    onChange({ levels: next });
  }

  const active = $derived(
    levels.size > 0 || source.trim() !== "" || search.trim() !== "",
  );
</script>

<div
  class="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3"
>
  <div class="flex items-center gap-1">
    <span class="mr-1 text-[10px] uppercase tracking-widest text-slate-500">
      level
    </span>
    {#each LOG_LEVELS as level (level)}
      {@const on = levels.has(level)}
      <button
        type="button"
        onclick={() => toggleLevel(level)}
        class={`rounded border px-2 py-1 text-xs font-semibold transition ${levelClass(
          level,
        )} ${on ? "border-slate-400 bg-slate-700/60" : "border-slate-700 hover:bg-slate-800"}`}
      >
        {level}
      </button>
    {/each}
  </div>

  <input
    value={source}
    oninput={(e) => onChange({ source: e.currentTarget.value })}
    placeholder="source…"
    class="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
  />

  <input
    value={search}
    oninput={(e) => onChange({ search: e.currentTarget.value })}
    placeholder="message を検索…"
    class="w-56 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
  />

  <label class="flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-500">
    window
    <select
      value={windowCount}
      onchange={(e) => onChange({ windowCount: Number(e.currentTarget.value) })}
      class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
    >
      {#each WINDOWS as w (w)}
        <option value={w}>{w.toLocaleString()}</option>
      {/each}
    </select>
  </label>

  {#if active}
    <span class="font-mono text-xs text-slate-400">
      {matched.toLocaleString()} / {scanned.toLocaleString()}
    </span>
    <button
      type="button"
      onclick={onClear}
      class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
    >
      クリア
    </button>
  {/if}
</div>
