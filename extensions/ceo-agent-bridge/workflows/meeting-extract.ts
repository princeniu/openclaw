import { buildDryRunSuccessResult, type WorkflowContext, type WorkflowResult } from "./types.js";

type MeetingTask = {
  text: string;
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
    incremental_updates: IncrementalUpdate[];
  }>
> {
  const meetingId = readMeetingId(context, payload);
  const transcript = readTranscriptChunks(payload);
  const seenDecision = new Set<string>();
  const seenTask = new Set<string>();
  const decisions: string[] = [];
  const tasks: MeetingTask[] = [];
  const incrementalUpdates: IncrementalUpdate[] = [];

  transcript.chunks.forEach((chunk, chunkIndex) => {
    const extracted = extractMeetingSignals(chunk);
    let decisionsAdded = 0;
    let tasksAdded = 0;

    for (const decision of extracted.decisions) {
      if (seenDecision.has(decision)) {
        continue;
      }
      seenDecision.add(decision);
      decisions.push(decision);
      decisionsAdded += 1;
    }

    for (const task of extracted.tasks) {
      if (seenTask.has(task.text)) {
        continue;
      }
      seenTask.add(task.text);
      tasks.push(task);
      tasksAdded += 1;
    }

    incrementalUpdates.push({
      chunk_index: chunkIndex,
      decisions_added: decisionsAdded,
      tasks_added: tasksAdded,
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
    incremental_updates: incrementalUpdates,
  });
}
