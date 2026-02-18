import { describe, expect, test } from "vitest";
import { runSupplyRiskScanWorkflow } from "./supply-risk-scan.js";

const context = {
  tenantId: "tenant-a",
  requestId: "req-supply-001",
  sessionId: "session-supply-001",
  runId: "run-supply-001",
};

describe("supply risk scan workflow", () => {
  test("detects three supply signals and outputs executable actions", async () => {
    const result = await runSupplyRiskScanWorkflow(context, {
      suppliers: [
        {
          supplier_id: "sup_a",
          on_time_rate: 0.82,
          delay_events: 4,
        },
      ],
      inventory: [
        {
          sku: "sku_a",
          days_of_cover: 5,
          target_cover_days: 14,
        },
      ],
      procurement_prices: [
        {
          material: "steel",
          current_price: 120,
          baseline_price: 100,
        },
      ],
    });

    expect(result.status).toBe("success");
    expect(result.errors).toEqual([]);
    expect(result.data.signal_count).toBeGreaterThanOrEqual(3);
    expect(result.data.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal_type: "supplier_fulfillment" }),
        expect.objectContaining({ signal_type: "inventory_coverage" }),
        expect.objectContaining({ signal_type: "price_volatility" }),
      ]),
    );
    expect(result.data.recommended_actions.length).toBeGreaterThanOrEqual(3);
  });

  test("uses demo fallback signals on empty payload", async () => {
    const result = await runSupplyRiskScanWorkflow(context, {});
    expect(result.status).toBe("success");
    expect(result.data.signal_count).toBeGreaterThan(0);
  });
});
