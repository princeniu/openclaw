import { evaluateCrmRisks, type CrmRiskInput } from "../domain/crm-rules.js";
import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

type CrmAction = "accept" | "ignore" | "reschedule";

type CrmActionResult = {
  recommendation_id: string;
  action: CrmAction;
  action_status: "accepted" | "ignored" | "rescheduled";
  actor_id?: string;
  due_at?: string;
  updated_at: string;
};

function normalizeCustomers(
  payload: Record<string, unknown>,
  options: { fallbackToDemo: boolean },
): CrmRiskInput[] {
  const value = payload.customers;
  if (!Array.isArray(value) || value.length === 0) {
    if (!options.fallbackToDemo) {
      return [];
    }
    return buildDemoCustomers();
  }

  const customers: CrmRiskInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const customerId = typeof record.customer_id === "string" ? record.customer_id.trim() : "";
    if (!customerId) {
      continue;
    }

    customers.push({
      customer_id: customerId,
      days_since_contact:
        typeof record.days_since_contact === "number" ? record.days_since_contact : undefined,
      overdue_days: typeof record.overdue_days === "number" ? record.overdue_days : undefined,
      high_value: typeof record.high_value === "boolean" ? record.high_value : undefined,
    });
  }

  if (customers.length > 0) {
    return customers;
  }
  if (!options.fallbackToDemo) {
    return [];
  }
  return buildDemoCustomers().slice(0, 1);
}

function buildDemoCustomers(): CrmRiskInput[] {
  return [
    {
      customer_id: "demo_a",
      days_since_contact: 35,
      overdue_days: 0,
      high_value: false,
    },
    {
      customer_id: "demo_b",
      days_since_contact: 12,
      overdue_days: 18,
      high_value: true,
    },
  ];
}

function mapActionStatus(action: CrmAction): CrmActionResult["action_status"] {
  if (action === "accept") {
    return "accepted";
  }
  if (action === "ignore") {
    return "ignored";
  }
  return "rescheduled";
}

function normalizeAction(raw: unknown): CrmAction | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "accept" || normalized === "ignore" || normalized === "reschedule") {
    return normalized;
  }
  return undefined;
}

function parseActionResult(
  payload: Record<string, unknown>,
  context: WorkflowContext,
): CrmActionResult | undefined {
  const actionEvent = payload.action_event;
  if (!actionEvent || typeof actionEvent !== "object" || Array.isArray(actionEvent)) {
    return undefined;
  }

  const record = actionEvent as Record<string, unknown>;
  const recommendationId =
    typeof record.recommendation_id === "string" ? record.recommendation_id.trim() : "";
  if (!recommendationId) {
    return undefined;
  }

  const action = normalizeAction(record.action);
  if (!action) {
    return undefined;
  }

  const dueAt = typeof record.due_at === "string" ? record.due_at.trim() : undefined;
  if (action === "reschedule" && !dueAt) {
    return undefined;
  }

  return {
    recommendation_id: recommendationId,
    action,
    action_status: mapActionStatus(action),
    actor_id: typeof record.actor_id === "string" ? record.actor_id.trim() || undefined : undefined,
    due_at: dueAt || undefined,
    updated_at: context.nowIso ?? new Date().toISOString(),
  };
}

export async function runCrmRiskScanWorkflow(
  context: WorkflowContext,
  payload: Record<string, unknown> = {},
): Promise<
  WorkflowResult<{
    workflow: string;
    mode: "dry-run";
    payload_size: number;
    crm_risk_list: ReturnType<typeof evaluateCrmRisks>;
    action_result?: CrmActionResult;
  }>
> {
  const actionResult = parseActionResult(payload, context);
  const customers = normalizeCustomers(payload, {
    fallbackToDemo: !actionResult,
  });
  const crmRiskList = customers.length > 0 ? evaluateCrmRisks(customers) : [];

  return buildDryRunSuccessResult(context, "crm-risk-scan", {
    payload_size: Object.keys(payload).length,
    crm_risk_list: crmRiskList,
    action_result: actionResult,
  });
}
