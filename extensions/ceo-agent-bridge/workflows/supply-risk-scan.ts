import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

type SupplierSignal = {
  supplier_id: string;
  on_time_rate?: number;
  delay_events?: number;
};

type InventorySignal = {
  sku: string;
  days_of_cover?: number;
  target_cover_days?: number;
};

type PriceSignal = {
  material: string;
  current_price?: number;
  baseline_price?: number;
};

type SupplyRiskSignal = {
  signal_type: "supplier_fulfillment" | "inventory_coverage" | "price_volatility";
  severity: "medium" | "high" | "critical";
  summary: string;
  recommended_action: string;
};

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

function toSeverityScore(level: SupplyRiskSignal["severity"]): number {
  if (level === "critical") {
    return 90;
  }
  if (level === "high") {
    return 75;
  }
  return 60;
}

function buildDemoSignals(): SupplyRiskSignal[] {
  return [
    {
      signal_type: "supplier_fulfillment",
      severity: "high",
      summary: "供应商 sup_demo 履约率下降，延迟交付风险上升。",
      recommended_action: "启动供应商替补方案，并在 48 小时内完成履约复盘。",
    },
    {
      signal_type: "inventory_coverage",
      severity: "high",
      summary: "核心 SKU 库存覆盖不足 7 天，存在断货风险。",
      recommended_action: "优先补货核心 SKU，并设置库存预警阈值。",
    },
    {
      signal_type: "price_volatility",
      severity: "medium",
      summary: "关键原材料采购价波动超过 10%。",
      recommended_action: "与核心供应商执行锁价或分批采购策略，降低波动影响。",
    },
  ];
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
  const signals: SupplyRiskSignal[] = [];

  for (const supplier of suppliers) {
    const onTimeRate = supplier.on_time_rate ?? 1;
    const delayEvents = supplier.delay_events ?? 0;
    if (onTimeRate >= 0.9 && delayEvents < 3) {
      continue;
    }
    const severity: SupplyRiskSignal["severity"] =
      onTimeRate < 0.75 || delayEvents >= 6 ? "critical" : "high";
    signals.push({
      signal_type: "supplier_fulfillment",
      severity,
      summary: `供应商 ${supplier.supplier_id} 履约异常（准时率 ${Math.round(onTimeRate * 100)}%，延迟 ${delayEvents} 次）。`,
      recommended_action: `为 ${supplier.supplier_id} 启动备选供应商切换，并执行周度履约评估。`,
    });
  }

  for (const item of inventory) {
    const days = item.days_of_cover ?? 0;
    const targetDays = item.target_cover_days ?? 14;
    if (days >= 7 && days >= targetDays * 0.6) {
      continue;
    }
    const severity: SupplyRiskSignal["severity"] = days < 3 ? "critical" : "high";
    signals.push({
      signal_type: "inventory_coverage",
      severity,
      summary: `SKU ${item.sku} 库存覆盖 ${days} 天，低于目标 ${targetDays} 天。`,
      recommended_action: `对 ${item.sku} 执行补货优先级提升，并配置最低库存告警。`,
    });
  }

  for (const price of prices) {
    const current = price.current_price;
    const baseline = price.baseline_price;
    if (current === undefined || baseline === undefined || baseline <= 0) {
      continue;
    }
    const volatility = Math.abs(current - baseline) / baseline;
    if (volatility < 0.1) {
      continue;
    }
    const severity: SupplyRiskSignal["severity"] = volatility >= 0.2 ? "high" : "medium";
    signals.push({
      signal_type: "price_volatility",
      severity,
      summary: `${price.material} 采购价波动 ${(volatility * 100).toFixed(1)}%。`,
      recommended_action: `针对 ${price.material} 执行锁价谈判或分批采购，控制采购成本波动。`,
    });
  }

  const finalSignals = signals.length > 0 ? signals : buildDemoSignals();
  const recommendedActions = [...new Set(finalSignals.map((item) => item.recommended_action))];
  const avgScore =
    finalSignals.reduce((sum, item) => sum + toSeverityScore(item.severity), 0) /
    finalSignals.length;

  return buildDryRunSuccessResult(context, "supply-risk-scan", {
    payload_size: Object.keys(payload).length,
    signal_count: finalSignals.length,
    risk_score: Number(avgScore.toFixed(2)),
    signals: finalSignals,
    recommended_actions: recommendedActions,
  });
}
