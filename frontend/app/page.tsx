import { Sidebar } from "@/components/Sidebar";
import DashboardClient from "@/components/DashboardClient";
import { METRICS } from "@/lib/types";

export default function Page() {
  return (
    <div className="flex min-h-screen">
      <Sidebar metrics={METRICS} />
      <main className="flex flex-1 flex-col">
        <DashboardClient />
      </main>
    </div>
  );
}
