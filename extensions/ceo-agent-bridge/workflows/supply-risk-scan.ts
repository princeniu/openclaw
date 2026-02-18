import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

export async function runSupplyRiskScanWorkflow(
  context: WorkflowContext,
  payload: Record<string, unknown> = {},
): Promise<WorkflowResult<{ workflow: string; mode: "dry-run"; payload_size: number }>> {
  return buildDryRunSuccessResult(context, "supply-risk-scan", {
    payload_size: Object.keys(payload).length,
  });
}
