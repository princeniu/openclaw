import { buildPostMeetingCard, type MeetingDispatchCard } from "../meeting/post-meeting-card.js";
import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

type MeetingTask = {
  text: string;
  description: string;
  owner?: string;
  due_at?: string;
};

type IncrementalUpdate = {
  chunk_index: number;
  decisions_added: number;
  tasks_added: number;
  total_decisions: number;
  total_tasks: number;
};

type PendingConfirmation = {
  conflict_type: "owner_conflict" | "date_conflict";
  description: string;
  candidates: MeetingTask[];
};

function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function extractDueDate(text: string): string | undefined {
  const match = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  return match?.[0];
}

function extractOwner(text: string): string | undefined {
  const zhMatch = text.match(/^([^\s在:：]+)\s+在\s+\d{4}-\d{2}-\d{2}/);
  if (zhMatch?.[1]) {
    return zhMatch[1];
  }
  const enMatch = text.match(/^([A-Za-z][\w-]*)\s+by\s+\d{4}-\d{2}-\d{2}/i);
  return enMatch?.[1];
}

function extractTaskDescription(text: string): string {
  const zhRemoved = text.replace(/^([^\s在:：]+)\s+在\s+\d{4}-\d{2}-\d{2}\s+前?完成\s*/i, "");
  if (zhRemoved !== text) {
    return zhRemoved.trim();
  }
  const enRemoved = text.replace(/^([A-Za-z][\w-]*)\s+by\s+\d{4}-\d{2}-\d{2}\s+/i, "");
  if (enRemoved !== text) {
    return enRemoved.trim();
  }
  return text.trim();
}

function extractMeetingSignals(text: string): { decisions: string[]; tasks: MeetingTask[] } {
  const decisions: string[] = [];
  const tasks: MeetingTask[] = [];
  for (const line of toLines(text)) {
    const decisionMatch = line.match(/^(?:决策|decision)\s*[:：]\s*(.+)$/i);
    if (decisionMatch?.[1]) {
      decisions.push(decisionMatch[1].trim());
      continue;
    }

    const taskMatch = line.match(/^(?:待办|action)\s*[:：]\s*(.+)$/i);
    if (taskMatch?.[1]) {
      const taskText = taskMatch[1].trim();
      tasks.push({
        text: taskText,
        description: extractTaskDescription(taskText),
        owner: extractOwner(taskText),
        due_at: extractDueDate(taskText),
      });
    }
  }
  return { decisions, tasks };
}

function readMeetingId(context: WorkflowContext, payload: Record<string, unknown>): string {
  const value = payload.meeting_id;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return context.requestId;
}

function readTranscriptChunks(payload: Record<string, unknown>): {
  text: string;
  sourceType: "text" | "transcript_stream";
  chunks: string[];
} {
  const stream = payload.transcript_stream;
  if (Array.isArray(stream) && stream.length > 0) {
    const chunks = stream
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const record = item as Record<string, unknown>;
          const text = typeof record.text === "string" ? record.text.trim() : "";
          return text;
        }
        return "";
      })
      .filter((item) => item.length > 0);
    return {
      text: chunks.join("\n"),
      sourceType: "transcript_stream",
      chunks,
    };
  }

  const rawText = typeof payload.raw_text === "string" ? payload.raw_text.trim() : "";
  return {
    text: rawText,
    sourceType: "text",
    chunks: rawText ? [rawText] : [],
  };
}

function upsertPendingConfirmation(
  pending: PendingConfirmation[],
  conflictType: PendingConfirmation["conflict_type"],
  description: string,
  candidates: MeetingTask[],
): void {
  let target = pending.find(
    (item) => item.conflict_type === conflictType && item.description === description,
  );
  if (!target) {
    target = {
      conflict_type: conflictType,
      description,
      candidates: [],
    };
    pending.push(target);
  }

  for (const candidate of candidates) {
    const exists = target.candidates.some((item) => item.text === candidate.text);
    if (!exists) {
      target.candidates.push(candidate);
    }
  }
}

export async function runMeetingExtractWorkflow(
  context: WorkflowContext,
  payload: Record<string, unknown> = {},
): Promise<
  WorkflowResult<{
    workflow: string;
    mode: "dry-run";
    payload_size: number;
    meeting_id: string;
    source_type: "text" | "transcript_stream";
    transcript_text: string;
    decision_count: number;
    task_count: number;
    decisions: string[];
    tasks: MeetingTask[];
    pending_confirmations: PendingConfirmation[];
    post_meeting_card: MeetingDispatchCard;
    incremental_updates: IncrementalUpdate[];
  }>
> {
  const meetingId = readMeetingId(context, payload);
  const transcript = readTranscriptChunks(payload);
  const seenDecision = new Set<string>();
  const seenTask = new Set<string>();
  const conflictedDescriptions = new Set<string>();
  const decisions: string[] = [];
  const tasks: MeetingTask[] = [];
  const confirmedTaskByDescription = new Map<string, MeetingTask>();
  const pendingConfirmations: PendingConfirmation[] = [];
  const incrementalUpdates: IncrementalUpdate[] = [];

  transcript.chunks.forEach((chunk, chunkIndex) => {
    const extracted = extractMeetingSignals(chunk);
    const beforeDecisions = decisions.length;
    const beforeTasks = tasks.length;

    for (const decision of extracted.decisions) {
      if (seenDecision.has(decision)) {
        continue;
      }
      seenDecision.add(decision);
      decisions.push(decision);
    }

    for (const task of extracted.tasks) {
      if (seenTask.has(task.text)) {
        continue;
      }
      seenTask.add(task.text);
      const existing = confirmedTaskByDescription.get(task.description);

      if (existing) {
        const ownerConflict =
          Boolean(existing.owner) && Boolean(task.owner) && existing.owner !== task.owner;
        const dateConflict =
          Boolean(existing.due_at) && Boolean(task.due_at) && existing.due_at !== task.due_at;

        if (ownerConflict || dateConflict) {
          conflictedDescriptions.add(task.description);
          confirmedTaskByDescription.delete(task.description);
          const keepTasks = tasks.filter((item) => item.description !== task.description);
          tasks.length = 0;
          tasks.push(...keepTasks);

          if (ownerConflict) {
            upsertPendingConfirmation(pendingConfirmations, "owner_conflict", task.description, [
              existing,
              task,
            ]);
          }
          if (dateConflict) {
            upsertPendingConfirmation(pendingConfirmations, "date_conflict", task.description, [
              existing,
              task,
            ]);
          }
        }
        continue;
      }

      if (conflictedDescriptions.has(task.description)) {
        for (const conflictType of ["owner_conflict", "date_conflict"] as const) {
          const hasConflict = pendingConfirmations.some(
            (item) => item.description === task.description && item.conflict_type === conflictType,
          );
          if (hasConflict) {
            upsertPendingConfirmation(pendingConfirmations, conflictType, task.description, [task]);
          }
        }
        continue;
      }

      confirmedTaskByDescription.set(task.description, task);
      tasks.push(task);
    }

    incrementalUpdates.push({
      chunk_index: chunkIndex,
      decisions_added: decisions.length - beforeDecisions,
      tasks_added: tasks.length - beforeTasks,
      total_decisions: decisions.length,
      total_tasks: tasks.length,
    });
  });

  return buildDryRunSuccessResult(context, "meeting-extract", {
    payload_size: Object.keys(payload).length,
    meeting_id: meetingId,
    source_type: transcript.sourceType,
    transcript_text: transcript.text,
    decision_count: decisions.length,
    task_count: tasks.length,
    decisions,
    tasks,
    pending_confirmations: pendingConfirmations,
    post_meeting_card: buildPostMeetingCard({
      meetingId,
      tasks,
      pendingConfirmations,
    }),
    incremental_updates: incrementalUpdates,
  });
}
