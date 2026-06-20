"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { METRICS } from "@/lib/types";
import { startWorker, type WorkerController } from "@/lib/workerBridge";

const Context = createContext<WorkerController | null>(null);

/**
 * Spawns the data Worker once for the page and exposes a single controller
 * via React context. DashboardGrid and LogTable both consume the same worker
 * via `useWorker()`.
 */
export function WorkerProvider({ children }: { children: React.ReactNode }) {
  const [controller, setController] = useState<WorkerController | null>(null);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";
    const wsLogsUrl =
      process.env.NEXT_PUBLIC_WS_LOGS_URL ??
      wsUrl.replace(/\/ws$/, "/ws/logs");

    const c = startWorker({
      apiBase: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080",
      wsUrl,
      wsLogsUrl,
      metrics: METRICS,
      bufferSize: 5000,
      maxRenderPoints: 2000,
      flushHz: 30,
      logBufferSize: 30000,
      logTotalHz: 5,
    });
    setController(c);
    return () => c.stop();
  }, []);

  if (!controller) {
    return (
      <div className="flex-1 p-6 text-sm text-slate-500">connecting…</div>
    );
  }
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}

export function useWorker(): WorkerController {
  const c = useContext(Context);
  if (!c) throw new Error("useWorker must be used inside <WorkerProvider>");
  return c;
}
