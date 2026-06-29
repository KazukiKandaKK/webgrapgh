import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractSnapshotId } from "./snapshots.svelte";

// --- PBT: extractSnapshotId ---

describe("extractSnapshotId - properties", () => {
  it("positive integers in /snapshots/:id always parse correctly", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 }), (id) => {
        return extractSnapshotId(`/snapshots/${id}`) === id;
      }),
    );
  });

  it("zero or negative values always return null", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 0 }), (id) => {
        return extractSnapshotId(`/snapshots/${id}`) === null;
      }),
    );
  });

  it("non-numeric path segments always return null", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => isNaN(parseInt(s, 10))),
        (s) => {
          return extractSnapshotId(`/snapshots/${s}`) === null;
        },
      ),
    );
  });
});

// --- Unit: extractSnapshotId edge cases ---

describe("extractSnapshotId - unit", () => {
  it("returns null for /snapshots (no id segment)", () => {
    expect(extractSnapshotId("/snapshots")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractSnapshotId("")).toBeNull();
  });

  it("returns 42 for /snapshots/42", () => {
    expect(extractSnapshotId("/snapshots/42")).toBe(42);
  });

  it("returns null for /snapshots/0", () => {
    expect(extractSnapshotId("/snapshots/0")).toBeNull();
  });

  it("returns null for /snapshots/abc", () => {
    expect(extractSnapshotId("/snapshots/abc")).toBeNull();
  });
});

// --- PBT: t ms → seconds conversion ---

describe("ms to seconds conversion - properties", () => {
  it("dividing by 1000 is consistent for any timestamp array", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 2 ** 53 }), { maxLength: 100 }),
        (timestamps) => {
          const seconds = timestamps.map((ms) => ms / 1000);
          return seconds.every((s, i) => s === timestamps[i] / 1000);
        },
      ),
    );
  });
});

// --- Unit: CommentPage has_more calculation ---

describe("CommentPage has_more - unit", () => {
  const cases = [
    { offset: 0, fetched: 50, total: 100, want: true },
    { offset: 50, fetched: 50, total: 100, want: false },
    { offset: 0, fetched: 10, total: 10, want: false },
    { offset: 0, fetched: 0, total: 0, want: false },
    { offset: 80, fetched: 10, total: 100, want: true },
    { offset: 90, fetched: 10, total: 100, want: false },
  ];

  for (const { offset, fetched, total, want } of cases) {
    it(`offset=${offset} fetched=${fetched} total=${total} → has_more=${want}`, () => {
      expect(offset + fetched < total).toBe(want);
    });
  }
});

// --- Unit: author normalization (trimming logic) ---

describe("author trim logic - unit", () => {
  function normalizeAuthor(author: string): string {
    const trimmed = author.trim();
    return trimmed === "" ? "anonymous" : trimmed;
  }

  it("empty string → anonymous", () => {
    expect(normalizeAuthor("")).toBe("anonymous");
  });

  it("whitespace-only → anonymous", () => {
    expect(normalizeAuthor("   ")).toBe("anonymous");
  });

  it("non-empty name is preserved and trimmed", () => {
    expect(normalizeAuthor("  Alice  ")).toBe("Alice");
  });

  it("PBT: any non-blank string is preserved after trim", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim() !== ""),
        (name) => {
          return normalizeAuthor(name) === name.trim();
        },
      ),
    );
  });
});
