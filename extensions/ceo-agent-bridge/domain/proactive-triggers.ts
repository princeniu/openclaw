export type ProactiveTriggerType = "schedule_conflict" | "crm_high_risk" | "travel_window";

export type ScheduleEventSignal = {
  start_at?: string;
  end_at?: string;
  is_conflict?: boolean;
};

export type CrmRiskSignal = {
  customer_id?: string;
  risk_level?: string;
  risk_score?: number;
  overdue_days?: number;
};

export type TripWindowSignal = {
  destination?: string;
  start_date?: string;
  customer_meetings?: number;
};

export type ProactiveTriggerInput = {
  nowIso: string;
  scheduleEvents: ScheduleEventSignal[];
  crmRisks: CrmRiskSignal[];
  trips: TripWindowSignal[];
};

export type ProactiveTriggerAnalysis = {
  trigger_types: ProactiveTriggerType[];
  proactive_items: string[];
  action_items: string[];
};

function toEpoch(value: string | undefined): number | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function detectScheduleConflict(events: ScheduleEventSignal[]): number {
  let conflictCount = events.filter((event) => event.is_conflict === true).length;
  const normalized: Array<{ start: number; end: number }> = [];

  for (const event of events) {
    const start = toEpoch(event.start_at);
    const end = toEpoch(event.end_at);
    if (start === undefined || end === undefined || end <= start) {
      continue;
    }
    normalized.push({ start, end });
  }

  normalized.sort((a, b) => a.start - b.start);
  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i].start < normalized[i - 1].end) {
      conflictCount += 1;
    }
  }
  return conflictCount;
}

function detectHighRiskCustomers(risks: CrmRiskSignal[]): number {
  let highRiskCount = 0;
  for (const risk of risks) {
    const level = risk.risk_level?.trim().toLowerCase();
    if (level === "high" || level === "critical") {
      highRiskCount += 1;
      continue;
    }
    if (typeof risk.risk_score === "number" && risk.risk_score >= 80) {
      highRiskCount += 1;
      continue;
    }
    if (typeof risk.overdue_days === "number" && risk.overdue_days >= 15) {
      highRiskCount += 1;
    }
  }
  return highRiskCount;
}

function detectUpcomingTrips(nowIso: string, trips: TripWindowSignal[]): number {
  const nowEpoch = toEpoch(nowIso);
  if (nowEpoch === undefined) {
    return 0;
  }
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let tripCount = 0;

  for (const trip of trips) {
    const startEpoch = toEpoch(trip.start_date);
    if (startEpoch === undefined) {
      continue;
    }
    if (startEpoch < nowEpoch || startEpoch - nowEpoch > sevenDaysMs) {
      continue;
    }
    tripCount += 1;
  }
  return tripCount;
}

export function analyzeProactiveTriggers(input: ProactiveTriggerInput): ProactiveTriggerAnalysis {
  const triggerTypes: ProactiveTriggerType[] = [];
  const proactiveItems: string[] = [];
  const actionItems: string[] = [];

  const scheduleConflicts = detectScheduleConflict(input.scheduleEvents);
  if (scheduleConflicts > 0) {
    triggerTypes.push("schedule_conflict");
    proactiveItems.push(`检测到 ${scheduleConflicts} 个日程冲突，建议压缩例会并释放深度工作时段。`);
    actionItems.push("将冲突会议合并到固定会议窗，并保留 2 个以上深度工作块。");
  }

  const highRiskCustomers = detectHighRiskCustomers(input.crmRisks);
  if (highRiskCustomers > 0) {
    triggerTypes.push("crm_high_risk");
    proactiveItems.push(`识别到 ${highRiskCustomers} 个高风险客户，需要 24 小时内跟进。`);
    actionItems.push("为高风险客户生成跟进清单，并推送负责人与截止时间。");
  }

  const upcomingTrips = detectUpcomingTrips(input.nowIso, input.trips);
  if (upcomingTrips > 0) {
    triggerTypes.push("travel_window");
    proactiveItems.push(
      `未来 7 天内有 ${upcomingTrips} 个出差窗口，可提前准备目的地客户会面建议。`,
    );
    actionItems.push("自动整理出差目的地客户动态，并生成会前沟通建议。");
  }

  return {
    trigger_types: triggerTypes,
    proactive_items: proactiveItems,
    action_items: actionItems,
  };
}
