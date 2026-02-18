export type SupplierSignal = {
  supplier_id: string;
  on_time_rate?: number;
  delay_events?: number;
};

export type InventorySignal = {
  sku: string;
  days_of_cover?: number;
  target_cover_days?: number;
};

export type PriceSignal = {
  material: string;
  current_price?: number;
  baseline_price?: number;
};

export type SupplyRiskSignal = {
  signal_type: "supplier_fulfillment" | "inventory_coverage" | "price_volatility";
  severity: "medium" | "high" | "critical";
  summary: string;
  recommended_action: string;
};

function severityToScore(level: SupplyRiskSignal["severity"]): number {
  if (level === "critical") {
    return 90;
  }
  if (level === "high") {
    return 75;
  }
  return 60;
}

export function evaluateSupplyRiskSignals(input: {
  suppliers: SupplierSignal[];
  inventory: InventorySignal[];
  procurementPrices: PriceSignal[];
}): SupplyRiskSignal[] {
  const signals: SupplyRiskSignal[] = [];

  for (const supplier of input.suppliers) {
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

  for (const item of input.inventory) {
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

  for (const price of input.procurementPrices) {
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

  return signals;
}

export function buildDemoSupplyRiskSignals(): SupplyRiskSignal[] {
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

export function collectSupplyRecommendedActions(signals: SupplyRiskSignal[]): string[] {
  return [...new Set(signals.map((item) => item.recommended_action))];
}

export function calculateSupplyRiskScore(signals: SupplyRiskSignal[]): number {
  if (signals.length === 0) {
    return 0;
  }
  const average =
    signals.reduce((sum, item) => sum + severityToScore(item.severity), 0) / signals.length;
  return Number(average.toFixed(2));
}
