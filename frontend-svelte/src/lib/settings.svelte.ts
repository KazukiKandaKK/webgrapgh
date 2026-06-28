// User settings, persisted to localStorage. Endpoint changes take effect on
// reload (the Worker is constructed once at App init); accent + default range
// apply live. No dependency — plain runes + localStorage.

const KEY = "webgrapgh:settings";

export type Accent = "sky" | "violet" | "emerald" | "amber" | "rose";

export type Settings = {
  wsUrl: string;
  wsLogsUrl: string;
  apiBase: string;
  defaultRangeMs: number | null;
  accent: Accent;
};

export const ACCENTS: Record<
  Accent,
  { label: string; color: string; soft: string }
> = {
  sky: { label: "Sky", color: "#38bdf8", soft: "rgba(56,189,248,0.18)" },
  violet: { label: "Violet", color: "#a78bfa", soft: "rgba(167,139,250,0.18)" },
  emerald: {
    label: "Emerald",
    color: "#34d399",
    soft: "rgba(52,211,153,0.18)",
  },
  amber: { label: "Amber", color: "#fbbf24", soft: "rgba(251,191,36,0.18)" },
  rose: { label: "Rose", color: "#fb7185", soft: "rgba(251,113,133,0.18)" },
};

function envDefaults(): Settings {
  const env = import.meta.env;
  const wsUrl = env.VITE_WS_URL ?? "ws://localhost:8080/ws";
  return {
    wsUrl,
    wsLogsUrl: env.VITE_WS_LOGS_URL ?? wsUrl.replace(/\/ws$/, "/ws/logs"),
    apiBase: env.VITE_API_BASE ?? "http://localhost:8080",
    defaultRangeMs: 5 * 60_000,
    accent: "sky",
  };
}

function load(): Settings {
  const base = envDefaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return { ...base, ...saved };
  } catch {
    return base;
  }
}

class SettingsStore {
  current = $state<Settings>(load());

  // Endpoints actually in use by the live Worker — captured at construction so
  // the Settings screen can tell when a reload is required to apply changes.
  readonly boot: Settings;

  constructor() {
    this.boot = { ...this.current };
  }

  update(patch: Partial<Settings>) {
    this.current = { ...this.current, ...patch };
    this.persist();
  }

  reset() {
    this.current = envDefaults();
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  }

  get endpointsDirty(): boolean {
    return (
      this.current.wsUrl !== this.boot.wsUrl ||
      this.current.wsLogsUrl !== this.boot.wsLogsUrl ||
      this.current.apiBase !== this.boot.apiBase
    );
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.current));
    } catch {
      // ignore (private mode / disabled storage)
    }
  }
}

export const settings = new SettingsStore();
