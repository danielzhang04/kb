import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tailFrom } from './tailer.ts';
import { joinToolResults } from './join.ts';

/** A `.meta.json` sidecar for a spawned subagent. */
export interface SubagentMeta {
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
  spawnDepth: number | null;
  model: string | null;
}

/** A node in the subagent spawn tree. The synthetic root has `id === 'root'`. */
export interface SubagentNode extends SubagentMeta {
  /** Hex id from `agent-<hex>.jsonl` (or `'root'` for the session root). */
  id: string;
  children: SubagentNode[];
}

const AGENT_META_RE = /^agent-([0-9a-f]+)\.meta\.json$/i;

function metaFromJson(raw: unknown): SubagentMeta {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    agentType: typeof o.agentType === 'string' ? o.agentType : null,
    description: typeof o.description === 'string' ? o.description : null,
    toolUseId: typeof o.toolUseId === 'string' ? o.toolUseId : null,
    spawnDepth: typeof o.spawnDepth === 'number' ? o.spawnDepth : null,
    model: typeof o.model === 'string' ? o.model : null,
  };
}

/**
 * Collect the `tool_use` ids emitted within a single transcript file. Used to
 * decide which agent (or the root) OWNS the Task tool_use that spawned a given
 * subagent — `meta.toolUseId` equals the parent's Task tool_use id.
 */
async function collectToolUseIds(jsonlPath: string): Promise<Set<string>> {
  const { records } = await tailFrom(jsonlPath, 0);
  const ids = new Set<string>();
  for (const tu of joinToolResults(records)) ids.add(tu.id);
  return ids;
}

/**
 * Assemble the subagent spawn tree for a session directory by reading the FLAT
 * `subagents/agent-<hex>.jsonl` + sibling `agent-<hex>.meta.json` files (no
 * per-runId subdirectories). Each subagent is linked to its parent by matching
 * its `meta.toolUseId` against the Task tool_use ids owned by another agent's
 * transcript; subagents whose spawning tool_use is not owned by any sibling
 * agent hang directly off the synthetic `root` (spawned by the session itself).
 */
export async function buildSubagentTree(sessionDir: string): Promise<SubagentNode> {
  const root: SubagentNode = {
    id: 'root',
    agentType: null,
    description: null,
    toolUseId: null,
    spawnDepth: null,
    model: null,
    children: [],
  };

  const subagentsDir = join(sessionDir, 'subagents');
  let entries: string[];
  try {
    entries = await readdir(subagentsDir);
  } catch {
    return root; // no subagents/ dir → empty root
  }

  // Load every subagent's meta, keyed by its hex id.
  const nodes = new Map<string, SubagentNode>();
  for (const name of entries) {
    const m = AGENT_META_RE.exec(name);
    if (!m) continue;
    const hex = m[1];
    let meta: SubagentMeta;
    try {
      meta = metaFromJson(JSON.parse(await readFile(join(subagentsDir, name), 'utf8')));
    } catch {
      continue;
    }
    nodes.set(hex, { id: hex, ...meta, children: [] });
  }

  // Map each Task tool_use id → the hex id of the agent whose transcript owns it.
  const ownerOfToolUse = new Map<string, string>();
  for (const hex of nodes.keys()) {
    const jsonlPath = join(subagentsDir, `agent-${hex}.jsonl`);
    let ids: Set<string>;
    try {
      ids = await collectToolUseIds(jsonlPath);
    } catch {
      continue;
    }
    for (const id of ids) ownerOfToolUse.set(id, hex);
  }

  // Attach each subagent under its owning parent, or under root.
  for (const node of nodes.values()) {
    const ownerHex = node.toolUseId ? ownerOfToolUse.get(node.toolUseId) : undefined;
    const parent = ownerHex && ownerHex !== node.id ? nodes.get(ownerHex) : undefined;
    (parent ?? root).children.push(node);
  }

  return root;
}
