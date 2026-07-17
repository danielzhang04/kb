/**
 * Timeline view model (D0.7). `foldRecords` is the single PURE fold shared by the live tail
 * (`server/timeline/stream.ts`) and static replay — the same records always produce the same model,
 * so a live session and a replayed transcript render through one code path.
 *
 * It consumes the existing Plane-B modules rather than reimplementing them: tool_result → tool_use
 * attachment is delegated to `joinToolResults` (D0.3); the raw records are those emitted by the
 * `tailFrom` tailer (D0.3). Subagent nesting is delivered as `SubagentInput[]` (assembled from the
 * flat `buildSubagentTree` layout by the stream layer) and folded through this same function.
 *
 * The surface is message-granular (thinking → tool_use → tool_result, per-turn usage): there is NO
 * intra-turn token claim here — that arrives only with the v2 Broker.
 */
import { joinToolResults } from '../../server/planeB/join.ts';
import type { TranscriptRecord } from '../../server/planeB/tailer.ts';

/** Per-turn token usage, read from `message.usage` (message-granular, not intra-turn). */
export interface TurnUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  /** Sum of the four token dimensions that are present (null contributes 0); null if none present. */
  totalTokens: number | null;
}

/** A joined `tool_result`, attached to its originating `tool_use` step. */
export interface StepToolResult {
  toolUseId: string;
  isError: boolean;
  content: unknown;
}

/** A folded subagent: its own turns, nested under the spawning `Task` step. */
export interface SubagentView {
  agentType: string | null;
  description: string | null;
  spawnDepth: number | null;
  model: string | null;
  turns: Turn[];
}

/** One step within a turn: a thinking block, a text block, or a tool_use (with its result/subagent). */
export interface TimelineStep {
  kind: 'thinking' | 'text' | 'tool_use';
  /** thinking/text payload. */
  text?: string;
  /** tool_use fields. */
  toolUseId?: string;
  name?: string;
  input?: unknown;
  /** The joined `tool_result` for this tool_use, or null if none / not a tool_use. */
  result?: StepToolResult | null;
  /** For a `Task` tool_use: the nested subagent folded from its own transcript. */
  subagent?: SubagentView | null;
}

/** One assistant turn: its steps plus the model/usage/timestamp of the assistant message that produced it. */
export interface Turn {
  index: number;
  model: string | null;
  /** The transcript record's ISO-8601 `timestamp`, or null when the record carries none. */
  timestamp: string | null;
  usage: TurnUsage | null;
  steps: TimelineStep[];
}

/** The subagent transcript fed to the fold, keyed to its spawning Task by `meta.toolUseId`. */
export interface SubagentInput {
  meta: {
    agentType: string | null;
    description: string | null;
    toolUseId: string | null;
    spawnDepth: number | null;
    model: string | null;
  };
  records: TranscriptRecord[];
}

export interface TimelineModel {
  turns: Turn[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function parseUsage(raw: unknown): TurnUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const inputTokens = num(o.input_tokens);
  const outputTokens = num(o.output_tokens);
  const cacheCreationInputTokens = num(o.cache_creation_input_tokens);
  const cacheReadInputTokens = num(o.cache_read_input_tokens);
  const dims = [inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens];
  const anyPresent = dims.some((d) => d !== null);
  const totalTokens = anyPresent ? dims.reduce((sum: number, d) => sum + (d ?? 0), 0) : null;
  return { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, totalTokens };
}

function contentBlocks(record: TranscriptRecord): Array<Record<string, unknown>> {
  const content = record.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null);
}

/** Build the assistant turns from records, attaching tool_results via the D0.3 join. */
function buildTurns(records: TranscriptRecord[]): Turn[] {
  // Reuse joinToolResults (D0.3) for the tool_result → tool_use.id attachment — do not reimplement it.
  const resultByUseId = new Map<string, StepToolResult>();
  for (const j of joinToolResults(records)) {
    if (j.result) {
      resultByUseId.set(j.id, {
        toolUseId: j.result.tool_use_id,
        isError: j.result.is_error === true,
        content: j.result.content,
      });
    }
  }

  const turns: Turn[] = [];
  for (const record of records) {
    if (record.type !== 'assistant') continue;
    const steps: TimelineStep[] = [];
    for (const block of contentBlocks(record)) {
      if (block.type === 'thinking') {
        steps.push({ kind: 'thinking', text: typeof block.thinking === 'string' ? block.thinking : '' });
      } else if (block.type === 'text') {
        steps.push({ kind: 'text', text: typeof block.text === 'string' ? block.text : '' });
      } else if (block.type === 'tool_use') {
        const id = typeof block.id === 'string' ? block.id : '';
        steps.push({
          kind: 'tool_use',
          toolUseId: id,
          name: typeof block.name === 'string' ? block.name : '',
          input: block.input ?? null,
          result: resultByUseId.get(id) ?? null,
          subagent: null,
        });
      }
    }
    turns.push({
      index: turns.length,
      model: typeof record.message?.model === 'string' ? record.message.model : null,
      // The transcript timestamp is a top-level record field (ISO-8601); absent in synthetic records.
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : null,
      usage: parseUsage(record.message?.usage),
      steps,
    });
  }
  return turns;
}

/** Collect every tool_use step across a turn list into a `toolUseId → step` index. */
function indexToolUseSteps(turns: Turn[], into: Map<string, TimelineStep>): void {
  for (const turn of turns) {
    for (const step of turn.steps) {
      if (step.kind === 'tool_use' && step.toolUseId) into.set(step.toolUseId, step);
    }
  }
}

/**
 * Fold raw transcript records into ordered turns, attaching each `tool_result` to its `tool_use`
 * step and nesting each subagent's turns under the `Task` tool_use that spawned it (matched by
 * `meta.toolUseId`). Pure and deterministic — identical input yields an identical model, which is the
 * live-tail ↔ replay invariant.
 */
export function foldRecords(records: TranscriptRecord[], subagents: SubagentInput[] = []): TimelineModel {
  const turns = buildTurns(records);

  if (subagents.length > 0) {
    // Fold each subagent's own transcript (one level per input; nested subagents attach via the
    // shared step index below, so a child's Task step inside a parent subagent is reachable).
    const views = subagents.map((sub) => ({
      input: sub,
      view: {
        agentType: sub.meta.agentType,
        description: sub.meta.description,
        spawnDepth: sub.meta.spawnDepth,
        model: sub.meta.model,
        turns: buildTurns(sub.records),
      } satisfies SubagentView,
    }));

    // Index every tool_use step — the parent turns AND each subagent's turns — so nesting works
    // regardless of spawn order or depth.
    const stepByUseId = new Map<string, TimelineStep>();
    indexToolUseSteps(turns, stepByUseId);
    for (const { view } of views) indexToolUseSteps(view.turns, stepByUseId);

    for (const { input, view } of views) {
      const parentStep = input.meta.toolUseId ? stepByUseId.get(input.meta.toolUseId) : undefined;
      if (parentStep) parentStep.subagent = view;
    }
  }

  return { turns };
}
