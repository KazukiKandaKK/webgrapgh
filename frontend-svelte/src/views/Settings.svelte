<script lang="ts">
  import { useWorker } from "../lib/workerController.svelte";
  import { settings, ACCENTS, type Accent } from "../lib/settings.svelte";
  import { TIME_RANGE_PRESETS as PRESETS } from "@shared/constants";

  const controller = useWorker();

  // Endpoint edits are staged in a local draft and only applied (with a reload)
  // on Save, because the live Worker is built from them at App init.
  let wsUrl = $state(settings.current.wsUrl);
  let wsLogsUrl = $state(settings.current.wsLogsUrl);
  let apiBase = $state(settings.current.apiBase);

  const endpointsDirty = $derived(
    wsUrl !== settings.boot.wsUrl ||
      wsLogsUrl !== settings.boot.wsLogsUrl ||
      apiBase !== settings.boot.apiBase,
  );

  function saveEndpoints() {
    settings.update({ wsUrl, wsLogsUrl, apiBase });
    // Rebuild the Worker against the new endpoints.
    window.location.reload();
  }

  // Default range + accent apply live (no reload). Range also pushes to the
  // shared worker immediately.
  function setRange(ms: number | null) {
    settings.update({ defaultRangeMs: ms });
    controller.setRange(ms);
  }

  function setAccent(a: Accent) {
    settings.update({ accent: a });
  }

  function resetAll() {
    settings.reset();
    wsUrl = settings.current.wsUrl;
    wsLogsUrl = settings.current.wsLogsUrl;
    apiBase = settings.current.apiBase;
    controller.setRange(settings.current.defaultRangeMs);
  }

  const accentKeys = Object.keys(ACCENTS) as Accent[];
</script>

<section class="flex flex-1 flex-col gap-6 p-6">
  <header>
    <h1 class="text-2xl font-semibold">Settings</h1>
    <p class="text-sm text-slate-400">
      エンドポイント・既定range・テーマ · localStorage に保存
    </p>
  </header>

  <!-- Endpoints -->
  <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
    <h2 class="text-sm font-semibold text-slate-200">Endpoints</h2>
    <p class="mt-1 text-xs text-slate-500">
      Worker はセッション開始時にこの値で接続します。変更は保存後の再読込で反映されます。
    </p>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <label class="flex flex-col gap-1 text-xs text-slate-400">
        <span class="uppercase tracking-widest">Metrics WS</span>
        <input
          bind:value={wsUrl}
          class="rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-200"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-slate-400">
        <span class="uppercase tracking-widest">Logs WS</span>
        <input
          bind:value={wsLogsUrl}
          class="rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-200"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
        <span class="uppercase tracking-widest">REST API base</span>
        <input
          bind:value={apiBase}
          class="rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-200"
        />
      </label>
    </div>
    <div class="mt-4 flex items-center gap-3">
      <button
        type="button"
        disabled={!endpointsDirty}
        onclick={saveEndpoints}
        class="rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
        style="background-color: var(--accent-soft); color: var(--accent)"
      >
        保存して再読込
      </button>
      {#if endpointsDirty}
        <span class="text-xs text-amber-300">未保存の変更があります</span>
      {/if}
    </div>
  </div>

  <!-- Default range -->
  <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
    <h2 class="text-sm font-semibold text-slate-200">Default time range</h2>
    <p class="mt-1 text-xs text-slate-500">
      起動時とExplore/Metricsの初期表示に使う時間窓。
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
      {#each PRESETS as p (p.label)}
        {@const active = p.windowMs === settings.current.defaultRangeMs}
        <button
          type="button"
          onclick={() => setRange(p.windowMs)}
          class={`rounded px-3 py-1 text-sm font-medium transition ${
            active ? "" : "text-slate-400 hover:bg-slate-800"
          }`}
          style={active
            ? "background-color: var(--accent-soft); color: var(--accent)"
            : ""}
        >
          {p.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Theme -->
  <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
    <h2 class="text-sm font-semibold text-slate-200">Theme accent</h2>
    <p class="mt-1 text-xs text-slate-500">
      ナビ・アクティブ要素のアクセントカラー(即時反映)。
    </p>
    <div class="mt-4 flex flex-wrap gap-3">
      {#each accentKeys as a (a)}
        {@const active = settings.current.accent === a}
        <button
          type="button"
          onclick={() => setAccent(a)}
          class={`flex items-center gap-2 rounded border px-3 py-2 text-sm transition ${
            active
              ? "border-slate-500 bg-slate-800"
              : "border-slate-700 hover:bg-slate-800"
          }`}
        >
          <span
            class="h-4 w-4 rounded-full"
            style={`background-color: ${ACCENTS[a].color}`}
          ></span>
          {ACCENTS[a].label}
        </button>
      {/each}
    </div>
  </div>

  <div>
    <button
      type="button"
      onclick={resetAll}
      class="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-rose-300"
    >
      既定値にリセット
    </button>
  </div>
</section>
