/**
 * Provider transcript line -> redacted public operational event.
 *
 * These mappers were declared inside the two unreachable managed session adapters
 * (`claudeSessionAdapter.ts` / `codexSessionAdapter.ts`, deleted in P3 W6.5 per plan [C-S6]) but their
 * only retained caller is `runEventService.ts`, which projects raw provider lines captured by the real
 * attempt sessions. They are pure functions over one line of text: no spawning, no process ownership,
 * no I/O. Redaction, bounding, and the public allowlist are applied by `normalizeOperationalEvent`, so
 * each private mapper only has to shape the fields.
 */
import {
  normalizeOperationalEvent,
  type PrivateOperationalEvent,
  type PublicOperationalEvent,
} from './publicEvents.ts';

/**
 * Map ONE parsed Claude stream-json event to zero or more private operational events (an assistant
 * turn can carry several content blocks).
 */
export function mapStreamEventToPrivate(event: unknown): PrivateOperationalEvent[] {
  if (!event || typeof event !== 'object') return [];
  const record = event as Record<string, unknown>;
  const type = record.type;

  if (type === 'system') {
    return [{ kind: 'lifecycle', state: typeof record.subtype === 'string' ? record.subtype : 'started', detail: null }];
  }

  // ASSISTANT ONLY. `user` events in the stream-json transcript are the harness echoing tool_result
  // blocks back into the conversation — worker output, not agent narration. Today those blocks are
  // skipped below because they carry no tool name, but that is a property of Claude Code's current
  // wire format, not of this code: if a tool result were ever hoisted into a top-level `text` block
  // on a user message, the loop below would mark it `visible: true` and persist it verbatim as an
  // event summary. Gating on `assistant` makes the safety local instead of borrowed. Nothing is lost
  // — a user message has no `tool_use` blocks, and its text is the operator's own approved prompt,
  // which the caller already holds.
  if (type === 'assistant') {
    const message = (record.message ?? {}) as Record<string, unknown>;
    const content = message.content;
    const out: PrivateOperationalEvent[] = [];
    if (Array.isArray(content)) {
      for (const rawBlock of content) {
        if (!rawBlock || typeof rawBlock !== 'object') continue;
        const block = rawBlock as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') {
          out.push({ kind: 'message', visible: true, text: block.text });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          out.push({ kind: 'tool', name: block.name, status: 'started' });
        }
        // Every other block type — tool_result, thinking, images — is dropped. Only `text` and
        // `tool_use` are projected, so an unrecognized block can never become an event payload.
      }
    }
    return out;
  }

  if (type === 'result') {
    // Fail-closed: success requires BOTH the explicit success subtype and a non-error flag. A result
    // event missing either field maps to a failed lifecycle rather than masquerading as succeeded.
    const isSuccess = record.subtype === 'success' && record.is_error !== true;
    const detail = typeof record.result === 'string' ? record.result : null;
    return [{ kind: 'lifecycle', state: isSuccess ? 'succeeded' : 'failed', detail }];
  }

  return [];
}

/** Parse one Claude stream-json line into the redacted public events it yields (malformed lines yield none). */
export function mapStreamLine(line: string): PublicOperationalEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const events: PublicOperationalEvent[] = [];
  for (const priv of mapStreamEventToPrivate(parsed)) {
    const normalized = normalizeOperationalEvent(priv);
    if (normalized) events.push(normalized);
  }
  return events;
}

/** Map one live-proven Codex JSONL event into the private event envelope. */
export function mapCodexEventToPrivate(event: unknown): PrivateOperationalEvent[] {
  if (!event || typeof event !== 'object') return [];
  const row = event as Record<string, unknown>;
  if (row.type === 'thread.started') return [{ kind: 'lifecycle', state: 'started', detail: null }];
  if (row.type === 'turn.started') return [{ kind: 'lifecycle', state: 'turn-started', detail: null }];
  if (row.type === 'item.completed' && row.item && typeof row.item === 'object') {
    const item = row.item as Record<string, unknown>;
    return item.type === 'agent_message' && typeof item.text === 'string'
      ? [{ kind: 'message', visible: true, text: item.text }]
      : [];
  }
  if (row.type === 'turn.completed') return [{ kind: 'lifecycle', state: 'succeeded', detail: null }];
  if (row.type === 'turn.failed') {
    const error = row.error && typeof row.error === 'object' ? row.error as Record<string, unknown> : {};
    return [{ kind: 'lifecycle', state: 'failed', detail: typeof error.message === 'string' ? error.message : null }];
  }
  return [];
}

/** Parse one Codex JSONL row and normalize every projected event through the redacting public allowlist. */
export function mapCodexStreamLine(line: string): PublicOperationalEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return []; }
  const events: PublicOperationalEvent[] = [];
  for (const event of mapCodexEventToPrivate(parsed)) {
    const normalized = normalizeOperationalEvent(event);
    if (normalized) events.push(normalized);
  }
  return events;
}
