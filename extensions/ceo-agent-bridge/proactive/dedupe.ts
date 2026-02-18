import type { ProactiveRecommendation } from "../domain/proactive-triggers.js";

export type RecentRecommendationSignal = {
  trigger_type: string;
  sent_at: string;
};

function isWithinCooldown(params: {
  recommendation: ProactiveRecommendation;
  recentBriefs: RecentRecommendationSignal[];
  nowIso: string;
  cooldownHours: number;
}): boolean {
  const nowEpoch = Date.parse(params.nowIso);
  if (!Number.isFinite(nowEpoch) || params.cooldownHours <= 0) {
    return false;
  }
  const cooldownMs = params.cooldownHours * 60 * 60 * 1000;

  for (const item of params.recentBriefs) {
    if (item.trigger_type !== params.recommendation.trigger_type) {
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

export function applyRecommendationCooldown(params: {
  recommendations: ProactiveRecommendation[];
  recentBriefs: RecentRecommendationSignal[];
  nowIso: string;
  cooldownHours: number;
}): { filtered: ProactiveRecommendation[]; suppressedTypes: string[] } {
  const suppressed = new Set<string>();
  const filtered: ProactiveRecommendation[] = [];

  for (const recommendation of params.recommendations) {
    if (
      isWithinCooldown({
        recommendation,
        recentBriefs: params.recentBriefs,
        nowIso: params.nowIso,
        cooldownHours: params.cooldownHours,
      })
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
