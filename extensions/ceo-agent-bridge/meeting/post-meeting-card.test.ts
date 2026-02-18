import { describe, expect, test } from "vitest";
import { buildPostMeetingCard } from "./post-meeting-card.js";

describe("post meeting card", () => {
  test("builds confirmation and dispatch card from meeting extraction result", () => {
    const card = buildPostMeetingCard({
      meetingId: "m_001",
      tasks: [
        {
          text: "李雷 在 2026-02-25 前完成 发布公告",
          description: "发布公告",
          owner: "李雷",
          due_at: "2026-02-25",
        },
      ],
      pendingConfirmations: [
        {
          conflict_type: "owner_conflict",
          description: "签约材料",
          candidates: [],
        },
      ],
    });

    expect(card).toMatchObject({
      card_type: "meeting_dispatch",
      meeting_id: "m_001",
      task_count: 1,
      pending_count: 1,
    });
    expect(card.items[0]).toMatchObject({
      title: "发布公告",
      actions: ["accept", "ignore", "reschedule"],
    });
  });
});
