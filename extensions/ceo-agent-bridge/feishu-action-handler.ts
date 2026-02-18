export type FeishuAction = "accept" | "ignore" | "reschedule";

export type FeishuActionInput = {
  action: string;
  recommendationId: string;
  tenantId: string;
  actorId?: string;
  dueAt?: string;
  requestId?: string;
  sessionId?: string;
};

export type FeishuActionValidationResult =
  | {
      ok: true;
      value: ValidatedFeishuActionInput;
    }
  | {
      ok: false;
      code: "validation_error";
      message: string;
    };

export type ValidatedFeishuActionInput = {
  action: FeishuAction;
  recommendationId: string;
  tenantId: string;
  actorId?: string;
  dueAt?: string;
  requestId?: string;
  sessionId?: string;
};

export type FeishuActionRoute = {
  endpoint: "/ceo/workflows/crm-risk-scan";
  method: "POST";
  payload: {
    tenant_id: string;
    action_event: {
      recommendation_id: string;
      action: FeishuAction;
      actor_id?: string;
      due_at?: string;
      request_id?: string;
      session_id?: string;
    };
  };
};

function normalizeAction(value: string): FeishuAction | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "accept") {
    return "accept";
  }
  if (normalized === "ignore") {
    return "ignore";
  }
  if (normalized === "reschedule") {
    return "reschedule";
  }
  return null;
}

export function validateFeishuActionInput(input: FeishuActionInput): FeishuActionValidationResult {
  const action = normalizeAction(input.action);
  if (!action) {
    return {
      ok: false,
      code: "validation_error",
      message: "Unsupported action, expected accept|ignore|reschedule",
    };
  }

  const recommendationId = input.recommendationId?.trim();
  if (!recommendationId) {
    return {
      ok: false,
      code: "validation_error",
      message: "recommendationId is required",
    };
  }

  const tenantId = input.tenantId?.trim();
  if (!tenantId) {
    return {
      ok: false,
      code: "validation_error",
      message: "tenantId is required",
    };
  }

  const dueAt = input.dueAt?.trim();
  if (action === "reschedule" && !dueAt) {
    return {
      ok: false,
      code: "validation_error",
      message: "dueAt is required when action=reschedule",
    };
  }

  return {
    ok: true,
    value: {
      action,
      recommendationId,
      tenantId,
      actorId: input.actorId?.trim() || undefined,
      dueAt,
      requestId: input.requestId?.trim() || undefined,
      sessionId: input.sessionId?.trim() || undefined,
    },
  };
}

export function buildFeishuActionRoute(actionInput: ValidatedFeishuActionInput): FeishuActionRoute {
  return {
    endpoint: "/ceo/workflows/crm-risk-scan",
    method: "POST",
    payload: {
      tenant_id: actionInput.tenantId,
      action_event: {
        recommendation_id: actionInput.recommendationId,
        action: actionInput.action,
        actor_id: actionInput.actorId,
        due_at: actionInput.dueAt,
        request_id: actionInput.requestId,
        session_id: actionInput.sessionId,
      },
    },
  };
}
