import type { ContainerWireFrame } from "@shared/types";
import { describe, expect, it } from "vitest";
import { applyFrame, latest, pushSeries } from "../src/lib/containers.svelte";

describe("pushSeries", () => {
  it("appends to an empty series", () => {
    expect(pushSeries(undefined, 1, 10)).toEqual({ t: [1], v: [10] });
  });

  it("appends to an existing series", () => {
    const s = pushSeries({ t: [1], v: [10] }, 2, 20);
    expect(s).toEqual({ t: [1, 2], v: [10, 20] });
  });

  it("caps length, dropping oldest", () => {
    let s = pushSeries(undefined, 0, 0, 3);
    s = pushSeries(s, 1, 1, 3);
    s = pushSeries(s, 2, 2, 3);
    s = pushSeries(s, 3, 3, 3); // overflow -> drop t=0
    expect(s.t).toEqual([1, 2, 3]);
    expect(s.v).toEqual([1, 2, 3]);
  });
});

describe("applyFrame", () => {
  const frame = (t: number, rows: ContainerWireFrame["rows"]) => ({ t, rows });

  it("creates new containers and sorts by name", () => {
    const out = applyFrame(
      [],
      frame(100, [
        { c: "zeta", m: "cpu_pct", v: 5 },
        { c: "alpha", m: "cpu_pct", v: 9 },
      ]),
    );
    expect(out.map((c) => c.name)).toEqual(["alpha", "zeta"]);
    expect(latest(out[0], "cpu_pct")).toBe(9);
    expect(out[0].lastSeen).toBe(100);
  });

  it("accumulates points across frames for the same container", () => {
    let state = applyFrame([], frame(1, [{ c: "api", m: "cpu_pct", v: 1 }]));
    state = applyFrame(state, frame(2, [{ c: "api", m: "cpu_pct", v: 2 }]));
    expect(state).toHaveLength(1);
    expect(state[0].series.cpu_pct).toEqual({ t: [1, 2], v: [1, 2] });
  });

  it("keeps independent series per metric", () => {
    const out = applyFrame(
      [],
      frame(1, [
        { c: "api", m: "cpu_pct", v: 1 },
        { c: "api", m: "mem_bytes", v: 1000 },
      ]),
    );
    expect(latest(out[0], "cpu_pct")).toBe(1);
    expect(latest(out[0], "mem_bytes")).toBe(1000);
  });

  it("does not mutate the input array or series objects", () => {
    const initial = applyFrame(
      [],
      frame(1, [{ c: "api", m: "cpu_pct", v: 1 }]),
    );
    const snapshot = JSON.parse(JSON.stringify(initial));
    applyFrame(initial, frame(2, [{ c: "api", m: "cpu_pct", v: 9 }]));
    expect(initial).toEqual(snapshot);
  });
});

describe("latest", () => {
  it("returns undefined for an unknown / empty metric", () => {
    const out = applyFrame([], {
      t: 1,
      rows: [{ c: "api", m: "cpu_pct", v: 1 }],
    });
    expect(latest(out[0], "net_rx_bps")).toBeUndefined();
  });
});
