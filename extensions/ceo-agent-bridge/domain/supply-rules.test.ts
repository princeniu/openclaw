import { describe, expect, test } from "vitest";
import {
  buildDemoSupplyRiskSignals,
  calculateSupplyRiskScore,
  collectSupplyRecommendedActions,
  evaluateSupplyRiskSignals,
} from "./supply-rules.js";

describe("supply rules", () => {
  test("evaluates three classes of supply signals", () => {
    const signals = evaluateSupplyRiskSignals({
      suppliers: [{ supplier_id: "sup_a", on_time_rate: 0.82, delay_events: 4 }],
      inventory: [{ sku: "sku_a", days_of_cover: 5, target_cover_days: 14 }],
      procurementPrices: [{ material: "steel", current_price: 120, baseline_price: 100 }],
    });

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal_type: "supplier_fulfillment" }),
        expect.objectContaining({ signal_type: "inventory_coverage" }),
        expect.objectContaining({ signal_type: "price_volatility" }),
      ]),
    );
  });

  test("supports demo fallback and score/action aggregation", () => {
    const signals = buildDemoSupplyRiskSignals();
    const score = calculateSupplyRiskScore(signals);
    const actions = collectSupplyRecommendedActions(signals);

    expect(signals.length).toBeGreaterThan(0);
    expect(score).toBeGreaterThan(0);
    expect(actions.length).toBeGreaterThan(0);
  });
});
