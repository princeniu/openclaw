import { describe, expect, test } from "vitest";
import { resolveWeeklyInput } from "./weekly-input-policy.js";

describe("weekly input policy", () => {
  test("real-or-default uses real series when available", () => {
    const resolved = resolveWeeklyInput({
      mode: "real-or-default",
      realSeries: {
        sales: [10, 12],
        costs: [8, 9],
        cashflow: [2, 3],
      },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.series).toEqual({
      sales: [10, 12],
      costs: [8, 9],
      cashflow: [2, 3],
    });
  });

  test("real-required returns validation error when real series missing", () => {
    const resolved = resolveWeeklyInput({
      mode: "real-required",
      realSeries: undefined,
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.error).toContain("real metrics");
  });
});
