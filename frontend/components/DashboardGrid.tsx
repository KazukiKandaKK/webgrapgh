"use client";

import { useEffect, useRef, useState } from "react";
import { METRICS, type MetricName } from "@/lib/types";
import { useWorker } from "@/lib/workerContext";
import { TimeRangeControls } from "./TimeRangeControls";
import { UplotChart, type UplotChartHandle } from "./UplotChart";

type MetricMeta = {
  label: string;
  color: string;
  unit: string;
  /** [min, max]; null on either side means auto-fit. */
  yRange: [number | null, number | null];
};

const METRIC_META: Record<MetricName, MetricMeta> = {
  cpu:         { label: "CPU",         color: "#38bdf8", unit: "%",     yRange: [0, 100] },
  memory:      { label: "Memory",      color: "#a78bfa", unit: "%",     yRange: [0, 100] },
  disk:        { label: "Disk",        color: "#facc15", unit: "%",     yRange: [0, 100] },
  network:     { label: "Network",     color: "#f472b6", unit: "MB/s",  yRange: [0, null] },
  gpu:         { label: "GPU",         color: "#34d399", unit: "%",     yRange: [0, 100] },
  requests:    { label: "Requests",    color: "#60a5fa", unit: "req/s", yRange: [0, null] },
  errors:      { label: "Errors",      color: "#fb7185", unit: "err/s", yRange: [0, null] },
  latency_p50: { label: "Latency p50", color: "#fbbf24", unit: "ms",    yRange: [0, null] },
  latency_p99: { label: "Latency p99", color: "#f97316", unit: "ms",    yRange: [0, null] },
  queue:       { label: "Queue Depth", color: "#c084fc", unit: "items", yRange: [0, null] },
};

const CHART_HEIGHT = 180;

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
    const offFrame = controller.onFrame((metrics) => {
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
