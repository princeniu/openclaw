export type IdentityKey = `${string}:${string}`;

export type IdentityInput = {
  channel: string;
  peerId: string;
  threadId?: string;
};

export type IdentityRecord = {
  tenantId: string;
  sessionKey?: string;
  allowed?: boolean;
};

export type IdentityMapOptions = {
  defaultTenantId: string;
  staticMap?: Record<string, IdentityRecord>;
  allowlist?: string[];
  envOverrideJson?: string;
  fallbackMode?: "allow" | "deny";
};

export type IdentityResolution = {
  allowed: boolean;
  identityKey: IdentityKey;
  tenantId: string;
  sessionKey: string;
  source: "env" | "static" | "fallback";
  reason?: string;
};

function makeIdentityKey(input: IdentityInput): IdentityKey {
  return `${input.channel}:${input.peerId}`;
}

function makeSessionKey(input: IdentityInput): string {
  return `${input.channel}:${input.peerId}:${input.threadId ?? "direct"}`;
}

function parseEnvOverrides(raw?: string): Record<string, IdentityRecord> {
  if (!raw || !raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, IdentityRecord>;
    }
  } catch {
    // Ignore malformed env overrides for safety; static map/fallback still works.
  }

  return {};
}

function denied(
  identityKey: IdentityKey,
  tenantId: string,
  sessionKey: string,
  reason: string,
): IdentityResolution {
  return {
    allowed: false,
    identityKey,
    tenantId,
    sessionKey,
    source: "fallback",
    reason,
  };
}

export function resolveChannelIdentity(
  input: IdentityInput,
  options: IdentityMapOptions,
): IdentityResolution {
  const identityKey = makeIdentityKey(input);
  const fallbackSessionKey = makeSessionKey(input);

  const allowlist = options.allowlist ?? [];
  const hasAllowlist = allowlist.length > 0;

  if (hasAllowlist && !allowlist.includes(identityKey)) {
    return denied(
      identityKey,
      options.defaultTenantId,
      fallbackSessionKey,
      `Identity ${identityKey} is not in allowlist`,
    );
  }

  const envMap = parseEnvOverrides(options.envOverrideJson);
  const envEntry = envMap[identityKey];
  if (envEntry) {
    if (envEntry.allowed === false) {
      return denied(
        identityKey,
        envEntry.tenantId || options.defaultTenantId,
        envEntry.sessionKey || fallbackSessionKey,
        `Identity ${identityKey} is blocked by env override`,
      );
    }

    return {
      allowed: true,
      identityKey,
      tenantId: envEntry.tenantId || options.defaultTenantId,
      sessionKey: envEntry.sessionKey || fallbackSessionKey,
      source: "env",
    };
  }

  const staticEntry = options.staticMap?.[identityKey];
  if (staticEntry) {
    if (staticEntry.allowed === false) {
      return denied(
        identityKey,
        staticEntry.tenantId || options.defaultTenantId,
        staticEntry.sessionKey || fallbackSessionKey,
        `Identity ${identityKey} is blocked by static mapping`,
      );
    }

    return {
      allowed: true,
      identityKey,
      tenantId: staticEntry.tenantId || options.defaultTenantId,
      sessionKey: staticEntry.sessionKey || fallbackSessionKey,
      source: "static",
    };
  }

  if (options.fallbackMode === "deny") {
    return denied(
      identityKey,
      options.defaultTenantId,
      fallbackSessionKey,
      `Identity ${identityKey} has no explicit mapping and fallbackMode=deny`,
    );
  }

  return {
    allowed: true,
    identityKey,
    tenantId: options.defaultTenantId,
    sessionKey: fallbackSessionKey,
    source: "fallback",
  };
}
