import type { GatewayRequestHandlerOptions, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { resolveChannelIdentity, type IdentityRecord } from "./identity-map.js";
import { routeCeoIntent } from "./intent-router.js";
import { createMvpClient } from "./mvp-client.js";
import { buildBridgeTelemetryLog } from "./telemetry.js";

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

function buildModeKey(params: {
  channel: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string;
}): string | null {
  const channel = params.channel.trim().toLowerCase();
  const conversationId = params.conversationId?.trim().toLowerCase();
  if (!channel || !conversationId) {
    return null;
  }
  const accountId = params.accountId?.trim().toLowerCase() ?? "";
  const threadId = params.threadId?.trim().toLowerCase() ?? "";
  return `${channel}|${accountId}|${conversationId}|${threadId}`;
}

function buildModeKeys(params: {
  channel: string;
  accountId?: string;
  threadId?: string;
  conversationIds: Array<string | undefined>;
}): string[] {
  const keys = new Set<string>();
  for (const conversationId of params.conversationIds) {
    const key = buildModeKey({
      channel: params.channel,
      accountId: params.accountId,
      conversationId,
      threadId: params.threadId,
    });
    if (key) {
      keys.add(key);
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

function parseCeoSlashAction(value: string): CeoModeAction | undefined {
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

function formatChatResult(params: {
  intent: string;
  runId?: string;
  requestId?: string;
  data: unknown;
}): string {
  const lines: string[] = [`CEO intent: ${params.intent}`];
  if (params.runId) {
    lines.push(`runId: ${params.runId}`);
  }
  if (params.requestId) {
    lines.push(`requestId: ${params.requestId}`);
  }

  if (params.data && typeof params.data === "object") {
    const record = params.data as Record<string, unknown>;
    if (typeof record.summary === "string" && record.summary.trim()) {
      lines.push(record.summary.trim());
    }
    if (typeof record.risk_level === "string" && record.risk_level.trim()) {
      lines.push(`risk: ${record.risk_level.trim()}`);
    }
    if (typeof record.overdue_tasks_count === "number") {
      lines.push(`overdue: ${record.overdue_tasks_count}`);
    }
    if (typeof record.stale_tasks_count === "number") {
      lines.push(`stale: ${record.stale_tasks_count}`);
    }
    if (typeof record.new_risks_count === "number") {
      lines.push(`new_risks: ${record.new_risks_count}`);
    }
    if (typeof record.escalations_count === "number") {
      lines.push(`escalations: ${record.escalations_count}`);
    }
  }

  lines.push("```json");
  lines.push(JSON.stringify(params.data, null, 2));
  lines.push("```");

  return lines.join("\n");
}

function formatChatError(code: string, error: string): string {
  return `CEO routing failed (${code}): ${error}`;
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

    const defaultTenantId = readString(pluginConfig, "defaultTenantId") ?? "default";
    const allowlist = readStringArray(pluginConfig, "identityAllowlist");
    const staticMap = readIdentityMap(pluginConfig, "identityMap");
    const envOverrideJson =
      readString(pluginConfig, "identityEnvOverrideJson") ?? process.env.OPENCLAW_CEO_IDENTITY_MAP;
    const fallbackMode =
      readString(pluginConfig, "identityFallbackMode") === "deny" ? "deny" : "allow";

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

    const applyModeAction = (modeKeys: string[], action: CeoModeAction): string => {
      if (action === "on") {
        for (const modeKey of modeKeys) {
          ceoModeKeys.add(modeKey);
          suppressUntilMsByModeKey.delete(modeKey);
        }
        return "CEO mode enabled. Regular chat text will route to CEO APIs.";
      }
      if (action === "off") {
        for (const modeKey of modeKeys) {
          ceoModeKeys.delete(modeKey);
          suppressUntilMsByModeKey.delete(modeKey);
        }
        return "CEO mode disabled. Chat is back to normal agent replies.";
      }
      return isCeoModeEnabled(modeKeys) ? "CEO mode: ON" : "CEO mode: OFF";
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

      const routeResult = routeCeoIntent({
        messageText: params.messageText,
        tenantId: identity.tenantId,
        sessionKey: identity.sessionKey,
        requestId: params.requestId,
        timezone: params.timezone,
      });

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
    };

    api.registerCommand({
      name: "ceo",
      description: "Toggle CEO routing mode: /ceo on|off|status",
      acceptsArgs: true,
      handler: (ctx) => {
        const parsedAction = parseCeoSlashAction(ctx.args ?? "status");
        const modeKeys = buildModeKeys({
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
            text: "Usage: /ceo on | /ceo off | /ceo status",
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
      const sendingKind = readMetadataString(metadata, "kind");
      const sendingSessionKey = readMetadataString(metadata, "sessionKey");
      if (!sendingKind && !sendingSessionKey) {
        return {};
      }
      const modeKeys = buildModeKeys({
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
      const conversationId = ctx.conversationId ?? readMetadataString(metadata, "to") ?? event.from;
      const threadId = normalizeThreadId(metadata?.threadId);
      const modeKeys = buildModeKeys({
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

      try {
        await sendBridgeReply({
          channel,
          conversationId,
          text,
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
