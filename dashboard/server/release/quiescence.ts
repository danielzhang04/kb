export type ExecutionLockState = 'unlocked' | 'locking' | 'locked';

export interface QuiescenceSnapshot {
  executionState: ExecutionLockState;
  bridgeStopped: boolean;
  queuedWork: number;
  activeWorkers: number;
  activeGit: number;
  activePty: number;
  activeComposer: number;
  serviceCgroupChildren: number;
}

export function quiescence(snapshot: QuiescenceSnapshot): { ok: true; quiescent: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (snapshot.executionState !== 'locked') blockers.push(`execution-${snapshot.executionState}`);
  if (!snapshot.bridgeStopped) blockers.push('queue-bridge-running');
  if (snapshot.queuedWork > 0) blockers.push('work-queued');
  if (snapshot.activeWorkers > 0) blockers.push('workers-active');
  if (snapshot.activeGit > 0) blockers.push('git-active');
  if (snapshot.activePty > 0) blockers.push('pty-active');
  if (snapshot.activeComposer > 0) blockers.push('composer-active');
  if (snapshot.serviceCgroupChildren > 0) blockers.push('service-cgroup-active');
  return { ok: true, quiescent: blockers.length === 0, blockers };
}
