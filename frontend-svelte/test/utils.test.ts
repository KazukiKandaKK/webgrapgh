import { formatLogTime, hexToRgba, levelClass } from "@shared/utils";
import { describe, expect, it } from "vitest";

describe("hexToRgba", () => {
  it("converts 6-digit hex (with or without #) to rgba", () => {
    expect(hexToRgba("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
    expect(hexToRgba("00ff00", 1)).toBe("rgba(0,255,0,1)");
  });

  it("is case-insensitive", () => {
    expect(hexToRgba("#00AAff", 0.2)).toBe("rgba(0,170,255,0.2)");
  });

  it("returns the input unchanged for malformed hex", () => {
    expect(hexToRgba("not-a-color", 1)).toBe("not-a-color");
    expect(hexToRgba("#fff", 1)).toBe("#fff"); // 3-digit not supported
  });
});

describe("levelClass", () => {
  it("maps known levels to their color class", () => {
    expect(levelClass("ERROR")).toBe("text-rose-400");
    expect(levelClass("WARN")).toBe("text-amber-300");
    expect(levelClass("DEBUG")).toBe("text-slate-500");
    expect(levelClass("INFO")).toBe("text-emerald-300");
  });

  it("falls back for unknown levels", () => {
    expect(levelClass("TRACE")).toBe("text-slate-600");
  });
});

describe("formatLogTime", () => {
  it("formats a positive unix-ms timestamp as HH:MM:SS.mmm (UTC)", () => {
    // 1970-01-01T00:00:01.234Z
    expect(formatLogTime(1234)).toBe("00:00:01.234");
  });

  it("renders a placeholder for non-positive timestamps", () => {
    expect(formatLogTime(0)).toBe("--:--:--.---");
    expect(formatLogTime(-5)).toBe("--:--:--.---");
  });
});
