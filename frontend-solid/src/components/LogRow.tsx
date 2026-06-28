import { levelClass, formatLogTime } from "@shared/utils";

/**
 * Pure log row. Solid only re-runs the fine-grained reactive expressions
 * that depend on changed props — there's no virtual-DOM diff to skip, so
 * unlike the React version this doesn't need React.memo.
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

export function LogRow(props: LogRowProps) {
  const time = () => formatLogTime(props.timeMs);

  return (
    <div
      style={{
        position: "absolute",
        top: props.topPx + "px",
        left: 0,
        right: 0,
        height: props.heightPx + "px",
      }}
      class="flex items-center gap-3 border-b border-slate-800/60 px-4 hover:bg-slate-800/40"
    >
      <span class="w-24 shrink-0 text-slate-500">{time()}</span>
      <span class={`w-14 shrink-0 font-semibold ${levelClass(props.level)}`}>
        {props.level || "·"}
      </span>
      <span class="w-20 shrink-0 truncate text-slate-400">{props.source}</span>
      <span class="flex-1 truncate text-slate-200">{props.message}</span>
    </div>
  );
}


