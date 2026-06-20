"use client";

import dynamic from "next/dynamic";

// The dashboard owns a Web Worker and uPlot — both require `window`. We load
// it client-side only. This file exists purely so `ssr:false` can live inside
// a client boundary (Next.js 14 disallows ssr:false in server components).
const DashboardGrid = dynamic(
  () => import("./DashboardGrid").then((m) => m.DashboardGrid),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 p-6 text-sm text-slate-500">loading dashboard…</div>
    ),
  }
);

export default function DashboardClient() {
  return <DashboardGrid />;
}
