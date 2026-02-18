export type WorkflowStatus = "success" | "partial" | "failed";

export type WorkflowContext = {
  tenantId: string;
  requestId: string;
  sessionId: string;
  runId: string;
  nowIso?: string;
};

export type WorkflowResult<T = Record<string, unknown>> = {
  request_id: string;
  session_id: string;
  run_id: string;
  status: WorkflowStatus;
  data: T;
  errors: string[];
};

export function buildDryRunSuccessResult<T extends Record<string, unknown>>(
  context: WorkflowContext,
  workflowName: string,
  extraData?: T,
): WorkflowResult<T & { workflow: string; mode: "dry-run" }> {
  return {
    request_id: context.requestId,
    session_id: context.sessionId,
    run_id: context.runId,
    status: "success",
    data: {
      workflow: workflowName,
      mode: "dry-run",
      ...(extraData ?? ({} as T)),
    },
    errors: [],
  };
}
