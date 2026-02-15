export type CeoRouteMethod = "GET" | "POST";

export type CeoIntentName = "meeting_extract" | "daily_heartbeat" | "weekly_report" | "latest_runs";

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
const DEFAULT_WEEKLY_SERIES = [1, 1] as const;

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
        sales: [...DEFAULT_WEEKLY_SERIES],
        costs: [...DEFAULT_WEEKLY_SERIES],
        cashflow: [...DEFAULT_WEEKLY_SERIES],
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

  return validationError(`Unsupported command: ${normalized}`);
}
