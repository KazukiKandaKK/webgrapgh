import { beforeEach, describe, expect, it } from "vitest";
import { alerts, compare } from "./alerts.svelte";

describe("compare", () => {
  it("evaluates each comparator", () => {
    expect(compare(10, ">", 5)).toBe(true);
    expect(compare(5, ">", 5)).toBe(false);
    expect(compare(5, ">=", 5)).toBe(true);
    expect(compare(3, "<", 5)).toBe(true);
    expect(compare(5, "<=", 5)).toBe(true);
    expect(compare(6, "<=", 5)).toBe(false);
  });
});

describe("AlertStore", () => {
  beforeEach(() => {
    // Reset to a single known rule so tests are independent of the singleton's
    // accumulated state.
    for (const r of [...alerts.rules]) alerts.remove(r.id);
    alerts.add({
      metric: "cpu",
      comparator: ">",
      threshold: 80,
      enabled: true,
    });
  });

  it("add/remove maintains the rule list", () => {
    expect(alerts.rules).toHaveLength(1);
    alerts.add({
      metric: "memory",
      comparator: ">",
      threshold: 90,
      enabled: true,
    });
    expect(alerts.rules).toHaveLength(2);
    alerts.remove(alerts.rules[0].id);
    expect(alerts.rules).toHaveLength(1);
  });

  it("fires when a value breaches its threshold and clears when it recovers", () => {
    alerts.evaluate({ cpu: 95 });
    expect(alerts.firingCount).toBe(1);
    alerts.evaluate({ cpu: 10 });
    expect(alerts.firingCount).toBe(0);
  });

  it("keeps firing membership stable across frames (no churn) while still firing", () => {
    alerts.evaluate({ cpu: 95 });
    const id = alerts.rules[0].id;
    const since = alerts.firing[id].since;
    // Membership is unchanged, so `firing` is intentionally NOT reassigned:
    // `since` is preserved and the per-frame `value` is left stale by design
    // (see sameFiring) so the sidebar badge doesn't re-render every frame.
    alerts.evaluate({ cpu: 96 });
    expect(alerts.firingCount).toBe(1);
    expect(alerts.firing[id].since).toBe(since);
    expect(alerts.firing[id].value).toBe(95);
  });

  it("ignores disabled rules and non-finite values", () => {
    alerts.toggle(alerts.rules[0].id); // disable
    alerts.evaluate({ cpu: 999 });
    expect(alerts.firingCount).toBe(0);

    alerts.toggle(alerts.rules[0].id); // re-enable
    alerts.evaluate({ cpu: Number.NaN });
    expect(alerts.firingCount).toBe(0);
  });

  it("update patches a rule in place", () => {
    const id = alerts.rules[0].id;
    alerts.update(id, { threshold: 10 });
    expect(alerts.rules[0].threshold).toBe(10);
    alerts.evaluate({ cpu: 50 }); // above the new (lower) threshold
    expect(alerts.firingCount).toBe(1);
  });
});
