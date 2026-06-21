import { WorkerProvider } from "./lib/workerController";
import { Sidebar } from "./components/Sidebar";
import { DashboardGrid } from "./components/DashboardGrid";
import { LogTable } from "./components/LogTable";

export default function App() {
  return (
    <WorkerProvider>
      <div class="flex min-h-screen">
        <Sidebar />
        <main class="flex flex-1 flex-col gap-6 pb-8">
          <DashboardGrid />
          <div class="px-6">
            <LogTable />
          </div>
        </main>
      </div>
    </WorkerProvider>
  );
}
