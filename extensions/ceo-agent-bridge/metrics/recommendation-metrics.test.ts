import { describe, expect, test } from "vitest";
import {
  buildWeeklyRecommendationReport,
  calculateRecommendationMetrics,
} from "./recommendation-metrics.js";

describe("recommendation metrics", () => {
  test("computes adoption/ignore/completion rates in report window", () => {
    const metrics = calculateRecommendationMetrics({
      nowIso: "2026-02-18T09:00:00.000Z",
      events: [
        { status: "accepted", occurred_at: "2026-02-17T09:00:00.000Z" },
        { status: "ignored", occurred_at: "2026-02-16T09:00:00.000Z" },
        { status: "completed", occurred_at: "2026-02-18T08:00:00.000Z" },
      ],
      windowDays: 7,
    });

    expect(metrics.accepted_count).toBe(1);
    expect(metrics.ignored_count).toBe(1);
    expect(metrics.completed_count).toBe(1);
    expect(metrics.adoption_rate).toBeCloseTo(0.5, 5);
    expect(metrics.ignore_rate).toBeCloseTo(0.5, 5);
    expect(metrics.completion_rate).toBeCloseTo(1, 5);
  });

  test("builds weekly report summary for pilot customers", () => {
    const report = buildWeeklyRecommendationReport({
      nowIso: "2026-02-18T09:00:00.000Z",
      events: [{ status: "accepted", occurred_at: "2026-02-18T07:00:00.000Z" }],
      pilotAccounts: 3,
    });

    expect(report.pilot_accounts).toBe(3);
    expect(report.summary).toContain("采纳率");
    expect(report.summary).toContain("执行完成率");
  });
});
