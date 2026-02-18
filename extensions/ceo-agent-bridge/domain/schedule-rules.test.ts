import { describe, expect, test } from "vitest";
import { evaluateScheduleRisks } from "./schedule-rules.js";

describe("schedule rules", () => {
  test("classifies high risk when all three rules hit", () => {
    const result = evaluateScheduleRisks({
      daily_meeting_hours: [7, 5, 4, 3, 2],
      strategic_time_flags: [false, false, false, true, true],
      deep_work_blocks: 0,
    });

    expect(result.risk_level).toBe("high");
    expect(result.hits).toEqual(["R1_MEETING_OVERLOAD", "R2_STRATEGY_GAP", "R3_NO_DEEP_WORK"]);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(result.action_items.length).toBe(result.suggestions.length);
  });

  test("returns low risk when no rule is hit", () => {
    const result = evaluateScheduleRisks({
      daily_meeting_hours: [1, 2, 1, 0, 2],
      strategic_time_flags: [true, true, true, true, true],
      deep_work_blocks: 2,
    });

    expect(result.risk_level).toBe("low");
    expect(result.hits).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.action_items).toEqual([]);
  });
});
