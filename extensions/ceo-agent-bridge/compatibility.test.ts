import { beforeEach, describe, expect, test, vi } from "vitest";
import plugin from "./index.js";

type RegisteredCommand = {
  name: string;
  acceptsArgs?: boolean;
  handler: (ctx: {
    senderId?: string;
    channel: string;
    channelId?: string;
    isAuthorizedSender: boolean;
    args?: string;
    commandBody: string;
    config: Record<string, unknown>;
    from?: string;
    to?: string;
    accountId?: string;
    messageThreadId?: number;
    sessionKey?: string;
  }) => Promise<{ text?: string }> | { text?: string };
};

type MessageReceivedHandler = (
  event: { from: string; content: string; metadata?: Record<string, unknown> },
  ctx: { channelId: string; accountId?: string; conversationId?: string },
) => Promise<void> | void;

function createApiStub(params?: {
  pluginConfig?: Record<string, unknown>;
  sendMessageTelegram?: ReturnType<typeof vi.fn>;
}) {
  const sendMessageTelegram =
    params?.sendMessageTelegram ?? vi.fn(async () => ({ messageId: "1" }));
  let registeredCommand: RegisteredCommand | null = null;
  const hookHandlers: Record<string, MessageReceivedHandler> = {};

  const api = {
    id: "ceo-agent-bridge",
    name: "CEO Agent Bridge",
    source: "test",
    config: {},
    pluginConfig: params?.pluginConfig ?? {},
    runtime: {
      channel: {
        telegram: {
          sendMessageTelegram,
        },
      },
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    registerGatewayMethod() {},
    registerCommand(command: RegisteredCommand) {
      registeredCommand = command;
    },
    on(hookName: string, handler: MessageReceivedHandler) {
      hookHandlers[hookName] = handler;
    },
  };

  plugin.register(api as never);

  return {
    sendMessageTelegram,
    getCommand: () => registeredCommand,
    getMessageReceivedHook: () => hookHandlers.message_received,
  };
}

describe("ceo-agent-bridge compatibility", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  test("non-ceo message should fall through when ceo mode is on", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "x-request-id": "x-1" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getCommand, getMessageReceivedHook, sendMessageTelegram } = createApiStub({
      pluginConfig: {
        mvpBaseUrl: "http://localhost:8787",
        mvpApiToken: "token",
        defaultTenantId: "tenant_a",
      },
    });

    const command = getCommand();
    const messageReceived = getMessageReceivedHook();

    expect(command).toBeTruthy();
    expect(messageReceived).toBeTruthy();

    await command!.handler({
      channel: "telegram",
      isAuthorizedSender: true,
      commandBody: "/ceo on",
      args: "on",
      config: {},
      to: "telegram:12345",
      accountId: "default",
    });

    await messageReceived!(
      {
        from: "telegram:12345",
        content: "今天天气不错",
        metadata: { to: "telegram:12345" },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:12345",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(sendMessageTelegram).toHaveBeenCalledTimes(0);
  });
});
