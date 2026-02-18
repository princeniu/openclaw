import { describe, expect, test } from "vitest";
import { runCrmRiskScanWorkflow } from "./crm-risk-scan.js";

const context = {
  tenantId: "tenant-a",
  requestId: "req-crm-001",
  sessionId: "session-crm-001",
  runId: "run-crm-001",
};

describe("crm risk scan workflow", () => {
  test("returns risk list and action suggestions", async () => {
    const result = await runCrmRiskScanWorkflow(context, {
      customers: [
        {
          customer_id: "c1",
          days_since_contact: 35,
          overdue_days: 0,
          high_value: false,
        },
        {
          customer_id: "c2",
          days_since_contact: 15,
          overdue_days: 20,
          high_value: true,
        },
      ],
    });

    expect(result.status).toBe("success");
    expect(result.errors).toEqual([]);
    expect(result.data.crm_risk_list.length).toBe(2);
    expect(result.data.crm_risk_list[0]).toHaveProperty("risk_level");
    expect(result.data.crm_risk_list[0]).toHaveProperty("suggested_actions");
  });

  test("uses fallback demo records on empty payload", async () => {
    const result = await runCrmRiskScanWorkflow(context, {});
    expect(result.status).toBe("success");
    expect(result.data.crm_risk_list.length).toBeGreaterThan(0);
  });
});
