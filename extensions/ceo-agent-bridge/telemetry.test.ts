import { describe, expect, test } from "vitest";
import { buildBridgeTelemetryLog } from "./telemetry.js";

describe("ceo-agent-bridge telemetry", () => {
  test("builds success log payload with required tracing fields", () => {
    const event = buildBridgeTelemetryLog({
      channel: "telegram",
      peerId: "u_001",
      sessionKey: "tenant-a:telegram:u_001",
      requestId: "req-123",
      runId: "run-456",
      latencyMs: 1320,
      status: "success",
      intent: "daily_heartbeat",
      endpoint: "/api/v1/heartbeat/daily/run",
    });

    expect(event).toMatchObject({
      component: "ceo-agent-bridge",
      channel: "telegram",
      peer_id: "u_001",
      session_key: "tenant-a:telegram:u_001",
      session_id: "tenant-a:telegram:u_001",
      request_id: "req-123",
      run_id: "run-456",
      latency_ms: 1320,
      status: "success",
    });
  });

  test("builds error log payload with error code and defaults", () => {
    const event = buildBridgeTelemetryLog({
      channel: "feishu",
      peerId: "ou_abc",
      sessionKey: "tenant-a:feishu:ou_abc",
      latencyMs: 980,
      status: "error",
      errorCode: "upstream_error",
    });

    expect(event.channel).toBe("feishu");
    expect(event.peer_id).toBe("ou_abc");
    expect(event.status).toBe("error");
    expect(event.error_code).toBe("upstream_error");
    expect(event.session_id).toBe("tenant-a:feishu:ou_abc");
    expect(event.request_id).toBe("n/a");
    expect(event.run_id).toBe("n/a");
  });
});
