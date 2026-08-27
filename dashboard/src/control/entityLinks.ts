/**
 * arc-3 step 2 — the cross-entity joins and the link builders over them.
 *
 * The dashboard had every entity and almost none of the edges between them: a launch returned an inert
 * `runRef` string and an agent row could not reach its work. Every join below is computed IN THE BROWSER
 * from data already on the wire; kept pure and DTO-shaped (no fetching, no React) so each is testable
 * against a literal fixture.
 *
 * Run → its workflow is deliberately NOT here any more: it is a server-stamped grouping key
 * (`RunDto.workflowRef`, built in `server/control/routes.ts#workflowRefIndex`). Re-deriving it in the
 * browser cost every run-listing surface a full proposal-revision fetch to answer a question the store
 * already knew. What survives on that side is link BUILDING only.
 *
 * The one join that is NOT here is agent → its live managed *sessions*. `ManagedSessionDto` and
 * `AttemptDto` carry `runtime` and `model` but no agent id, so there is no honest client-side join for
 * it; faking one from `runtime` would be a lie. It needs `agentId` on `ManagedSession` server-side and
 * is listed as an interface request rather than approximated here.
 */
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { RunMetadataDto, StageDto } from './controlClient';
import { focusTarget, type NavTarget } from '../nav/stack';

/** Open a run — inside the Workflows destination, which owns runs now (see `nav/stack.ts`). */
export function runLink(runRef: string): NavTarget {
  return focusTarget({ kind: 'run', id: runRef });
}

/** Open a workflow definition. */
export function workflowLink(workflowId: string): NavTarget {
  return focusTarget({ kind: 'workflow', id: workflowId });
}

/** Open an agent's detail. */
export function agentLink(agentId: string): NavTarget {
  return focusTarget({ kind: 'agent', id: agentId });
}

/** Open a queue card in the unified Inbox detail pane. */
export function cardLink(cardId: string): NavTarget {
  return focusTarget({ kind: 'card', id: cardId });
}

/** Runs belonging to one workflow definition, newest first, off the server's grouping key. */
export function runsForWorkflow(workflowId: string, runs: RunMetadataDto[]): RunMetadataDto[] {
  return runs
    .filter((run) => run.workflowRef === workflowId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Flatten the Plane-A card index into `cardId -> owner`.
 *
 * `stage.canonicalCardRef` IS a queue card id — `canonicalResultIntegrator.ts` writes each result to
 * `queue/done/${canonicalCardRef}.md`, so the ref is the filename stem. That makes the card's `owner`
 * the only real, already-present agent join in the product.
 */
export function cardOwnerIndex(index: PlaneAIndex): Map<string, string> {
  const owners = new Map<string, string>();
  // These joins parse a NETWORK RESPONSE, so the shape is an assumption, not a guarantee. A partial or
  // unexpected body must cost the operator some links, never crash the run detail that hosts them.
  for (const bucket of Object.values(index?.cards ?? {})) {
    if (!Array.isArray(bucket)) continue;
    for (const card of bucket) {
      if (!card?.meta) continue;
      const id = card.meta.id;
      const owner = card.meta.owner;
      if (typeof id !== 'string' || id === '') continue;
      if (typeof owner !== 'string' || owner === '') continue;
      owners.set(id, owner);
    }
  }
  return owners;
}

/** One stage's agent attribution, derived through its canonical queue card. */
export interface StageAgentLink {
  stageRef: string;
  stageId: string;
  cardId: string;
  agentId: string;
}

/**
 * Run → its agents, via each stage's canonical queue card owner.
 *
 * This is a DERIVED link and the UI labels it as such ("via queue cards"). Stages with no canonical
 * card yet, or whose card has no owner, are simply absent — an unowned stage must not invent an agent.
 */
export function agentsForRun(stages: StageDto[], owners: Map<string, string>): StageAgentLink[] {
  const links: StageAgentLink[] = [];
  for (const stage of stages) {
    const cardId = stage.canonicalCardRef;
    if (!cardId) continue;
    const agentId = owners.get(cardId);
    if (!agentId) continue;
    links.push({ stageRef: stage.stageRef, stageId: stage.stageId, cardId, agentId });
  }
  return links;
}

/** The distinct agent ids working a run, in first-stage order. */
export function agentIdsForRun(stages: StageDto[], owners: Map<string, string>): string[] {
  return [...new Set(agentsForRun(stages, owners).map((link) => link.agentId))];
}

/** A run paired with its stages — the shape the agent → runs inverse needs. */
export interface RunWithStages {
  run: RunMetadataDto;
  stages: StageDto[];
}

/**
 * Agent → its runs: the inverse card index.
 *
 * Requires stages, which `listRuns` does not return, so the caller must have loaded run details. That
 * cost is why the agent detail loads this lazily and degrades to an explicit empty state rather than
 * fanning out governed fetches from the roster table.
 */
export function runsForAgent(agentId: string, loaded: RunWithStages[], owners: Map<string, string>): RunMetadataDto[] {
  return loaded
    .filter(({ run, stages }) => run.agentWorkspaceLaunch?.agentId === agentId || agentIdsForRun(stages, owners).includes(agentId))
    .map(({ run }) => run)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The queue cards an agent owns, newest-id-last, from the Plane-A snapshot. */
export interface AgentCardRef {
  id: string;
  /** Carried straight from the server card DTO — never derived here. */
  displayName: string;
  shortRef: number;
  action: string;
  state: string;
  bucket: string;
}

/**
 * Agent → its queue cards. This is the direct answer to "tasks it's currently running": the card index
 * is already loaded by the Agents view, so this join costs nothing and needs no session.
 */
export function cardsForAgent(agentId: string, index: PlaneAIndex): AgentCardRef[] {
  const cards: AgentCardRef[] = [];
  for (const [bucket, entries] of Object.entries(index?.cards ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const card of entries) {
      if (card?.meta?.owner !== agentId) continue;
      const id = card.meta.id;
      if (typeof id !== 'string' || id === '') continue;
      cards.push({
        id,
        displayName: card.displayName,
        shortRef: card.shortRef,
        action: typeof card.meta.action === 'string' ? card.meta.action : '—',
        state: typeof card.meta.state === 'string' ? card.meta.state : bucket,
        bucket,
      });
    }
  }
  return cards.sort((a, b) => a.id.localeCompare(b.id));
}
