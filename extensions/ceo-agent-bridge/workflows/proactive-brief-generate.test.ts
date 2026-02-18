import { describe, expect, test } from "vitest";
import { runProactiveBriefGenerateWorkflow } from "./proactive-brief-generate.js";

const context = {
  tenantId: "tenant-a",
  requestId: "req-proactive-001",
  sessionId: "session-proactive-001",
  runId: "run-proactive-001",
  nowIso: "2026-02-18T09:00:00.000Z",
};

describe("proactive brief generate workflow", () => {
  test("builds daily brief from trigger signals", async () => {
    const result = await runProactiveBriefGenerateWorkflow(context, {
      schedule_events: [
        {
          start_at: "2026-02-18T09:00:00.000Z",
          end_at: "2026-02-18T10:00:00.000Z",
        },
        {
          start_at: "2026-02-18T09:30:00.000Z",
          end_at: "2026-02-18T10:30:00.000Z",
        },
      ],
      crm_risks: [
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

    expect(result.status).toBe("success");
    expect(result.errors).toEqual([]);
    expect(result.data).toMatchObject({
      workflow: "proactive-brief-generate",
      mode: "dry-run",
      generation_mode: "daily_auto",
      brief_date: "2026-02-18",
      trigger_count: 3,
    });
    expect(result.data.trigger_types).toEqual([
      "schedule_conflict",
      "crm_high_risk",
      "travel_window",
    ]);
    expect(result.data.proactive_items.length).toBeGreaterThanOrEqual(3);
  });

  test("returns calm brief when no trigger is hit", async () => {
    const result = await runProactiveBriefGenerateWorkflow(context, {});

    expect(result.status).toBe("success");
    expect(result.data.trigger_count).toBe(0);
    expect(result.data.proactive_items).toEqual([]);
    expect(result.data.summary).toContain("暂无高优先级主动提醒");
  });
});
