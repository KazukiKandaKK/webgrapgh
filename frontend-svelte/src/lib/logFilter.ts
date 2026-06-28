import type { LogEvent } from "./types";

export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

export type LogFilter = {
  /** Selected levels; empty means "any level". */
  levels: Set<string>;
  /** Case-insensitive substring on `src`; empty means "any source". */
  source: string;
  /** Case-insensitive substring on `msg`; empty means "any message". */
  search: string;
  /** How many of the most recent events to scan when filtering. */
  windowCount: number;
};

export function emptyFilter(): LogFilter {
  return { levels: new Set(), source: "", search: "", windowCount: 1000 };
}

export function isFilterActive(f: LogFilter): boolean {
  return f.levels.size > 0 || f.source.trim() !== "" || f.search.trim() !== "";
}

export function matchesFilter(ev: LogEvent, f: LogFilter): boolean {
  if (f.levels.size > 0 && !f.levels.has(ev.level)) return false;
  if (f.source.trim() !== "") {
    if (!ev.src.toLowerCase().includes(f.source.trim().toLowerCase())) {
      return false;
    }
  }
  if (f.search.trim() !== "") {
    if (!ev.msg.toLowerCase().includes(f.search.trim().toLowerCase())) {
      return false;
    }
  }
  return true;
}
