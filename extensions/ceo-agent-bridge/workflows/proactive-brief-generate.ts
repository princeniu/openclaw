import { calculateEffectMetrics, type EffectEvent } from "../domain/effect-metrics.js";
import {
  analyzeProactiveTriggers,
  type CrmRiskSignal,
  type ProactiveRecommendation,
  type ScheduleEventSignal,
  type TripWindowSignal,
} from "../domain/proactive-triggers.js";
import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

function parseScheduleEvents(payload: Record<string, unknown>): ScheduleEventSignal[] {
  const value = payload.schedule_events;
  if (!Array.isArray(value)) {
    return [];
  }
  const events: ScheduleEventSignal[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    events.push({
      start_at: typeof record.start_at === "string" ? record.start_at.trim() : undefined,
      end_at: typeof record.end_at === "string" ? record.end_at.trim() : undefined,
      is_conflict: typeof record.is_conflict === "boolean" ? record.is_conflict : undefined,
    });
  }
  return events;
}

function parseCrmRisks(payload: Record<string, unknown>): CrmRiskSignal[] {
  const value = payload.crm_risks;
  if (!Array.isArray(value)) {
    return [];
  }
  const risks: CrmRiskSignal[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    risks.push({
      customer_id: typeof record.customer_id === "string" ? record.customer_id.trim() : undefined,
      risk_level: typeof record.risk_level === "string" ? record.risk_level.trim() : undefined,
      risk_score: typeof record.risk_score === "number" ? record.risk_score : undefined,
      overdue_days: typeof record.overdue_days === "number" ? record.overdue_days : undefined,
    });
  }
  return risks;
}

function parseTrips(payload: Record<string, unknown>): TripWindowSignal[] {
  const value = payload.trips;
  if (!Array.isArray(value)) {
    return [];
  }
  const trips: TripWindowSignal[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    trips.push({
      destination: typeof record.destination === "string" ? record.destination.trim() : undefined,
      start_date: typeof record.start_date === "string" ? record.start_date.trim() : undefined,
      customer_meetings:
        typeof record.customer_meetings === "number" ? record.customer_meetings : undefined,
    });
  }
  return trips;
}

type RecentBriefSignal = {
  trigger_type: string;
  sent_at: string;
};

function parseRecentBriefs(payload: Record<string, unknown>): RecentBriefSignal[] {
  const value = payload.recent_briefs;
  if (!Array.isArray(value)) {
    return [];
  }
  const recent: RecentBriefSignal[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.trigger_type !== "string" || typeof record.sent_at !== "string") {
      continue;
    }
    const triggerType = record.trigger_type.trim();
    const sentAt = record.sent_at.trim();
    if (!triggerType || !sentAt) {
      continue;
    }
    recent.push({
      trigger_type: triggerType,
      sent_at: sentAt,
    });
  }
  return recent;
}

function parseEffectEvents(payload: Record<string, unknown>): EffectEvent[] {
  const value = payload.effect_events;
  if (!Array.isArray(value)) {
    return [];
  }
  const events: EffectEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    events.push({
      status: typeof record.status === "string" ? record.status.trim() : undefined,
      occurred_at: typeof record.occurred_at === "string" ? record.occurred_at.trim() : undefined,
    });
  }
  return events;
}

function parsePilotAccounts(payload: Record<string, unknown>): string[] {
  const value = payload.pilot_accounts;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readPositiveNumber(
  payload: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

function isWithinCooldown(
  recommendation: ProactiveRecommendation,
  recentBriefs: RecentBriefSignal[],
  nowEpoch: number | undefined,
  cooldownHours: number,
): boolean {
  if (nowEpoch === undefined || cooldownHours <= 0) {
    return false;
  }
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  for (const item of recentBriefs) {
    if (item.trigger_type !== recommendation.trigger_type) {
      continue;
    }
    const sentEpoch = Date.parse(item.sent_at);
    if (!Number.isFinite(sentEpoch) || sentEpoch > nowEpoch) {
      continue;
    }
    if (nowEpoch - sentEpoch <= cooldownMs) {
      return true;
    }
  }
  return false;
}

function applyRecommendationPolicy(params: {
  recommendations: ProactiveRecommendation[];
  recentBriefs: RecentBriefSignal[];
  nowIso: string;
  minPriority: number;
  cooldownHours: number;
}): { filtered: ProactiveRecommendation[]; suppressedTypes: string[] } {
  const nowEpoch = Date.parse(params.nowIso);
  const suppressed = new Set<string>();
  const filtered: ProactiveRecommendation[] = [];

  for (const recommendation of params.recommendations) {
    if (recommendation.priority < params.minPriority) {
      suppressed.add(recommendation.trigger_type);
      continue;
    }
    if (
      isWithinCooldown(
        recommendation,
        params.recentBriefs,
        Number.isFinite(nowEpoch) ? nowEpoch : undefined,
        params.cooldownHours,
      )
    ) {
      suppressed.add(recommendation.trigger_type);
      continue;
    }
    filtered.push(recommendation);
  }

  return {
    filtered,
    suppressedTypes: [...suppressed],
  };
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export async function runProactiveBriefGenerateWorkflow(
  context: WorkflowContext,
  payload: Record<string, unknown> = {},
): Promise<
  WorkflowResult<{
    workflow: string;
    mode: "dry-run";
    payload_size: number;
    generation_mode: "daily_auto" | "manual";
    generated_at: string;
    brief_date: string;
    trigger_count: number;
    trigger_types: ReturnType<typeof analyzeProactiveTriggers>["trigger_types"];
    suppressed_types: string[];
    min_priority: number;
    cooldown_hours: number;
    proactive_items: string[];
    action_items: string[];
    summary: string;
    report_scope: "daily_brief" | "weekly_effect";
    weekly_effect_report?: ReturnType<typeof calculateEffectMetrics> & {
      pilot_accounts: number;
    };
  }>
> {
  const generatedAt =
    (typeof payload.now_iso === "string" && payload.now_iso.trim()) ||
    context.nowIso ||
    new Date().toISOString();
  const scheduleEvents = parseScheduleEvents(payload);
  const crmRisks = parseCrmRisks(payload);
  const trips = parseTrips(payload);
  const recentBriefs = parseRecentBriefs(payload);
  const effectEvents = parseEffectEvents(payload);
  const pilotAccounts = parsePilotAccounts(payload);
  const minPriority = readPositiveNumber(payload, "min_priority", 60);
  const cooldownHours = readPositiveNumber(payload, "cooldown_hours", 24);
  const reportScope =
    typeof payload.report_scope === "string" && payload.report_scope.trim() === "weekly_effect"
      ? "weekly_effect"
      : "daily_brief";

  const analysis = analyzeProactiveTriggers({
    nowIso: generatedAt,
    scheduleEvents,
    crmRisks,
    trips,
  });
  const policyResult = applyRecommendationPolicy({
    recommendations: analysis.recommendations,
    recentBriefs,
    nowIso: generatedAt,
    minPriority,
    cooldownHours,
  });

  const generationMode =
    typeof payload.generation_mode === "string" && payload.generation_mode.trim() === "manual"
      ? "manual"
      : "daily_auto";
  const weeklyEffectReport =
    reportScope === "weekly_effect"
      ? {
          ...calculateEffectMetrics({
            nowIso: generatedAt,
            events: effectEvents,
          }),
          pilot_accounts: pilotAccounts.length,
        }
      : undefined;

  const summary = (() => {
    if (reportScope === "weekly_effect" && weeklyEffectReport) {
      return `周效果报表：采纳率 ${formatRate(weeklyEffectReport.adoption_rate)}，忽略率 ${formatRate(
        weeklyEffectReport.ignore_rate,
      )}，执行完成率 ${formatRate(weeklyEffectReport.completion_rate)}。`;
    }
    if (policyResult.filtered.length > 0) {
      return `已生成今日主动简报，触发 ${policyResult.filtered.length} 类关键信号。`;
    }
    if (analysis.recommendations.length > 0) {
      return "已识别到风险信号，但因频控或优先级阈值暂不重复推送。";
    }
    return "今日暂无高优先级主动提醒，保持当前执行节奏。";
  })();

  return buildDryRunSuccessResult(context, "proactive-brief-generate", {
    payload_size: Object.keys(payload).length,
    generation_mode: generationMode,
    generated_at: generatedAt,
    brief_date: generatedAt.slice(0, 10),
    trigger_count: policyResult.filtered.length,
    trigger_types: policyResult.filtered.map((item) => item.trigger_type),
    suppressed_types: policyResult.suppressedTypes,
    min_priority: minPriority,
    cooldown_hours: cooldownHours,
    proactive_items: policyResult.filtered.map((item) => item.brief),
    action_items: policyResult.filtered.map((item) => item.action),
    summary,
    report_scope: reportScope,
    weekly_effect_report: weeklyEffectReport,
  });
}
