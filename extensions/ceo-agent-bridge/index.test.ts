import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("ceo-agent-bridge plugin scaffold", () => {
  test("has valid manifest and register entry", async () => {
    const manifestPath = path.join(__dirname, "openclaw.plugin.json");
    const packagePath = path.join(__dirname, "package.json");

    const manifestRaw = await fs.readFile(manifestPath, "utf-8");
    const packageRaw = await fs.readFile(packagePath, "utf-8");

    const manifest = JSON.parse(manifestRaw) as {
      id?: string;
      configSchema?: { type?: string };
    };
    const pkg = JSON.parse(packageRaw) as {
      name?: string;
      type?: string;
      openclaw?: { extensions?: string[] };
    };

    expect(manifest.id).toBe("ceo-agent-bridge");
    expect(manifest.configSchema?.type).toBe("object");
    expect(pkg.type).toBe("module");
    expect(pkg.openclaw?.extensions).toContain("./index.ts");

    const pluginMod = await import("./index.js");
    const plugin = pluginMod.default as {
      id?: string;
      name?: string;
      register?: unknown;
    };

    expect(plugin.id).toBe("ceo-agent-bridge");
    expect(plugin.name).toBe("CEO Agent Bridge");
    expect(typeof plugin.register).toBe("function");
  });
});
