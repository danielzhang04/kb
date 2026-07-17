import type { TranscriptRecord } from './tailer.ts';

/** A `tool_result` block from a `user` record. */
export interface ToolResult {
  tool_use_id: string;
  is_error?: boolean;
  content?: unknown;
}

/** A `tool_use` block joined to its originating assistant turn and its result. */
export interface JoinedToolUse {
  id: string;
  name: string;
  input: unknown;
  /** Model of the assistant message that emitted this tool_use (`message.model`). */
  model: string | null;
  /** Usage of the assistant message that emitted this tool_use (`message.usage`). */
  usage: unknown | null;
  /** The matching `tool_result`, joined by `tool_use_id → tool_use.id`; null if none. */
  result: ToolResult | null;
}

function contentBlocks(record: TranscriptRecord): Array<Record<string, unknown>> {
  const content = record.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null);
}

/**
 * Join `tool_result` blocks (in `user` records) to their originating `tool_use`
 * blocks (in `assistant` records) by `tool_result.tool_use_id === tool_use.id`.
 *
 * Each joined entry carries the `model`/`usage` of the assistant message that
 * emitted the tool_use, read from `message.model` / `message.usage`.
 */
export function joinToolResults(records: TranscriptRecord[]): JoinedToolUse[] {
  const order: JoinedToolUse[] = [];
  const byId = new Map<string, JoinedToolUse>();

  // Pass 1: collect tool_use blocks from assistant records.
  for (const record of records) {
    if (record.type !== 'assistant') continue;
    const model = typeof record.message?.model === 'string' ? record.message.model : null;
    const usage = record.message?.usage ?? null;
    for (const block of contentBlocks(record)) {
      if (block.type !== 'tool_use') continue;
      const id = block.id;
      if (typeof id !== 'string') continue;
      const entry: JoinedToolUse = {
        id,
        name: typeof block.name === 'string' ? block.name : '',
        input: block.input ?? null,
        model,
        usage,
        result: null,
      };
      order.push(entry);
      byId.set(id, entry);
    }
  }

  // Pass 2: attach tool_result blocks from user records by tool_use_id.
  for (const record of records) {
    if (record.type !== 'user') continue;
    for (const block of contentBlocks(record)) {
      if (block.type !== 'tool_result') continue;
      const targetId = block.tool_use_id;
      if (typeof targetId !== 'string') continue;
      const entry = byId.get(targetId);
      if (!entry) continue;
      entry.result = {
        tool_use_id: targetId,
        is_error: typeof block.is_error === 'boolean' ? block.is_error : undefined,
        content: block.content,
      };
    }
  }

  return order;
}
