/**
 * arc-3 — the navigation stack.
 *
 * The shell has deliberately never had a router (see the header of `src/App.tsx`): the destination set
 * is fixed and long-lived overlays (Terminal's xterm instances, Composer workspaces) are mounted
 * OUTSIDE the body switch and must survive navigation. A router that owns mount/unmount fights that
 * directly, so it would cost a full migration for partial ownership.
 *
 * What arc-3 actually needs is drill-in + back, which `App.tsx` already had a single-purpose version of
 * (`openCardId` + `goTo('tasks')` + `taskSelectedId`). This module generalizes that precedent into one
 * typed stack of ~40 lines with zero dependencies.
 *
 * The three operations are deliberately asymmetric:
 *   - `goTo` RESETS to a single root entry. A sidebar click is a fresh start, never accumulated
 *     history — that preserves today's mental model exactly (no back arrow appears from browsing the
 *     sidebar).
 *   - `push` drills in; back becomes available.
 *   - `back` pops one and is a no-op at the root.
 *
 * `NavTarget` doubles as the URL schema if shareable deep links ever become a real requirement, so
 * migrating to a router later is mechanical rather than a rewrite.
 */
import type { DestinationId } from './config';

/** The entity a pushed entry is focused on. `card` reuses the pre-existing Tasks detail-pane payload. */
export type Focus =
  | { kind: 'run'; id: string }
  | { kind: 'workflow'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'card'; id: string };

export interface NavTarget {
  view: DestinationId;
  focus?: Focus;
  /** The detail section (tab) to restore. Written back into the top entry as the operator switches tabs. */
  section?: string;
}

export type NavEntry = NavTarget;

/** Depth cap. Drilling deeper drops from the BOTTOM so the operator never loses their current context. */
export const MAX_NAV_DEPTH = 8;

export const rootStack = (view: DestinationId): NavEntry[] => [{ view }];

/** True when two entries address the same thing — used to swallow double-click duplicates. */
export function sameTarget(a: NavEntry | undefined, b: NavTarget): boolean {
  if (!a) return false;
  return a.view === b.view && a.focus?.kind === b.focus?.kind && a.focus?.id === b.focus?.id;
}

/** A sidebar click: reset to a fresh root. No back arrow, no accumulated history. */
export function goToStack(view: DestinationId): NavEntry[] {
  return rootStack(view);
}

/** Drill in. Identical-to-top pushes are swallowed; depth is capped from the bottom. */
export function pushStack(stack: NavEntry[], target: NavTarget): NavEntry[] {
  if (sameTarget(stack[stack.length - 1], target)) return stack;
  const next = [...stack, target];
  return next.length > MAX_NAV_DEPTH ? next.slice(next.length - MAX_NAV_DEPTH) : next;
}

/** Pop one entry. At the root this is a no-op (the caller hides the affordance). */
export function backStack(stack: NavEntry[]): NavEntry[] {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

/** Rewrite the top entry's active section so `back()` then forward restores the operator's tab. */
export function setSectionOnStack(stack: NavEntry[], section: string): NavEntry[] {
  const top = stack[stack.length - 1];
  if (!top || top.section === section) return stack;
  return [...stack.slice(0, -1), { ...top, section }];
}

/** The entry the back button would return to, or undefined at the root. */
export function parentEntry(stack: NavEntry[]): NavEntry | undefined {
  return stack.length > 1 ? stack[stack.length - 2] : undefined;
}
