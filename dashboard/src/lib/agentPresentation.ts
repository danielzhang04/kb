/**
 * How the client TALKS ABOUT an agent (U12) — the two facts every agent surface has to get right, in
 * one place instead of one copy per panel.
 *
 * Both rules below were established by review and then written down twice: the effective-model rule
 * as `AgentManagement.panel.tsx#modelOf` and again inline in `FleetGraph.ts`, the role vocabulary as
 * a panel-local table inside the fleet-graph module. Neither is a rendering concern — they are facts
 * about what the roster's fields MEAN — so a second copy is a second chance to get them wrong, in a
 * surface nobody is looking at while they fix the first one.
 *
 * NO IMPORT OF THE SERVER ROSTER TYPE, deliberately. The parameter below is STRUCTURAL — it names the
 * one field it reads — so this module has no edge of any kind into `server/agents/roster.ts` (which
 * reaches `node:fs`), and it accepts a real `AgentRosterEntry` as well as any partially-loaded row a
 * caller happens to hold. `agentPresentation.test.ts` pins the assignability so the structural type
 * cannot drift away from the wire shape unnoticed.
 */

/**
 * The model an agent will actually run on: the RESOLVED routing, and only that.
 *
 * Deliberately does NOT fall back to `declaredModel`. `effectiveForAgent` already resolves
 * declaration-first, and in the one case where the two disagree — a declaration naming a model its
 * runtime refuses — the server drops the unusable pair on purpose and answers with the policy model.
 * Re-surfacing the refused string would print a model the fleet will never run under a label claiming
 * it is what the agent runs on: a wrong answer that looks more informative than the right one.
 *
 * Null when nothing resolved. Null is an honest answer; a guess is not.
 */
export function effectiveModelOf(
  agent: { effective?: { model?: string | null } | null } | null | undefined,
): string | null {
  return agent?.effective?.model ?? null;
}

/**
 * The canonical role classes. A roster entry's `role` arrives in EITHER of two live vocabularies and
 * both must land on the same class, or half the fleet renders as "unknown" while its chip reads
 * "worker":
 *   - a DECLARED agent carries its own `agents/<id>.md` frontmatter role — `manage`/`work`/`inspect`/
 *     `scout`/`consolidate`;
 *   - an UNDECLARED agent gets `roleFor()`, which returns a `routines/roles/` FILENAME —
 *     `manager`/`worker`/`inspector`/`scout`.
 *
 * The pairing below mirrors `server/agents/roster.ts#executionAssignmentRole`, which normalizes the
 * same two vocabularies at the execution boundary. PRESENTATION MIRROR ONLY — that function stays the
 * authority for eligibility, and nothing here may be used to decide what an agent is allowed to do.
 */
export const FLEET_ROLES = ['manage', 'work', 'inspect', 'scout', 'consolidate'] as const;

export type FleetRole = (typeof FLEET_ROLES)[number];

/** Both live vocabularies, folded onto {@link FLEET_ROLES}. */
const ROLE_ALIASES: Readonly<Record<string, FleetRole>> = {
  manage: 'manage',
  manager: 'manage',
  work: 'work',
  worker: 'work',
  inspect: 'inspect',
  inspector: 'inspect',
  scout: 'scout',
  consolidate: 'consolidate',
  consolidator: 'consolidate',
};

/** The canonical role for a value in either vocabulary, or null when the role is unrecognised. */
export function normalizeRole(role: string | null | undefined): FleetRole | null {
  const key = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return ROLE_ALIASES[key] ?? null;
}
