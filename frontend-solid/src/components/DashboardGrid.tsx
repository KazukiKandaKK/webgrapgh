import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { METRICS, type MetricName } from "../lib/types";
import { useWorker } from "../lib/workerController";
import { METRIC_META, CHART_HEIGHT } from "@shared/constants";
import { TimeRangeControls } from "./TimeRangeControls";
import { UplotChart, type UplotChartHandle } from "./UplotChart";

export function DashboardGrid() {
  const controller = useWorker();

  // Imperative chart handles keyed by metric. Filled by UplotChart.onReady.
  // Plain Map (not a signal) — Solid doesn't need this to be reactive.
  const chartHandles = new Map<MetricName, UplotChartHandle>();

  // Default window: 5 minutes. Updated on user click; the effect below pushes
  // the change to the worker which immediately re-flushes.
  const [windowMs, setWindowMs] = createSignal<number | null>(5 * 60_000);

  let firstFrameLogged = false;
  onMount(() => {
    const offFrame = controller.onFrame((metrics) => {
      if (!firstFrameLogged) {
        firstFrameLogged = true;
        const refsReady = METRICS.filter((m) => chartHandles.has(m)).length;
        const firstMetric = METRICS.find((m) => metrics[m]);
        const sample = firstMetric ? metrics[firstMetric] : undefined;
        // eslint-disable-next-line no-console
        console.info(
          `[grid] first onFrame: ${Object.keys(metrics).length} metrics, ` +
            `${refsReady}/${METRICS.length} chart refs ready, ` +
            `sample ${firstMetric}: ${sample?.t.length ?? 0} pts`,
        );
      }
      for (const name of METRICS) {
        const series = metrics[name];
        if (!series) continue;
        chartHandles.get(name)?.setData(series.t, series.v);
      }
    });
    onCleanup(offFrame);
  });

  // Push range changes whenever the signal value changes.
  createEffect(() => {
    controller.setRange(windowMs());
  });

  return (
    <section class="p-6">
      <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold">System Metrics</h1>
          <p class="text-sm text-slate-400">
            {METRICS.length} metrics · Worker → uPlot direct setData · SolidJS
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <TimeRangeControls
            windowMs={windowMs()}
            onChange={(v) => setWindowMs(v)}
          />
          <div class="flex gap-2">
            <StatusPill
              label="metrics"
              state={controller.status().metrics.state}
              detail={controller.status().metrics.detail}
            />
            <StatusPill
              label="logs"
              state={controller.status().logs.state}
              detail={controller.status().logs.detail}
            />
          </div>
        </div>
      </header>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        <For each={METRICS}>
          {(name) => {
            const meta = METRIC_META[name];
            return (
              <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-3 shadow">
                <div class="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
                  <span>{name}</span>
                  <span>{meta.unit}</span>
                </div>
                <UplotChart
                  title={meta.label}
                  color={meta.color}
                  height={CHART_HEIGHT}
                  yRange={meta.yRange}
                  onReady={(api) => chartHandles.set(name, api)}
                />
              </div>
            );
          }}
        </For>
      </div>
    </section>
  );
}

function StatusPill(props: { label: string; state: string; detail?: string }) {
  const color = () => {
    switch (props.state) {
      case "open":
        return "bg-emerald-500/20 text-emerald-300 border-emerald-700";
      case "error":
        return "bg-rose-500/20 text-rose-300 border-rose-700";
      default:
        return "bg-slate-500/20 text-slate-300 border-slate-700";
    }
  };
  return (
    <span
      class={`rounded-full border px-3 py-1 text-xs font-medium ${color()}`}
      title={props.detail ?? ""}
    >
      {props.label}: {props.state}
    </span>
  );
}
