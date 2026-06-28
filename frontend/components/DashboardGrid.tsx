"use client";

import { useEffect, useRef, useState } from "react";
import { METRICS, type MetricName } from "@/lib/types";
import { useWorker } from "@/lib/workerContext";
import { METRIC_META, CHART_HEIGHT } from "@shared/constants";
import { TimeRangeControls } from "./TimeRangeControls";
import { UplotChart, type UplotChartHandle } from "./UplotChart";

type WSStatus = {
  metrics: { state: string; detail?: string };
  logs: { state: string; detail?: string };
};

export function DashboardGrid() {
  const controller = useWorker();
  const chartRefs = useRef<Record<MetricName, UplotChartHandle | null>>(
    METRICS.reduce(
      (acc, name) => {
        acc[name] = null;
        return acc;
      },
      {} as Record<MetricName, UplotChartHandle | null>
    )
  );

  // Status is the only React state on the hot path. It changes only on
  // connection events. The time range is also React state but updates only
  // on user click — no re-renders during streaming.
  const [status, setStatus] = useState<WSStatus>({
    metrics: { state: "init" },
    logs: { state: "init" },
  });
  const [windowMs, setWindowMs] = useState<number | null>(5 * 60_000);

  // Subscribe to worker frames (imperative fan-out — no React rerenders).
  useEffect(() => {
    let firstFrameLogged = false;
    const offFrame = controller.onFrame((metrics) => {
      if (!firstFrameLogged) {
        firstFrameLogged = true;
        const refsReady = METRICS.filter((m) => chartRefs.current[m] !== null).length;
        const firstMetric = METRICS.find((m) => metrics[m]);
        const sample = firstMetric ? metrics[firstMetric] : undefined;
        // eslint-disable-next-line no-console
        console.info(
          `[grid] first onFrame: ${Object.keys(metrics).length} metrics, ` +
            `${refsReady}/${METRICS.length} chart refs ready, ` +
            `sample ${firstMetric}: ${sample?.t.length ?? 0} pts`
        );
      }
      for (const name of METRICS) {
        const series = metrics[name];
        if (!series) continue;
        chartRefs.current[name]?.setData(series.t, series.v);
      }
    });
    const offStatus = controller.onStatus((channel, state, detail) => {
      setStatus((prev) => ({ ...prev, [channel]: { state, detail } }));
    });
    return () => {
      offFrame();
      offStatus();
    };
  }, [controller]);

  // Push range changes to the worker. The worker re-flushes immediately.
  useEffect(() => {
    controller.setRange(windowMs);
  }, [controller, windowMs]);

  return (
    <section className="p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">System Metrics</h1>
          <p className="text-sm text-slate-400">
            {METRICS.length} metrics · Worker → uPlot direct setData
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TimeRangeControls windowMs={windowMs} onChange={setWindowMs} />
          <div className="flex gap-2">
            <StatusPill label="metrics" state={status.metrics.state} detail={status.metrics.detail} />
            <StatusPill label="logs" state={status.logs.state} detail={status.logs.detail} />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {METRICS.map((name) => {
          const meta = METRIC_META[name];
          return (
            <div
              key={name}
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 shadow"
            >
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
                <span>{name}</span>
                <span>{meta.unit}</span>
              </div>
              <UplotChart
                ref={(h) => {
                  chartRefs.current[name] = h;
                }}
                title={meta.label}
                color={meta.color}
                height={CHART_HEIGHT}
                yRange={meta.yRange}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatusPill({
  label,
  state,
  detail,
}: {
  label: string;
  state: string;
  detail?: string;
}) {
  const color =
    state === "open"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-700"
      : state === "error"
        ? "bg-rose-500/20 text-rose-300 border-rose-700"
        : "bg-slate-500/20 text-slate-300 border-slate-700";
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-medium ${color}`}
      title={detail ?? ""}
    >
      {label}: {state}
    </span>
  );
}
