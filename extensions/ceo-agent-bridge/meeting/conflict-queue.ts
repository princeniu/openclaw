import type { MeetingTask } from "./input-adapter.js";

export type PendingConfirmation = {
  conflict_type: "owner_conflict" | "date_conflict";
  description: string;
  candidates: MeetingTask[];
};

export function enqueueConflict(
  queue: PendingConfirmation[],
  conflictType: PendingConfirmation["conflict_type"],
  description: string,
  candidates: MeetingTask[],
): PendingConfirmation[] {
  const nextQueue = queue.map((item) => ({
    ...item,
    candidates: [...item.candidates],
  }));

  let target = nextQueue.find(
    (item) => item.conflict_type === conflictType && item.description === description,
  );
  if (!target) {
    target = {
      conflict_type: conflictType,
      description,
      candidates: [],
    };
    nextQueue.push(target);
  }

  for (const candidate of candidates) {
    const exists = target.candidates.some((item) => item.text === candidate.text);
    if (!exists) {
      target.candidates.push(candidate);
    }
  }

  return nextQueue;
}

export function filterConfirmedTasks(
  tasks: MeetingTask[],
  queue: PendingConfirmation[],
): MeetingTask[] {
  const conflictedDescriptions = new Set(queue.map((item) => item.description));
  return tasks.filter((task) => !conflictedDescriptions.has(task.description));
}
