"use client";

import { WorkerProvider } from "@/lib/workerContext";
import { DashboardGrid } from "./DashboardGrid";
import { LogTable } from "./LogTable";

/**
 * Page composition under the shared Worker context. Grid + log table both
 * subscribe to the same worker instance.
 */
export function Dashboard() {
  return (
    <WorkerProvider>
      <div className="flex flex-1 flex-col gap-6 pb-8">
        <DashboardGrid />
        <div className="px-6">
          <LogTable />
        </div>
      </div>
    </WorkerProvider>
  );
}
