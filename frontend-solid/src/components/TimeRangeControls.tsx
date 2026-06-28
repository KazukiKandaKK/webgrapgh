import { For } from "solid-js";
import { TIME_RANGE_PRESETS } from "@shared/constants";

type Props = {
  windowMs: number | null;
  onChange: (windowMs: number | null) => void;
};

export function TimeRangeControls(props: Props) {
  return (
    <div class="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
      <span class="px-2 text-xs uppercase tracking-widest text-slate-500">
        range
      </span>
      <For each={TIME_RANGE_PRESETS}>
        {(p) => {
          const active = () => p.windowMs === props.windowMs;
          return (
            <button
              type="button"
              onClick={() => props.onChange(p.windowMs)}
              class={`rounded px-3 py-1 text-xs font-medium transition ${
                active()
                  ? "bg-sky-500/20 text-sky-200"
                  : "text-slate-400 hover:bg-slate-800"
              }`}
            >
              {p.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}
