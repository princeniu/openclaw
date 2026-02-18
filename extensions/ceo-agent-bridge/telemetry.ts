export type BridgeTelemetryStatus = "success" | "error";

export type BridgeTelemetryInput = {
  channel: string;
  peerId: string;
  sessionKey: string;
  requestId?: string;
  runId?: string;
  latencyMs: number;
  status: BridgeTelemetryStatus;
  intent?: string;
  endpoint?: string;
  errorCode?: string;
};

export type BridgeTelemetryLog = {
  component: "ceo-agent-bridge";
  channel: string;
  peer_id: string;
  session_key: string;
  session_id: string;
  request_id: string;
  run_id: string;
  latency_ms: number;
  status: BridgeTelemetryStatus;
  intent?: string;
  endpoint?: string;
  error_code?: string;
};

function safeString(value: string | undefined): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "n/a";
}

export function buildBridgeTelemetryLog(input: BridgeTelemetryInput): BridgeTelemetryLog {
  return {
    component: "ceo-agent-bridge",
    channel: input.channel,
    peer_id: input.peerId,
    session_key: input.sessionKey,
    session_id: input.sessionKey,
    request_id: safeString(input.requestId),
    run_id: safeString(input.runId),
    latency_ms: Math.max(0, Math.round(input.latencyMs)),
    status: input.status,
    intent: input.intent,
    endpoint: input.endpoint,
    error_code: input.errorCode,
  };
}
