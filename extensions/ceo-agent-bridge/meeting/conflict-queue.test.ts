import { describe, expect, test } from "vitest";
import type { MeetingTask } from "./input-adapter.js";
import { enqueueConflict, filterConfirmedTasks } from "./conflict-queue.js";

describe("meeting conflict queue", () => {
  test("merges candidates into pending confirmation queue without duplicates", () => {
    const queue = enqueueConflict([], "owner_conflict", "签约材料", [
      { text: "张三 在 2026-02-25 前完成 签约材料", description: "签约材料", owner: "张三" },
    ]);
    const merged = enqueueConflict(queue, "owner_conflict", "签约材料", [
      { text: "李四 在 2026-02-25 前完成 签约材料", description: "签约材料", owner: "李四" },
      { text: "张三 在 2026-02-25 前完成 签约材料", description: "签约材料", owner: "张三" },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.candidates).toHaveLength(2);
  });

  test("filters out conflicted tasks from confirmed task set", () => {
    const tasks: MeetingTask[] = [
      { text: "张三 在 2026-02-25 前完成 签约材料", description: "签约材料", owner: "张三" },
      { text: "赵六 在 2026-02-28 前完成 客户回访", description: "客户回访", owner: "赵六" },
    ];
    const queue = enqueueConflict([], "owner_conflict", "签约材料", [tasks[0]]);

    const confirmed = filterConfirmedTasks(tasks, queue);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.description).toBe("客户回访");
  });
});
