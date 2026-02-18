import {
  buildDemoSupplyRiskSignals,
  calculateSupplyRiskScore,
  collectSupplyRecommendedActions,
  evaluateSupplyRiskSignals,
  type InventorySignal,
  type PriceSignal,
  type SupplierSignal,
  type SupplyRiskSignal,
} from "../domain/supply-rules.js";
import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

function parseSuppliers(payload: Record<string, unknown>): SupplierSignal[] {
  const value = payload.suppliers;
  if (!Array.isArray(value)) {
    return [];
  }
  const suppliers: SupplierSignal[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const supplierId = typeof record.supplier_id === "string" ? record.supplier_id.trim() : "";
    if (!supplierId) {
      continue;
    }
    suppliers.push({
      supplier_id: supplierId,
      on_time_rate: typeof record.on_time_rate === "number" ? record.on_time_rate : undefined,
      delay_events: typeof record.delay_events === "number" ? record.delay_events : undefined,
    });
  }
  return suppliers;
}

function parseInventory(payload: Record<string, unknown>): InventorySignal[] {
  const value = payload.inventory;
  if (!Array.isArray(value)) {
    return [];
  }
  const inventory: InventorySignal[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const sku = typeof record.sku === "string" ? record.sku.trim() : "";
    if (!sku) {
      continue;
    }
    inventory.push({
      sku,
      days_of_cover: typeof record.days_of_cover === "number" ? record.days_of_cover : undefined,
      target_cover_days:
        typeof record.target_cover_days === "number" ? record.target_cover_days : undefined,
    });
  }
  return inventory;
}

function parsePrices(payload: Record<string, unknown>): PriceSignal[] {
  const value = payload.procurement_prices;
  if (!Array.isArray(value)) {
    return [];
  }
  const prices: PriceSignal[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const material = typeof record.material === "string" ? record.material.trim() : "";
    if (!material) {
      continue;
    }
    prices.push({
      material,
      current_price: typeof record.current_price === "number" ? record.current_price : undefined,
      baseline_price: typeof record.baseline_price === "number" ? record.baseline_price : undefined,
    });
  }
  return prices;
}

export async function runSupplyRiskScanWorkflow(
  context: WorkflowContext,
  payload: Record<string, unknown> = {},
): Promise<
  WorkflowResult<{
    workflow: string;
    mode: "dry-run";
    payload_size: number;
    signal_count: number;
    risk_score: number;
    signals: SupplyRiskSignal[];
    recommended_actions: string[];
  }>
> {
  const suppliers = parseSuppliers(payload);
  const inventory = parseInventory(payload);
  const prices = parsePrices(payload);
  const signals = evaluateSupplyRiskSignals({
    suppliers,
    inventory,
    procurementPrices: prices,
  });
  const finalSignals = signals.length > 0 ? signals : buildDemoSupplyRiskSignals();
  const recommendedActions = collectSupplyRecommendedActions(finalSignals);
  const avgScore = calculateSupplyRiskScore(finalSignals);

  return buildDryRunSuccessResult(context, "supply-risk-scan", {
    payload_size: Object.keys(payload).length,
    signal_count: finalSignals.length,
    risk_score: avgScore,
    signals: finalSignals,
    recommended_actions: recommendedActions,
  });
}
