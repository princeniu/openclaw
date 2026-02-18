import { describe, expect, test, vi } from "vitest";
import plugin from "./index.js";

function createGatewayHandlers(pluginConfig?: Record<string, unknown>) {
  const gatewayHandlers: Record<string, unknown> = {};
  const api = {
    id: "ceo-agent-bridge",
    name: "CEO Agent Bridge",
    source: "test",
    config: {},
    pluginConfig: pluginConfig ?? {},
    runtime: {
      channel: {
        telegram: {
          sendMessageTelegram: vi.fn(async () => ({ messageId: "1" })),
        },
      },
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    registerGatewayMethod(method: string, handler: unknown) {
      gatewayHandlers[method] = handler;
    },
    registerCommand() {
      return undefined;
    },
    on() {
      return undefined;
    },
  };

  plugin.register(api as never);
  return gatewayHandlers;
}

async function invokeGatewayHandler(
  handler: unknown,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; payload: unknown }> {
  if (typeof handler !== "function") {
    throw new Error("gateway handler is not registered");
  }

  let response: { ok: boolean; payload: unknown } | null = null;
  await (
    handler as (options: {
      params: Record<string, unknown>;
      respond: (ok: boolean, payload?: unknown) => void;
    }) => Promise<void> | void
  )({
    params,
    respond: (ok, payload) => {
      response = { ok, payload };
    },
  });

  if (!response) {
    throw new Error("gateway handler did not respond");
  }
  return response;
}

describe("ceo bridge feishu action gateway", () => {
  test("routes action card to crm workflow", async () => {
    const handlers = createGatewayHandlers({
      defaultTenantId: "tenant_a",
    });
    const result = await invokeGatewayHandler(handlers["ceo.bridge.handle_feishu_action"], {
      action: "accept",
      recommendationId: "rec_001",
      tenantId: "tenant_a",
      actorId: "ou_1001",
      requestId: "req_action_001",
      sessionId: "sess_action_001",
    });

    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      route: {
        endpoint: "/ceo/workflows/crm-risk-scan",
        method: "POST",
      },
      request_id: "req_action_001",
      session_id: "sess_action_001",
      status: "success",
      errors: [],
      data: {
        action_result: {
          recommendation_id: "rec_001",
          action: "accept",
          actor_id: "ou_1001",
          action_status: "accepted",
        },
      },
    });
  });

  test("returns validation error for unsupported action", async () => {
    const handlers = createGatewayHandlers({
      defaultTenantId: "tenant_a",
    });
    const result = await invokeGatewayHandler(handlers["ceo.bridge.handle_feishu_action"], {
      action: "archive",
      recommendationId: "rec_001",
      tenantId: "tenant_a",
    });

    expect(result.ok).toBe(false);
    expect(result.payload).toMatchObject({
      code: "validation_error",
      status: 422,
    });
  });
});
