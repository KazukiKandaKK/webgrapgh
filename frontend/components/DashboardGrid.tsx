"use client";

import { useEffect, useRef, useState } from "react";
import { METRICS, type MetricName } from "@/lib/types";
import { startWorker } from "@/lib/workerBridge";
import { UplotChart, type UplotChartHandle } from "./UplotChart";

const METRIC_META: Record<MetricName, { label: string; color: string; unit: string }> = {
  cpu:     { label: "CPU Usage",       color: "#38bdf8", unit: "%" },
  memory:  { label: "Memory Usage",    color: "#a78bfa", unit: "%" },
  network: { label: "Network Through", color: "#f472b6", unit: "MB/s" },
  disk:    { label: "Disk I/O",        color: "#facc15", unit: "%" },
};

export function DashboardGrid() {
  const chartRefs = useRef<Record<MetricName, UplotChartHandle | null>>({
    cpu: null,
    memory: null,
    network: null,
    disk: null,
  });

  // status is the *only* React state on this page. It's only updated when the
  // WS connection state changes — never per-frame.
  const [status, setStatus] = useState<{ state: string; detail?: string }>({
    state: "init",
  });

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";

    const stop = startWorker({
      apiBase,
      wsUrl,
      metrics: METRICS,
      bufferSize: 5000,
      maxRenderPoints: 2000,
      flushHz: 30,
      onStatus: (state, detail) => setStatus({ state, detail }),
      onFrame: (metrics) => {
        // Imperative fan-out: no React state touched, no re-renders.
        for (const name of METRICS) {
          const series = metrics[name];
          if (!series) continue;
          chartRefs.current[name]?.setData(series.t, series.v);
        }
      },
    });
    return stop;
  }, []);

  return (
    <section className="flex-1 p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">System Metrics</h1>
          <p className="text-sm text-slate-400">
            過去 1 時間 + リアルタイム (Worker → uPlot direct setData)
          </p>
        </div>
        <StatusPill state={status.state} detail={status.detail} />
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

function StatusPill({ state, detail }: { state: string; detail?: string }) {
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
      ws: {state}
      {detail ? ` (${detail})` : ""}
    </span>
  );
}
