import type { GatewayRequestHandlerOptions, OpenClawPluginApi } from "openclaw/plugin-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import type { WeeklySeries } from "./weekly-input-policy.js";
import { buildFeishuActionRoute, validateFeishuActionInput } from "./feishu-action-handler.js";
import { buildCeoHelpText } from "./help-text.js";
import { resolveChannelIdentity, type IdentityRecord } from "./identity-map.js";
import { isCeoIntentMessage, routeCeoIntent } from "./intent-router.js";
import {
  formatMetricsSyncSummary,
  parseMetricsSyncCommand,
  runMetricsSync,
} from "./metrics-sync.js";
import { createMvpClient } from "./mvp-client.js";
import { buildBridgeTelemetryLog } from "./telemetry.js";
import {
  runWorkflowByName,
  type CeoWorkflowName,
  type WorkflowContext,
} from "./workflows/index.js";

function readString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function readNumber(config: Record<string, unknown>, key: string): number | undefined {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
}

function readBoolean(config: Record<string, unknown>, key: string): boolean | undefined {
  const value = config[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readIdentityMap(
  config: Record<string, unknown>,
  key: string,
): Record<string, IdentityRecord> {
  const value = config[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = value as Record<string, unknown>;
  const output: Record<string, IdentityRecord> = {};

  for (const [identityKey, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const tenantId = typeof record.tenantId === "string" ? record.tenantId.trim() : "";
    if (!tenantId) {
      continue;
    }

    output[identityKey] = {
      tenantId,
      sessionKey: typeof record.sessionKey === "string" ? record.sessionKey.trim() : undefined,
      allowed: typeof record.allowed === "boolean" ? record.allowed : undefined,
    };
  }

  return output;
}

function normalizeThreadId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function parseThreadIdNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeAgentId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractAgentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  if (!sessionKey) {
    return undefined;
  }
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^agent:([^:]+):/i.exec(trimmed);
  return match?.[1]?.trim() ? match[1].trim() : undefined;
}

function resolveAgentIdFromSessionCandidates(
  sessionCandidates: Array<string | undefined>,
): string | undefined {
  for (const candidate of sessionCandidates) {
    const agentId = extractAgentIdFromSessionKey(candidate);
    if (agentId) {
      return agentId;
    }
  }
  return undefined;
}

function resolveScopedAgentId(params: {
  explicitAgentId?: unknown;
  sessionCandidates: Array<string | undefined>;
}): string | undefined {
  return (
    normalizeAgentId(params.explicitAgentId) ??
    resolveAgentIdFromSessionCandidates(params.sessionCandidates)
  );
}

function buildModeKey(params: {
  agentId?: string;
  channel: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string;
}): string | null {
  const agentId = params.agentId?.trim().toLowerCase() ?? "";
  const channel = params.channel.trim().toLowerCase();
  const conversationId = params.conversationId?.trim().toLowerCase();
  if (!channel || !conversationId) {
    return null;
  }
  const accountId = params.accountId?.trim().toLowerCase() ?? "";
  const threadId = params.threadId?.trim().toLowerCase() ?? "";
  return `${agentId}|${channel}|${accountId}|${conversationId}|${threadId}`;
}

function buildModeKeys(params: {
  agentId?: string;
  channel: string;
  accountId?: string;
  threadId?: string;
  conversationIds: Array<string | undefined>;
}): string[] {
  const keys = new Set<string>();
  const agentIdCandidates = params.agentId ? [params.agentId, undefined] : [undefined];
  for (const conversationId of params.conversationIds) {
    for (const agentId of agentIdCandidates) {
      const key = buildModeKey({
        agentId,
        channel: params.channel,
        accountId: params.accountId,
        conversationId,
        threadId: params.threadId,
      });
      if (key) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

function resolveCommandConversationIds(params: {
  to?: string;
  from?: string;
  senderId?: string;
}): string[] {
  const out: string[] = [];
  const candidates = [params.to, params.from, params.senderId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const trimmed = candidate.trim();
      if (!out.includes(trimmed)) {
        out.push(trimmed);
      }
    }
  }
  return out;
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type CeoModeAction = "on" | "off" | "status";
type CeoSlashAction = CeoModeAction | "help";

function parseCeoSlashAction(value: string): CeoSlashAction | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "on" || normalized === "enable") {
    return "on";
  }
  if (normalized === "off" || normalized === "disable") {
    return "off";
  }
  if (normalized === "status" || normalized.length === 0) {
    return "status";
  }
  if (normalized === "help" || normalized === "h" || normalized === "?") {
    return "help";
  }
  return undefined;
}

function parseCeoNaturalAction(value: string): Exclude<CeoModeAction, "status"> | undefined {
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[\s,，.。!！?？:：]+/g, "");

  const hasCeoContext =
    compact.includes("ceo") ||
    /(?:\bceo\b|ceo\s*mode|首席执行官|老板模式|ceomode)/i.test(normalized);
  if (!hasCeoContext) {
    return undefined;
  }

  const onCompactKeywords = [
    "开启ceo",
    "打开ceo",
    "启用ceo",
    "切到ceo",
    "切换到ceo",
    "进入ceo",
    "ceo模式开",
    "ceoon",
    "ceomodeon",
  ];
  const offCompactKeywords = [
    "关闭ceo",
    "关掉ceo",
    "停用ceo",
    "退出ceo",
    "ceo模式关",
    "ceooff",
    "ceomodeoff",
  ];

  const onWordKeywords = ["on", "enable", "start"];
  const offWordKeywords = ["off", "disable", "stop"];

  const scoreCompact = (keywords: string[]): number =>
    keywords.reduce((score, keyword) => score + (compact.includes(keyword) ? 2 : 0), 0);

  const scoreWords = (keywords: string[]): number =>
    keywords.reduce((score, keyword) => {
      const pattern = new RegExp(`\\b${keyword}\\b`, "i");
      return score + (pattern.test(normalized) ? 1 : 0);
    }, 0);

  const onScore = scoreCompact(onCompactKeywords) + scoreWords(onWordKeywords);
  const offScore = scoreCompact(offCompactKeywords) + scoreWords(offWordKeywords);

  if (onScore === 0 && offScore === 0) {
    return undefined;
  }
  if (onScore > offScore) {
    return "on";
  }
  if (offScore > onScore) {
    return "off";
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNumberField(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readArrayField(record: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function readFiniteNumberArray(
  record: Record<string, unknown> | undefined,
  key: string,
  minLength: number,
): number[] | undefined {
  const values = readArrayField(record, key);
  if (values.length < minLength) {
    return undefined;
  }
  const numbers: number[] = [];
  for (const item of values) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return undefined;
    }
    numbers.push(item);
  }
  return numbers.length >= minLength ? numbers : undefined;
}

function formatRunTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function localizeWeeklySummary(summary: string | undefined): string | undefined {
  if (!summary) {
    return undefined;
  }

  const trendMatch = summary.match(
    /^Weekly trend:\s*sales\s+([+-]?\d+(?:\.\d+)?)\s+\(([^)]+)\),\s*costs\s+([+-]?\d+(?:\.\d+)?)\s+\(([^)]+)\),\s*cashflow\s+([+-]?\d+(?:\.\d+)?)\.?$/i,
  );
  if (!trendMatch) {
    return summary;
  }

  const [, sales, salesDelta, costs, costsDelta, cashflow] = trendMatch;
  return `本周趋势：销售 ${sales}（${salesDelta}），成本 ${costs}（${costsDelta}），现金流 ${cashflow}。`;
}

function formatMeetingExtractResult(data: unknown): string {
  const record = readRecord(data);
  const decisions = readArrayField(record, "decisions").length;
  const tasks = readArrayField(record, "tasks").length;
  const meetingId = readStringField(record, "meeting_id");
  const postMeetingCard = readRecord(record?.post_meeting_card);

  if (decisions === 0 && tasks === 0) {
    return [
      "已完成会议纪要同步。",
      "本次没有识别出明确的决策或待办。",
      "建议补充更明确的句式，例如：",
      "决策：……",
      "待办：张三 在 2026-02-20 前完成 ……",
    ].join("\n");
  }

  const lines = [
    "已完成会议纪要同步。",
    meetingId ? `会议ID：${meetingId}` : undefined,
    `识别结果：${decisions} 条决策，${tasks} 条待办。`,
    postMeetingCard ? "已推送“确认并派发”卡片。请在卡片中确认后执行派发。" : undefined,
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

function formatDailyHeartbeatResult(data: unknown): string {
  const record = readRecord(data);
  const overdue = readNumberField(record, "overdue_tasks_count") ?? 0;
  const stale = readNumberField(record, "stale_tasks_count") ?? 0;
  const newRisks = readNumberField(record, "new_risks_count") ?? 0;
  const escalations = readNumberField(record, "escalations_count") ?? 0;

  const hasIssue = overdue > 0 || stale > 0 || newRisks > 0 || escalations > 0;

  const lines = [
    "已完成日报心跳检查。",
    `逾期任务：${overdue}，停滞任务：${stale}，新增风险：${newRisks}，升级事项：${escalations}。`,
    hasIssue
      ? "建议优先处理逾期与升级事项，避免风险继续扩大。"
      : "当前状态稳定，可按既定节奏推进。",
  ];
  return lines.join("\n");
}

function formatWeeklyReportResult(data: unknown): string {
  const record = readRecord(data);
  const summary = readStringField(record, "summary");
  const localizedSummary = localizeWeeklySummary(summary);
  const riskLevel = readStringField(record, "risk_level");
  const runId = readStringField(record, "run_id");

  const lines = ["已完成周报生成。"];
  if (localizedSummary) {
    lines.push(`摘要：${localizedSummary}`);
  }
  if (riskLevel) {
    lines.push(`风险等级：${riskLevel}`);
  }
  if (runId) {
    lines.push(`报告运行ID：${runId}`);
  }
  if (!summary && !riskLevel) {
    lines.push("周报已生成成功。可继续发送“latest runs 5”查看最近任务状态。");
  }
  return lines.join("\n");
}

function formatLatestRunsResult(data: unknown): string {
  const record = readRecord(data);
  const run = readRecord(record?.run);

  if (!run) {
    return "已查询最近运行记录，但当前没有可展示的运行明细。";
  }

  const status = readStringField(run, "status") ?? "unknown";
  const runType = readStringField(run, "run_type") ?? "unknown";
  const runId = readStringField(run, "run_id");
  const startedAt = formatRunTime(readStringField(run, "started_at"));
  const finishedAt = formatRunTime(readStringField(run, "finished_at"));

  const lines = [
    "已查询最近运行记录。",
    `最近一次：${runType}（状态：${status}）`,
    runId ? `运行ID：${runId}` : undefined,
    startedAt ? `开始时间：${startedAt}` : undefined,
    finishedAt ? `结束时间：${finishedAt}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function formatScheduleAnalyzeResult(data: unknown): string {
  const record = readRecord(data);
  const report = readRecord(record?.schedule_risk_report) ?? readRecord(record?.data);
  if (!report) {
    return "已完成日程分析，但当前没有可展示的风险结果。";
  }

  const riskLevel = readStringField(report, "risk_level") ?? "unknown";
  const hits = readArrayField(report, "hits").filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  const actionItems = readArrayField(report, "action_items").filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );

  const lines = [
    "已完成日程分析。",
    `风险等级：${riskLevel}`,
    hits.length ? `命中规则：${hits.join("、")}` : undefined,
    actionItems.length ? `建议动作：${actionItems.slice(0, 3).join("；")}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function formatCrmRisksResult(data: unknown): string {
  const record = readRecord(data);
  const riskList = readArrayField(record, "crm_risk_list");
  if (riskList.length === 0) {
    return "已完成客户风险扫描，但当前没有可展示的风险客户。";
  }

  const entries: string[] = [];
  for (const item of riskList.slice(0, 3)) {
    const risk = readRecord(item);
    if (!risk) {
      continue;
    }
    const customerId = readStringField(risk, "customer_id") ?? "unknown";
    const riskLevel = readStringField(risk, "risk_level") ?? "unknown";
    const riskScore = readNumberField(risk, "risk_score");
    entries.push(`${customerId}（${riskLevel}${riskScore !== undefined ? `/${riskScore}` : ""}）`);
  }

  const first = readRecord(riskList[0]);
  const firstActions = readArrayField(first, "suggested_actions").filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );

  const lines = [
    "已完成客户风险扫描。",
    entries.length ? `高优先客户：${entries.join("、")}` : undefined,
    firstActions.length ? `建议动作：${firstActions.slice(0, 2).join("；")}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function formatProactiveBriefResult(data: unknown): string {
  const record = readRecord(data);
  const summary = readStringField(record, "summary");
  const reportScope = readStringField(record, "report_scope") ?? "daily_brief";
  const weeklyEffectReport = readRecord(record?.weekly_effect_report);
  const triggerTypes = readArrayField(record, "trigger_types").filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  const proactiveItems = readArrayField(record, "proactive_items").filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  const actionItems = readArrayField(record, "action_items").filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );

  if (reportScope === "weekly_effect" && weeklyEffectReport) {
    const adoptionRate = readNumberField(weeklyEffectReport, "adoption_rate");
    const ignoreRate = readNumberField(weeklyEffectReport, "ignore_rate");
    const completionRate = readNumberField(weeklyEffectReport, "completion_rate");
    const pilotAccounts = readNumberField(weeklyEffectReport, "pilot_accounts");

    const lines = [
      "已生成试点客户周效果报表。",
      summary,
      pilotAccounts !== undefined ? `试点客户数：${pilotAccounts}` : undefined,
      adoptionRate !== undefined ? `采纳率：${(adoptionRate * 100).toFixed(1)}%` : undefined,
      ignoreRate !== undefined ? `忽略率：${(ignoreRate * 100).toFixed(1)}%` : undefined,
      completionRate !== undefined
        ? `执行完成率：${(completionRate * 100).toFixed(1)}%`
        : undefined,
    ].filter((line): line is string => Boolean(line));
    return lines.join("\n");
  }

  const lines = [
    "已生成主动简报。",
    summary,
    triggerTypes.length ? `触发类型：${triggerTypes.join("、")}` : undefined,
    proactiveItems.length ? `提醒：${proactiveItems.slice(0, 2).join("；")}` : undefined,
    actionItems.length ? `建议执行：${actionItems.slice(0, 2).join("；")}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function formatChatResult(params: {
  intent: string;
  runId?: string;
  requestId?: string;
  data: unknown;
}): string {
  if (params.intent === "meeting_extract") {
    return formatMeetingExtractResult(params.data);
  }
  if (params.intent === "daily_heartbeat") {
    return formatDailyHeartbeatResult(params.data);
  }
  if (params.intent === "weekly_report") {
    return formatWeeklyReportResult(params.data);
  }
  if (params.intent === "latest_runs") {
    return formatLatestRunsResult(params.data);
  }
  if (params.intent === "schedule_analyze") {
    return formatScheduleAnalyzeResult(params.data);
  }
  if (params.intent === "crm_risks") {
    return formatCrmRisksResult(params.data);
  }
  if (params.intent === "proactive_brief") {
    return formatProactiveBriefResult(params.data);
  }
  return "已完成请求处理。";
}

function extractMeetingPostCard(data: unknown): Record<string, unknown> | undefined {
  const record = readRecord(data);
  const card = readRecord(record?.post_meeting_card);
  return card;
}

function formatChatError(code: string, error: string): string {
  if (code === "validation_error") {
    return [
      "我没识别出可执行的 CEO 指令。",
      "可用示例：daily、weekly、latest runs 5、会议纪要 今天同步了客户拜访。",
      `详情：${error}`,
    ].join("\n");
  }
  if (code === "unauthorized") {
    return "当前会话没有 CEO 权限，请联系管理员确认身份映射配置。";
  }
  if (code === "config_error") {
    return "CEO 服务配置未完成，请先配置 mvpBaseUrl 和 mvpApiToken。";
  }
  if (code === "timeout") {
    return "CEO 服务请求超时，请稍后重试。";
  }
  if (code === "network_error") {
    return "CEO 服务连接失败，请检查网络或服务状态后重试。";
  }
  if (code === "upstream_error" || code === "invalid_response") {
    return `CEO 服务暂时不可用：${error}`;
  }
  return `CEO 请求失败：${error}`;
}

const pluginDirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(pluginDirname, "../../..");

const INTERNAL_ENDPOINT_TO_WORKFLOW: Record<string, CeoWorkflowName> = {
  "/ceo/workflows/meeting-extract": "meeting-extract",
  "/ceo/workflows/schedule-analyze": "schedule-analyze",
  "/ceo/workflows/crm-risk-scan": "crm-risk-scan",
  "/ceo/workflows/supply-risk-scan": "supply-risk-scan",
  "/ceo/workflows/proactive-brief-generate": "proactive-brief-generate",
};

function resolveInternalWorkflow(endpoint: string): CeoWorkflowName | undefined {
  return INTERNAL_ENDPOINT_TO_WORKFLOW[endpoint];
}

const plugin = {
  id: "ceo-agent-bridge",
  name: "CEO Agent Bridge",
  description: "Bridge OpenClaw channel events to CEO Agent MVP APIs",
  kind: "integration",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const pluginConfig =
      api.pluginConfig && typeof api.pluginConfig === "object" && !Array.isArray(api.pluginConfig)
        ? (api.pluginConfig as Record<string, unknown>)
        : {};

    const mvpBaseUrl = readString(pluginConfig, "mvpBaseUrl");
    const mvpApiToken = readString(pluginConfig, "mvpApiToken");
    const requestTimeoutMs = readNumber(pluginConfig, "requestTimeoutMs");
    const maxRetries = readNumber(pluginConfig, "maxRetries");
    const weeklyRealMetricsPreferred =
      readBoolean(pluginConfig, "weeklyRealMetricsPreferred") ?? false;
    const metricsSyncScriptPath =
      readString(pluginConfig, "metricsSyncScriptPath") ??
      path.join(projectRoot, "scripts", "ceo_metrics_sync.py");
    const metricsSyncDbPath =
      readString(pluginConfig, "metricsSyncDbPath") ?? path.join(projectRoot, "ceo_agent.db");

    const defaultTenantId = readString(pluginConfig, "defaultTenantId") ?? "default";
    const allowlist = readStringArray(pluginConfig, "identityAllowlist");
    const staticMap = readIdentityMap(pluginConfig, "identityMap");
    const envOverrideJson =
      readString(pluginConfig, "identityEnvOverrideJson") ?? process.env.OPENCLAW_CEO_IDENTITY_MAP;
    const fallbackMode =
      readString(pluginConfig, "identityFallbackMode") === "deny" ? "deny" : "allow";
    const ceoAgentId = readString(pluginConfig, "ceoAgentId") ?? "ceo-agent";
    const enforceAgentScope = readBoolean(pluginConfig, "enforceAgentScope") ?? false;

    const client =
      mvpBaseUrl && mvpApiToken
        ? createMvpClient({
            baseUrl: mvpBaseUrl,
            apiToken: mvpApiToken,
            timeoutMs: requestTimeoutMs,
            maxRetries,
          })
        : null;

    const ceoModeKeys = new Set<string>();
    const suppressUntilMsByModeKey = new Map<string, number>();
    const SUPPRESSION_WINDOW_MS = 15_000;

    const startSuppressionWindow = (modeKey: string) => {
      suppressUntilMsByModeKey.set(modeKey, Date.now() + SUPPRESSION_WINDOW_MS);
    };

    const isWithinSuppressionWindow = (modeKey: string): boolean => {
      const until = suppressUntilMsByModeKey.get(modeKey);
      if (!until) {
        return false;
      }
      if (Date.now() > until) {
        suppressUntilMsByModeKey.delete(modeKey);
        return false;
      }
      return true;
    };

    const isCeoModeEnabled = (modeKeys: string[]): boolean =>
      modeKeys.some((modeKey) => ceoModeKeys.has(modeKey));

    const modeKeysWithinSuppressionWindow = (modeKeys: string[]): string[] =>
      modeKeys.filter((modeKey) => isWithinSuppressionWindow(modeKey));

    const isAllowedAgentScope = (agentId: string | undefined): boolean => {
      if (!enforceAgentScope) {
        return true;
      }
      if (!agentId) {
        return true;
      }
      return agentId === ceoAgentId;
    };

    const applyModeAction = (modeKeys: string[], action: CeoModeAction): string => {
      if (action === "on") {
        for (const modeKey of modeKeys) {
          ceoModeKeys.add(modeKey);
          suppressUntilMsByModeKey.delete(modeKey);
        }
        return "已开启 CEO 模式。你可以直接发送 daily、weekly、latest runs 5、sync metrics <目录> 或会议纪要内容。";
      }
      if (action === "off") {
        for (const modeKey of modeKeys) {
          ceoModeKeys.delete(modeKey);
          suppressUntilMsByModeKey.delete(modeKey);
        }
        return "已关闭 CEO 模式，当前会按普通聊天回复。";
      }
      return isCeoModeEnabled(modeKeys) ? "CEO 模式：已开启" : "CEO 模式：已关闭";
    };

    type RouteExecutionResult =
      | {
          ok: true;
          route: ReturnType<typeof routeCeoIntent> extends { ok: true; route: infer R } ? R : never;
          status: number;
          requestId?: string;
          runId?: string;
          data: unknown;
          identity: {
            key: string;
            source: string;
            tenantId: string;
            sessionKey: string;
          };
        }
      | {
          ok: false;
          code: string;
          error: string;
          status?: number;
        };

    const executeRoutedIntent = async (params: {
      messageText: string;
      channel: string;
      peerId: string;
      threadId?: string;
      timezone?: string;
      requestId?: string;
    }): Promise<RouteExecutionResult> => {
      const startedAt = Date.now();

      const identity = resolveChannelIdentity(
        {
          channel: params.channel,
          peerId: params.peerId,
          threadId: params.threadId,
        },
        {
          defaultTenantId,
          staticMap,
          allowlist,
          envOverrideJson,
          fallbackMode,
        },
      );

      if (!identity.allowed) {
        api.logger.warn(
          JSON.stringify(
            buildBridgeTelemetryLog({
              channel: params.channel,
              peerId: params.peerId,
              sessionKey: identity.sessionKey,
              requestId: params.requestId,
              latencyMs: Date.now() - startedAt,
              status: "error",
              errorCode: "unauthorized",
            }),
          ),
        );
        return {
          ok: false,
          code: "unauthorized",
          error: identity.reason ?? "identity denied",
        };
      }

      let routeResult = routeCeoIntent({
        messageText: params.messageText,
        tenantId: identity.tenantId,
        sessionKey: identity.sessionKey,
        requestId: params.requestId,
        timezone: params.timezone,
      });

      if (
        weeklyRealMetricsPreferred &&
        client &&
        routeResult.ok &&
        routeResult.route.intent === "weekly_report"
      ) {
        const metricsResult = await client.execute(
          {
            endpoint: "/api/v1/metrics/series/latest",
            method: "GET",
            query: {
              tenant_id: identity.tenantId,
              limit: 2,
            },
          },
          {
            requestId: params.requestId,
            sessionId: identity.sessionKey,
          },
        );
        if (metricsResult.ok) {
          const metricsPayload =
            metricsResult.data && typeof metricsResult.data === "object"
              ? (metricsResult.data as Record<string, unknown>)
              : undefined;
          const sales = readFiniteNumberArray(metricsPayload, "sales", 2);
          const costs = readFiniteNumberArray(metricsPayload, "costs", 2);
          const cashflow = readFiniteNumberArray(metricsPayload, "cashflow", 2);
          if (sales && costs && cashflow) {
            const realWeeklySeries: WeeklySeries = {
              sales,
              costs,
              cashflow,
            };
            const routeWithRealMetrics = routeCeoIntent({
              messageText: params.messageText,
              tenantId: identity.tenantId,
              sessionKey: identity.sessionKey,
              requestId: params.requestId,
              timezone: params.timezone,
              weeklyInputPolicy: "real-or-default",
              realWeeklySeries,
            });
            if (routeWithRealMetrics.ok) {
              routeResult = routeWithRealMetrics;
            }
          }
        }
      }

      if (!routeResult.ok) {
        api.logger.warn(
          JSON.stringify(
            buildBridgeTelemetryLog({
              channel: params.channel,
              peerId: params.peerId,
              sessionKey: identity.sessionKey,
              requestId: params.requestId,
              latencyMs: Date.now() - startedAt,
              status: "error",
              errorCode: routeResult.error.code,
            }),
          ),
        );
        return {
          ok: false,
          code: routeResult.error.code,
          error: routeResult.error.message,
        };
      }

      const internalWorkflow = resolveInternalWorkflow(routeResult.route.endpoint);
      if (internalWorkflow) {
        const requestId = params.requestId ?? `req-${Date.now()}`;
        const runId = `${internalWorkflow}-${Date.now()}`;
        const context: WorkflowContext = {
          tenantId: identity.tenantId,
          requestId,
          sessionId: identity.sessionKey,
          runId,
          nowIso: new Date().toISOString(),
        };
        const workflowPayload = routeResult.route.payload ?? {};
        const workflowResult = await runWorkflowByName(internalWorkflow, context, workflowPayload);
        const statusCode = workflowResult.status === "failed" ? 500 : 200;

        api.logger.info(
          JSON.stringify(
            buildBridgeTelemetryLog({
              channel: params.channel,
              peerId: params.peerId,
              sessionKey: identity.sessionKey,
              requestId: workflowResult.request_id,
              runId: workflowResult.run_id,
              latencyMs: Date.now() - startedAt,
              status: workflowResult.status === "failed" ? "error" : "success",
              intent: routeResult.route.intent,
              endpoint: routeResult.route.endpoint,
              errorCode: workflowResult.status === "failed" ? "workflow_error" : undefined,
            }),
          ),
        );

        if (workflowResult.status === "failed") {
          return {
            ok: false,
            code: "upstream_error",
            status: statusCode,
            error: workflowResult.errors.join("; ") || "internal workflow failed",
          };
        }

        return {
          ok: true,
          route: routeResult.route,
          status: statusCode,
          requestId: workflowResult.request_id,
          runId: workflowResult.run_id,
          data: workflowResult.data,
          identity: {
            key: identity.identityKey,
            source: identity.source,
            tenantId: identity.tenantId,
            sessionKey: identity.sessionKey,
          },
        };
      }

      if (!client) {
        api.logger.error(
          JSON.stringify(
            buildBridgeTelemetryLog({
              channel: params.channel,
              peerId: params.peerId,
              sessionKey: identity.sessionKey,
              requestId: params.requestId,
              latencyMs: Date.now() - startedAt,
              status: "error",
              intent: routeResult.route.intent,
              endpoint: routeResult.route.endpoint,
              errorCode: "config_error",
            }),
          ),
        );
        return {
          ok: false,
          code: "config_error",
          error: "ceo-agent-bridge requires mvpBaseUrl and mvpApiToken in plugin config",
        };
      }

      const mvpResult = await client.execute(routeResult.route, {
        requestId: params.requestId,
        sessionId: identity.sessionKey,
      });

      if (!mvpResult.ok) {
        api.logger.error(
          JSON.stringify(
            buildBridgeTelemetryLog({
              channel: params.channel,
              peerId: params.peerId,
              sessionKey: identity.sessionKey,
              requestId: params.requestId,
              latencyMs: Date.now() - startedAt,
              status: "error",
              intent: routeResult.route.intent,
              endpoint: routeResult.route.endpoint,
              errorCode: mvpResult.error.code,
            }),
          ),
        );
        return {
          ok: false,
          code: mvpResult.error.code,
          status: mvpResult.error.status,
          error: mvpResult.error.message,
        };
      }

      api.logger.info(
        JSON.stringify(
          buildBridgeTelemetryLog({
            channel: params.channel,
            peerId: params.peerId,
            sessionKey: identity.sessionKey,
            requestId: mvpResult.requestId ?? params.requestId,
            runId: mvpResult.runId,
            latencyMs: Date.now() - startedAt,
            status: "success",
            intent: routeResult.route.intent,
            endpoint: routeResult.route.endpoint,
          }),
        ),
      );

      return {
        ok: true,
        route: routeResult.route,
        status: mvpResult.status,
        requestId: mvpResult.requestId,
        runId: mvpResult.runId,
        data: mvpResult.data,
        identity: {
          key: identity.identityKey,
          source: identity.source,
          tenantId: identity.tenantId,
          sessionKey: identity.sessionKey,
        },
      };
    };

    const sendBridgeReply = async (params: {
      channel: string;
      conversationId: string;
      text: string;
      card?: Record<string, unknown>;
      accountId?: string;
      threadId?: string;
      sessionKey?: string;
    }) => {
      if (params.channel === "telegram") {
        await api.runtime.channel.telegram.sendMessageTelegram(params.conversationId, params.text, {
          accountId: params.accountId,
          messageThreadId: parseThreadIdNumber(params.threadId),
        });
        return;
      }

      const { routeReply } = await import("../../src/auto-reply/reply/route-reply.js");
      if (params.text) {
        const routed = await routeReply({
          payload: { text: params.text },
          channel: params.channel as never,
          to: params.conversationId,
          accountId: params.accountId,
          threadId: params.threadId,
          sessionKey: params.sessionKey,
          cfg: api.config,
          mirror: false,
        });

        if (!routed.ok) {
          throw new Error(routed.error ?? `Failed to route reply to channel=${params.channel}`);
        }
      }

      if (params.channel === "feishu" && params.card) {
        const cardRouted = await routeReply({
          payload: { card: params.card },
          channel: params.channel as never,
          to: params.conversationId,
          accountId: params.accountId,
          threadId: params.threadId,
          sessionKey: params.sessionKey,
          cfg: api.config,
          mirror: false,
        });
        if (!cardRouted.ok) {
          throw new Error(cardRouted.error ?? "Failed to route meeting post card");
        }
      }
    };

    api.registerCommand({
      name: "ceo",
      description: "Toggle CEO routing mode: /ceo on|off|status",
      acceptsArgs: true,
      handler: (ctx) => {
        const commandCtxRecord = readRecord(ctx);
        const commandAgentId = resolveScopedAgentId({
          explicitAgentId: readStringField(commandCtxRecord, "agentId"),
          sessionCandidates: [ctx.sessionKey],
        });
        if (!isAllowedAgentScope(commandAgentId)) {
          return {
            text: `当前会话属于 ${commandAgentId}，未进入 CEO agent（${ceoAgentId}），保持普通模式。`,
          };
        }

        const parsedAction = parseCeoSlashAction(ctx.args ?? "status");
        const modeKeys = buildModeKeys({
          agentId: commandAgentId,
          channel: ctx.channel,
          accountId: ctx.accountId,
          threadId: normalizeThreadId(ctx.messageThreadId),
          conversationIds: [
            ...resolveCommandConversationIds({
              to: ctx.to,
              from: ctx.from,
              senderId: ctx.senderId,
            }),
            ctx.sessionKey,
          ],
        });
        if (modeKeys.length === 0) {
          return {
            text: "Unable to resolve chat scope for /ceo command.",
          };
        }
        if (!parsedAction) {
          return {
            text: "Usage: /ceo on | /ceo off | /ceo status | /ceo help",
          };
        }
        if (parsedAction === "help") {
          return {
            text: buildCeoHelpText(),
          };
        }
        return {
          text: applyModeAction(modeKeys, parsedAction),
        };
      },
    });

    api.on("message_sending", (event, ctx) => {
      const metadata =
        event.metadata && typeof event.metadata === "object"
          ? (event.metadata as Record<string, unknown>)
          : undefined;
      const ctxRecord = readRecord(ctx);
      const sendingKind = readMetadataString(metadata, "kind");
      const sendingSessionKey = readMetadataString(metadata, "sessionKey");
      const contextSessionKey = readStringField(ctxRecord, "sessionKey");
      const scopedAgentId = resolveScopedAgentId({
        explicitAgentId: readStringField(ctxRecord, "agentId"),
        sessionCandidates: [sendingSessionKey, contextSessionKey],
      });
      if (!isAllowedAgentScope(scopedAgentId)) {
        return {};
      }
      if (!sendingKind && !sendingSessionKey) {
        return {};
      }
      const modeKeys = buildModeKeys({
        agentId: scopedAgentId,
        channel: ctx.channelId,
        accountId: ctx.accountId,
        threadId: normalizeThreadId(metadata?.threadId),
        conversationIds: [
          ctx.conversationId,
          event.to,
          readMetadataString(metadata, "conversationId"),
          readMetadataString(metadata, "sessionKey"),
        ],
      });
      if (modeKeys.length === 0) {
        return {};
      }
      const suppressionKeys = modeKeysWithinSuppressionWindow(modeKeys);
      if (!isCeoModeEnabled(modeKeys) && suppressionKeys.length === 0) {
        return {};
      }
      if (suppressionKeys.length === 0) {
        return {};
      }
      return { cancel: true };
    });

    api.on("message_received", async (event, ctx) => {
      const channel = ctx.channelId.trim().toLowerCase();
      if (channel !== "telegram" && channel !== "feishu") {
        return;
      }
      const metadata =
        event.metadata && typeof event.metadata === "object"
          ? (event.metadata as Record<string, unknown>)
          : undefined;
      const ctxRecord = readRecord(ctx);
      const scopedAgentId = resolveScopedAgentId({
        explicitAgentId: readStringField(ctxRecord, "agentId"),
        sessionCandidates: [
          readMetadataString(metadata, "sessionKey"),
          readStringField(ctxRecord, "sessionKey"),
        ],
      });
      if (!isAllowedAgentScope(scopedAgentId)) {
        return;
      }
      const conversationId = ctx.conversationId ?? readMetadataString(metadata, "to") ?? event.from;
      const threadId = normalizeThreadId(metadata?.threadId);
      const modeKeys = buildModeKeys({
        agentId: scopedAgentId,
        channel,
        accountId: ctx.accountId,
        threadId,
        conversationIds: [
          ctx.conversationId,
          readMetadataString(metadata, "conversationId"),
          readMetadataString(metadata, "to"),
          readMetadataString(metadata, "senderId"),
          readMetadataString(metadata, "sessionKey"),
          event.from,
        ],
      });
      if (modeKeys.length === 0) {
        return;
      }

      const messageText = event.content.trim();
      if (!messageText) {
        return;
      }

      const naturalModeAction = parseCeoNaturalAction(messageText);
      if (naturalModeAction) {
        const text = applyModeAction(modeKeys, naturalModeAction);
        try {
          await sendBridgeReply({
            channel,
            conversationId,
            text,
            accountId: ctx.accountId,
            threadId,
          });
        } catch (error) {
          api.logger.error(
            `ceo-agent-bridge failed to send mode reply channel=${channel} error=${String(error)}`,
          );
        }
        return;
      }

      if (!isCeoModeEnabled(modeKeys)) {
        return;
      }

      if (messageText.startsWith("/")) {
        return;
      }

      const metricsSyncCommand = parseMetricsSyncCommand(messageText);
      if (metricsSyncCommand.matched) {
        for (const modeKey of modeKeys) {
          startSuppressionWindow(modeKey);
        }

        if (metricsSyncCommand.error || !metricsSyncCommand.inputDir) {
          await sendBridgeReply({
            channel,
            conversationId,
            text: metricsSyncCommand.error ?? "sync metrics 命令参数无效",
            accountId: ctx.accountId,
            threadId,
          });
          return;
        }

        const peerId = channel === "feishu" ? event.from : conversationId;
        const identity = resolveChannelIdentity(
          {
            channel,
            peerId,
            threadId,
          },
          {
            defaultTenantId,
            staticMap,
            allowlist,
            envOverrideJson,
            fallbackMode,
          },
        );
        if (!identity.allowed) {
          await sendBridgeReply({
            channel,
            conversationId,
            text: "当前身份未授权执行指标同步，请联系管理员配置身份映射。",
            accountId: ctx.accountId,
            threadId,
          });
          return;
        }

        try {
          const summary = await runMetricsSync({
            scriptPath: metricsSyncScriptPath,
            inputDir: metricsSyncCommand.inputDir,
            tenantId: identity.tenantId,
            dbPath: metricsSyncDbPath,
            dryRun: metricsSyncCommand.dryRun,
          });
          await sendBridgeReply({
            channel,
            conversationId,
            text: formatMetricsSyncSummary(summary),
            accountId: ctx.accountId,
            threadId,
            sessionKey: identity.sessionKey,
          });
        } catch (error) {
          for (const modeKey of modeKeys) {
            suppressUntilMsByModeKey.delete(modeKey);
          }
          api.logger.error(
            `ceo-agent-bridge metrics sync failed channel=${channel} error=${String(error)}`,
          );
          await sendBridgeReply({
            channel,
            conversationId,
            text: "指标同步失败，请检查目录路径、文件格式和运行日志。",
            accountId: ctx.accountId,
            threadId,
          });
        }
        return;
      }

      if (!isCeoIntentMessage(messageText)) {
        return;
      }

      for (const modeKey of modeKeys) {
        startSuppressionWindow(modeKey);
      }
      const peerId = channel === "feishu" ? event.from : conversationId;
      const execution = await executeRoutedIntent({
        messageText,
        channel,
        peerId,
        threadId,
      });

      const text = execution.ok
        ? formatChatResult({
            intent: execution.route.intent,
            runId: execution.runId,
            requestId: execution.requestId,
            data: execution.data,
          })
        : formatChatError(execution.code, execution.error);
      const card =
        execution.ok && execution.route.intent === "meeting_extract"
          ? extractMeetingPostCard(execution.data)
          : undefined;

      try {
        await sendBridgeReply({
          channel,
          conversationId,
          text,
          card,
          accountId: ctx.accountId,
          threadId,
          sessionKey: execution.ok ? execution.identity.sessionKey : undefined,
        });
      } catch (error) {
        for (const modeKey of modeKeys) {
          suppressUntilMsByModeKey.delete(modeKey);
        }
        api.logger.error(
          JSON.stringify(
            buildBridgeTelemetryLog({
              channel,
              peerId: conversationId,
              sessionKey: execution.ok ? execution.identity.sessionKey : undefined,
              requestId: execution.ok ? execution.requestId : undefined,
              runId: execution.ok ? execution.runId : undefined,
              latencyMs: 0,
              status: "error",
              intent: execution.ok ? execution.route.intent : undefined,
              endpoint: execution.ok ? execution.route.endpoint : undefined,
              errorCode: "send_error",
            }),
          ),
        );
        api.logger.error(
          `ceo-agent-bridge failed to send routed reply channel=${channel} error=${String(error)}`,
        );
      }
    });

    api.registerGatewayMethod(
      "ceo.bridge.handle_feishu_action",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        const now = Date.now();
        const paramsRecord = readRecord(params);

        const channel =
          readStringField(paramsRecord, "channel") ??
          readStringField(paramsRecord, "channelId") ??
          "feishu";
        const peerId =
          readStringField(paramsRecord, "peerId") ??
          readStringField(paramsRecord, "from") ??
          readStringField(paramsRecord, "actorId") ??
          readStringField(paramsRecord, "actor_id");
        const threadId =
          readStringField(paramsRecord, "threadId") ??
          readStringField(paramsRecord, "conversationId");

        let resolvedSessionKey =
          readStringField(paramsRecord, "sessionId") ?? readStringField(paramsRecord, "session_id");
        let tenantId =
          readStringField(paramsRecord, "tenantId") ?? readStringField(paramsRecord, "tenant_id");

        if (!tenantId && peerId) {
          const identity = resolveChannelIdentity(
            {
              channel,
              peerId,
              threadId,
            },
            {
              defaultTenantId,
              staticMap,
              allowlist,
              envOverrideJson,
              fallbackMode,
            },
          );

          if (!identity.allowed) {
            respond(false, {
              code: "unauthorized",
              status: 403,
              error: identity.reason ?? "identity denied",
            });
            return;
          }

          tenantId = identity.tenantId;
          resolvedSessionKey = resolvedSessionKey ?? identity.sessionKey;
        }

        const parsed = validateFeishuActionInput({
          action: readStringField(paramsRecord, "action") ?? "",
          recommendationId:
            readStringField(paramsRecord, "recommendationId") ??
            readStringField(paramsRecord, "recommendation_id") ??
            "",
          tenantId: tenantId ?? defaultTenantId,
          actorId:
            readStringField(paramsRecord, "actorId") ?? readStringField(paramsRecord, "actor_id"),
          dueAt: readStringField(paramsRecord, "dueAt") ?? readStringField(paramsRecord, "due_at"),
          requestId:
            readStringField(paramsRecord, "requestId") ??
            readStringField(paramsRecord, "request_id"),
          sessionId: resolvedSessionKey,
        });

        if (!parsed.ok) {
          respond(false, {
            code: parsed.code,
            status: 422,
            error: parsed.message,
          });
          return;
        }

        const route = buildFeishuActionRoute(parsed.value);
        const internalWorkflow = resolveInternalWorkflow(route.endpoint);
        if (!internalWorkflow) {
          respond(false, {
            code: "internal_error",
            status: 500,
            error: `unsupported internal endpoint: ${route.endpoint}`,
          });
          return;
        }

        const requestId = parsed.value.requestId ?? `req-${now}`;
        const sessionId =
          parsed.value.sessionId ?? `${channel}:${peerId ?? "unknown"}:${threadId ?? "direct"}`;
        const runId = `${internalWorkflow}-${now}`;
        const context: WorkflowContext = {
          tenantId: parsed.value.tenantId,
          requestId,
          sessionId,
          runId,
          nowIso: new Date(now).toISOString(),
        };

        const workflowResult = await runWorkflowByName(internalWorkflow, context, route.payload);

        api.logger.info(
          JSON.stringify(
            buildBridgeTelemetryLog({
              channel,
              peerId: peerId ?? "unknown",
              sessionKey: sessionId,
              requestId: workflowResult.request_id,
              runId: workflowResult.run_id,
              latencyMs: Date.now() - now,
              status: workflowResult.status === "failed" ? "error" : "success",
              intent: "crm_risks",
              endpoint: route.endpoint,
              errorCode: workflowResult.status === "failed" ? "workflow_error" : undefined,
            }),
          ),
        );

        if (workflowResult.status === "failed") {
          respond(false, {
            code: "upstream_error",
            status: 500,
            error: workflowResult.errors.join("; ") || "internal workflow failed",
            request_id: workflowResult.request_id,
            session_id: workflowResult.session_id,
            run_id: workflowResult.run_id,
            errors: workflowResult.errors,
          });
          return;
        }

        respond(true, {
          route: {
            endpoint: route.endpoint,
            method: route.method,
          },
          request_id: workflowResult.request_id,
          session_id: workflowResult.session_id,
          run_id: workflowResult.run_id,
          status: workflowResult.status,
          errors: workflowResult.errors,
          data: workflowResult.data,
        });
      },
    );

    api.registerGatewayMethod(
      "ceo.bridge.route_intent",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        const messageText =
          typeof params?.messageText === "string"
            ? params.messageText
            : typeof params?.text === "string"
              ? params.text
              : "";
        const channel =
          typeof params?.channel === "string" && params.channel.trim()
            ? params.channel.trim()
            : typeof params?.channelId === "string" && params.channelId.trim()
              ? params.channelId.trim()
              : "unknown";
        const peerId =
          typeof params?.peerId === "string" && params.peerId.trim()
            ? params.peerId.trim()
            : typeof params?.from === "string" && params.from.trim()
              ? params.from.trim()
              : "unknown";
        const threadId =
          typeof params?.threadId === "string" && params.threadId.trim()
            ? params.threadId.trim()
            : typeof params?.conversationId === "string" && params.conversationId.trim()
              ? params.conversationId.trim()
              : undefined;
        const timezone =
          typeof params?.timezone === "string" && params.timezone.trim()
            ? params.timezone.trim()
            : undefined;
        const requestId =
          typeof params?.requestId === "string" && params.requestId.trim()
            ? params.requestId.trim()
            : undefined;
        const sessionKey =
          typeof params?.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : undefined;
        const scopedAgentId = resolveScopedAgentId({
          explicitAgentId: params?.agentId,
          sessionCandidates: [sessionKey],
        });
        if (!isAllowedAgentScope(scopedAgentId)) {
          respond(false, {
            code: "agent_scope_mismatch",
            status: 403,
            error: `session is bound to ${scopedAgentId}, expected ${ceoAgentId}`,
          });
          return;
        }
        const execution = await executeRoutedIntent({
          messageText,
          channel,
          peerId,
          threadId,
          timezone,
          requestId,
        });
        if (!execution.ok) {
          respond(false, {
            code: execution.code,
            status: execution.status,
            error: execution.error,
          });
          return;
        }

        respond(true, {
          route: execution.route,
          status: execution.status,
          requestId: execution.requestId,
          runId: execution.runId,
          data: execution.data,
          identity: execution.identity,
        });
      },
    );
  },
};

export default plugin;
