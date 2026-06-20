"use client";

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

/**
 * Preset range selector. State lives in the parent; we just emit changes.
 * Re-rendering this component is cheap and only happens on user interaction.
 */
export function TimeRangeControls({ windowMs, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
      <span className="px-2 text-xs uppercase tracking-widest text-slate-500">
        range
      </span>
      {PRESETS.map((p) => {
        const active = p.windowMs === windowMs;
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.windowMs)}
            className={`rounded px-3 py-1 text-xs font-medium transition ${
              active
                ? "bg-sky-500/20 text-sky-200"
                : "text-slate-400 hover:bg-slate-800"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
