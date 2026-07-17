/**
 * Live spectator timeline stream (D0.7). Wraps the D0.3 byte-offset tailer + join and the D0.7 pure
 * fold into a live feed: seek from the last byte offset, fold the new records, and push a
 * message-granular delta onto the hub bus. The SAME `foldRecords` powers static replay, so a live
 * session and a replayed transcript render through one code path.
 *
 * Consumes the existing Plane-B modules — `tailFrom` (D0.3 tailer) and `buildSubagentTree` (D0.3 flat
 * subagent layout) — and the hub bus `publishTailDelta` (D0.4). Nothing here is reimplemented.
 */
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { tailFrom } from '../planeB/tailer.ts';
import type { TranscriptRecord } from '../planeB/tailer.ts';
import { buildSubagentTree } from '../planeB/subagents.ts';
import type { SubagentNode } from '../planeB/subagents.ts';
import { foldRecords } from '../../src/lib/timelineModel.ts';
import type { SubagentInput, TimelineModel } from '../../src/lib/timelineModel.ts';
import { publishTailDelta } from '../hub/bus.ts';
import type { EventBus } from '../hub/bus.ts';

export interface StreamResult {
  /** The new records tailed on this pass (post-skip, post-offset). */
  records: TranscriptRecord[];
  /** The folded timeline model for these records (subagents nested when present). */
  model: TimelineModel;
  /** Resume offset for the next `streamSession` pass. */
  nextOffset: number;
}

/** Flatten a subagent tree (excluding the synthetic root) into a node list. */
function flattenSubagents(node: SubagentNode, out: SubagentNode[]): void {
  for (const child of node.children) {
    out.push(child);
    flattenSubagents(child, out);
  }
}

/**
 * Assemble `SubagentInput[]` from the flat `subagents/` layout using `buildSubagentTree` (D0.3):
 * one input per spawned agent, its `meta.toolUseId` linking it to the Task step that spawned it.
 * Absent/empty `subagents/` yields an empty list.
 */
async function collectSubagentInputs(sessionDir: string): Promise<SubagentInput[]> {
  const root = await buildSubagentTree(sessionDir);
  const nodes: SubagentNode[] = [];
  flattenSubagents(root, nodes);

  const inputs: SubagentInput[] = [];
  for (const node of nodes) {
    let records: TranscriptRecord[] = [];
    try {
      const jsonlPath = join(sessionDir, 'subagents', `agent-${node.id}.jsonl`);
      // Touch to fail fast if the transcript is missing, then tail it from the head.
      await readFile(jsonlPath, { encoding: 'utf8', flag: 'r' }).catch(() => undefined);
      records = (await tailFrom(jsonlPath, 0)).records;
    } catch {
      records = [];
    }
    inputs.push({
      meta: {
        agentType: node.agentType,
        description: node.description,
        toolUseId: node.toolUseId,
        spawnDepth: node.spawnDepth,
        model: node.model,
      },
      records,
    });
  }
  return inputs;
}

/**
 * Tail `sessionPath` from `fromOffset`, fold the new records into a timeline model (nesting any
 * subagents discovered in the sibling `subagents/` dir), publish a message-granular delta onto the
 * bus, and return the delta + folded model + resume offset.
 */
export async function streamSession(
  sessionPath: string,
  fromOffset: number,
  bus?: EventBus,
): Promise<StreamResult> {
  const { records, nextOffset } = await tailFrom(sessionPath, fromOffset);
  const subagents = await collectSubagentInputs(dirname(sessionPath));
  const model = foldRecords(records, subagents);
  if (bus) {
    publishTailDelta(bus, { sessionPath, records, nextOffset });
  }
  return { records, model, nextOffset };
}
