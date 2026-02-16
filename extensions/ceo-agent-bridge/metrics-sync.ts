import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MetricsSyncCommand = {
  matched: boolean;
  inputDir?: string;
  dryRun: boolean;
  error?: string;
};

export type MetricsSyncSummary = {
  files_total: number;
  files_processed: number;
  rows_loaded: number;
  rows_skipped: number;
  date_start?: string;
  date_end?: string;
  dry_run?: boolean;
};

export type ExecRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export function parseMetricsSyncCommand(messageText: string): MetricsSyncCommand {
  const normalized = messageText.trim();
  if (!normalized) {
    return { matched: false, dryRun: false };
  }

  const match = normalized.match(/^(sync\s+metrics|同步指标)(?:\s+(.+))?$/i);
  if (!match) {
    return { matched: false, dryRun: false };
  }

  const rawArgs = (match[2] ?? "").trim();
  if (!rawArgs) {
    return {
      matched: true,
      dryRun: false,
      error: "请提供指标目录，例如：sync metrics ./data/metrics",
    };
  }

  const hasDryRun = /(?:^|\s)--dry-run(?:\s|$)/.test(rawArgs);
  const inputDir = rawArgs.replace(/(?:^|\s)--dry-run(?=\s|$)/g, " ").trim();
  if (!inputDir) {
    return {
      matched: true,
      dryRun: hasDryRun,
      error: "请提供指标目录，例如：sync metrics ./data/metrics",
    };
  }

  return {
    matched: true,
    inputDir,
    dryRun: hasDryRun,
  };
}

export async function runMetricsSync(
  params: {
    scriptPath: string;
    inputDir: string;
    tenantId: string;
    dbPath: string;
    dryRun: boolean;
  },
  runExec: ExecRunner = (command, args) => execFileAsync(command, args),
): Promise<MetricsSyncSummary> {
  const args = [
    params.scriptPath,
    "--input-dir",
    params.inputDir,
    "--tenant-id",
    params.tenantId,
    "--db-path",
    params.dbPath,
  ];
  if (params.dryRun) {
    args.push("--dry-run");
  }

  const result = await runExec("python", args);
  const output = pickLastNonEmptyLine(result.stdout);
  if (!output) {
    throw new Error("metrics sync returned empty output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`metrics sync output is not valid JSON: ${output}`);
  }

  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return {
    files_total: readNumber(record, "files_total"),
    files_processed: readNumber(record, "files_processed"),
    rows_loaded: readNumber(record, "rows_loaded"),
    rows_skipped: readNumber(record, "rows_skipped"),
    date_start: readOptionalString(record, "date_start"),
    date_end: readOptionalString(record, "date_end"),
    dry_run: readOptionalBool(record, "dry_run"),
  };
}

export function formatMetricsSyncSummary(summary: MetricsSyncSummary): string {
  const lines = [
    "指标同步完成。",
    `处理文件：${summary.files_processed}/${summary.files_total}`,
    `导入行数：${summary.rows_loaded}，跳过行数：${summary.rows_skipped}`,
  ];
  if (summary.date_start && summary.date_end) {
    lines.push(`时间范围：${summary.date_start} ~ ${summary.date_end}`);
  }
  if (summary.dry_run) {
    lines.push("当前为 dry-run，本次未写入数据库。");
  }
  return lines.join("\n");
}

function pickLastNonEmptyLine(stdout: string): string {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]) {
      return lines[i];
    }
  }
  return "";
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalBool(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}
