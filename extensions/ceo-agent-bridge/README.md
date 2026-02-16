# CEO Agent Bridge Plugin

This plugin bridges OpenClaw inbound channel messages to the CEO Agent MVP API.

## Current behavior

- Supports deterministic CEO intents (`daily`, `weekly`, `meeting`, `latest runs`, `sync metrics`).
- Supports CEO mode switching (`/ceo on|off|status|help` and natural-language toggles).
- Emits structured telemetry logs with request/session/run correlation IDs.
- Falls through for non-CEO messages so normal OpenClaw chat remains available.
- Supports multi-agent scope guard (`ceoAgentId` + `enforceAgentScope`) to limit bridge behavior to CEO agent sessions.

## Config contract

- `mvpBaseUrl`
- `mvpApiToken`
- `requestTimeoutMs`
- `maxRetries`
- `defaultTenantId`
- `metricsSyncScriptPath`
- `metricsSyncDbPath`
- `identityAllowlist`
- `identityMap`
- `identityEnvOverrideJson`
- `identityFallbackMode` (`allow` / `deny`)
- `ceoAgentId` (default: `ceo-agent`)
- `enforceAgentScope` (default: `false`, recommended `true` in multi-agent profile)
