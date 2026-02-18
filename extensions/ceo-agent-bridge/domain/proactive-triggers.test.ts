import { describe, expect, test } from "vitest";
import { analyzeProactiveTriggers } from "./proactive-triggers.js";

describe("proactive trigger analysis", () => {
  test("detects schedule conflict, crm high risk, and travel window", () => {
    const result = analyzeProactiveTriggers({
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
      crmRisks: [
        {
          customer_id: "c_100",
          risk_level: "high",
          risk_score: 88,
        },
      ],
      trips: [
        {
          destination: "Shanghai",
          start_date: "2026-02-21",
          customer_meetings: 2,
        },
      ],
    });

    expect(result.trigger_types).toEqual(["schedule_conflict", "crm_high_risk", "travel_window"]);
    expect(result.proactive_items.length).toBeGreaterThanOrEqual(3);
    expect(result.action_items.length).toBeGreaterThanOrEqual(3);
  });

  test("returns empty trigger set when no high-priority signals", () => {
    const result = analyzeProactiveTriggers({
      nowIso: "2026-02-18T09:00:00.000Z",
      scheduleEvents: [],
      crmRisks: [],
      trips: [],
    });

    expect(result.trigger_types).toEqual([]);
    expect(result.proactive_items).toEqual([]);
    expect(result.action_items).toEqual([]);
  });
});
