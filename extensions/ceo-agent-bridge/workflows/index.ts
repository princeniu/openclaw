import type { WorkflowContext, WorkflowResult } from "./types.js";
import { runCrmRiskScanWorkflow } from "./crm-risk-scan.js";
import { runMeetingExtractWorkflow } from "./meeting-extract.js";
import { runProactiveBriefGenerateWorkflow } from "./proactive-brief-generate.js";
import { runScheduleAnalyzeWorkflow } from "./schedule-analyze.js";
import { runSupplyRiskScanWorkflow } from "./supply-risk-scan.js";

export const CEO_WORKFLOW_NAMES = [
  "meeting-extract",
  "schedule-analyze",
  "crm-risk-scan",
  "supply-risk-scan",
  "proactive-brief-generate",
] as const;

export type CeoWorkflowName = (typeof CEO_WORKFLOW_NAMES)[number];

export async function runWorkflowByName(
  name: CeoWorkflowName,
  context: WorkflowContext,
  payload: Record<string, unknown> = {},
): Promise<WorkflowResult> {
  switch (name) {
    case "meeting-extract":
      return runMeetingExtractWorkflow(context, payload);
    case "schedule-analyze":
      return runScheduleAnalyzeWorkflow(context, payload);
    case "crm-risk-scan":
      return runCrmRiskScanWorkflow(context, payload);
    case "supply-risk-scan":
      return runSupplyRiskScanWorkflow(context, payload);
    case "proactive-brief-generate":
      return runProactiveBriefGenerateWorkflow(context, payload);
    default:
      return {
        request_id: context.requestId,
        session_id: context.sessionId,
        run_id: context.runId,
        status: "failed",
        data: {},
        errors: [`unsupported workflow: ${name}`],
      };
  }
}

export {
  runMeetingExtractWorkflow,
  runScheduleAnalyzeWorkflow,
  runCrmRiskScanWorkflow,
  runSupplyRiskScanWorkflow,
  runProactiveBriefGenerateWorkflow,
};

export type { WorkflowContext, WorkflowResult } from "./types.js";
