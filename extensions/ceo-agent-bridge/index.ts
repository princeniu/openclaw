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

    api.registerGatewayMethod(
      "ceo.bridge.route_intent",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        const startedAt = Date.now();
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
          api.logger.warn(
            JSON.stringify(
              buildBridgeTelemetryLog({
                channel,
                peerId,
                sessionKey: identity.sessionKey,
                requestId,
                latencyMs: Date.now() - startedAt,
                status: "error",
                errorCode: "unauthorized",
              }),
            ),
          );
          respond(false, {
            code: "unauthorized",
            error: identity.reason ?? "identity denied",
            identityKey: identity.identityKey,
          });
          return;
        }

        const routeResult = routeCeoIntent({
          messageText,
          tenantId: identity.tenantId,
          sessionKey: identity.sessionKey,
          timezone,
        });

        if (!routeResult.ok) {
          api.logger.warn(
            JSON.stringify(
              buildBridgeTelemetryLog({
                channel,
                peerId,
                sessionKey: identity.sessionKey,
                requestId,
                latencyMs: Date.now() - startedAt,
                status: "error",
                errorCode: routeResult.error.code,
              }),
            ),
          );
          respond(false, {
            code: routeResult.error.code,
            error: routeResult.error.message,
          });
          return;
        }

        if (!client) {
          api.logger.error(
            JSON.stringify(
              buildBridgeTelemetryLog({
                channel,
                peerId,
                sessionKey: identity.sessionKey,
                requestId,
                latencyMs: Date.now() - startedAt,
                status: "error",
                intent: routeResult.route.intent,
                endpoint: routeResult.route.endpoint,
                errorCode: "config_error",
              }),
            ),
          );
          respond(false, {
            code: "config_error",
            error: "ceo-agent-bridge requires mvpBaseUrl and mvpApiToken in plugin config",
          });
          return;
        }

        const mvpResult = await client.execute(routeResult.route, {
          requestId,
          sessionId: identity.sessionKey,
        });

        if (!mvpResult.ok) {
          api.logger.error(
            JSON.stringify(
              buildBridgeTelemetryLog({
                channel,
                peerId,
                sessionKey: identity.sessionKey,
                requestId,
                latencyMs: Date.now() - startedAt,
                status: "error",
                intent: routeResult.route.intent,
                endpoint: routeResult.route.endpoint,
                errorCode: mvpResult.error.code,
              }),
            ),
          );
          respond(false, {
            code: mvpResult.error.code,
            status: mvpResult.error.status,
            error: mvpResult.error.message,
          });
          return;
        }

        api.logger.info(
          JSON.stringify(
            buildBridgeTelemetryLog({
              channel,
              peerId,
              sessionKey: identity.sessionKey,
              requestId: mvpResult.requestId ?? requestId,
              runId: mvpResult.runId,
              latencyMs: Date.now() - startedAt,
              status: "success",
              intent: routeResult.route.intent,
              endpoint: routeResult.route.endpoint,
            }),
          ),
        );
        respond(true, {
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
        });
      },
    );
  },
};

export default plugin;
