import { describe, expect, test, vi } from "vitest";
import {
  formatMetricsSyncSummary,
  parseMetricsSyncCommand,
  runMetricsSync,
} from "./metrics-sync.js";

describe("metrics sync command", () => {
  test("parses sync metrics command with dry-run flag", () => {
    const parsed = parseMetricsSyncCommand("sync metrics ./fixtures/metrics --dry-run");
    expect(parsed.matched).toBe(true);
    if (!parsed.matched) {
      return;
    }
    expect(parsed.error).toBeUndefined();
    expect(parsed.inputDir).toBe("./fixtures/metrics");
    expect(parsed.dryRun).toBe(true);
  });

  test("executes script with expected args and returns parsed summary", async () => {
    const runExec = vi.fn(async () => ({
      stdout:
        '{"files_total":2,"files_processed":2,"rows_loaded":4,"rows_skipped":0,"date_start":"2026-02-01","date_end":"2026-02-07"}',
      stderr: "",
    }));

    const summary = await runMetricsSync(
      {
        scriptPath: "/workspace/scripts/ceo_metrics_sync.py",
        inputDir: "/workspace/data/metrics",
        tenantId: "tenant_a",
        dbPath: "/workspace/ceo_agent.db",
        dryRun: true,
      },
      runExec,
    );

    expect(runExec).toHaveBeenCalledTimes(1);
    expect(runExec).toHaveBeenCalledWith("python", [
      "/workspace/scripts/ceo_metrics_sync.py",
      "--input-dir",
      "/workspace/data/metrics",
      "--tenant-id",
      "tenant_a",
      "--db-path",
      "/workspace/ceo_agent.db",
      "--dry-run",
    ]);
    expect(summary.rows_loaded).toBe(4);
    expect(formatMetricsSyncSummary(summary)).toContain("导入行数：4");
  });
});
