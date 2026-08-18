/**
 * U6 — the RUN ENVELOPE: a JSON-serializable, payload-free skeleton of one run's tool steps.
 *
 * DISTINCT FROM `render.ts` (the Flight Recorder). `render.ts` produces a self-contained HTML
 * permalink that is COMMITTED and pushed to `origin ops`; this module produces an in-memory DTO for a
 * read-only API/panel and writes nothing, ever. Both share the same elision posture, for the same
 * reason: tool INPUTS and RESULTS carry the query, the path, the command line, the mail body. The
 * envelope therefore carries turn structure only — step order, tool NAMES, model, whether a result
 * arrived and whether it was an error, usage, and timing. No payload byte leaves this module.
 *
 * PARSING IS REUSED, NOT REIMPLEMENTED — exactly as `render.ts` does it:
 *   - `tailFrom`        (byte-offset streaming tail — huge-line safe, skips non-timeline records)
 *   - `joinToolResults` (tool_result → tool_use join by tool_use_id, carrying model/usage)
 * The only thing computed here is TIMING: `JoinedToolUse` has no timestamps, so the record-level
 * `timestamp` field is indexed per tool_use id (assistant record) and per tool_use_id (user record).
 *
 * Pure read: `tailFrom` opens the session file read-only and nothing else touches the filesystem.
 */

import { basename } from 'node:path';
import { tailFrom } from '../planeB/tailer.ts';
import type { TranscriptRecord } from '../planeB/tailer.ts';
import { joinToolResults } from '../planeB/join.ts';

/**
 * Token counts, PROJECTED — never a wholesale copy of `message.usage`.
 *
 * The raw usage object is provider-shaped and grows: it already carries `service_tier`, `speed`,
 * `inference_geo`, a nested `iterations[]` array, `server_tool_use` counters. Copying it through means
 * every future field a provider adds ships to the client sight-unseen, which is exactly the
 * copy-the-blob posture the payload elision exists to refuse. Each field below is named on purpose and
 * kept only if it is a NUMBER; anything else (including a new field) is dropped until someone adds it
 * here deliberately.
 */
export interface StepUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** The numeric usage fields carried through, in report order. */
const USAGE_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
] as const satisfies ReadonlyArray<keyof StepUsage>;

/** Project the allowlisted numeric counters out of a raw `message.usage`; null when none survive. */
function projectUsage(raw: unknown): StepUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const usage: StepUsage = {};
  let any = false;
  for (const field of USAGE_FIELDS) {
    const value = source[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      usage[field] = value;
      any = true;
    }
  }
  return any ? usage : null;
}

/**
 * One tool step, payload-elided. A light DTO off `JoinedToolUse`: `input` and `result.content` are
 * NOT carried over — not truncated, not summarized, omitted entirely.
 */
export interface EnvelopeStep {
  /** `tool_use.id` — stable within the session; the step-check result key. */
  id: string;
  /** 0-based position in tool-call order. */
  index: number;
  /** Tool name (`Read`, `Bash`, …). Structure, not payload — always kept. */
  name: string;
  /** Model of the assistant message that emitted this tool_use, or null. */
  model: string | null;
  /** Whether a matching `tool_result` arrived. */
  hasResult: boolean;
  /** TRI-STATE: `true`/`false` when the result declared `is_error`, `undefined` when it did not
   *  (and when no result arrived at all). "Absent" is deliberately not folded into "false". */
  isError: boolean | undefined;
  /** Token counts of the emitting assistant message, PROJECTED FIELD BY FIELD (see {@link StepUsage});
   *  null when the message carried no usage at all. */
  usage: StepUsage | null;
  /** ISO timestamp of the assistant record that emitted the tool_use, or null. */
  startedAt: string | null;
  /** ISO timestamp of the user record carrying the tool_result, or null. */
  endedAt: string | null;
  /** `endedAt - startedAt` in ms; null unless BOTH timestamps are present and parseable. */
  durationMs: number | null;
}

/** A whole run, as steps. JSON-serializable by construction (no Dates, no Maps, no payloads). */
export interface RunEnvelope {
  sessionId: string;
  stepCount: number;
  steps: EnvelopeStep[];
}

function recordTimestamp(rec: TranscriptRecord): string | null {
  const ts = (rec as { timestamp?: unknown }).timestamp;
  return typeof ts === 'string' ? ts : null;
}

function contentBlocks(rec: TranscriptRecord): Array<Record<string, unknown>> {
  const content = rec.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null);
}

/**
 * Index record-level timestamps by tool_use id: `starts` from the assistant record that emitted the
 * `tool_use`, `ends` from the user record that carried the matching `tool_result`.
 */
function indexTimestamps(records: TranscriptRecord[]): { starts: Map<string, string>; ends: Map<string, string> } {
  const starts = new Map<string, string>();
  const ends = new Map<string, string>();
  for (const rec of records) {
    const ts = recordTimestamp(rec);
    if (ts === null) continue;
    if (rec.type === 'assistant') {
      for (const block of contentBlocks(rec)) {
        if (block.type === 'tool_use' && typeof block.id === 'string' && !starts.has(block.id)) {
          starts.set(block.id, ts);
        }
      }
    } else if (rec.type === 'user') {
      for (const block of contentBlocks(rec)) {
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && !ends.has(block.tool_use_id)) {
          ends.set(block.tool_use_id, ts);
        }
      }
    }
  }
  return { starts, ends };
}

function durationOf(startedAt: string | null, endedAt: string | null): number | null {
  if (startedAt === null || endedAt === null) return null;
  const a = Date.parse(startedAt);
  const b = Date.parse(endedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return b - a;
}

/** `…/<sessionId>.jsonl` → `<sessionId>`; any other shape falls back to the bare file name. */
function sessionIdFromPath(sessionPath: string): string {
  return basename(sessionPath).replace(/\.jsonl$/i, '');
}

/**
 * Read one session JSONL into its run envelope. Read-only and non-mutating: nothing is written, and
 * tool payloads are never copied out of the transcript.
 *
 * `sessionId` defaults to the file's base name (the Claude Code convention `<sessionId>.jsonl`).
 */
export async function readEnvelope(sessionPath: string, sessionId?: string): Promise<RunEnvelope> {
  const { records } = await tailFrom(sessionPath, 0);
  const joined = joinToolResults(records);
  const { starts, ends } = indexTimestamps(records);

  const steps: EnvelopeStep[] = joined.map((tu, index) => {
    const startedAt = starts.get(tu.id) ?? null;
    const endedAt = tu.result ? ends.get(tu.id) ?? null : null;
    return {
      id: tu.id,
      index,
      name: tu.name,
      model: tu.model,
      hasResult: tu.result !== null,
      // `is_error` is already tri-state on the joined result (`undefined` when the block omitted it).
      isError: tu.result ? tu.result.is_error : undefined,
      usage: projectUsage(tu.usage),
      startedAt,
      endedAt,
      durationMs: durationOf(startedAt, endedAt),
    };
  });

  return { sessionId: sessionId ?? sessionIdFromPath(sessionPath), stepCount: steps.length, steps };
}
