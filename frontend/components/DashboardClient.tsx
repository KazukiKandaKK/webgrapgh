"use client";

import dynamic from "next/dynamic";

// The dashboard owns a Web Worker, uPlot, and the virtualizer — all require
// `window`. We load it client-side only.
const Dashboard = dynamic(
  () => import("./Dashboard").then((m) => m.Dashboard),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 p-6 text-sm text-slate-500">loading dashboard…</div>
    ),
  }
);

export default function DashboardClient() {
  return <Dashboard />;
}
