"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Props = {
  metrics: readonly string[];
};

// Sidebar is a static UI shell. It deliberately holds NO realtime state.
// The Worker → uPlot path bypasses React entirely so this component never
// re-renders on data updates.
export function Sidebar({ metrics }: Props) {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    setNow(new Date().toLocaleString());
    const id = setInterval(() => setNow(new Date().toLocaleString()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-800 bg-slate-900/60 p-5 md:block">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-slate-500">
          webgrapgh
        </div>
        <div className="mt-1 text-lg font-semibold">Realtime Dashboard</div>
      </div>

      <nav>
        <div className="mb-2 text-xs uppercase tracking-widest text-slate-500">
          Metrics
        </div>
        <ul className="space-y-1">
          {metrics.map((m) => (
            <li
              key={m}
              className="rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
            >
              {m}
            </li>
          ))}
        </ul>

        <div className="mb-2 mt-6 text-xs uppercase tracking-widest text-slate-500">
          Tools
        </div>
        <ul className="space-y-1">
          <li>
            <Link
              href="/whiteboard"
              className="block rounded px-2 py-1 text-sm text-sky-300 hover:bg-slate-800"
            >
              ✏️ whiteboard (CRDT)
            </Link>
          </li>
        </ul>
      </nav>

      <div className="mt-10 text-xs text-slate-500">
        <div>main thread: React UI shell only</div>
        <div>worker: WS + parse + downsample</div>
        <div>render: uPlot (Canvas)</div>
        <div className="mt-4 font-mono text-[10px] text-slate-600">{now}</div>
      </div>
    </aside>
  );
}
