import { describe, expect, test } from "vitest";
import {
  CEO_WORKFLOW_NAMES,
  runCrmRiskScanWorkflow,
  runMeetingExtractWorkflow,
  runProactiveBriefGenerateWorkflow,
  runScheduleAnalyzeWorkflow,
  runSupplyRiskScanWorkflow,
  runWorkflowByName,
} from "./index.js";

const context = {
  tenantId: "tenant-a",
  requestId: "req-001",
  sessionId: "session-001",
  runId: "run-001",
};

describe("ceo workflows dry run", () => {
  test("exports all frozen workflow names", () => {
    expect(CEO_WORKFLOW_NAMES).toEqual([
      "meeting-extract",
      "schedule-analyze",
      "crm-risk-scan",
      "supply-risk-scan",
      "proactive-brief-generate",
    ]);
  });

  test("each workflow can run in dry-run mode", async () => {
    const outputs = await Promise.all([
      runMeetingExtractWorkflow(context, { meeting_id: "m-1" }),
      runScheduleAnalyzeWorkflow(context, { days: 7 }),
      runCrmRiskScanWorkflow(context, { customers: 3 }),
      runSupplyRiskScanWorkflow(context, { suppliers: 2 }),
      runProactiveBriefGenerateWorkflow(context, { trigger: "daily" }),
    ]);

    for (const output of outputs) {
      expect(output.request_id).toBe(context.requestId);
      expect(output.session_id).toBe(context.sessionId);
      expect(output.run_id).toBe(context.runId);
      expect(output.status).toBe("success");
      expect(output.errors).toEqual([]);
      expect(output.data).toHaveProperty("mode", "dry-run");
      expect(output.data).toHaveProperty("workflow");
    }
  });

  test("dispatcher routes workflow by name", async () => {
    const output = await runWorkflowByName("schedule-analyze", context, { x: 1 });

    expect(output.status).toBe("success");
    expect(output.data).toMatchObject({
      workflow: "schedule-analyze",
      mode: "dry-run",
      payload_size: 1,
    });
  });
});
