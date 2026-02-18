import { describe, expect, test } from "vitest";
import { routeCeoIntent } from "./intent-router.js";

describe("ceo-agent-bridge intent router", () => {
  test("routes meeting keyword to internal meeting extract workflow endpoint", () => {
    const result = routeCeoIntent({
      messageText: "会议纪要 今天讨论了产品发布节奏",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
      requestId: "req-meeting-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.route.endpoint).toBe("/ceo/workflows/meeting-extract");
    expect(result.route.method).toBe("POST");
    expect(result.route.payload).toMatchObject({
      tenant_id: "tenant-a",
      meeting_id: "req-meeting-1",
      raw_text: "今天讨论了产品发布节奏",
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
      now_iso: "2026-02-15T08:30:00.000Z",
      stale_hours: 24,
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
      period_start: "2026-02-09",
      period_end: "2026-02-15",
      sales: [1, 1],
      costs: [1, 1],
      cashflow: [1, 1],
    });
  });

  test("routes schedule analyze command to internal workflow endpoint", () => {
    const result = routeCeoIntent({
      messageText: "schedule analyze",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.route.intent).toBe("schedule_analyze");
    expect(result.route.endpoint).toBe("/ceo/workflows/schedule-analyze");
    expect(result.route.method).toBe("POST");
    expect(result.route.payload).toMatchObject({
      tenant_id: "tenant-a",
      deep_work_blocks: 0,
    });
  });

  test("routes weekly with real series when provided", () => {
    const result = routeCeoIntent({
      messageText: "weekly",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
      weeklyInputPolicy: "real-or-default",
      realWeeklySeries: {
        sales: [120, 130],
        costs: [70, 65],
        cashflow: [50, 65],
      },
      now: new Date("2026-02-15T08:30:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.route.payload).toMatchObject({
      sales: [120, 130],
      costs: [70, 65],
      cashflow: [50, 65],
    });
  });

  test("returns validation error when weekly real-required has no real data", () => {
    const result = routeCeoIntent({
      messageText: "周报",
      tenantId: "tenant-a",
      sessionKey: "telegram:u1",
      weeklyInputPolicy: "real-required",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation error");
    }
    expect(result.error.code).toBe("validation_error");
    expect(result.error.message).toContain("real metrics");
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
