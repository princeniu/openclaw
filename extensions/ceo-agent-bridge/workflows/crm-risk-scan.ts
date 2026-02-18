import { evaluateCrmRisks, type CrmRiskInput } from "../domain/crm-rules.js";
import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

function normalizeCustomers(payload: Record<string, unknown>): CrmRiskInput[] {
  const value = payload.customers;
  if (!Array.isArray(value) || value.length === 0) {
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

  return customers.length > 0
    ? customers
    : [
        {
          customer_id: "demo_a",
          days_since_contact: 35,
          overdue_days: 0,
          high_value: false,
        },
      ];
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
  }>
> {
  const customers = normalizeCustomers(payload);
  const result = evaluateCrmRisks(customers);

  return buildDryRunSuccessResult(context, "crm-risk-scan", {
    payload_size: Object.keys(payload).length,
    crm_risk_list: result,
  });
}
