<script lang="ts">
  import { useWorker } from "../lib/workerController.svelte";
  import { snapshotStore, type MetricSeries } from "../lib/snapshots.svelte";
  import { settings } from "../lib/settings.svelte";
  import { METRICS, type MetricName } from "../lib/types";

  type Props = {
    open: boolean;
    onClose: () => void;
    onSaved: () => void;
  };

  let { open, onClose, onSaved }: Props = $props();

  const controller = useWorker();
  const apiBase = settings.current.apiBase;

  let name = $state("");
  let selectedMetrics = $state(new Set<string>(METRICS));
  let capturedFrame: Record<string, MetricSeries> | null = $state(null);
  let rangeMinutes = $state(60);
  let saving = $state(false);
  let error: string | null = $state(null);

  $effect(() => {
    if (!open) {
      capturedFrame = null;
      name = "";
      error = null;
      selectedMetrics = new Set(METRICS);
      return;
    }
    const ms = settings.current.defaultRangeMs;
    rangeMinutes = ms != null
      ? Math.max(1, Math.min(1440, Math.round(ms / 60000)))
      : 60;

    const off = controller.onFrame((metrics) => {
      const snap: Record<string, MetricSeries> = {};
      for (const metric of METRICS) {
        const s = metrics[metric as MetricName];
        // s.t is in seconds (worker divides by 1000); convert to ms integers for backend []int64
      if (s) snap[metric] = { t: Array.from(s.t, (sec) => Math.round(sec * 1000)), v: Array.from(s.v) };
      }
      capturedFrame = snap;
      off();
    });
    return () => off();
  });

  function toggleMetric(metric: string) {
    const next = new Set(selectedMetrics);
    if (next.has(metric)) next.delete(metric);
    else next.add(metric);
    selectedMetrics = next;
  }

  function selectAll() { selectedMetrics = new Set(METRICS); }
  function deselectAll() { selectedMetrics = new Set(); }

  function validateForm(): string | null {
    if (name.trim() === "") return "Snapshot name is required";
    if (name.length > 255) return "Name too long (max 255 chars)";
    if (selectedMetrics.size === 0) return "Select at least one metric";
    return null;
  }

  async function handleSave() {
    error = validateForm();
    if (error) return;

    const seriesData: Record<string, MetricSeries> = {};
    for (const m of selectedMetrics) {
      if (capturedFrame?.[m]) seriesData[m] = capturedFrame[m];
    }

    saving = true;
    error = null;
    const snap = await snapshotStore.createSnapshot(
      apiBase,
      name.trim(),
      [...selectedMetrics],
      seriesData,
      rangeMinutes,
    );
    saving = false;

    if (snap) {
      onSaved();
    } else {
      error = snapshotStore.error ?? "Failed to save snapshot";
    }
  }
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-40 bg-black/60"
    role="presentation"
    onclick={onClose}
  ></div>

  <!-- Dialog -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Save Snapshot"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
  >
    <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 flex flex-col gap-4 shadow-2xl">
      <h2 class="text-lg font-semibold text-slate-100">Save Snapshot</h2>

      <label class="flex flex-col gap-1 text-sm text-slate-300">
        Snapshot Name
        <input
          data-testid="snapshot-modal-name-input"
          type="text"
          placeholder="e.g. CPU spike at 14:30"
          bind:value={name}
          class="rounded bg-slate-800 border border-slate-700 px-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
        />
      </label>

      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm text-slate-300 mb-1">Include Metrics</legend>
        <div class="flex gap-2 text-xs">
          <button class="text-slate-400 hover:text-slate-200 underline" onclick={selectAll}>Select all</button>
          <button class="text-slate-400 hover:text-slate-200 underline" onclick={deselectAll}>Deselect all</button>
        </div>
        <div class="grid grid-cols-2 gap-1">
          {#each METRICS as metric (metric)}
            <label class="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                data-testid="snapshot-modal-metric-{metric}"
                type="checkbox"
                checked={selectedMetrics.has(metric)}
                onchange={() => toggleMetric(metric)}
                class="accent-sky-500"
              />
              {metric}
            </label>
          {/each}
        </div>
      </fieldset>

      {#if !capturedFrame}
        <p class="text-xs text-slate-500 italic">Waiting for live data…</p>
      {/if}

      {#if error}
        <p class="text-xs text-rose-400">{error}</p>
      {/if}

      <div class="flex justify-end gap-2 pt-2">
        <button
          data-testid="snapshot-modal-cancel-button"
          class="rounded px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 transition"
          onclick={onClose}
        >
          Cancel
        </button>
        <button
          data-testid="snapshot-modal-save-button"
          class="rounded px-3 py-1.5 text-sm font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition"
          disabled={saving || !capturedFrame || selectedMetrics.size === 0}
          onclick={handleSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  </div>
{/if}
