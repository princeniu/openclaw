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

function resolveCommandConversationId(params: {
  to?: string;
  from?: string;
  senderId?: string;
}): string | undefined {
  const candidates = [params.to, params.from, params.senderId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

    api.registerCommand({
      name: "ceo",
      description: "Toggle CEO routing mode: /ceo on|off|status",
      acceptsArgs: true,
      handler: (ctx) => {
        const action = (ctx.args ?? "status").trim().toLowerCase();
        const conversationId = resolveCommandConversationId({
          to: ctx.to,
          from: ctx.from,
          senderId: ctx.senderId,
        });
        const modeKey = buildModeKey({
          channel: ctx.channel,
          accountId: ctx.accountId,
          conversationId,
          threadId: normalizeThreadId(ctx.messageThreadId),
        });
        if (!modeKey) {
          return {
            text: "Unable to resolve chat scope for /ceo command.",
          };
        }

        if (action === "on" || action === "enable") {
          ceoModeKeys.add(modeKey);
          suppressUntilMsByModeKey.delete(modeKey);
          return {
            text: "CEO mode enabled. Regular chat text will route to CEO APIs.",
          };
        }
        if (action === "off" || action === "disable") {
          ceoModeKeys.delete(modeKey);
          suppressUntilMsByModeKey.delete(modeKey);
          return {
            text: "CEO mode disabled. Chat is back to normal agent replies.",
          };
        }
        if (action === "status" || action.length === 0) {
          return {
            text: ceoModeKeys.has(modeKey) ? "CEO mode: ON" : "CEO mode: OFF",
          };
        }
        return {
          text: "Usage: /ceo on | /ceo off | /ceo status",
        };
      },
    });

    api.on("message_sending", (event, ctx) => {
      const metadata =
        event.metadata && typeof event.metadata === "object"
          ? (event.metadata as Record<string, unknown>)
          : undefined;
      const modeKey = buildModeKey({
        channel: ctx.channelId,
        accountId: ctx.accountId,
        conversationId: ctx.conversationId ?? event.to,
        threadId: normalizeThreadId(metadata?.threadId),
      });
      if (!modeKey) {
        return {};
      }
      if (!ceoModeKeys.has(modeKey)) {
        return {};
      }
      if (!isWithinSuppressionWindow(modeKey)) {
        return {};
      }
      return { cancel: true };
    });

    api.on("message_received", async (event, ctx) => {
      const channel = ctx.channelId.trim().toLowerCase();
      if (channel !== "telegram") {
        return;
      }
      const metadata =
        event.metadata && typeof event.metadata === "object"
          ? (event.metadata as Record<string, unknown>)
          : undefined;
      const conversationId = ctx.conversationId ?? readMetadataString(metadata, "to") ?? event.from;
      const threadId = normalizeThreadId(metadata?.threadId);
      const modeKey = buildModeKey({
        channel,
        accountId: ctx.accountId,
        conversationId,
        threadId,
      });
      if (!modeKey || !ceoModeKeys.has(modeKey)) {
        return;
      }

      const messageText = event.content.trim();
      if (!messageText || messageText.startsWith("/")) {
        return;
      }

      startSuppressionWindow(modeKey);
      const execution = await executeRoutedIntent({
        messageText,
        channel,
        peerId: conversationId,
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

      await api.runtime.channel.telegram.sendMessageTelegram(conversationId, text, {
        accountId: ctx.accountId,
        messageThreadId: parseThreadIdNumber(threadId),
      });
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
