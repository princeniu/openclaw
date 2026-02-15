import type { CeoBridgeRoute } from "./intent-router.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type MvpClientOptions = {
  baseUrl: string;
  apiToken: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: FetchLike;
};

export type MvpRequestMeta = {
  requestId?: string;
  sessionId?: string;
};

export type MvpClientErrorCode =
  | "timeout"
  | "network_error"
  | "upstream_error"
  | "invalid_response";

export type MvpClientError = {
  code: MvpClientErrorCode;
  message: string;
  status?: number;
};

export type MvpClientResult =
  | {
      ok: true;
      status: number;
      data: unknown;
      requestId?: string;
      runId?: string;
    }
  | {
      ok: false;
      error: MvpClientError;
    };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 0;

function joinUrl(
  baseUrl: string,
  endpoint: string,
  query?: Record<string, string | number | boolean>,
): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`${normalizedBase}${normalizedEndpoint}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function buildHeaders(
  apiToken: string,
  method: "GET" | "POST",
  meta?: MvpRequestMeta,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiToken}`,
    accept: "application/json",
  };

  if (method === "POST") {
    headers["content-type"] = "application/json";
  }
  if (meta?.requestId) {
    headers["x-request-id"] = meta.requestId;
  }
  if (meta?.sessionId) {
    headers["x-session-id"] = meta.sessionId;
  }

  return headers;
}

async function parseJsonSafe(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveRunId(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const runId = record.run_id;
    if (typeof runId === "string" && runId) {
      return runId;
    }
  }
  return undefined;
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim();
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
  }
  return fallback;
}

function normalizeThrownError(err: unknown): { error: MvpClientError; retryable: boolean } {
  if (err instanceof DOMException && err.name === "AbortError") {
    return {
      error: {
        code: "timeout",
        message: "Request timeout while calling MVP API",
      },
      retryable: false,
    };
  }

  if (err instanceof TypeError) {
    return {
      error: {
        code: "network_error",
        message: err.message || "Network error while calling MVP API",
      },
      retryable: true,
    };
  }

  if (err instanceof Error) {
    return {
      error: {
        code: "network_error",
        message: err.message,
      },
      retryable: true,
    };
  }

  return {
    error: {
      code: "network_error",
      message: "Unknown network error while calling MVP API",
    },
    retryable: true,
  };
}

function buildRequestInit(
  route: CeoBridgeRoute,
  apiToken: string,
  meta?: MvpRequestMeta,
  signal?: AbortSignal,
): RequestInit {
  return {
    method: route.method,
    headers: buildHeaders(apiToken, route.method, meta),
    body: route.method === "POST" ? JSON.stringify(route.payload ?? {}) : undefined,
    signal,
  };
}

export function createMvpClient(options: MvpClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  const execute = async (
    route: CeoBridgeRoute,
    meta?: MvpRequestMeta,
  ): Promise<MvpClientResult> => {
    const url = joinUrl(options.baseUrl, route.endpoint, route.query);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(
          url,
          buildRequestInit(route, options.apiToken, meta, controller.signal),
        );

        clearTimeout(timeoutHandle);

        const payload = await parseJsonSafe(response);

        if (!response.ok) {
          const message = errorMessageFromPayload(
            payload,
            `MVP API responded with HTTP ${response.status}`,
          );
          const retryable = response.status >= 500;
          if (retryable && attempt < maxRetries) {
            continue;
          }
          return {
            ok: false,
            error: {
              code: "upstream_error",
              status: response.status,
              message,
            },
          };
        }

        if (payload === null) {
          return {
            ok: false,
            error: {
              code: "invalid_response",
              message: "MVP API returned invalid JSON payload",
            },
          };
        }

        return {
          ok: true,
          status: response.status,
          data: payload,
          requestId: response.headers.get("x-request-id") ?? meta?.requestId,
          runId: resolveRunId(payload),
        };
      } catch (err) {
        clearTimeout(timeoutHandle);
        const normalized = normalizeThrownError(err);
        if (normalized.retryable && attempt < maxRetries) {
          continue;
        }
        return {
          ok: false,
          error: normalized.error,
        };
      }
    }

    return {
      ok: false,
      error: {
        code: "network_error",
        message: "MVP API request failed after retries",
      },
    };
  };

  return {
    execute,
  };
}
