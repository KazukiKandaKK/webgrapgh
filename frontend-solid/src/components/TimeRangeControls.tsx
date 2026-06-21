import { For } from "solid-js";

const PRESETS: { label: string; windowMs: number | null }[] = [
  { label: "1m", windowMs: 60_000 },
  { label: "5m", windowMs: 5 * 60_000 },
  { label: "15m", windowMs: 15 * 60_000 },
  { label: "1h", windowMs: 60 * 60_000 },
  { label: "All", windowMs: null },
];

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
      <For each={PRESETS}>
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
