import type { PendingConfirmation } from "./conflict-queue.js";
import type { MeetingTask } from "./input-adapter.js";

export type MeetingDispatchCard = {
  card_type: "meeting_dispatch";
  title: string;
  meeting_id: string;
  task_count: number;
  pending_count: number;
  items: Array<{
    recommendation_id: string;
    title: string;
    owner?: string;
    due_at?: string;
    actions: Array<"accept" | "ignore" | "reschedule">;
  }>;
};

export function buildPostMeetingCard(params: {
  meetingId: string;
  tasks: MeetingTask[];
  pendingConfirmations: PendingConfirmation[];
}): MeetingDispatchCard {
  return {
    card_type: "meeting_dispatch",
    title: "会议结束后确认并派发",
    meeting_id: params.meetingId,
    task_count: params.tasks.length,
    pending_count: params.pendingConfirmations.length,
    items: params.tasks.slice(0, 8).map((task, index) => ({
      recommendation_id: `${params.meetingId}-task-${index + 1}`,
      title: task.description || task.text,
      owner: task.owner,
      due_at: task.due_at,
      actions: ["accept", "ignore", "reschedule"],
    })),
  };
}
