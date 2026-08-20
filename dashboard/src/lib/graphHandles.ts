/**
 * Shared reactflow edge-routing helpers (U12).
 *
 * ── Why this file exists ──
 * `WorkflowAgentGraph.tsx` and the fleet graph (`views/agentPlatform/panels/FleetGraph.ts`) each held
 * a verbatim copy of `nearestHandles` and `rememberNodePositions`, the second one added with a comment
 * saying it was replicated and had to be lifted. Two copies of a routing rule is exactly the shape of
 * bug where one graph gets a fix and the other silently keeps the old behaviour — and the behaviour in
 * question is invisible until you drag a node, which is when nobody is looking at the other graph.
 *
 * ── What `nearestHandles` is actually for ──
 * NOT cosmetic. Reactflow's `getHandle` falls back to `bounds[0]` when an edge names no handle id, and
 * a node exposing four handles per type gets the FIRST one for every edge — so every arrow in the
 * graph leaves and arrives at the top, crossing the nodes it is supposed to connect. Naming the facing
 * pair is what makes the arrows readable.
 *
 * Both functions are pure and reactflow-agnostic: they take plain `{x, y}` points and plain change
 * records, so they are testable with literals and carry no rendering dependency.
 */

/** A plain point. Structurally compatible with reactflow's `XYPosition`, without importing it. */
export interface GraphPoint {
  x: number;
  y: number;
}

/** The handle-id pair an edge should use: which side it leaves, and which side it arrives at. */
interface HandlePair {
  sourceHandle: string;
  targetHandle: string;
}

/**
 * Which side of each node an edge should leave from and arrive at, given where the two nodes sit.
 *
 * The dominant axis wins — a mostly-horizontal run uses left/right, a mostly-vertical one uses
 * top/bottom — and a tie (`|dx| === |dy|`) resolves to the horizontal pair, which keeps a perfect
 * diagonal from flickering between two equally valid routings as a node is dragged.
 *
 * With either position unknown (a node reactflow has not measured yet) the answer is the left-to-right
 * default rather than a guess: the graph's initial layout is a reading-order grid, so right→left is
 * the correct edge for the overwhelming majority of first frames.
 */
export function nearestHandles(source: GraphPoint | undefined, target: GraphPoint | undefined): HandlePair {
  if (!source || !target) return { sourceHandle: 'source-right', targetHandle: 'target-left' };
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: 'source-right', targetHandle: 'target-left' }
      : { sourceHandle: 'source-left', targetHandle: 'target-right' };
  }
  return dy >= 0
    ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
    : { sourceHandle: 'source-top', targetHandle: 'target-bottom' };
}

/**
 * The fields of a reactflow `NodeChange` this module reads. Kept structural so callers can pass
 * reactflow's own change array without a cast and without this file importing reactflow.
 *
 * `id` is OPTIONAL because reactflow's union is not uniform — an `add` change carries a whole node
 * and no top-level id. Requiring it here would reject the real array at every call site and push a
 * cast into both callers, which is precisely the type hole a shared helper should not create.
 */
interface NodeChangeLike {
  type: string;
  id?: string | undefined;
  position?: GraphPoint | undefined;
}

/**
 * Fold every POSITION change in a reactflow change batch into `positions`, in place.
 *
 * Mutates on purpose: the caller holds this map in a `useRef` precisely so a drag does not re-render
 * the graph on every mouse-move frame. Non-position changes (select, dimensions, remove) are ignored
 * — this map answers exactly one question, "where is each node right now", which is what
 * {@link nearestHandles} needs to re-route edges as they move.
 */
export function rememberNodePositions(changes: readonly NodeChangeLike[], positions: Map<string, GraphPoint>): void {
  for (const change of changes) {
    if (change.type !== 'position' || !change.position || change.id === undefined) continue;
    positions.set(change.id, change.position);
  }
}
