export type EffectEvent = {
  status?: string;
  occurred_at?: string;
};

export type EffectMetricsInput = {
  nowIso: string;
  events: EffectEvent[];
  windowDays?: number;
};

export type EffectMetricsResult = {
  window_start: string;
  window_end: string;
  accepted_count: number;
  ignored_count: number;
  completed_count: number;
  adoption_rate: number;
  ignore_rate: number;
  completion_rate: number;
};

function toEpoch(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function calculateEffectMetrics(input: EffectMetricsInput): EffectMetricsResult {
  const nowEpoch = toEpoch(input.nowIso) ?? Date.now();
  const windowDays =
    typeof input.windowDays === "number" && input.windowDays > 0 ? input.windowDays : 7;
  const windowStartEpoch = nowEpoch - windowDays * 24 * 60 * 60 * 1000;

  let acceptedCount = 0;
  let ignoredCount = 0;
  let completedCount = 0;

  for (const event of input.events) {
    const occurredAt = typeof event.occurred_at === "string" ? event.occurred_at.trim() : "";
    const occurredEpoch = occurredAt ? toEpoch(occurredAt) : undefined;
    if (
      occurredEpoch === undefined ||
      occurredEpoch < windowStartEpoch ||
      occurredEpoch > nowEpoch
    ) {
      continue;
    }

    const status = typeof event.status === "string" ? event.status.trim().toLowerCase() : "";
    if (status === "accepted") {
      acceptedCount += 1;
      continue;
    }
    if (status === "ignored") {
      ignoredCount += 1;
      continue;
    }
    if (status === "completed") {
      completedCount += 1;
    }
  }

  const decisionBase = acceptedCount + ignoredCount;
  const adoptionRate = decisionBase > 0 ? acceptedCount / decisionBase : 0;
  const ignoreRate = decisionBase > 0 ? ignoredCount / decisionBase : 0;
  const completionRate = acceptedCount > 0 ? completedCount / acceptedCount : 0;

  return {
    window_start: new Date(windowStartEpoch).toISOString(),
    window_end: new Date(nowEpoch).toISOString(),
    accepted_count: acceptedCount,
    ignored_count: ignoredCount,
    completed_count: completedCount,
    adoption_rate: adoptionRate,
    ignore_rate: ignoreRate,
    completion_rate: completionRate,
  };
}
