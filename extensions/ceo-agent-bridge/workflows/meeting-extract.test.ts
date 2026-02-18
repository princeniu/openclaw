import { describe, expect, test } from "vitest";
import { runMeetingExtractWorkflow } from "./meeting-extract.js";

const context = {
  tenantId: "tenant-a",
  requestId: "req-meeting-001",
  sessionId: "session-meeting-001",
  runId: "run-meeting-001",
};

describe("meeting extract workflow", () => {
  test("extracts decisions and tasks from raw text", async () => {
    const result = await runMeetingExtractWorkflow(context, {
      meeting_id: "m_001",
      raw_text:
        "决策：下周发布 beta 版本\n待办：李雷 在 2026-02-25 前完成 发布公告\n待办：韩梅梅 在 2026-02-26 前完成 客户通知",
    });

    expect(result.status).toBe("success");
    expect(result.errors).toEqual([]);
    expect(result.data).toMatchObject({
      meeting_id: "m_001",
      source_type: "text",
      decision_count: 1,
      task_count: 2,
    });
    expect(result.data.decisions[0]).toContain("下周发布 beta 版本");
    expect(result.data.tasks[0]).toMatchObject({
      owner: "李雷",
      due_at: "2026-02-25",
    });
  });

  test("supports transcript stream and incremental extraction", async () => {
    const result = await runMeetingExtractWorkflow(context, {
      meeting_id: "m_002",
      transcript_stream: [
        { text: "决策：本周确定试点名单" },
        { text: "待办：王五 在 2026-02-27 前完成 试点合同初稿" },
        { text: "决策：本周确定试点名单\n待办：赵六 在 2026-02-28 前完成 客户沟通脚本" },
      ],
    });

    expect(result.status).toBe("success");
    expect(result.data.source_type).toBe("transcript_stream");
    expect(result.data.decision_count).toBe(1);
    expect(result.data.task_count).toBe(2);
    expect(result.data.incremental_updates).toHaveLength(3);
    expect(result.data.incremental_updates[0]).toMatchObject({
      chunk_index: 0,
      decisions_added: 1,
      tasks_added: 0,
    });
    expect(result.data.incremental_updates[2]).toMatchObject({
      chunk_index: 2,
      decisions_added: 0,
      tasks_added: 1,
    });
  });

  test("routes owner/date conflicts to pending confirmation queue", async () => {
    const result = await runMeetingExtractWorkflow(context, {
      meeting_id: "m_003",
      raw_text:
        "待办：张三 在 2026-02-25 前完成 签约材料\n待办：李四 在 2026-02-25 前完成 签约材料\n待办：王五 在 2026-02-26 前完成 预算复核\n待办：王五 在 2026-02-27 前完成 预算复核\n待办：赵六 在 2026-02-28 前完成 客户回访",
    });

    expect(result.status).toBe("success");
    expect(result.data.task_count).toBe(1);
    expect(result.data.tasks[0]).toMatchObject({
      owner: "赵六",
      due_at: "2026-02-28",
    });
    expect(result.data.pending_confirmations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conflict_type: "owner_conflict",
          description: "签约材料",
        }),
        expect.objectContaining({
          conflict_type: "date_conflict",
          description: "预算复核",
        }),
      ]),
    );
  });
});
