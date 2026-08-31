import { sha256Hex } from '../shared/hashing.ts';
import type { AttentionEnvelope, RunnableRef } from './p2Contracts.ts';
import type { RunLifecycleKind } from './runLifecycle.ts';

export interface AttentionRun {
  runRef: string;
  owner: RunnableRef;
  lifecycle: RunLifecycleKind;
}

export interface AttentionHumanRequest {
  requestRef: string;
  runRef: string;
  state: 'open' | 'resolved';
}

export interface RunAttentionSnapshot {
  runs: readonly AttentionRun[];
  humanRequests: readonly AttentionHumanRequest[];
}

function ownerKey(owner: RunnableRef): string {
  return owner.type === 'agent' ? `agent:${owner.id}` : `workflow:${owner.project}:${owner.id}`;
}

function bump(map: Record<string, number>, id: string): void {
  map[id] = (map[id] ?? 0) + 1;
}

export function projectRunAttention(snapshot: RunAttentionSnapshot): AttentionEnvelope {
  const openRuns = new Set(snapshot.humanRequests.filter((request) => request.state === 'open').map((request) => request.runRef));
  const ownerByRun = new Map<string, RunnableRef>();
  for (const run of snapshot.runs) {
    const existing = ownerByRun.get(run.runRef);
    if (existing && ownerKey(existing) !== ownerKey(run.owner)) {
      throw new Error(`run ${run.runRef} has conflicting immutable owners`);
    }
    ownerByRun.set(run.runRef, run.owner);
  }

  const pairs = snapshot.runs
    .filter((run) => run.lifecycle === 'waiting-human' || openRuns.has(run.runRef))
    .filter((run, index, runs) => runs.findIndex((candidate) => candidate.runRef === run.runRef) === index)
    .map(({ runRef, owner }) => ({ runRef, owner }))
    .sort((left, right) => ownerKey(left.owner).localeCompare(ownerKey(right.owner)) || left.runRef.localeCompare(right.runRef));
  const agents: Record<string, number> = {};
  const workflows: Record<string, number> = {};
  for (const item of pairs) {
    if (item.owner.type === 'agent') bump(agents, item.owner.id);
    else bump(workflows, ownerKey(item.owner));
  }
  return {
    revision: sha256Hex(JSON.stringify(pairs)),
    pairs,
    agents,
    workflows,
  };
}
