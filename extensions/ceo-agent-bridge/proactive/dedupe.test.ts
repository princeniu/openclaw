import { describe, expect, test } from "vitest";
import type { ProactiveRecommendation } from "../domain/proactive-triggers.js";
import { applyRecommendationCooldown, type RecentRecommendationSignal } from "./dedupe.js";

const recommendations: ProactiveRecommendation[] = [
  {
    trigger_type: "crm_high_risk",
    priority: 90,
    brief: "risk",
    action: "follow up",
  },
  {
    trigger_type: "schedule_conflict",
    priority: 75,
    brief: "conflict",
    action: "merge meetings",
  },
];

describe("proactive recommendation dedupe", () => {
  test("suppresses repeated trigger in cooldown window", () => {
    const recentBriefs: RecentRecommendationSignal[] = [
      {
        trigger_type: "crm_high_risk",
        sent_at: "2026-02-18T08:30:00.000Z",
      },
    ];

    const result = applyRecommendationCooldown({
      recommendations,
      recentBriefs,
      nowIso: "2026-02-18T09:00:00.000Z",
      cooldownHours: 24,
    });

    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0]?.trigger_type).toBe("schedule_conflict");
    expect(result.suppressedTypes).toContain("crm_high_risk");
  });

  test("keeps recommendation when cooldown window already expired", () => {
    const recentBriefs: RecentRecommendationSignal[] = [
      {
        trigger_type: "crm_high_risk",
        sent_at: "2026-02-15T09:00:00.000Z",
      },
    ];

    const result = applyRecommendationCooldown({
      recommendations,
      recentBriefs,
      nowIso: "2026-02-18T09:00:00.000Z",
      cooldownHours: 24,
    });

    expect(result.filtered.map((item) => item.trigger_type)).toEqual([
      "crm_high_risk",
      "schedule_conflict",
    ]);
    expect(result.suppressedTypes).toEqual([]);
  });
});
