export interface ParsedCodexStream {
  terminalEvent: Record<string, unknown> | null;
  threadId: string | null;
  finalMessage: string;
}

/** Parse tolerated JSONL noise, retaining only the live-proven Codex event shapes. */
export function parseCodexStream(stdout: string): ParsedCodexStream {
  let terminalEvent: Record<string, unknown> | null = null;
  let threadId: string | null = null;
  let finalMessage = '';
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const row = event as Record<string, unknown>;
    if (row.type === 'thread.started' && threadId === null && typeof row.thread_id === 'string' && row.thread_id.trim()) {
      threadId = row.thread_id;
      continue;
    }
    if (row.type === 'item.completed' && row.item && typeof row.item === 'object') {
      const item = row.item as Record<string, unknown>;
      if (item.type === 'agent_message' && typeof item.text === 'string') finalMessage = item.text;
      continue;
    }
    if (row.type === 'turn.completed') terminalEvent = row;
  }
  return { terminalEvent, threadId, finalMessage };
}
