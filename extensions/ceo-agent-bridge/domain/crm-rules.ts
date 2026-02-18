export type CrmRiskLevel = "low" | "medium" | "high";

export type CrmRiskInput = {
  customer_id: string;
  days_since_contact?: number;
  overdue_days?: number;
  high_value?: boolean;
};

export type CrmRiskRecord = {
  customer_id: string;
  risk_score: number;
  risk_level: CrmRiskLevel;
  reasons: string[];
  suggested_actions: string[];
};

function riskLevel(score: number): CrmRiskLevel {
  if (score >= 70) {
    return "high";
  }
  if (score >= 40) {
    return "medium";
  }
  return "low";
}

function toActions(level: CrmRiskLevel, reasons: string[]): string[] {
  if (level === "high") {
    return [
      "24 小时内完成客户沟通并记录结果。",
      "创建回款/续签专项跟进任务并指定负责人。",
      reasons.length ? `优先处理原因：${reasons[0]}` : "优先处理最高风险客户。",
    ];
  }
  if (level === "medium") {
    return ["本周内安排跟进触达并更新 CRM 状态。", "确认潜在逾期风险并给出预防动作。"];
  }
  return ["保持当前跟进节奏，纳入常规巡检。"];
}

export function evaluateCrmRisks(customers: CrmRiskInput[]): CrmRiskRecord[] {
  return customers.map((customer) => {
    const daysSinceContact = Number.isFinite(customer.days_since_contact)
      ? Number(customer.days_since_contact)
      : 0;
    const overdueDays = Number.isFinite(customer.overdue_days) ? Number(customer.overdue_days) : 0;
    const highValue = customer.high_value === true;

    let score = 0;
    const reasons: string[] = [];

    if (daysSinceContact >= 30) {
      score += 30;
      reasons.push("No contact in last 30 days.");
    }

    if (overdueDays > 0) {
      score += 40;
      reasons.push("Receivable is overdue.");
    }

    if (highValue && daysSinceContact >= 14) {
      score += 35;
      reasons.push("High-value account inactive for 14+ days.");
    }

    const level = riskLevel(score);

    return {
      customer_id: customer.customer_id,
      risk_score: score,
      risk_level: level,
      reasons,
      suggested_actions: toActions(level, reasons),
    };
  });
}
