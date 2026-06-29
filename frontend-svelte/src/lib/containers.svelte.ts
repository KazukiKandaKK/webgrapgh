// Live per-container metrics store. Unlike the fixed-metric dashboard (which
// runs through the shared SAB Worker), container series are dynamic and
// low-rate, so this connects a plain JSON WebSocket directly and keeps a small
// rolling window per (container, metric) for sparklines. No dependency.

import type { ContainerWireFrame, ContainersHistoryResponse } from "./types";

/** Points retained per (container, metric) for the inline sparkline. */
export const SPARK_POINTS = 90;

export type Series = { t: number[]; v: number[] };
export type ContainerState = {
  name: string;
  lastSeen: number;
  series: Record<string, Series>;
};

export type ConnState = "connecting" | "open" | "closed" | "error";

/** Append (t, v) to a series, capping length at `cap` (oldest dropped). */
export function pushSeries(
  prev: Series | undefined,
  t: number,
  v: number,
  cap = SPARK_POINTS,
): Series {
  const pt = prev?.t ?? [];
  const pv = prev?.v ?? [];
  const over = pt.length + 1 > cap;
  return {
    t: [...(over ? pt.slice(pt.length - cap + 1) : pt), t],
    v: [...(over ? pv.slice(pv.length - cap + 1) : pv), v],
  };
}

/**
 * Pure reducer: fold a wire frame into the current container list, returning a
 * new array sorted by name. Kept side-effect free so it is unit-testable.
 */
export function applyFrame(
  current: ContainerState[],
  frame: ContainerWireFrame,
  cap = SPARK_POINTS,
): ContainerState[] {
  const byName = new Map<string, ContainerState>();
  for (const c of current) byName.set(c.name, c);

  for (const row of frame.rows) {
    const existing = byName.get(row.c);
    const series = { ...(existing?.series ?? {}) };
    series[row.m] = pushSeries(series[row.m], frame.t, row.v, cap);
    byName.set(row.c, {
      name: row.c,
      lastSeen: frame.t,
      series,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Latest value of a metric for a container, or undefined when absent. */
export function latest(c: ContainerState, metric: string): number | undefined {
  const s = c.series[metric];
  return s && s.v.length > 0 ? s.v[s.v.length - 1] : undefined;
}

class ContainerStore {
  list = $state<ContainerState[]>([]);
  state = $state<ConnState>("closed");

  #ws: WebSocket | null = null;
  #wsUrl = "";
  #apiBase = "";
  #stopped = false;
  #retry: ReturnType<typeof setTimeout> | null = null;

  /** Connect + bootstrap. Safe to call repeatedly; reuses an open socket. */
  start(wsUrl: string, apiBase: string) {
    this.#wsUrl = wsUrl;
    this.#apiBase = apiBase;
    this.#stopped = false;
    void this.#bootstrap();
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = null;
    this.#ws?.close();
    this.#ws = null;
    this.state = "closed";
  }

  async #bootstrap() {
    try {
      const res = await fetch(`${this.#apiBase}/api/containers/history`);
      if (!res.ok) return;
      const data = (await res.json()) as ContainersHistoryResponse;
      const next: ContainerState[] = [];
      for (const name of data.containers) {
        const series: Record<string, Series> = {};
        const byMetric = data.series[name] ?? {};
        for (const [metric, s] of Object.entries(byMetric)) {
          const keep = Math.max(0, s.t.length - SPARK_POINTS);
          series[metric] = { t: s.t.slice(keep), v: s.v.slice(keep) };
        }
        const lastSeen = Object.values(series).reduce(
          (m, s) => Math.max(m, s.t.at(-1) ?? 0),
          0,
        );
        next.push({ name, lastSeen, series });
      }
      // Only seed if the live stream hasn't already populated state.
      if (this.list.length === 0) {
        this.list = next.sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch {
      // history is best-effort; the live stream still works
    }
  }

  #connect() {
    if (this.#stopped) return;
    this.state = "connecting";
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.#wsUrl);
    } catch {
      this.state = "error";
      this.#scheduleRetry();
      return;
    }
    this.#ws = ws;

    ws.onopen = () => {
      this.state = "open";
    };
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as ContainerWireFrame;
        if (frame && Array.isArray(frame.rows)) {
          this.list = applyFrame(this.list, frame);
        }
      } catch {
        // ignore malformed frame
      }
    };
    ws.onerror = () => {
      this.state = "error";
    };
    ws.onclose = () => {
      this.#ws = null;
      if (!this.#stopped) {
        this.state = "closed";
        this.#scheduleRetry();
      }
    };
  }

  #scheduleRetry() {
    if (this.#stopped || this.#retry) return;
    this.#retry = setTimeout(() => {
      this.#retry = null;
      this.#connect();
    }, 2000);
  }
}

export const containers = new ContainerStore();
