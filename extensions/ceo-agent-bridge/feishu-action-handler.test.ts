import { describe, expect, test } from "vitest";
import { buildFeishuActionRoute, validateFeishuActionInput } from "./feishu-action-handler.js";

describe("feishu action handler", () => {
  test("validates accept action and builds workflow route", () => {
    const parsed = validateFeishuActionInput({
      action: "accept",
      recommendationId: "rec_001",
      tenantId: "tenant_a",
      actorId: "u_100",
      requestId: "req_1",
      sessionId: "sess_1",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("expected valid action");
    }

    const route = buildFeishuActionRoute(parsed.value);
    expect(route.endpoint).toBe("/ceo/workflows/crm-risk-scan");
    expect(route.payload).toMatchObject({
      tenant_id: "tenant_a",
      action_event: {
        recommendation_id: "rec_001",
        action: "accept",
      },
    });
  });

  test("requires dueAt for reschedule action", () => {
    const parsed = validateFeishuActionInput({
      action: "reschedule",
      recommendationId: "rec_002",
      tenantId: "tenant_a",
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected validation error");
    }
    expect(parsed.message).toContain("dueAt is required");
  });
});
