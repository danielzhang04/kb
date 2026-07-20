/**
 * arc-3 step 2 — the cross-entity joins, as pure functions.
 *
 * The dashboard had every entity and almost none of the edges between them: a launch returned an inert
 * `runRef` string, an agent row could not reach its work, and a run could not name the definition that
 * produced it. Every join below is computed IN THE BROWSER from data already on the wire. None of them
 * needed a server change.
 *
 * Kept deliberately pure and DTO-shaped (no fetching, no React) so each join is testable against a
 * literal fixture — which matters most for `sourceTurnId`, whose silent loss is invisible at runtime:
 * the UI just quietly renders "no runs" forever.
 *
 * The one join that is NOT here is agent → its live managed *sessions*. `ManagedSessionDto` and
 * `AttemptDto` carry `runtime` and `model` but no agent id, so there is no honest client-side join for
 * it; faking one from `runtime` would be a lie. It needs `agentId` on `ManagedSession` server-side and
 * is listed as an interface request rather than approximated here.
 */
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { ProposalRevisionMetadataDto, RunMetadataDto, StageDto } from './controlClient';

/**
 * The `sourceComposerRef` that `server/workflows/routes.ts` stamps on every revision it creates from a
 * workflow definition. A revision carrying it has its definition id in `sourceTurnId`.
 */
export const WORKFLOW_COMPOSER_REF = 'workflow-registry';

/**
 * The proposal refs produced by one workflow definition.
 *
 * A definition may be launched many times; when its content hash is unchanged the launch REUSES the
 * already-approved revision, so several launches can share one `proposalRef` — hence a Set.
 */
export function proposalRefsForWorkflow(
  workflowId: string,
  revisions: ProposalRevisionMetadataDto[],
): Set<string> {
  const refs = new Set<string>();
  for (const revision of revisions) {
    if (revision.sourceComposerRef !== WORKFLOW_COMPOSER_REF) continue;
    if (revision.sourceTurnId !== workflowId) continue;
    refs.add(revision.proposalRef);
  }
  return refs;
}

/**
 * Workflow → its runs. The link that makes Launch's `runRef` stop being inert text.
 *
 * Newest first: the operator opening a definition almost always wants the run they just launched.
 */
export function runsForWorkflow(
  workflowId: string,
  revisions: ProposalRevisionMetadataDto[],
  runs: RunMetadataDto[],
): RunMetadataDto[] {
  const refs = proposalRefsForWorkflow(workflowId, revisions);
  if (refs.size === 0) return [];
  return runs
    .filter((run) => refs.has(run.proposalRef))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Run → its workflow definition id, or null for an ad-hoc (Composer) run.
 *
 * The inverse of the above, and the reason a run is not required to be workflow-launched: a run is an
 * instance of ANY proposal, so "no workflow" is a normal answer here, not a failure.
 */
export function workflowIdForRun(
  run: { proposalRef: string },
  revisions: ProposalRevisionMetadataDto[],
): string | null {
  for (const revision of revisions) {
    if (revision.proposalRef !== run.proposalRef) continue;
    if (revision.sourceComposerRef !== WORKFLOW_COMPOSER_REF) continue;
    if (revision.sourceTurnId) return revision.sourceTurnId;
  }
  return null;
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
    .filter(({ stages }) => agentIdsForRun(stages, owners).includes(agentId))
    .map(({ run }) => run)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The queue cards an agent owns, newest-id-last, from the Plane-A snapshot. */
export interface AgentCardRef {
  id: string;
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
        action: typeof card.meta.action === 'string' ? card.meta.action : '—',
        state: typeof card.meta.state === 'string' ? card.meta.state : bucket,
        bucket,
      });
    }
  }
  return cards.sort((a, b) => a.id.localeCompare(b.id));
}
