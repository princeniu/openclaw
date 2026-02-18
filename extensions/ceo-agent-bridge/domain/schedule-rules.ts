export type ScheduleRiskLevel = "low" | "medium" | "high";

export type ScheduleRiskReport = {
  risk_level: ScheduleRiskLevel;
  hits: string[];
  suggestions: string[];
  action_items: string[];
};

export type ScheduleRiskInput = {
  daily_meeting_hours: number[];
  strategic_time_flags: boolean[];
  deep_work_blocks: number;
};

function hasThreeDayStrategyGap(flags: boolean[]): boolean {
  let consecutive = 0;
  for (const value of flags) {
    if (value) {
      consecutive = 0;
      continue;
    }
    consecutive += 1;
    if (consecutive >= 3) {
      return true;
    }
  }
  return false;
}

function toActionItem(suggestion: string): string {
  if (suggestion.includes("strategic") || suggestion.includes("战略")) {
    return "为未来两周创建固定战略时段，并指派负责人确认。";
  }
  if (suggestion.includes("deep work") || suggestion.includes("深度")) {
    return "本周安排至少 1 个 90 分钟深度工作块并锁定日程。";
  }
  return "压缩会议时段并创建高优先级执行窗口。";
}

export function evaluateScheduleRisks(input: ScheduleRiskInput): ScheduleRiskReport {
  const hits: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  if (input.daily_meeting_hours.some((hours) => hours > 6)) {
    hits.push("R1_MEETING_OVERLOAD");
    suggestions.push("Cap daily meetings and block executive focus windows.");
    score += 2;
  }

  if (hasThreeDayStrategyGap(input.strategic_time_flags)) {
    hits.push("R2_STRATEGY_GAP");
    suggestions.push("Reserve recurring strategic blocks for the next two weeks.");
    score += 2;
  }

  if (input.deep_work_blocks <= 0) {
    hits.push("R3_NO_DEEP_WORK");
    suggestions.push("Create at least one 90-minute deep work block each week.");
    score += 1;
  }

  const risk_level: ScheduleRiskLevel = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  const action_items = suggestions.map((item) => toActionItem(item));

  return {
    risk_level,
    hits,
    suggestions,
    action_items,
  };
}
