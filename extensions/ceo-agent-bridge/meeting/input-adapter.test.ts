import { describe, expect, test } from "vitest";
import { adaptMeetingInput } from "./input-adapter.js";

describe("meeting input adapter", () => {
  test("extracts structured decisions and tasks from raw text input", () => {
    const result = adaptMeetingInput({
      raw_text: "决策：下周发布 beta\n待办：李雷 在 2026-02-25 前完成 发布公告",
    });

    expect(result.source_type).toBe("text");
    expect(result.transcript_text).toContain("决策：下周发布 beta");
    expect(result.decision_count).toBe(1);
    expect(result.task_count).toBe(1);
    expect(result.tasks[0]).toMatchObject({
      owner: "李雷",
      due_at: "2026-02-25",
      description: "发布公告",
    });
    expect(result.incremental_updates).toEqual([
      expect.objectContaining({
        chunk_index: 0,
        decisions_added: 1,
        tasks_added: 1,
      }),
    ]);
  });

  test("supports transcript stream and incremental dedup extraction", () => {
    const result = adaptMeetingInput({
      transcript_stream: [
        { text: "决策：本周确定试点名单" },
        { text: "待办：王五 在 2026-02-27 前完成 试点合同初稿" },
        { text: "决策：本周确定试点名单\n待办：赵六 在 2026-02-28 前完成 客户沟通脚本" },
      ],
    });

    expect(result.source_type).toBe("transcript_stream");
    expect(result.decision_count).toBe(1);
    expect(result.task_count).toBe(2);
    expect(result.incremental_updates).toHaveLength(3);
    expect(result.incremental_updates[2]).toMatchObject({
      chunk_index: 2,
      decisions_added: 0,
      tasks_added: 1,
    });
  });
});
