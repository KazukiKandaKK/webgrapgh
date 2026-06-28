// Threshold alert rules, persisted to localStorage. Rules are evaluated once
// per frame at App level (so the firing count is live on every screen). No
// dependency — plain runes + localStorage.

import type { MetricName } from "./types";

const KEY = "webgrapgh:alerts";

export type Comparator = ">" | ">=" | "<" | "<=";

export type AlertRule = {
  id: string;
  metric: MetricName;
  comparator: Comparator;
  threshold: number;
  enabled: boolean;
};

export type FiringState = {
  ruleId: string;
  value: number;
  since: number; // unix ms when this rule started firing
};

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultRules(): AlertRule[] {
  return [
    { id: rid(), metric: "cpu", comparator: ">", threshold: 85, enabled: true },
    {
      id: rid(),
      metric: "errors",
      comparator: ">",
      threshold: 5,
      enabled: true,
    },
    {
      id: rid(),
      metric: "latency_p99",
      comparator: ">",
      threshold: 500,
      enabled: true,
    },
  ];
}

function load(): AlertRule[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultRules();
    const saved = JSON.parse(raw) as AlertRule[];
    if (!Array.isArray(saved)) return defaultRules();
    return saved;
  } catch {
    return defaultRules();
  }
}

export function compare(v: number, cmp: Comparator, thr: number): boolean {
  switch (cmp) {
    case ">":
      return v > thr;
    case ">=":
      return v >= thr;
    case "<":
      return v < thr;
    case "<=":
      return v <= thr;
    default:
      return false;
  }
}

class AlertStore {
  rules = $state<AlertRule[]>(load());
  // ruleId -> firing state, for rules currently breaching their threshold.
  firing = $state<Record<string, FiringState>>({});

  get firingCount(): number {
    return Object.keys(this.firing).length;
  }

  add(rule: Omit<AlertRule, "id">) {
    this.rules = [...this.rules, { ...rule, id: rid() }];
    this.persist();
  }

  remove(id: string) {
    this.rules = this.rules.filter((r) => r.id !== id);
    if (this.firing[id]) {
      const rest = { ...this.firing };
      delete rest[id];
      this.firing = rest;
    }
    this.persist();
  }

  toggle(id: string) {
    this.rules = this.rules.map((r) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r,
    );
    this.persist();
  }

  update(id: string, patch: Partial<Omit<AlertRule, "id">>) {
    this.rules = this.rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
    this.persist();
  }

  /**
   * Evaluate every enabled rule against the latest per-metric value. Called on
   * each frame from App. Reassigns `firing` only when the set actually changes
   * to avoid re-rendering subscribers (e.g. the sidebar badge) every frame.
   */
  evaluate(latest: Partial<Record<MetricName, number>>) {
    const now = Date.now();
    const next: Record<string, FiringState> = {};
    for (const r of this.rules) {
      if (!r.enabled) continue;
      const v = latest[r.metric];
      if (v === undefined || !Number.isFinite(v)) continue;
      if (compare(v, r.comparator, r.threshold)) {
        next[r.id] = {
          ruleId: r.id,
          value: v,
          since: this.firing[r.id]?.since ?? now,
        };
      }
    }
    if (!sameFiring(this.firing, next)) this.firing = next;
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.rules));
    } catch {
      // ignore
    }
  }
}

function sameFiring(
  a: Record<string, FiringState>,
  b: Record<string, FiringState>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!b[k]) return false;
    // `value` updates every frame; ignore it for change detection so the badge
    // doesn't churn. Only membership transitions matter here.
  }
  return true;
}

export const alerts = new AlertStore();
