"use client";

import dynamic from "next/dynamic";

// CanvasBoard owns a Web Worker and a <canvas>. Both require `window`, so
// disable SSR. The dynamic boundary must live inside a client component
// (Next.js 14 rejects ssr:false in server components).
const CanvasBoard = dynamic(
  () => import("./CanvasBoard").then((m) => m.CanvasBoard),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 p-6 text-sm text-slate-500">
        loading canvas…
      </div>
    ),
  },
);

export default function WhiteboardClient() {
  return <CanvasBoard />;
}
