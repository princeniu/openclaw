import { describe, expect, test } from "vitest";
import { generateDailyProactiveBrief } from "./triggers.js";

describe("proactive triggers", () => {
  test("generates actionable daily brief from trigger signals", () => {
    const result = generateDailyProactiveBrief({
      nowIso: "2026-02-18T09:00:00.000Z",
      scheduleEvents: [
        {
          start_at: "2026-02-18T09:00:00.000Z",
          end_at: "2026-02-18T10:00:00.000Z",
        },
        {
          start_at: "2026-02-18T09:30:00.000Z",
          end_at: "2026-02-18T10:30:00.000Z",
        },
      ],
      crmRisks: [{ customer_id: "cust_1", risk_level: "high", risk_score: 88 }],
      trips: [],
    });

    expect(result.trigger_count).toBeGreaterThan(0);
    expect(result.action_items.length).toBeGreaterThan(0);
    expect(result.trigger_types).toContain("crm_high_risk");
  });

  test("applies min priority threshold", () => {
    const result = generateDailyProactiveBrief({
      nowIso: "2026-02-18T09:00:00.000Z",
      scheduleEvents: [],
      crmRisks: [],
      trips: [{ destination: "Shanghai", start_date: "2026-02-20", customer_meetings: 1 }],
      minPriority: 70,
    });

    expect(result.trigger_types).toEqual([]);
    expect(result.action_items).toEqual([]);
  });
});
