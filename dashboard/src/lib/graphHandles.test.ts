/**
 * `lib/graphHandles` (U12) — the one edge-routing rule shared by every reactflow graph in the app.
 *
 * These were two verbatim copies, one in `views/WorkflowAgentGraph.tsx` and one in the fleet graph,
 * with a comment on the second saying so. The behaviour is invisible until a node is dragged, which
 * is exactly when nobody is looking at the other graph — so a divergence between the copies would
 * have gone unnoticed indefinitely. Tested here once, for both.
 */
import { describe, expect, it } from 'vitest';
import { nearestHandles, rememberNodePositions, type GraphPoint } from './graphHandles';

const RIGHT_LEFT = { sourceHandle: 'source-right', targetHandle: 'target-left' };
const LEFT_RIGHT = { sourceHandle: 'source-left', targetHandle: 'target-right' };
const BOTTOM_TOP = { sourceHandle: 'source-bottom', targetHandle: 'target-top' };
const TOP_BOTTOM = { sourceHandle: 'source-top', targetHandle: 'target-bottom' };

describe('nearestHandles', () => {
  it('picks the facing sides, so no edge falls back to top→top', () => {
    expect(nearestHandles({ x: 0, y: 0 }, { x: 280, y: 0 })).toEqual(RIGHT_LEFT);
    expect(nearestHandles({ x: 280, y: 0 }, { x: 0, y: 0 })).toEqual(LEFT_RIGHT);
    expect(nearestHandles({ x: 0, y: 0 }, { x: 0, y: 200 })).toEqual(BOTTOM_TOP);
    expect(nearestHandles({ x: 0, y: 200 }, { x: 0, y: 0 })).toEqual(TOP_BOTTOM);
    expect(nearestHandles(undefined, undefined)).toEqual(RIGHT_LEFT);
  });

  it('routes on the DOMINANT axis, not on whichever delta is non-zero', () => {
    // Mostly horizontal with a real vertical component — still a side-to-side run.
    expect(nearestHandles({ x: 0, y: 0 }, { x: 300, y: 80 })).toEqual(RIGHT_LEFT);
    // …and the same pair of nodes, mostly vertical, goes top-to-bottom instead.
    expect(nearestHandles({ x: 0, y: 0 }, { x: 80, y: 300 })).toEqual(BOTTOM_TOP);
    expect(nearestHandles({ x: 0, y: 0 }, { x: -300, y: -80 })).toEqual(LEFT_RIGHT);
    expect(nearestHandles({ x: 0, y: 0 }, { x: -80, y: -300 })).toEqual(TOP_BOTTOM);
  });

  it('resolves an exact diagonal to the horizontal pair, so a drag cannot make it flicker', () => {
    // |dx| === |dy|: both routings are equally "correct", so the tie must break the SAME way every
    // time. A tie that resolved by comparison order would swap sides as a node crossed the diagonal.
    expect(nearestHandles({ x: 0, y: 0 }, { x: 100, y: 100 })).toEqual(RIGHT_LEFT);
    expect(nearestHandles({ x: 0, y: 0 }, { x: -100, y: 100 })).toEqual(LEFT_RIGHT);
  });

  it('falls back to left-to-right when EITHER endpoint has not been measured yet', () => {
    // The initial layout is a reading-order grid, so right→left is right for the first frame.
    expect(nearestHandles(undefined, { x: 10, y: 900 })).toEqual(RIGHT_LEFT);
    expect(nearestHandles({ x: 10, y: 900 }, undefined)).toEqual(RIGHT_LEFT);
  });

  it('is pure — it returns a fresh object and never touches its arguments', () => {
    const source: GraphPoint = { x: 0, y: 0 };
    const target: GraphPoint = { x: 10, y: 0 };
    const first = nearestHandles(source, target);
    const second = nearestHandles(source, target);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(source).toEqual({ x: 0, y: 0 });
    expect(target).toEqual({ x: 10, y: 0 });
  });
});

describe('rememberNodePositions', () => {
  it('folds position changes into the map, in place', () => {
    const positions = new Map<string, GraphPoint>();
    rememberNodePositions(
      [
        { type: 'position', id: 'a', position: { x: 1, y: 2 } },
        { type: 'position', id: 'b', position: { x: 3, y: 4 } },
      ],
      positions,
    );
    expect([...positions.entries()]).toEqual([
      ['a', { x: 1, y: 2 }],
      ['b', { x: 3, y: 4 }],
    ]);
  });

  it('keeps only the LATEST position for a node — a drag is a stream of changes for one id', () => {
    const positions = new Map<string, GraphPoint>();
    rememberNodePositions(
      [
        { type: 'position', id: 'a', position: { x: 1, y: 1 } },
        { type: 'position', id: 'a', position: { x: 2, y: 2 } },
        { type: 'position', id: 'a', position: { x: 9, y: 9 } },
      ],
      positions,
    );
    expect(positions.get('a')).toEqual({ x: 9, y: 9 });
    expect(positions.size).toBe(1);
  });

  it('ignores every non-position change, and a position change carrying no position', () => {
    const positions = new Map<string, GraphPoint>([['keep', { x: 5, y: 5 }]]);
    rememberNodePositions(
      [
        { type: 'select', id: 'keep' },
        { type: 'dimensions', id: 'keep' },
        { type: 'remove', id: 'keep' },
        // reactflow emits a position change with no position on drag START; writing `undefined`
        // through would erase a node's last known position mid-drag and snap its edges to the
        // unmeasured fallback.
        { type: 'position', id: 'keep' },
        // An `add` change carries a whole node and NO top-level id — it must not throw or write.
        { type: 'add', position: { x: 0, y: 0 } },
      ],
      positions,
    );
    expect(positions.get('keep')).toEqual({ x: 5, y: 5 });
    expect(positions.size).toBe(1);
  });

  it('is safe on an empty batch', () => {
    const positions = new Map<string, GraphPoint>();
    expect(() => rememberNodePositions([], positions)).not.toThrow();
    expect(positions.size).toBe(0);
  });
});
