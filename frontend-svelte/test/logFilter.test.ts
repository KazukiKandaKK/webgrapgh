import type { LogEvent } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  emptyFilter,
  isFilterActive,
  matchesFilter,
} from "../src/lib/logFilter";

function ev(over: Partial<LogEvent> = {}): LogEvent {
  return {
    id: 1,
    t: 0,
    level: "INFO",
    src: "api",
    msg: "request handled",
    ...over,
  };
}

describe("isFilterActive", () => {
  it("is false for an empty filter", () => {
    expect(isFilterActive(emptyFilter())).toBe(false);
  });

  it("is true when any of levels/source/search is set", () => {
    expect(
      isFilterActive({ ...emptyFilter(), levels: new Set(["ERROR"]) }),
    ).toBe(true);
    expect(isFilterActive({ ...emptyFilter(), source: "api" })).toBe(true);
    expect(isFilterActive({ ...emptyFilter(), search: "boom" })).toBe(true);
    expect(isFilterActive({ ...emptyFilter(), search: "   " })).toBe(false);
  });
});

describe("matchesFilter", () => {
  it("matches everything with an empty filter", () => {
    expect(matchesFilter(ev(), emptyFilter())).toBe(true);
  });

  it("filters by level set", () => {
    const f = { ...emptyFilter(), levels: new Set(["ERROR"]) };
    expect(matchesFilter(ev({ level: "ERROR" }), f)).toBe(true);
    expect(matchesFilter(ev({ level: "INFO" }), f)).toBe(false);
  });

  it("filters by case-insensitive source substring", () => {
    const f = { ...emptyFilter(), source: "API" };
    expect(matchesFilter(ev({ src: "api-gateway" }), f)).toBe(true);
    expect(matchesFilter(ev({ src: "db" }), f)).toBe(false);
  });

  it("filters by case-insensitive message substring", () => {
    const f = { ...emptyFilter(), search: "AUTH failed" };
    expect(matchesFilter(ev({ msg: "auth failed for user" }), f)).toBe(true);
    expect(matchesFilter(ev({ msg: "ok" }), f)).toBe(false);
  });

  it("requires ALL active criteria to match (AND)", () => {
    const f = {
      ...emptyFilter(),
      levels: new Set(["ERROR"]),
      source: "api",
      search: "timeout",
    };
    expect(
      matchesFilter(ev({ level: "ERROR", src: "api", msg: "timeout" }), f),
    ).toBe(true);
    // right level+source but message doesn't contain "timeout"
    expect(
      matchesFilter(ev({ level: "ERROR", src: "api", msg: "ok" }), f),
    ).toBe(false);
  });
});
