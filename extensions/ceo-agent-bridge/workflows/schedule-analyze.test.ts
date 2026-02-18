import { describe, expect, test } from "vitest";
import { runScheduleAnalyzeWorkflow } from "./schedule-analyze.js";

const context = {
  tenantId: "tenant-a",
  requestId: "req-schedule-001",
  sessionId: "session-schedule-001",
  runId: "run-schedule-001",
};

describe("schedule analyze workflow", () => {
  test("returns high risk report using deterministic rules", async () => {
    const result = await runScheduleAnalyzeWorkflow(context, {
      daily_meeting_hours: [7, 5, 4, 3, 2],
      strategic_time_flags: [false, false, false, true, true],
      deep_work_blocks: 0,
    });

    expect(result.status).toBe("success");
    expect(result.errors).toEqual([]);
    expect(result.data.schedule_risk_report).toMatchObject({
      risk_level: "high",
      hits: ["R1_MEETING_OVERLOAD", "R2_STRATEGY_GAP", "R3_NO_DEEP_WORK"],
    });
    expect(result.data.schedule_risk_report.action_items.length).toBeGreaterThanOrEqual(2);
  });

  test("uses fallback defaults when payload is empty", async () => {
    const result = await runScheduleAnalyzeWorkflow(context, {});
    expect(result.status).toBe("success");
    expect(result.data.schedule_risk_report.risk_level).toBe("high");
  });
});
