/**
 * arc-3 — pure projections over `OperationalEventDto`.
 *
 * These exist because the previous `eventText()` was
 *   `summary ?? command ?? toolName ?? path ?? checkpoint ?? kind`
 * a single `??` chain flattening nine populated fields into ONE string. Two things were silently lost:
 *
 *  1. **`event.diff`** — persisted server-side, returned by `GET /api/control/runs/:runRef/events`,
 *     typed on the DTO, present in the browser on every load, and never in that chain. Rendering it is
 *     most of what "code history" means here. See {@link isChangeEvent} / the Changes section.
 *
 *  2. **The checkpoint NAME.** Worth being precise, because the wire shape is the opposite of what it
 *     looks like. `server/control/store.ts:916-919` normalizes a broker checkpoint as:
 *         { kind: 'checkpoint', checkpoint: event.name,
 *           status: event.state === 'blocked' ? 'waiting' : 'success', summary: event.state }
 *     so `checkpoint` carries the NAME and `summary` carries the STATE. Because `summary` came FIRST in
 *     the `??` chain, the old timeline rendered the bare word "reached" and dropped the name entirely.
 *     The two steering paths (`store.ts:1981` enqueue, `store.ts:2026` consume) instead put operator or
 *     narrative text in `summary`, so the state has to be recovered from `status` there.
 *
 * Everything here is a pure function over one DTO so each is testable with a literal fixture.
 */
import type { OperationalEventDto, RunState } from './controlClient';
import type { StatusTone } from '../entity/EntityDetail';

/** The lifecycle position of a checkpoint. `queued`/`failed` are derived from `status` on the two
 *  steering paths, which carry no state word; the broker path carries the first three verbatim. */
export type CheckpointState = 'reached' | 'released' | 'blocked' | 'queued' | 'failed';

const WIRE_CHECKPOINT_STATES = ['reached', 'released', 'blocked'] as const;

/** `status` → checkpoint state, for the steering paths whose `summary` holds text, not a state word. */
const STATE_BY_STATUS: Partial<Record<NonNullable<OperationalEventDto['status']>, CheckpointState>> = {
  waiting: 'blocked',
  pending: 'queued',
  success: 'reached',
  failure: 'failed',
};

export interface CheckpointInfo {
  /** The checkpoint's name — the operator-meaningful half, dropped entirely by the old flattening. */
  name: string;
  /** Its lifecycle position, or null when neither the summary nor the status can establish one. */
  state: CheckpointState | null;
  /** Narrative/operator text, when `summary` holds something other than the bare state word. */
  detail: string | null;
}

/** Parse a checkpoint event into its distinct name / state / detail parts. Null for other kinds. */
export function checkpointInfo(event: OperationalEventDto): CheckpointInfo | null {
  if (event.checkpoint === null) return null;
  const summary = event.summary?.trim() ?? '';
  const isStateWord = (WIRE_CHECKPOINT_STATES as readonly string[]).includes(summary);
  return {
    name: event.checkpoint,
    state: isStateWord
      ? (summary as CheckpointState)
      : (event.status ? STATE_BY_STATUS[event.status] ?? null : null),
    detail: isStateWord || summary === '' ? null : summary,
  };
}

/**
 * The server's `MAX_LONG_TEXT` — `store.ts` stores a diff as `cleanText(input.diff, MAX_LONG_TEXT)` =
 * `redactSensitiveText(...).slice(0, 64 * 1024)`. A diff that lands exactly on this length was cut by
 * that slice; a diff shorter than it was not. That is the only truncation signal on the wire, and it is
 * enough to mark the affected diffs specifically instead of letting them render as if complete.
 */
export const MAX_DIFF_BYTES = 64 * 1024;

/**
 * True when this diff was cut short by the server's 64KB cap, so the `<pre>` is NOT the whole change.
 *
 * Exact-length equality can in principle fire on a diff that happens to be precisely 64KB and was never
 * cut. Erring that way is deliberate: over-warning tells the operator to go look at the real diff, while
 * under-warning renders a partial change as complete — only one of those can mislead a review.
 */
export function isDiffTruncated(event: OperationalEventDto): boolean {
  return typeof event.diff === 'string' && event.diff.length >= MAX_DIFF_BYTES;
}

/** True when this event carries a rendered diff body — the "Changes" (code history) feed. */
export function isChangeEvent(event: OperationalEventDto): boolean {
  return typeof event.diff === 'string' && event.diff.trim().length > 0;
}

/** Every event that carries a diff body, oldest first (the natural cursor order the API returns). */
export function changeEvents(events: OperationalEventDto[]): OperationalEventDto[] {
  return events.filter(isChangeEvent);
}

/**
 * The one-line human label for an event row.
 *
 * Unlike the old chain this NEVER consumes the diff or the checkpoint: both are structured surfaces
 * with their own rendering, so collapsing them into this string is exactly the bug being fixed. A
 * checkpoint row is labelled by its NAME (the part that was being lost), and a diff row by its path.
 */
export function eventLabel(event: OperationalEventDto): string {
  const checkpoint = checkpointInfo(event);
  if (checkpoint) return checkpoint.name;
  if (isChangeEvent(event)) return event.path ?? 'change';
  return event.summary ?? event.command ?? event.toolName ?? event.path ?? event.kind;
}

/** Format an ISO timestamp as a stable, locale-independent `HH:MM:SS` clock for dense trace rows. */
export function eventClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '--:--:--';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
}

/** Format an ISO timestamp as a full, unambiguous UTC stamp for fact strips. */
export function timestampLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

/** Map a run state onto a data-encoding tone. No new hues — these resolve to existing status tokens. */
export function runTone(state: RunState): StatusTone {
  switch (state) {
    case 'running':
    case 'recovering':
      return 'running';
    case 'succeeded':
      return 'ok';
    case 'failed':
    case 'interrupted':
      return 'error';
    case 'waiting-human':
    case 'stopping':
    case 'stopped':
      return 'warn';
    // A dismissed run is inert, not something to look at again: idle, never warn or error.
    case 'archived':
    default:
      return 'idle';
  }
}

const RUN_DOT_BY_TONE: Record<StatusTone, string> = {
  running: 'running',
  ok: 'done',
  error: 'error',
  warn: 'blocked',
  idle: 'idle',
};

/** The `mc-status-dot--*` modifier for a run state. */
export function runDot(state: string): string {
  return RUN_DOT_BY_TONE[runTone(state as RunState)];
}

/**
 * A run's state in the words an operator reads.
 *
 * The state-machine token is still the truth on the wire and still shown in the technical fold; this is
 * the label for the places where a person is scanning a list, and `waiting-human` is the one that most
 * needed translating — it is the state that means "you".
 */
export function runStateLabel(state: string): string {
  switch (state) {
    case 'running': return 'running';
    case 'recovering': return 'restarting';
    case 'waiting-human': return 'needs you';
    case 'succeeded': return 'finished';
    case 'failed': return 'failed';
    case 'stopped': return 'stopped';
    case 'stopping': return 'stopping';
    case 'interrupted': return 'interrupted';
    case 'planned': return 'not started yet';
    case 'archived': return 'archived';
    default: return state;
  }
}

/** Coarse age label ("4m ago") for run rows. `now` is injectable so tests stay deterministic. */
export function relativeAge(iso: string, now: number = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 'unknown';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
