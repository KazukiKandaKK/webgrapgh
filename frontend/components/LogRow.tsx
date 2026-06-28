"use client";

import { memo } from "react";
import { levelClass, formatLogTime } from "@shared/utils";

/**
 * Pure log row. Props are all primitives so React.memo's default shallow
 * equality is enough to skip re-renders for unchanged rows. Never accept
 * objects here.
 */
export type LogRowProps = {
  topPx: number;
  heightPx: number;
  id: number;
  timeMs: number;
  level: string;
  source: string;
  message: string;
};

export const LogRow = memo(function LogRow({
  topPx,
  heightPx,
  timeMs,
  level,
  source,
  message,
}: LogRowProps) {
  const time = formatLogTime(timeMs);
  return (
    <div
      style={{
        position: "absolute",
        top: topPx,
        left: 0,
        right: 0,
        height: heightPx,
      }}
      className="flex items-center gap-3 border-b border-slate-800/60 px-4 hover:bg-slate-800/40"
    >
      <span className="w-24 shrink-0 text-slate-500">{time}</span>
      <span className={`w-14 shrink-0 font-semibold ${levelClass(level)}`}>
        {level || "·"}
      </span>
      <span className="w-20 shrink-0 truncate text-slate-400">{source}</span>
      <span className="flex-1 truncate text-slate-200">{message}</span>
    </div>
  );
});


