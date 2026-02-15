import { describe, expect, test } from "vitest";
import { resolveChannelIdentity } from "./identity-map.js";

describe("ceo-agent-bridge identity map", () => {
  test("uses static mapping when available", () => {
    const result = resolveChannelIdentity(
      {
        channel: "telegram",
        peerId: "u_001",
      },
      {
        defaultTenantId: "tenant-default",
        staticMap: {
          "telegram:u_001": {
            tenantId: "tenant-alpha",
            sessionKey: "tenant-alpha:ceo",
          },
        },
      },
    );

    expect(result.allowed).toBe(true);
    expect(result.tenantId).toBe("tenant-alpha");
    expect(result.sessionKey).toBe("tenant-alpha:ceo");
    expect(result.source).toBe("static");
  });

  test("applies env override before static mapping", () => {
    const result = resolveChannelIdentity(
      {
        channel: "telegram",
        peerId: "u_001",
      },
      {
        defaultTenantId: "tenant-default",
        staticMap: {
          "telegram:u_001": {
            tenantId: "tenant-alpha",
          },
        },
        envOverrideJson: JSON.stringify({
          "telegram:u_001": {
            tenantId: "tenant-beta",
            sessionKey: "tenant-beta:override",
            allowed: true,
          },
        }),
      },
    );

    expect(result.allowed).toBe(true);
    expect(result.tenantId).toBe("tenant-beta");
    expect(result.sessionKey).toBe("tenant-beta:override");
    expect(result.source).toBe("env");
  });

  test("enforces allowlist and denies non-allowed identity", () => {
    const result = resolveChannelIdentity(
      {
        channel: "feishu",
        peerId: "ou_xxx",
      },
      {
        defaultTenantId: "tenant-default",
        allowlist: ["telegram:u_001"],
        fallbackMode: "deny",
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in allowlist");
  });

  test("uses deterministic safe fallback when allowlist is not configured", () => {
    const result = resolveChannelIdentity(
      {
        channel: "feishu",
        peerId: "ou_xxx",
        threadId: "chat_abc",
      },
      {
        defaultTenantId: "tenant-default",
      },
    );

    expect(result.allowed).toBe(true);
    expect(result.tenantId).toBe("tenant-default");
    expect(result.sessionKey).toBe("feishu:ou_xxx:chat_abc");
    expect(result.source).toBe("fallback");
  });
});
