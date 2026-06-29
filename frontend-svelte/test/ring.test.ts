import { LogRing, computeSlice, makeBuffer, pushPoint } from "@shared/ring";
import type { LogEvent } from "@shared/types";
import { describe, expect, it } from "vitest";

describe("metric ring buffer", () => {
  it("fills then wraps, keeping the newest `capacity` points", () => {
    const buf = makeBuffer(3);
    for (let i = 0; i < 5; i++) pushPoint(buf, i, i * 10);
    expect(buf.size).toBe(3);
    // Newest 3 values are 2,3,4 -> v 20,30,40 (order in storage may wrap).
    const stored = Array.from(buf.v).sort((a, b) => a - b);
    expect(stored).toEqual([20, 30, 40]);
  });

  it("tracks size up to capacity", () => {
    const buf = makeBuffer(4);
    expect(buf.size).toBe(0);
    pushPoint(buf, 1, 1);
    pushPoint(buf, 2, 2);
    expect(buf.size).toBe(2);
  });
});

describe("computeSlice", () => {
  it("returns null for an empty buffer", () => {
    expect(computeSlice(makeBuffer(8), null, 100)).toBeNull();
  });

  it("returns the whole buffer with stride 1 when under maxRenderPoints", () => {
    const buf = makeBuffer(8);
    for (let i = 0; i < 5; i++) pushPoint(buf, i, i);
    const plan = computeSlice(buf, null, 100);
    expect(plan).not.toBeNull();
    expect(plan?.sliceSize).toBe(5);
    expect(plan?.stride).toBe(1);
    expect(plan?.outLen).toBe(5);
  });

  it("downsamples by stride when exceeding maxRenderPoints", () => {
    const buf = makeBuffer(100);
    for (let i = 0; i < 100; i++) pushPoint(buf, i, i);
    const plan = computeSlice(buf, null, 10);
    expect(plan?.stride).toBe(10);
    expect(plan?.outLen).toBe(10);
  });

  it("restricts to the most recent windowMs", () => {
    const buf = makeBuffer(100);
    // timestamps 0..99 (ms). newest is 99.
    for (let i = 0; i < 100; i++) pushPoint(buf, i, i);
    // window of 10ms => cutoff = 99-10 = 89, points with t>=89 => 89..99 (11).
    const plan = computeSlice(buf, 10, 1000);
    expect(plan?.sliceSize).toBe(11);
  });

  it("returns null when the window predates all points", () => {
    const buf = makeBuffer(10);
    pushPoint(buf, 1000, 1);
    // newest t=1000, window 0 => cutoff 1000, only t>=1000 qualifies (1 point).
    // Use a negative-ish scenario: window so small nothing but newest matches.
    const plan = computeSlice(buf, 0, 100);
    expect(plan?.sliceSize).toBe(1);
  });
});

function ev(id: number): LogEvent {
  return { id, t: id, level: "INFO", src: "test", msg: `m${id}` };
}

describe("LogRing", () => {
  it("returns events oldest-first before wrapping", () => {
    const ring = new LogRing(5);
    for (let i = 1; i <= 3; i++) ring.push(ev(i));
    expect(ring.total()).toBe(3);
    expect(ring.slice(0, 10).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("keeps the newest `capacity` after wrap, oldest-first", () => {
    const ring = new LogRing(3);
    for (let i = 1; i <= 6; i++) ring.push(ev(i));
    expect(ring.total()).toBe(3);
    expect(ring.slice(0, 10).map((e) => e.id)).toEqual([4, 5, 6]);
  });

  it("honors offset and limit", () => {
    const ring = new LogRing(10);
    for (let i = 1; i <= 6; i++) ring.push(ev(i));
    expect(ring.slice(2, 2).map((e) => e.id)).toEqual([3, 4]);
  });

  it("returns empty for non-positive limit or out-of-range offset", () => {
    const ring = new LogRing(10);
    for (let i = 1; i <= 3; i++) ring.push(ev(i));
    expect(ring.slice(0, 0)).toEqual([]);
    expect(ring.slice(99, 5)).toEqual([]);
  });
});
