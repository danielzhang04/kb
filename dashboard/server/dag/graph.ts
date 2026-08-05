/**
 * D3.4 — the pipeline DAG projection. A PURE, reactflow-agnostic function over the Plane-A index
 * ({@link ../planeA/indexer.ts}) that turns the card queue into a `{ nodes, edges }` graph:
 *
 *   - one NODE per card (across every queue bucket), carrying only the fields the canvas renders —
 *     id, action/target, a one-line summary, the STAMPED runtime/model (top-precedence routing input),
 *     owner/project/role, its `depends-on` ids and `variant-group`, and a `blocked` flag;
 *   - one EDGE per `depends-on` relation, drawn FROM the dependency TO the dependent, but only when the
 *     dependency is itself a node in the index (never a dangling edge).
 *
 * A node is `blocked` when ANY of its `depends-on` targets is not in a RELEASED state. Per
 * governance/card-schema.md the dispatcher releases a card "only when these are done", so `done` is the
 * sole released state; a dependency that is missing from the index is likewise treated as unreleased.
 *
 * SECURITY: this reads only frontmatter (already parsed to inert scalars by planeA/cards.ts). No card
 * body — `## Work order` / `## Evidence` / `## Result` — is consulted, so nothing here can be steered by
 * untrusted card content. Pure data out; this module holds no UI, no reactflow, no I/O.
 */
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { CardFieldValue, CardProjection } from '../planeA/cards.ts';

/** States that count as "released" for a `depends-on` edge. Schema: released ⇔ `done`. */
export const RELEASED_STATES: ReadonlySet<string> = new Set(['done']);

/** The data a single DAG node carries — everything the pipeline canvas node renders. */
export interface DagNodeData {
  id: string;
  /** Server-owned display identity for the card, carried straight through from the Plane-A index so
   *  the canvas never has to build a human label out of `id`. */
  displayName: string;
  shortRef: number;
  action: string;
  target: string;
  state: string;
  /** One-line human summary (action + target) shown under the node name. */
  summary: string;
  /** STAMPED runtime/model from card frontmatter (top-precedence routing input); null when unrouted. */
  runtime: string | null;
  model: string | null;
  owner: string | null;
  project: string;
  role: string | null;
  /** Workflow run instance id. Null for legacy/single cards not launched as a run. */
  workflow: string | null;
  dependsOn: string[];
  variantGroup: string | null;
  /** True when a depends-on target is not yet released (`done`) — or is absent from the index. */
  blocked: boolean;
}

export interface DagNode {
  id: string;
  data: DagNodeData;
}

export interface DagEdge {
  id: string;
  source: string;
  target: string;
}

export interface Dag {
  nodes: DagNode[];
  edges: DagEdge[];
}

/** Coerce a frontmatter field (scalar / list / null) into a string id list. */
function asList(v: CardFieldValue | undefined): string[] {
  if (Array.isArray(v)) return v.map(String).filter((s) => s !== '');
  if (v == null || v === '') return [];
  return [String(v)];
}

function str(v: CardFieldValue | undefined): string | null {
  return v == null || v === '' ? null : String(v);
}

/** A compact one-line summary: the action, plus a concrete target when it is not the repo-root sentinel. */
function summarize(action: string, target: string): string {
  const t = target && target !== '.' ? ` → ${target}` : '';
  return `${action || 'card'}${t}`;
}

/**
 * Build the pipeline DAG from the Plane-A index. Accepts anything carrying the `cards` projection (the
 * full {@link PlaneAIndex} or a test double). Nodes and edges are returned in a stable id order so the
 * canvas layout is deterministic across re-indexes.
 */
export function buildDag(index: Pick<PlaneAIndex, 'cards'>): Dag {
  const cards: CardProjection[] = Object.values(index.cards).flat();

  // First pass: authoritative state per card id, used to resolve depends-on release.
  const stateById = new Map<string, string>();
  for (const c of cards) stateById.set(String(c.meta.id), String(c.meta.state));

  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];
  const seenEdge = new Set<string>();

  for (const c of cards) {
    const id = String(c.meta.id);
    const dependsOn = asList(c.meta['depends-on']);
    // Blocked ⇔ some dependency is not released. An absent dependency (undefined state) is unreleased.
    const blocked = dependsOn.some((dep) => !RELEASED_STATES.has(stateById.get(dep) ?? ''));
    const action = c.meta.action != null ? String(c.meta.action) : '';
    const target = c.meta.target != null ? String(c.meta.target) : '';

    nodes.push({
      id,
      data: {
        id,
        displayName: c.displayName,
        shortRef: c.shortRef,
        action,
        target,
        state: String(c.meta.state),
        summary: summarize(action, target),
        runtime: str(c.meta.runtime),
        model: str(c.meta.model),
        owner: str(c.meta.owner),
        project: Array.isArray(c.meta.project) ? c.meta.project.join(', ') : String(c.meta.project ?? ''),
        role: str(c.meta.role),
        workflow: str(c.meta.workflow),
        dependsOn,
        variantGroup: str(c.meta['variant-group']),
        blocked,
      },
    });

    for (const dep of dependsOn) {
      if (!stateById.has(dep)) continue; // never draw an edge to a node that is not in the graph
      const eid = `${dep}->${id}`;
      if (seenEdge.has(eid)) continue;
      seenEdge.add(eid);
      edges.push({ id: eid, source: dep, target: id });
    }
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, edges };
}
