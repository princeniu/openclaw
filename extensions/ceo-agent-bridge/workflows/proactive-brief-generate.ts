import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

export async function runProactiveBriefGenerateWorkflow(
  context: WorkflowContext,
  payload: Record<string, unknown> = {},
): Promise<WorkflowResult<{ workflow: string; mode: "dry-run"; payload_size: number }>> {
  return buildDryRunSuccessResult(context, "proactive-brief-generate", {
    payload_size: Object.keys(payload).length,
  });
}
