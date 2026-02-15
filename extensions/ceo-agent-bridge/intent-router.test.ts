import { describe, expect, test } from "vitest";
import { routeCeoIntent } from "./intent-router.js";

describe("ceo-agent-bridge intent router", () => {
  test("routes meeting keyword to meeting extract endpoint", () => {
    const result = routeCeoIntent({
      messageText: "会议纪要 今天讨论了产品发布节奏",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.route.endpoint).toBe("/api/v1/meetings/extract");
    expect(result.route.method).toBe("POST");
    expect(result.route.payload).toMatchObject({
      tenant_id: "tenant-a",
      session_key: "telegram:u1",
      transcript: "今天讨论了产品发布节奏",
    });
  });

  test("routes daily keyword to daily heartbeat endpoint", () => {
    const result = routeCeoIntent({
      messageText: "daily",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
      now: new Date("2026-02-15T08:30:00.000Z"),
      timezone: "Asia/Shanghai",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.route.endpoint).toBe("/api/v1/heartbeat/daily/run");
    expect(result.route.method).toBe("POST");
    expect(result.route.payload).toMatchObject({
      tenant_id: "tenant-a",
      session_key: "telegram:u1",
      date: "2026-02-15",
      timezone: "Asia/Shanghai",
    });
  });

  test("routes weekly keyword to weekly report endpoint", () => {
    const result = routeCeoIntent({
      messageText: "周报",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
      now: new Date("2026-02-15T08:30:00.000Z"),
      timezone: "Asia/Shanghai",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.route.endpoint).toBe("/api/v1/reports/weekly/generate");
    expect(result.route.method).toBe("POST");
    expect(result.route.payload).toMatchObject({
      tenant_id: "tenant-a",
      session_key: "telegram:u1",
      week_anchor_date: "2026-02-15",
      timezone: "Asia/Shanghai",
    });
  });

  test("routes latest runs keyword to latest runs endpoint", () => {
    const result = routeCeoIntent({
      messageText: "latest runs 8",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.route.endpoint).toBe("/api/v1/runs/latest");
    expect(result.route.method).toBe("GET");
    expect(result.route.query).toEqual({
      tenant_id: "tenant-a",
      limit: 8,
    });
  });

  test("returns validation error when meeting command has no transcript", () => {
    const result = routeCeoIntent({
      messageText: "meeting",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation error");
    }
    expect(result.error.code).toBe("validation_error");
  });

  test("returns validation error for unknown command", () => {
    const result = routeCeoIntent({
      messageText: "hello there",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation error");
    }
    expect(result.error.message).toContain("Unsupported command");
  });
});
