import {
  analyzeProactiveTriggers,
  type CrmRiskSignal,
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
    proactive_items: string[];
    action_items: string[];
    summary: string;
  }>
> {
  const generatedAt =
    (typeof payload.now_iso === "string" && payload.now_iso.trim()) ||
    context.nowIso ||
    new Date().toISOString();
  const scheduleEvents = parseScheduleEvents(payload);
  const crmRisks = parseCrmRisks(payload);
  const trips = parseTrips(payload);

  const analysis = analyzeProactiveTriggers({
    nowIso: generatedAt,
    scheduleEvents,
    crmRisks,
    trips,
  });

  const generationMode =
    typeof payload.generation_mode === "string" && payload.generation_mode.trim() === "manual"
      ? "manual"
      : "daily_auto";
  const summary =
    analysis.trigger_types.length > 0
      ? `已生成今日主动简报，触发 ${analysis.trigger_types.length} 类关键信号。`
      : "今日暂无高优先级主动提醒，保持当前执行节奏。";

  return buildDryRunSuccessResult(context, "proactive-brief-generate", {
    payload_size: Object.keys(payload).length,
    generation_mode: generationMode,
    generated_at: generatedAt,
    brief_date: generatedAt.slice(0, 10),
    trigger_count: analysis.trigger_types.length,
    trigger_types: analysis.trigger_types,
    proactive_items: analysis.proactive_items,
    action_items: analysis.action_items,
    summary,
  });
}
