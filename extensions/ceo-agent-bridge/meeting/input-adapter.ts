export type MeetingTask = {
  text: string;
  description: string;
  owner?: string;
  due_at?: string;
};

export type IncrementalUpdate = {
  chunk_index: number;
  decisions_added: number;
  tasks_added: number;
  total_decisions: number;
  total_tasks: number;
};

export type MeetingInputAdapterResult = {
  source_type: "text" | "transcript_stream";
  transcript_text: string;
  chunks: string[];
  decision_count: number;
  task_count: number;
  decisions: string[];
  tasks: MeetingTask[];
  incremental_updates: IncrementalUpdate[];
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

function readTranscriptChunks(payload: Record<string, unknown>): {
  source_type: "text" | "transcript_stream";
  transcript_text: string;
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
          return typeof record.text === "string" ? record.text.trim() : "";
        }
        return "";
      })
      .filter((item) => item.length > 0);

    return {
      source_type: "transcript_stream",
      transcript_text: chunks.join("\n"),
      chunks,
    };
  }

  const rawText = typeof payload.raw_text === "string" ? payload.raw_text.trim() : "";
  return {
    source_type: "text",
    transcript_text: rawText,
    chunks: rawText ? [rawText] : [],
  };
}

export function adaptMeetingInput(
  payload: Record<string, unknown> = {},
): MeetingInputAdapterResult {
  const transcript = readTranscriptChunks(payload);
  const seenDecision = new Set<string>();
  const seenTask = new Set<string>();
  const decisions: string[] = [];
  const tasks: MeetingTask[] = [];
  const incrementalUpdates: IncrementalUpdate[] = [];

  transcript.chunks.forEach((chunk, chunkIndex) => {
    const extracted = extractMeetingSignals(chunk);
    const beforeDecisions = decisions.length;
    const beforeTasks = tasks.length;

    for (const decision of extracted.decisions) {
      if (!seenDecision.has(decision)) {
        seenDecision.add(decision);
        decisions.push(decision);
      }
    }

    for (const task of extracted.tasks) {
      if (!seenTask.has(task.text)) {
        seenTask.add(task.text);
        tasks.push(task);
      }
    }

    incrementalUpdates.push({
      chunk_index: chunkIndex,
      decisions_added: decisions.length - beforeDecisions,
      tasks_added: tasks.length - beforeTasks,
      total_decisions: decisions.length,
      total_tasks: tasks.length,
    });
  });

  return {
    source_type: transcript.source_type,
    transcript_text: transcript.transcript_text,
    chunks: transcript.chunks,
    decision_count: decisions.length,
    task_count: tasks.length,
    decisions,
    tasks,
    incremental_updates: incrementalUpdates,
  };
}
