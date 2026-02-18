import {
  resolveWeeklyInput,
  type WeeklyInputPolicyMode,
  type WeeklySeries,
} from "./weekly-input-policy.js";

export type CeoRouteMethod = "GET" | "POST";

export type CeoIntentName =
  | "meeting_extract"
  | "daily_heartbeat"
  | "weekly_report"
  | "latest_runs"
  | "schedule_analyze"
  | "crm_risks"
  | "supply_risks"
  | "proactive_brief";

export type CeoBridgeRoute = {
  intent: CeoIntentName;
  endpoint: string;
  method: CeoRouteMethod;
  payload?: Record<string, unknown>;
  query?: Record<string, string | number | boolean>;
};

export type CeoIntentInput = {
  messageText: string;
  tenantId: string;
  sessionKey: string;
  requestId?: string;
  timezone?: string;
  now?: Date;
  weeklyInputPolicy?: WeeklyInputPolicyMode;
  realWeeklySeries?: WeeklySeries;
};

export type CeoIntentError = {
  code: "validation_error";
  message: string;
};

export type CeoIntentResult =
  | {
      ok: true;
      route: CeoBridgeRoute;
    }
  | {
      ok: false;
      error: CeoIntentError;
    };

const DEFAULT_LIMIT = 20;
const DEFAULT_STALE_HOURS = 24;

function validationError(message: string): CeoIntentResult {
  return {
    ok: false,
    error: {
      code: "validation_error",
      message,
    },
  };
}

function dateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function shiftDays(now: Date, deltaDays: number): Date {
  const shifted = new Date(now);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return shifted;
}

function stripPrefix(text: string, prefix: RegExp): string {
  return text.replace(prefix, "").trim();
}

function isMeetingCommand(text: string): boolean {
  return /^会议纪要(?:\s|:|：|,|，|-|$)/i.test(text) || /^meeting(?:\s|:|：|,|，|-|$)/i.test(text);
}

function isDailyCommand(text: string): boolean {
  return /日报心跳/.test(text) || /^daily(?:\s|$)/i.test(text);
}

function isWeeklyCommand(text: string): boolean {
  return /周报/.test(text) || /^weekly(?:\s|$)/i.test(text);
}

function isLatestRunsCommand(text: string): boolean {
  return /查询运行/.test(text) || /^latest\s+runs?(?:\s|$)/i.test(text);
}

function isScheduleCommand(text: string): boolean {
  return /日程分析/.test(text) || /^schedule\s+analy[sz]e?(?:\s|$)/i.test(text);
}

function isCrmCommand(text: string): boolean {
  return /客户风险/.test(text) || /^crm\s+risks?(?:\s|$)/i.test(text);
}

function isSupplyCommand(text: string): boolean {
  return /供应链风险/.test(text) || /^supply\s+risks?(?:\s|$)/i.test(text);
}

function isProactiveCommand(text: string): boolean {
  return /主动简报/.test(text) || /^proactive\s+brief(?:\s|$)/i.test(text);
}

export function isCeoIntentMessage(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return (
    isMeetingCommand(normalized) ||
    isDailyCommand(normalized) ||
    isWeeklyCommand(normalized) ||
    isLatestRunsCommand(normalized) ||
    isScheduleCommand(normalized) ||
    isCrmCommand(normalized) ||
    isSupplyCommand(normalized) ||
    isProactiveCommand(normalized)
  );
}

function extractLatestRunsLimit(text: string): number {
  const match = text.match(/\b(\d{1,3})\b/);
  if (!match) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, 100);
}

function routeMeeting(input: CeoIntentInput, normalized: string): CeoIntentResult {
  const now = input.now ?? new Date();
  let transcript = normalized;
  if (/^会议纪要(?:\s|:|：|,|，|-|$)/i.test(normalized)) {
    transcript = stripPrefix(normalized, /^会议纪要(?:\s|:|：|,|，|-)*/i);
  } else {
    transcript = stripPrefix(normalized, /^meeting(?:\s|:|：|,|，|-)*/i);
  }

  if (!transcript) {
    return validationError("Meeting command requires transcript content");
  }

  return {
    ok: true,
    route: {
      intent: "meeting_extract",
      endpoint: "/api/v1/meetings/extract",
      method: "POST",
      payload: {
        tenant_id: input.tenantId,
        meeting_id: input.requestId ?? `meeting-${now.getTime()}`,
        raw_text: transcript,
      },
    },
  };
}

function routeDaily(input: CeoIntentInput): CeoIntentResult {
  const now = input.now ?? new Date();
  return {
    ok: true,
    route: {
      intent: "daily_heartbeat",
      endpoint: "/api/v1/heartbeat/daily/run",
      method: "POST",
      payload: {
        tenant_id: input.tenantId,
        now_iso: now.toISOString(),
        stale_hours: DEFAULT_STALE_HOURS,
      },
    },
  };
}

function routeWeekly(input: CeoIntentInput): CeoIntentResult {
  const now = input.now ?? new Date();
  const periodStart = shiftDays(now, -6);
  const weeklyInput = resolveWeeklyInput({
    mode: input.weeklyInputPolicy ?? "real-or-default",
    realSeries: input.realWeeklySeries,
  });
  if (!weeklyInput.ok) {
    return validationError(weeklyInput.error);
  }
  return {
    ok: true,
    route: {
      intent: "weekly_report",
      endpoint: "/api/v1/reports/weekly/generate",
      method: "POST",
      payload: {
        tenant_id: input.tenantId,
        period_start: dateStamp(periodStart),
        period_end: dateStamp(now),
        sales: [...weeklyInput.series.sales],
        costs: [...weeklyInput.series.costs],
        cashflow: [...weeklyInput.series.cashflow],
      },
    },
  };
}

function routeLatestRuns(input: CeoIntentInput, normalized: string): CeoIntentResult {
  return {
    ok: true,
    route: {
      intent: "latest_runs",
      endpoint: "/api/v1/runs/latest",
      method: "GET",
      query: {
        tenant_id: input.tenantId,
        limit: extractLatestRunsLimit(normalized),
      },
    },
  };
}

function routeSchedule(input: CeoIntentInput): CeoIntentResult {
  return {
    ok: true,
    route: {
      intent: "schedule_analyze",
      endpoint: "/ceo/workflows/schedule-analyze",
      method: "POST",
      payload: {
        tenant_id: input.tenantId,
        daily_meeting_hours: [7, 5, 4, 3, 2],
        strategic_time_flags: [false, false, false, true, true],
        deep_work_blocks: 0,
      },
    },
  };
}

function routeCrm(input: CeoIntentInput): CeoIntentResult {
  return {
    ok: true,
    route: {
      intent: "crm_risks",
      endpoint: "/ceo/workflows/crm-risk-scan",
      method: "POST",
      payload: {
        tenant_id: input.tenantId,
        customers: [
          {
            customer_id: "demo_a",
            days_since_contact: 35,
            overdue_days: 0,
            high_value: false,
          },
          {
            customer_id: "demo_b",
            days_since_contact: 12,
            overdue_days: 18,
            high_value: true,
          },
        ],
      },
    },
  };
}

function routeSupply(input: CeoIntentInput): CeoIntentResult {
  return {
    ok: true,
    route: {
      intent: "supply_risks",
      endpoint: "/ceo/workflows/supply-risk-scan",
      method: "POST",
      payload: {
        tenant_id: input.tenantId,
      },
    },
  };
}

function routeProactive(input: CeoIntentInput): CeoIntentResult {
  return {
    ok: true,
    route: {
      intent: "proactive_brief",
      endpoint: "/ceo/workflows/proactive-brief-generate",
      method: "POST",
      payload: {
        tenant_id: input.tenantId,
      },
    },
  };
}

export function routeCeoIntent(input: CeoIntentInput): CeoIntentResult {
  const normalized = input.messageText.trim();
  if (!normalized) {
    return validationError("Message text is required");
  }

  if (isMeetingCommand(normalized)) {
    return routeMeeting(input, normalized);
  }

  if (isDailyCommand(normalized)) {
    return routeDaily(input);
  }

  if (isWeeklyCommand(normalized)) {
    return routeWeekly(input);
  }

  if (isLatestRunsCommand(normalized)) {
    return routeLatestRuns(input, normalized);
  }

  if (isScheduleCommand(normalized)) {
    return routeSchedule(input);
  }

  if (isCrmCommand(normalized)) {
    return routeCrm(input);
  }

  if (isSupplyCommand(normalized)) {
    return routeSupply(input);
  }

  if (isProactiveCommand(normalized)) {
    return routeProactive(input);
  }

  return validationError(`Unsupported command: ${normalized}`);
}
