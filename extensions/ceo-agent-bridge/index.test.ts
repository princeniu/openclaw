import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test, vi } from "vitest";
import plugin from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeReplyMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, messageId: "1" })));
const runMetricsSyncMock = vi.hoisted(() =>
  vi.fn(async () => ({
    files_total: 2,
    files_processed: 2,
    rows_loaded: 4,
    rows_skipped: 0,
    date_start: "2026-02-01",
    date_end: "2026-02-07",
    dry_run: true,
  })),
);

vi.mock("../../src/auto-reply/reply/route-reply.js", () => ({
  routeReply: routeReplyMock,
}));
vi.mock("./metrics-sync.js", async () => {
  const actual = await vi.importActual<typeof import("./metrics-sync.js")>("./metrics-sync.js");
  return {
    ...actual,
    runMetricsSync: runMetricsSyncMock,
  };
});

describe("ceo-agent-bridge plugin scaffold", () => {
  test("has valid manifest and register entry", async () => {
    const manifestPath = path.join(__dirname, "openclaw.plugin.json");
    const packagePath = path.join(__dirname, "package.json");

    const manifestRaw = await fs.readFile(manifestPath, "utf-8");
    const packageRaw = await fs.readFile(packagePath, "utf-8");

    const manifest = JSON.parse(manifestRaw) as {
      id?: string;
      configSchema?: { type?: string };
    };
    const pkg = JSON.parse(packageRaw) as {
      name?: string;
      type?: string;
      openclaw?: { extensions?: string[] };
    };

    expect(manifest.id).toBe("ceo-agent-bridge");
    expect(manifest.configSchema?.type).toBe("object");
    expect(pkg.type).toBe("module");
    expect(pkg.openclaw?.extensions).toContain("./index.ts");

    const pluginMod = await import("./index.js");
    const plugin = pluginMod.default as {
      id?: string;
      name?: string;
      register?: unknown;
    };

    expect(plugin.id).toBe("ceo-agent-bridge");
    expect(plugin.name).toBe("CEO Agent Bridge");
    expect(typeof plugin.register).toBe("function");
  });
});

type RegisteredCommand = {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
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
  ctx: { channelId: string; accountId?: string; conversationId?: string; sessionKey?: string },
) => Promise<void> | void;
type MessageSendingHandler = (
  event: { to: string; content: string; metadata?: Record<string, unknown> },
  ctx: { channelId: string; accountId?: string; conversationId?: string; sessionKey?: string },
) =>
  | Promise<{ cancel?: boolean; content?: string } | void>
  | { cancel?: boolean; content?: string }
  | void;

function createApiStub(params?: {
  pluginConfig?: Record<string, unknown>;
  sendMessageTelegram?: ReturnType<typeof vi.fn>;
}) {
  const sendMessageTelegram =
    params?.sendMessageTelegram ?? vi.fn(async () => ({ messageId: "1" }));
  let registeredCommand: RegisteredCommand | null = null;
  const hookHandlers: Record<string, MessageReceivedHandler | MessageSendingHandler> = {};
  const gatewayHandlers: Record<string, unknown> = {};

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
    registerGatewayMethod(method: string, handler: unknown) {
      gatewayHandlers[method] = handler;
    },
    registerCommand(command: RegisteredCommand) {
      registeredCommand = command;
    },
    on(hookName: string, handler: MessageReceivedHandler | MessageSendingHandler) {
      hookHandlers[hookName] = handler;
    },
  };

  plugin.register(api as never);

  return {
    sendMessageTelegram,
    gatewayHandlers,
    getCommand: () => registeredCommand,
    getMessageReceivedHook: () =>
      hookHandlers.message_received as MessageReceivedHandler | undefined,
    getMessageSendingHook: () => hookHandlers.message_sending as MessageSendingHandler | undefined,
  };
}

describe("ceo-agent-bridge /ceo command", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    routeReplyMock.mockClear();
    runMetricsSyncMock.mockClear();
  });

  test("registers /ceo command", () => {
    const { getCommand } = createApiStub();
    const command = getCommand();
    expect(command?.name).toBe("ceo");
    expect(command?.acceptsArgs).toBe(true);
  });

  test("supports /ceo help surface", async () => {
    const { getCommand } = createApiStub();
    const command = getCommand();
    expect(command).toBeTruthy();

    const result = await command!.handler({
      channel: "telegram",
      isAuthorizedSender: true,
      commandBody: "/ceo help",
      args: "help",
      config: {},
      to: "telegram:1",
      accountId: "default",
    });

    expect(result.text).toContain("/ceo on");
    expect(result.text).toContain("/ceo help");
    expect(result.text).toContain("daily");
    expect(result.text).toContain("周报");
  });

  test("returns usage hint with help guidance on invalid /ceo args", async () => {
    const { getCommand } = createApiStub();
    const command = getCommand();
    expect(command).toBeTruthy();

    const result = await command!.handler({
      channel: "telegram",
      isAuthorizedSender: true,
      commandBody: "/ceo xyz",
      args: "xyz",
      config: {},
      to: "telegram:1",
      accountId: "default",
    });

    expect(result.text).toContain("/ceo help");
  });

  test("routes sync metrics command while ceo mode is on", async () => {
    const fetchMock = vi.fn();
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
      to: "telegram:777",
      accountId: "default",
    });

    await messageReceived!(
      {
        from: "telegram:777",
        content: "sync metrics ./fixtures/metrics --dry-run",
        metadata: { to: "telegram:777" },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:777",
      },
    );

    expect(runMetricsSyncMock).toHaveBeenCalledTimes(1);
    expect(runMetricsSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputDir: "./fixtures/metrics",
        tenantId: "tenant_a",
        dryRun: true,
      }),
    );
    expect(sendMessageTelegram).toHaveBeenCalledTimes(1);
    expect(sendMessageTelegram.mock.calls[0]?.[1]).toContain("导入行数：4");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("routes inbound telegram text only when /ceo mode is on", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          request_id: "manual-daily-001",
          run_id: "run-123",
          overdue_tasks_count: 0,
          stale_tasks_count: 0,
        }),
        {
          status: 200,
          headers: { "x-request-id": "manual-daily-001" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getCommand, getMessageReceivedHook, getMessageSendingHook, sendMessageTelegram } =
      createApiStub({
        pluginConfig: {
          mvpBaseUrl: "http://localhost:8787",
          mvpApiToken: "token",
          defaultTenantId: "tenant_a",
        },
      });
    const command = getCommand();
    const messageReceived = getMessageReceivedHook();
    const messageSending = getMessageSendingHook();
    expect(command).toBeTruthy();
    expect(messageReceived).toBeTruthy();
    expect(messageSending).toBeTruthy();

    const onResult = await command!.handler({
      channel: "telegram",
      isAuthorizedSender: true,
      commandBody: "/ceo on",
      args: "on",
      config: {},
      to: "telegram:12345",
      accountId: "default",
    });
    expect(onResult.text).toContain("已开启 CEO 模式");

    await messageReceived!(
      {
        from: "telegram:12345",
        content: "daily",
        metadata: {
          to: "telegram:12345",
        },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:12345",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMessageTelegram).toHaveBeenCalledTimes(1);
    const routedReply = sendMessageTelegram.mock.calls[0]?.[1];
    expect(routedReply).toContain("已完成日报心跳检查");
    expect(routedReply).not.toContain("CEO intent");
    expect(routedReply).not.toContain("```json");
    const sendingResult = await messageSending!(
      {
        to: "telegram:12345",
        content: "normal reply",
        metadata: { threadId: undefined, kind: "final", sessionKey: "agent:main:main" },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:12345",
      },
    );
    expect(sendingResult).toMatchObject({ cancel: true });
    const secondSendingResult = await messageSending!(
      {
        to: "telegram:12345",
        content: "normal reply chunk 2",
        metadata: { threadId: undefined, kind: "final", sessionKey: "agent:main:main" },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:12345",
      },
    );
    expect(secondSendingResult).toMatchObject({ cancel: true });

    await command!.handler({
      channel: "telegram",
      isAuthorizedSender: true,
      commandBody: "/ceo off",
      args: "off",
      config: {},
      to: "telegram:12345",
      accountId: "default",
    });

    await messageReceived!(
      {
        from: "telegram:12345",
        content: "daily",
        metadata: {
          to: "telegram:12345",
        },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:12345",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("localizes weekly summary to product-facing Chinese wording", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          request_id: "manual-weekly-001",
          run_id: "run-weekly-1",
          summary: "Weekly trend: sales 1 (+0.0%), costs 1 (+0.0%), cashflow 1.",
          risk_level: "low",
        }),
        {
          status: 200,
          headers: { "x-request-id": "manual-weekly-001" },
        },
      );
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
      to: "telegram:70001",
      accountId: "default",
    });

    await messageReceived!(
      {
        from: "telegram:70001",
        content: "weekly",
        metadata: {
          to: "telegram:70001",
        },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:70001",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMessageTelegram).toHaveBeenCalledTimes(1);
    const reply = sendMessageTelegram.mock.calls[0]?.[1];
    expect(reply).toContain("摘要：本周趋势");
    expect(reply).toContain("销售 1（+0.0%）");
    expect(reply).toContain("成本 1（+0.0%）");
    expect(reply).toContain("现金流 1");
    expect(reply).not.toContain("Weekly trend:");
  });

  test("routes inbound feishu text only when /ceo mode is on", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          request_id: "manual-daily-002",
          run_id: "run-feishu-1",
          overdue_tasks_count: 0,
          stale_tasks_count: 0,
        }),
        {
          status: 200,
          headers: { "x-request-id": "manual-daily-002" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getCommand, getMessageReceivedHook, getMessageSendingHook, sendMessageTelegram } =
      createApiStub({
        pluginConfig: {
          mvpBaseUrl: "http://localhost:8787",
          mvpApiToken: "token",
          defaultTenantId: "tenant_a",
        },
      });
    const command = getCommand();
    const messageReceived = getMessageReceivedHook();
    const messageSending = getMessageSendingHook();
    const feishuSessionKey = "agent:main:feishu:direct:ou_sender_1";
    expect(command).toBeTruthy();
    expect(messageReceived).toBeTruthy();
    expect(messageSending).toBeTruthy();

    const onResult = await command!.handler({
      channel: "feishu",
      isAuthorizedSender: true,
      commandBody: "/ceo on",
      args: "on",
      config: {},
      to: "user:ou_sender_1",
      from: "feishu:ou_sender_1",
      senderId: "ou_sender_1",
      accountId: "main",
      sessionKey: feishuSessionKey,
    });
    expect(onResult.text).toContain("已开启 CEO 模式");

    await messageReceived!(
      {
        from: "feishu:ou_sender_1",
        content: "daily",
        metadata: {
          to: "chat:oc_feishu_chat_1",
          senderId: "ou_sender_1",
          sessionKey: feishuSessionKey,
        },
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "chat:oc_feishu_chat_1",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMessageTelegram).not.toHaveBeenCalled();
    expect(routeReplyMock).toHaveBeenCalledTimes(1);
    expect(routeReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "feishu",
        to: "chat:oc_feishu_chat_1",
        payload: expect.objectContaining({
          text: expect.not.stringContaining("CEO intent"),
        }),
      }),
    );

    const sendingResult = await messageSending!(
      {
        to: "chat:oc_feishu_chat_1",
        content: "normal reply",
        metadata: {
          threadId: undefined,
          kind: "final",
          sessionKey: feishuSessionKey,
        },
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "chat:oc_feishu_chat_1",
      },
    );
    expect(sendingResult).toMatchObject({ cancel: true });

    const bridgeSendResult = await messageSending!(
      {
        to: "chat:oc_feishu_chat_1",
        content: "bridge reply",
        metadata: { threadId: undefined },
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "chat:oc_feishu_chat_1",
      },
    );
    expect(bridgeSendResult).toEqual({});

    await command!.handler({
      channel: "feishu",
      isAuthorizedSender: true,
      commandBody: "/ceo off",
      args: "off",
      config: {},
      to: "user:ou_sender_1",
      from: "feishu:ou_sender_1",
      senderId: "ou_sender_1",
      accountId: "main",
      sessionKey: feishuSessionKey,
    });

    await messageReceived!(
      {
        from: "feishu:ou_sender_1",
        content: "daily",
        metadata: {
          to: "chat:oc_feishu_chat_1",
          senderId: "ou_sender_1",
          sessionKey: feishuSessionKey,
        },
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "chat:oc_feishu_chat_1",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("supports natural-language ceo mode switching in feishu p2p", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          request_id: "manual-daily-003",
          run_id: "run-feishu-natural-1",
          overdue_tasks_count: 0,
          stale_tasks_count: 0,
        }),
        {
          status: 200,
          headers: { "x-request-id": "manual-daily-003" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getMessageReceivedHook } = createApiStub({
      pluginConfig: {
        mvpBaseUrl: "http://localhost:8787",
        mvpApiToken: "token",
        defaultTenantId: "tenant_a",
      },
    });
    const messageReceived = getMessageReceivedHook();
    const feishuSessionKey = "agent:main:feishu:direct:ou_sender_2";
    expect(messageReceived).toBeTruthy();

    await messageReceived!(
      {
        from: "feishu:ou_sender_2",
        content: "请帮我打开 CEO 模式",
        metadata: {
          to: "chat:oc_feishu_chat_2",
          senderId: "ou_sender_2",
          sessionKey: feishuSessionKey,
        },
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "chat:oc_feishu_chat_2",
      },
    );

    expect(routeReplyMock).toHaveBeenCalledTimes(1);
    expect(routeReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "feishu",
        to: "chat:oc_feishu_chat_2",
        payload: expect.objectContaining({
          text: expect.stringContaining("已开启 CEO 模式"),
        }),
      }),
    );

    await messageReceived!(
      {
        from: "feishu:ou_sender_2",
        content: "daily",
        metadata: {
          to: "chat:oc_feishu_chat_2",
          senderId: "ou_sender_2",
          sessionKey: feishuSessionKey,
        },
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "chat:oc_feishu_chat_2",
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await messageReceived!(
      {
        from: "feishu:ou_sender_2",
        content: "能不能帮我把ceo模式关一下",
        metadata: {
          to: "chat:oc_feishu_chat_2",
          senderId: "ou_sender_2",
          sessionKey: feishuSessionKey,
        },
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "chat:oc_feishu_chat_2",
      },
    );
    expect(routeReplyMock).toHaveBeenCalledTimes(3);
    expect(routeReplyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channel: "feishu",
        to: "chat:oc_feishu_chat_2",
        payload: expect.objectContaining({
          text: expect.stringContaining("已关闭 CEO 模式"),
        }),
      }),
    );

    await messageReceived!(
      {
        from: "feishu:ou_sender_2",
        content: "daily",
        metadata: {
          to: "chat:oc_feishu_chat_2",
          senderId: "ou_sender_2",
          sessionKey: feishuSessionKey,
        },
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "chat:oc_feishu_chat_2",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("does not enable ceo mode for non-ceo agent sessions when scope is enforced", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getCommand, getMessageReceivedHook, sendMessageTelegram } = createApiStub({
      pluginConfig: {
        mvpBaseUrl: "http://localhost:8787",
        mvpApiToken: "token",
        defaultTenantId: "tenant_a",
        enforceAgentScope: true,
        ceoAgentId: "ceo-agent",
      },
    });
    const command = getCommand();
    const messageReceived = getMessageReceivedHook();
    expect(command).toBeTruthy();
    expect(messageReceived).toBeTruthy();

    const commandResult = await command!.handler({
      channel: "telegram",
      isAuthorizedSender: true,
      commandBody: "/ceo on",
      args: "on",
      config: {},
      to: "telegram:scope-blocked",
      accountId: "default",
      sessionKey: "agent:general-agent:main",
    });
    expect(commandResult.text).toContain("未进入 CEO agent");

    await messageReceived!(
      {
        from: "telegram:scope-blocked",
        content: "daily",
        metadata: {
          to: "telegram:scope-blocked",
          sessionKey: "agent:general-agent:main",
        },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:scope-blocked",
        sessionKey: "agent:general-agent:main",
      },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMessageTelegram).not.toHaveBeenCalled();
  });

  test("routes ceo intent for ceo-agent sessions when scope is enforced", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          request_id: "manual-scope-001",
          run_id: "run-scope-1",
          overdue_tasks_count: 0,
          stale_tasks_count: 0,
          new_risks_count: 0,
          escalations_count: 0,
        }),
        {
          status: 200,
          headers: { "x-request-id": "manual-scope-001" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getCommand, getMessageReceivedHook, sendMessageTelegram } = createApiStub({
      pluginConfig: {
        mvpBaseUrl: "http://localhost:8787",
        mvpApiToken: "token",
        defaultTenantId: "tenant_a",
        enforceAgentScope: true,
        ceoAgentId: "ceo-agent",
      },
    });
    const command = getCommand();
    const messageReceived = getMessageReceivedHook();
    expect(command).toBeTruthy();
    expect(messageReceived).toBeTruthy();

    const commandResult = await command!.handler({
      channel: "telegram",
      isAuthorizedSender: true,
      commandBody: "/ceo on",
      args: "on",
      config: {},
      to: "telegram:scope-ceo",
      accountId: "default",
      sessionKey: "agent:ceo-agent:main",
    });
    expect(commandResult.text).toContain("已开启 CEO 模式");

    await messageReceived!(
      {
        from: "telegram:scope-ceo",
        content: "daily",
        metadata: {
          to: "telegram:scope-ceo",
          sessionKey: "agent:ceo-agent:main",
        },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:scope-ceo",
        sessionKey: "agent:ceo-agent:main",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMessageTelegram).toHaveBeenCalledTimes(1);
    expect(sendMessageTelegram.mock.calls[0]?.[1]).toContain("已完成日报心跳检查");
  });

  test("falls through for non-ceo messages when ceo mode is on", async () => {
    const fetchMock = vi.fn();
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
      to: "telegram:54321",
      accountId: "default",
    });

    await messageReceived!(
      {
        from: "telegram:54321",
        content: "随便说一句",
        metadata: {
          to: "telegram:54321",
        },
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "telegram:54321",
      },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMessageTelegram).not.toHaveBeenCalled();
  });
});
