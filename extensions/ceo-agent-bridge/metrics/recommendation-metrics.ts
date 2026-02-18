import { calculateEffectMetrics, type EffectEvent } from "../domain/effect-metrics.js";

export type RecommendationMetricEvent = EffectEvent;

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function calculateRecommendationMetrics(params: {
  nowIso: string;
  events: RecommendationMetricEvent[];
  windowDays?: number;
}): ReturnType<typeof calculateEffectMetrics> {
  return calculateEffectMetrics({
    nowIso: params.nowIso,
    events: params.events,
    windowDays: params.windowDays,
  });
}

export function buildWeeklyRecommendationReport(params: {
  nowIso: string;
  events: RecommendationMetricEvent[];
  pilotAccounts: number;
  windowDays?: number;
}): ReturnType<typeof calculateEffectMetrics> & { pilot_accounts: number; summary: string } {
  const metrics = calculateRecommendationMetrics({
    nowIso: params.nowIso,
    events: params.events,
    windowDays: params.windowDays,
  });
  return {
    ...metrics,
    pilot_accounts: params.pilotAccounts,
    summary: `周效果报表：采纳率 ${formatRate(metrics.adoption_rate)}，忽略率 ${formatRate(
      metrics.ignore_rate,
    )}，执行完成率 ${formatRate(metrics.completion_rate)}。`,
  };
}
