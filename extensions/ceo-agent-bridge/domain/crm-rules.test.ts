import { describe, expect, test } from "vitest";
import { evaluateCrmRisks } from "./crm-rules.js";

describe("crm rules", () => {
  test("classifies risk levels by score thresholds", () => {
    const result = evaluateCrmRisks([
      {
        customer_id: "c1",
        days_since_contact: 35,
        overdue_days: 0,
        high_value: false,
      },
      {
        customer_id: "c2",
        days_since_contact: 10,
        overdue_days: 20,
        high_value: false,
      },
      {
        customer_id: "c3",
        days_since_contact: 20,
        overdue_days: 20,
        high_value: true,
      },
    ]);

    expect(result[0]).toMatchObject({ risk_score: 30, risk_level: "low" });
    expect(result[1]).toMatchObject({ risk_score: 40, risk_level: "medium" });
    expect(result[2]).toMatchObject({ risk_score: 75, risk_level: "high" });
  });

  test("adds actionable suggestions per risk level", () => {
    const [record] = evaluateCrmRisks([
      {
        customer_id: "high_1",
        days_since_contact: 30,
        overdue_days: 20,
        high_value: true,
      },
    ]);

    expect(record.risk_level).toBe("high");
    expect(record.suggested_actions.length).toBeGreaterThanOrEqual(2);
  });
});
