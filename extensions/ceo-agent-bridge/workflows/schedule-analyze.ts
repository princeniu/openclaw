import { evaluateScheduleRisks } from "../domain/schedule-rules.js";
import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

function readNumberArray(record: Record<string, unknown>, key: string): number[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const numbers: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return undefined;
    }
    numbers.push(item);
  }
  return numbers;
}

function readBooleanArray(record: Record<string, unknown>, key: string): boolean[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const flags: boolean[] = [];
  for (const item of value) {
    if (typeof item !== "boolean") {
      return undefined;
    }
    flags.push(item);
  }
  return flags;
}

function normalizeInput(payload: Record<string, unknown>): {
  daily_meeting_hours: number[];
  strategic_time_flags: boolean[];
  deep_work_blocks: number;
} {
  const meetingHours = readNumberArray(payload, "daily_meeting_hours") ?? [7, 5, 4, 3, 2];
  const strategicFlags = readBooleanArray(payload, "strategic_time_flags") ?? [
    false,
    false,
    false,
    true,
    true,
  ];
  const deepWorkBlocks =
    typeof payload.deep_work_blocks === "number" && Number.isFinite(payload.deep_work_blocks)
      ? payload.deep_work_blocks
      : 0;

  return {
    daily_meeting_hours: meetingHours,
    strategic_time_flags: strategicFlags,
    deep_work_blocks: deepWorkBlocks,
  };
}

export async function runScheduleAnalyzeWorkflow(
  context: WorkflowContext,
  payload: Record<string, unknown> = {},
): Promise<
  WorkflowResult<{
    workflow: string;
    mode: "dry-run";
    payload_size: number;
    schedule_risk_report: ReturnType<typeof evaluateScheduleRisks>;
  }>
> {
  const normalized = normalizeInput(payload);
  const report = evaluateScheduleRisks(normalized);

  return buildDryRunSuccessResult(context, "schedule-analyze", {
    payload_size: Object.keys(payload).length,
    schedule_risk_report: report,
  });
}
