import { describe, expect, test } from "vitest";
import { calculateEffectMetrics } from "./effect-metrics.js";

describe("effect metrics", () => {
  test("calculates adoption, ignore, and completion rates", () => {
    const result = calculateEffectMetrics({
      nowIso: "2026-02-18T09:00:00.000Z",
      events: [
        { status: "accepted", occurred_at: "2026-02-17T10:00:00.000Z" },
        { status: "accepted", occurred_at: "2026-02-17T11:00:00.000Z" },
        { status: "ignored", occurred_at: "2026-02-17T12:00:00.000Z" },
        { status: "completed", occurred_at: "2026-02-17T13:00:00.000Z" },
      ],
    });

    expect(result.accepted_count).toBe(2);
    expect(result.ignored_count).toBe(1);
    expect(result.completed_count).toBe(1);
    expect(result.adoption_rate).toBeCloseTo(0.6667, 3);
    expect(result.ignore_rate).toBeCloseTo(0.3333, 3);
    expect(result.completion_rate).toBeCloseTo(0.5, 3);
  });
});
