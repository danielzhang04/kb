import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCardFrontmatter } from '../planeA/cards.ts';
import type { GitRunner } from '../write/branch.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import type { PlanProposal } from './proposal.ts';
import type { StageState } from './types.ts';

const PHYSICAL_QUEUE_DIRS = ['inbox', 'working', 'approvals', 'done'] as const;

export interface ReconciledPublicationCard {
  stageId: string;
  cardId: string;
  cardPath: string;
  cardState: string;
  stageState: Exclude<StageState, 'interrupted'>;
}

export type PublicationReconciliation =
  | { ok: true; cards: ReconciledPublicationCard[] }
  | { ok: false; reason: string; detail: string };

function scalar(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function projection(state: string): Exclude<StageState, 'interrupted'> | null {
  if (state === 'inbox' || state === 'approved') return 'ready';
  if (state === 'blocked') return 'blocked';
  if (state === 'working' || state === 'stop-requested' || state === 'halting') return 'running';
  if (state === 'approvals') return 'waiting-human';
  if (state === 'done') return 'succeeded';
  if (state === 'rejected') return 'failed';
  if (state === 'halted') return 'stopped';
  return null;
}

/** Rebuild app-local publication truth only from exact, committed canonical cards. */
export function reconcileCanonicalPublication(input: {
  repoRoot: string;
  runRef: string;
  proposal: PlanProposal;
  defaultWorkers: Record<string, string>;
  runGit: GitRunner;
}): PublicationReconciliation {
  const cards: ReconciledPublicationCard[] = [];
  for (const stage of input.proposal.stages) {
    const cardId = workflowCardId(input.runRef, stage.id);
    const matches = PHYSICAL_QUEUE_DIRS
      .map((directory) => ({ directory, relpath: `queue/${directory}/${cardId}.md` }))
      .filter((candidate) => existsSync(join(input.repoRoot, ...candidate.relpath.split('/'))));
    if (matches.length !== 1) {
      return { ok: false, reason: matches.length ? 'duplicate-card' : 'missing-card', detail: `stage '${stage.id}' has ${matches.length} canonical cards` };
    }
    const { relpath } = matches[0];
    try {
      const tracked = input.runGit(input.repoRoot, ['ls-files', '--error-unmatch', '--', relpath]).trim().replace(/\\/g, '/');
      if (tracked !== relpath) throw new Error('tracked path mismatch');
      input.runGit(input.repoRoot, ['diff', '--quiet', 'HEAD', '--', relpath]);
    } catch {
      return { ok: false, reason: 'uncommitted-card', detail: `canonical card '${relpath}' is not tracked and clean at HEAD` };
    }
    let card;
    try {
      card = parseCardFrontmatter(readFileSync(join(input.repoRoot, ...relpath.split('/')), 'utf8'));
    } catch (error) {
      return { ok: false, reason: 'malformed-card', detail: error instanceof Error ? error.message : String(error) };
    }
    const expectedOwner = input.defaultWorkers[stage.worker.runtime];
    const expectedDependencies = stage.dependsOn.map((dependency) => workflowCardId(input.runRef, dependency));
    const actualDependencies = Array.isArray(card.meta['depends-on']) ? card.meta['depends-on'] : [];
    const state = scalar(card.meta.state);
    const stageState = projection(state);
    const exact = card.meta.id === cardId
      && scalar(card.meta.workflow) === input.runRef
      && scalar(card.meta.project) === input.proposal.project
      && scalar(card.meta.action) === stage.action
      && scalar(card.meta.target) === stage.target
      && scalar(card.meta['risk-tier']) === stage.riskTier
      && scalar(card.meta.owner) === expectedOwner
      && scalar(card.meta.runtime) === stage.worker.runtime
      && scalar(card.meta.model) === stage.worker.model
      && JSON.stringify(actualDependencies) === JSON.stringify(expectedDependencies)
      && card.body === `## Work order\n\n${stage.workOrder}\n`;
    if (!exact || !stageState) {
      return { ok: false, reason: 'card-mismatch', detail: `canonical card for stage '${stage.id}' differs from the approved proposal` };
    }
    cards.push({ stageId: stage.id, cardId, cardPath: relpath, cardState: state, stageState });
  }
  return { ok: true, cards };
}
