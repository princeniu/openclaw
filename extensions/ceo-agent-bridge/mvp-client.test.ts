import { afterEach, describe, expect, test, vi } from "vitest";
import type { CeoBridgeRoute } from "./intent-router.js";
import { createMvpClient } from "./mvp-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ceo-agent-bridge mvp client", () => {
  test("builds POST request with bearer token and metadata headers", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, run_id: "run-1" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "upstream-req-1",
        },
      });
    });

    const client = createMvpClient({
      baseUrl: "https://mvp.example.com",
      apiToken: "secret-token",
      timeoutMs: 500,
      maxRetries: 0,
      fetchImpl: fetchMock,
    });

    const route: CeoBridgeRoute = {
      intent: "daily_heartbeat",
      endpoint: "/api/v1/heartbeat/daily/run",
      method: "POST",
      payload: {
        tenant_id: "tenant-a",
        session_key: "telegram:u1",
      },
    };

    const result = await client.execute(route, {
      requestId: "req-123",
      sessionId: "sess-123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mvp.example.com/api/v1/heartbeat/daily/run");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: "Bearer secret-token",
      "content-type": "application/json",
      "x-request-id": "req-123",
      "x-session-id": "sess-123",
    });
    expect(init.body).toBe(JSON.stringify(route.payload));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.status).toBe(200);
    expect(result.requestId).toBe("upstream-req-1");
    expect(result.runId).toBe("run-1");
  });

  test("builds GET query string for latest runs route", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ runs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = createMvpClient({
      baseUrl: "https://mvp.example.com/",
      apiToken: "secret-token",
      fetchImpl: fetchMock,
    });

    const route: CeoBridgeRoute = {
      intent: "latest_runs",
      endpoint: "/api/v1/runs/latest",
      method: "GET",
      query: {
        tenant_id: "tenant-a",
        limit: 8,
      },
    };

    const result = await client.execute(route);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mvp.example.com/api/v1/runs/latest?tenant_id=tenant-a&limit=8");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();

    expect(result.ok).toBe(true);
  });

  test("retries transient network failure and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const client = createMvpClient({
      baseUrl: "https://mvp.example.com",
      apiToken: "secret-token",
      maxRetries: 1,
      fetchImpl: fetchMock,
    });

    const route: CeoBridgeRoute = {
      intent: "daily_heartbeat",
      endpoint: "/api/v1/heartbeat/daily/run",
      method: "POST",
      payload: {},
    };

    const result = await client.execute(route);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  test("normalizes timeout errors", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const client = createMvpClient({
      baseUrl: "https://mvp.example.com",
      apiToken: "secret-token",
      timeoutMs: 10,
      maxRetries: 0,
      fetchImpl: fetchMock,
    });

    const route: CeoBridgeRoute = {
      intent: "daily_heartbeat",
      endpoint: "/api/v1/heartbeat/daily/run",
      method: "POST",
      payload: {},
    };

    const result = await client.execute(route);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected timeout error");
    }
    expect(result.error.code).toBe("timeout");
  });

  test("normalizes upstream non-2xx errors", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "upstream failure" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });

    const client = createMvpClient({
      baseUrl: "https://mvp.example.com",
      apiToken: "secret-token",
      fetchImpl: fetchMock,
    });

    const route: CeoBridgeRoute = {
      intent: "weekly_report",
      endpoint: "/api/v1/reports/weekly/generate",
      method: "POST",
      payload: {},
    };

    const result = await client.execute(route);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected upstream error");
    }
    expect(result.error.code).toBe("upstream_error");
    expect(result.error.status).toBe(500);
    expect(result.error.message).toContain("upstream failure");
  });
});
