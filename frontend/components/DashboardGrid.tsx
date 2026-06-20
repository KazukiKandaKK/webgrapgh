"use client";

import { useEffect, useRef, useState } from "react";
import { METRICS, type MetricName } from "@/lib/types";
import { useWorker } from "@/lib/workerContext";
import { UplotChart, type UplotChartHandle } from "./UplotChart";

const METRIC_META: Record<MetricName, { label: string; color: string; unit: string }> = {
  cpu:     { label: "CPU Usage",       color: "#38bdf8", unit: "%" },
  memory:  { label: "Memory Usage",    color: "#a78bfa", unit: "%" },
  network: { label: "Network Through", color: "#f472b6", unit: "MB/s" },
  disk:    { label: "Disk I/O",        color: "#facc15", unit: "%" },
};

type WSStatus = {
  metrics: { state: string; detail?: string };
  logs: { state: string; detail?: string };
};

export function DashboardGrid() {
  const controller = useWorker();
  const chartRefs = useRef<Record<MetricName, UplotChartHandle | null>>({
    cpu: null,
    memory: null,
    network: null,
    disk: null,
  });

  // Status is the only React state. It changes only on connection events.
  const [status, setStatus] = useState<WSStatus>({
    metrics: { state: "init" },
    logs: { state: "init" },
  });

  useEffect(() => {
    const offFrame = controller.onFrame((metrics) => {
      // Imperative fan-out: no React state touched, no re-renders.
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

  return (
    <section className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">System Metrics</h1>
          <p className="text-sm text-slate-400">
            過去 1 時間 + リアルタイム (Worker → uPlot direct setData)
          </p>
        </div>
        <div className="flex gap-2">
          <StatusPill label="metrics" state={status.metrics.state} detail={status.metrics.detail} />
          <StatusPill label="logs" state={status.logs.state} detail={status.logs.detail} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {METRICS.map((name) => {
          const meta = METRIC_META[name];
          return (
            <div
              key={name}
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow"
            >
              <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-slate-500">
                <span>{name}</span>
                <span>{meta.unit}</span>
              </div>
              <UplotChart
                ref={(h) => {
                  chartRefs.current[name] = h;
                }}
                title={meta.label}
                color={meta.color}
                yRange={name === "network" ? [0, null] : [0, 100]}
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
