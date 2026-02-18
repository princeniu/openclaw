import { describe, expect, test, vi } from "vitest";
import plugin from "./index.js";

const routeReplyMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, messageId: "1" })));

vi.mock("../../src/auto-reply/reply/route-reply.js", () => ({
  routeReply: routeReplyMock,
}));

type RegisteredCommand = {
  handler: (ctx: {
    channel: string;
    isAuthorizedSender: boolean;
    commandBody: string;
    args?: string;
    config: Record<string, unknown>;
    to?: string;
    from?: string;
    accountId?: string;
    sessionKey?: string;
    agentId?: string;
  }) => Promise<{ text?: string }> | { text?: string };
};

type MessageReceivedHandler = (
  event: { from: string; content: string; metadata?: Record<string, unknown> },
  ctx: {
    channelId: string;
    accountId?: string;
    conversationId?: string;
    sessionKey?: string;
    agentId?: string;
  },
) => Promise<void> | void;

function createApiStub() {
  let registeredCommand: RegisteredCommand | null = null;
  const hookHandlers: Record<string, MessageReceivedHandler> = {};

  const api = {
    id: "ceo-agent-bridge",
    name: "CEO Agent Bridge",
    source: "test",
    config: {},
    pluginConfig: { defaultTenantId: "tenant_a" },
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
    registerGatewayMethod() {
      return undefined;
    },
    registerCommand(command: RegisteredCommand) {
      registeredCommand = command;
    },
    on(hookName: string, handler: MessageReceivedHandler) {
      hookHandlers[hookName] = handler;
    },
  };

  plugin.register(api as never);

  return {
    getCommand: () => registeredCommand,
    getMessageReceivedHook: () => hookHandlers.message_received,
  };
}

describe("meeting post card push", () => {
  test("pushes confirmation and dispatch card for feishu meeting flow", async () => {
    routeReplyMock.mockClear();
    const { getCommand, getMessageReceivedHook } = createApiStub();
    const command = getCommand();
    const messageReceived = getMessageReceivedHook();
    expect(command).toBeTruthy();
    expect(messageReceived).toBeTruthy();

    await command!.handler({
      channel: "feishu",
      isAuthorizedSender: true,
      commandBody: "/ceo on",
      args: "on",
      config: {},
      to: "chat:oc_feishu_meeting",
      from: "feishu:ou_001",
      accountId: "main",
      sessionKey: "agent:main:feishu:direct:ou_001",
    });

    await messageReceived!(
      {
        from: "feishu:ou_001",
        content: "会议纪要 决策：下周发布 beta\n待办：李雷 在 2026-02-25 前完成 发布公告",
        metadata: {
          to: "chat:oc_feishu_meeting",
          senderId: "ou_001",
          sessionKey: "agent:main:feishu:direct:ou_001",
        },
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "chat:oc_feishu_meeting",
      },
    );

    expect(routeReplyMock).toHaveBeenCalledTimes(2);
    const cardCall = routeReplyMock.mock.calls[1]?.[0];
    expect(cardCall).toMatchObject({
      channel: "feishu",
      to: "chat:oc_feishu_meeting",
      payload: {
        card: {
          card_type: "meeting_dispatch",
          task_count: 1,
        },
      },
    });
  });
});
