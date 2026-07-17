/**
 * R2.2 — the Agents-view roster, server side. One row per known agent id (derived from card ownership,
 * the only place agent identity surfaces in the read API), each annotated with its EFFECTIVE runtime +
 * model + per-field provenance from the R2.1 projection (`effectiveForAgent`). Read-only, pure.
 */
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { ParsedCard } from '../planeA/cards.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';
import { effectiveForAgent } from '../routing/effective.ts';
import type { Effective } from '../routing/effective.ts';

export interface AgentRosterRow {
  id: string;
  working: boolean;
  /** The card the agent is actively working, if any. */
  current: { action: string; id: string } | null;
  projects: string[];
  cardCount: number;
  /** Effective routing for this agent (agent-scope override -> policy role_default -> safe default). */
  effective: Effective;
}

/** Normalise a card's `project` field (string | string[]) into a flat list. */
function projectsOf(card: ParsedCard): string[] {
  const p = card.meta.project;
  if (Array.isArray(p)) return p.filter((x): x is string => typeof x === 'string' && x !== '');
  return typeof p === 'string' && p !== '' ? [p] : [];
}

/**
 * Build the roster from the Plane-A snapshot: group every card by its non-null owner, then annotate
 * each agent with status/current-card/projects/count and its effective routing. Sorted working-first,
 * then id-alphabetical (same ordering as the client `deriveRoster`).
 */
export function listAgents(index: PlaneAIndex, policy: PolicyDoc, override: OverrideDoc): AgentRosterRow[] {
  const byOwner = new Map<string, ParsedCard[]>();
  for (const bucket of Object.values(index.cards)) {
    for (const card of bucket) {
      const owner = card.meta.owner;
      if (typeof owner !== 'string' || owner === '') continue;
      const existing = byOwner.get(owner);
      if (existing) existing.push(card);
      else byOwner.set(owner, [card]);
    }
  }

  const rows: AgentRosterRow[] = [];
  for (const [id, cards] of byOwner) {
    const workingCard = cards.find((c) => c.meta.state === 'working') ?? null;
    const projects = [...new Set(cards.flatMap(projectsOf))].sort();
    rows.push({
      id,
      working: workingCard !== null,
      current: workingCard
        ? { action: String(workingCard.meta.action), id: String(workingCard.meta.id) }
        : null,
      projects,
      cardCount: cards.length,
      effective: effectiveForAgent(id, policy, override),
    });
  }

  return rows.sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}
