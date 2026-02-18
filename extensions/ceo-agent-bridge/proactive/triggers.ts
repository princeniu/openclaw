import {
  analyzeProactiveTriggers,
  type CrmRiskSignal,
  type ProactiveRecommendation,
  type ScheduleEventSignal,
  type TripWindowSignal,
} from "../domain/proactive-triggers.js";

export type DailyProactiveBrief = {
  generated_at: string;
  trigger_count: number;
  trigger_types: string[];
  proactive_items: string[];
  action_items: string[];
  recommendations: ProactiveRecommendation[];
};

export type DailyProactiveBriefInput = {
  nowIso: string;
  scheduleEvents: ScheduleEventSignal[];
  crmRisks: CrmRiskSignal[];
  trips: TripWindowSignal[];
  minPriority?: number;
};

export function generateDailyProactiveBrief(input: DailyProactiveBriefInput): DailyProactiveBrief {
  const minPriority =
    typeof input.minPriority === "number" && Number.isFinite(input.minPriority)
      ? input.minPriority
      : 60;
  const analysis = analyzeProactiveTriggers({
    nowIso: input.nowIso,
    scheduleEvents: input.scheduleEvents,
    crmRisks: input.crmRisks,
    trips: input.trips,
  });

  const recommendations = analysis.recommendations.filter(
    (recommendation) => recommendation.priority >= minPriority,
  );

  return {
    generated_at: input.nowIso,
    trigger_count: recommendations.length,
    trigger_types: recommendations.map((item) => item.trigger_type),
    proactive_items: recommendations.map((item) => item.brief),
    action_items: recommendations.map((item) => item.action),
    recommendations,
  };
}
