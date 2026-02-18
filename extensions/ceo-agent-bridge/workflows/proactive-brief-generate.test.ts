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

  test("suppresses repeated and low-priority suggestions by policy", async () => {
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
      min_priority: 70,
      cooldown_hours: 24,
      recent_briefs: [
        {
          trigger_type: "crm_high_risk",
          sent_at: "2026-02-18T08:30:00.000Z",
        },
      ],
    });

    expect(result.status).toBe("success");
    expect(result.data.trigger_types).toEqual(["schedule_conflict"]);
    expect(result.data.suppressed_types).toEqual(
      expect.arrayContaining(["crm_high_risk", "travel_window"]),
    );
    expect(result.data.min_priority).toBe(70);
    expect(result.data.cooldown_hours).toBe(24);
  });

  test("outputs weekly pilot effect report", async () => {
    const result = await runProactiveBriefGenerateWorkflow(context, {
      report_scope: "weekly_effect",
      pilot_accounts: ["pilot_a", "pilot_b", "pilot_c"],
      effect_events: [
        { status: "accepted", occurred_at: "2026-02-17T10:00:00.000Z" },
        { status: "accepted", occurred_at: "2026-02-17T11:00:00.000Z" },
        { status: "ignored", occurred_at: "2026-02-17T12:00:00.000Z" },
        { status: "completed", occurred_at: "2026-02-17T13:00:00.000Z" },
      ],
    });

    expect(result.status).toBe("success");
    expect(result.data.summary).toContain("周效果报表");
    expect(result.data.weekly_effect_report).toMatchObject({
      pilot_accounts: 3,
      accepted_count: 2,
      ignored_count: 1,
      completed_count: 1,
    });
    expect(result.data.weekly_effect_report.adoption_rate).toBeCloseTo(0.6667, 3);
    expect(result.data.weekly_effect_report.ignore_rate).toBeCloseTo(0.3333, 3);
    expect(result.data.weekly_effect_report.completion_rate).toBeCloseTo(0.5, 3);
  });
});
