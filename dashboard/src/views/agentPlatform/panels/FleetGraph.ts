/**
 * Fleet graph — the PURE projection behind the `fleet-graph` panel (Wave-1 U14).
 *
 * ONE NODE PER FLEET AGENT, and only edges the data actually proves:
 *
 *  - COORDINATION edges come from the card DAG (`GET /api/dag`), collapsed from card level to agent
 *    level by each card's `owner`. A card-dependency between two cards owned by two different agents
 *    is the only machine-readable evidence the fleet has that two agents' work is coupled. It is NOT
 *    evidence that one agent dispatched the other, so nothing here is ever labelled "dispatched".
 *    Cards with no owner are skipped (an unowned card names no agent), and a pair that collapses onto
 *    itself is dropped — an agent depending on its own earlier card is not a fleet relationship.
 *    (Same self-skip rule as `WorkflowAgentGraph.agentEdges`.)
 *  - BUILDS-ON edges come from each agent declaration's `buildsOn` list. A predecessor that is itself
 *    a roster id becomes a real, drawable edge; a predecessor that is NOT in the roster is EXCLUDED
 *    from the edge list and returned separately, because reactflow silently drops an edge whose
 *    endpoint node is missing — a lie that looks like a rendering bug. The panel prints those as
 *    plain text instead. No ghost node is ever fabricated to receive an edge, mirroring
 *    `server/dag/graph.ts`'s "never a dangling edge" rule.
 *
 * `whatItReplaces` is deliberately NOT an edge: it is prose from the declaration, not an id, so it is
 * display-only in the inspect pane.
 *
 * This module holds no reactflow and no React, so every rule above is tested as data.
 */
import type { AgentRosterEntry } from '../../../../server/agents/roster';
import type { Dag } from '../../../../server/dag/graph';
// U12: the effective-model rule and the two-vocabulary role fold are facts about the roster's fields,
// not canvas concerns — they moved to one shared module so no second surface can restate them wrongly.
import { effectiveModelOf, normalizeRole } from '../../../lib/agentPresentation';

/** One agent on the fleet canvas. */
export interface FleetNode {
  /** Canvas node id — `agent:<agentId>`, so an agent id can never collide with anything else drawn. */
  id: string;
  agentId: string;
  role: string | null;
  working: boolean;
  declared: boolean;
  runnerBound: boolean;
  displayName: string;
  /** EFFECTIVE model from the roster's routing resolution — never `declaredModel`, which can re-surface
   *  a string the resolver already refused (established by U4's review). Null when nothing resolved. */
  model: string | null;
}

/** One drawable relationship between two fleet agents. */
export interface FleetEdge {
  id: string;
  /** Canvas node id (`agent:<agentId>`). */
  source: string;
  /** Canvas node id (`agent:<agentId>`). */
  target: string;
  kind: 'coordination' | 'declared-buildsOn';
  /** Both endpoints are real fleet members. Only `true` edges are ever handed to the canvas. */
  resolved: boolean;
}

/** A declared `buildsOn` predecessor that is not a fleet member — printed as text, never drawn. */
interface UnresolvedBuildsOn {
  /** The agent whose declaration names the predecessor. */
  agentId: string;
  /** The predecessor id exactly as declared. */
  predecessor: string;
}

/** An agent's canvas node id. Namespaced so no other canvas object can collide with it. */
export function fleetNodeId(agentId: string): string {
  return `agent:${agentId}`;
}

/** One node per roster entry, in roster order (the server already sorts working-first, then by id). */
export function fleetNodes(roster: readonly AgentRosterEntry[] | null | undefined): FleetNode[] {
  if (!Array.isArray(roster)) return [];
  return roster
    .filter((entry) => typeof entry?.id === 'string' && entry.id !== '')
    .map((entry) => ({
      id: fleetNodeId(entry.id),
      agentId: entry.id,
      role: entry.role ?? null,
      working: entry.working === true,
      declared: entry.declared === true,
      runnerBound: entry.runnerBound === true,
      displayName: entry.displayName || entry.id,
      model: effectiveModelOf(entry),
    }));
}

/**
 * Card dependencies collapsed to the agent level: one deduped edge per distinct (fromOwner, toOwner).
 *
 * Orientation is the DAG's own — from the dependency's owner to the dependent's owner, i.e. the arrow
 * points at the agent that is waiting. Null/absent owners are skipped and self-pairs are dropped.
 */
export function coordinationEdges(dag: Pick<Dag, 'nodes' | 'edges'> | null | undefined): FleetEdge[] {
  const nodes = Array.isArray(dag?.nodes) ? dag.nodes : [];
  const dagEdges = Array.isArray(dag?.edges) ? dag.edges : [];
  const ownerOf = new Map<string, string>();
  for (const node of nodes) {
    const owner = node?.data?.owner;
    if (typeof owner === 'string' && owner !== '') ownerOf.set(node.id, owner);
  }

  const edges: FleetEdge[] = [];
  const seen = new Set<string>();
  for (const edge of dagEdges) {
    const from = ownerOf.get(edge?.source ?? '');
    const to = ownerOf.get(edge?.target ?? '');
    if (!from || !to || from === to) continue;
    const key = `${from}~${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: `fleet-coord:${key}`,
      source: fleetNodeId(from),
      target: fleetNodeId(to),
      kind: 'coordination',
      resolved: true,
    });
  }
  return edges;
}

/**
 * Declared lineage. `edges` holds only predecessors that are themselves fleet members; everything else
 * lands in `unresolved` for the panel's plain-text list. The edge runs from the agent to the
 * predecessor it builds on, so it reads source-to-target as "<source> builds on <target>".
 */
export function buildsOnEdges(roster: readonly AgentRosterEntry[] | null | undefined): {
  edges: FleetEdge[];
  unresolved: UnresolvedBuildsOn[];
} {
  if (!Array.isArray(roster)) return { edges: [], unresolved: [] };
  const members = new Set(roster.map((entry) => entry?.id).filter((id): id is string => typeof id === 'string' && id !== ''));
  const edges: FleetEdge[] = [];
  const unresolved: UnresolvedBuildsOn[] = [];
  const seen = new Set<string>();

  for (const entry of roster) {
    const agentId = entry?.id;
    if (typeof agentId !== 'string' || agentId === '') continue;
    for (const raw of entry.buildsOn ?? []) {
      const predecessor = typeof raw === 'string' ? raw.trim() : '';
      if (predecessor === '' || predecessor === agentId) continue;
      const key = `${agentId}~${predecessor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!members.has(predecessor)) {
        unresolved.push({ agentId, predecessor });
        continue;
      }
      edges.push({
        id: `fleet-builds:${key}`,
        source: fleetNodeId(agentId),
        target: fleetNodeId(predecessor),
        kind: 'declared-buildsOn',
        resolved: true,
      });
    }
  }
  return { edges, unresolved };
}

/** The role's class on a node chip. Total: an unknown or absent role is named, never blank. */
export function roleColorClass(role: string | null | undefined): string {
  const canonical = normalizeRole(role);
  return canonical ? `fg-role--${canonical}` : 'fg-role--unknown';
}

/**
 * The last guard before the canvas: an edge whose endpoint is not a drawn node is dropped rather than
 * handed to reactflow, which would swallow it silently.
 */
export function keepDrawableEdges(edges: readonly FleetEdge[], nodes: readonly FleetNode[]): FleetEdge[] {
  const drawn = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => drawn.has(edge.source) && drawn.has(edge.target));
}

/* ---- Layout. Fleet-local constants; the workflow graph's numbers are sized for tall step cards and
 *      are deliberately not imported here. Pixels, because that is what reactflow measures. ---- */
export const FLEET_NODE_WIDTH = 232;
export const FLEET_NODE_HEIGHT = 92;
export const FLEET_NODE_GAP_X = 48;
export const FLEET_NODE_GAP_Y = 44;
/** Three columns keeps a ten-to-twenty agent fleet inside roughly one canvas width, so `fitView`
 *  frames it near 1:1 instead of zooming the labels into illegibility. */
export const FLEET_GRID_COLUMNS = 3;
/** Frame the WHOLE fleet; `maxZoom: 1` stops a two-agent fleet ballooning. */
export const FLEET_FIT_VIEW = { padding: 0.1, maxZoom: 1, minZoom: 0.25 };

/** A stable grid, in roster order — reading order, wrapping every {@link FLEET_GRID_COLUMNS}. */
export function fleetNodePositions(nodes: readonly FleetNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const column = index % FLEET_GRID_COLUMNS;
    const row = Math.floor(index / FLEET_GRID_COLUMNS);
    positions.set(node.id, {
      x: column * (FLEET_NODE_WIDTH + FLEET_NODE_GAP_X),
      y: row * (FLEET_NODE_HEIGHT + FLEET_NODE_GAP_Y),
    });
  });
  return positions;
}
