import type { DeployPause, RunLifecycle } from './types.ts';

export const RUN_LIFECYCLE_KINDS = [
  'planned',
  'recovering',
  'running',
  'waiting-human',
  'stopping',
  'succeeded',
  'failed',
  'stopped',
  'interrupted',
  'archived',
  'paused-for-deploy',
] as const;

export type RunLifecycleKind = typeof RUN_LIFECYCLE_KINDS[number];

interface RunLifecycleSemantics {
  terminal: boolean;
  quarantine: boolean;
  transitions: ReadonlySet<RunLifecycleKind>;
  crash: 'preserve' | 'interrupt';
}

export const RUN_LIFECYCLE_SEMANTICS = {
  planned: { terminal: false, quarantine: false, transitions: new Set<RunLifecycleKind>(['recovering', 'running', 'waiting-human', 'stopping', 'failed', 'stopped', 'interrupted']), crash: 'preserve' },
  recovering: { terminal: false, quarantine: false, transitions: new Set<RunLifecycleKind>(['running', 'waiting-human', 'stopping', 'failed', 'stopped', 'interrupted']), crash: 'interrupt' },
  running: { terminal: false, quarantine: false, transitions: new Set<RunLifecycleKind>(['waiting-human', 'stopping', 'succeeded', 'failed', 'stopped', 'interrupted']), crash: 'interrupt' },
  'waiting-human': { terminal: false, quarantine: false, transitions: new Set<RunLifecycleKind>(['planned', 'recovering', 'running', 'stopping', 'failed', 'stopped', 'interrupted', 'archived']), crash: 'preserve' },
  stopping: { terminal: false, quarantine: false, transitions: new Set<RunLifecycleKind>(['stopped', 'failed', 'interrupted']), crash: 'interrupt' },
  succeeded: { terminal: true, quarantine: true, transitions: new Set<RunLifecycleKind>(['archived']), crash: 'preserve' },
  failed: { terminal: true, quarantine: true, transitions: new Set<RunLifecycleKind>(['archived']), crash: 'preserve' },
  stopped: { terminal: true, quarantine: true, transitions: new Set<RunLifecycleKind>(['archived']), crash: 'preserve' },
  interrupted: { terminal: false, quarantine: true, transitions: new Set<RunLifecycleKind>(['recovering', 'running', 'waiting-human', 'stopping', 'failed', 'stopped', 'archived']), crash: 'preserve' },
  archived: { terminal: true, quarantine: true, transitions: new Set<RunLifecycleKind>(), crash: 'preserve' },
  'paused-for-deploy': { terminal: false, quarantine: false, transitions: new Set<RunLifecycleKind>(), crash: 'preserve' },
} satisfies Record<RunLifecycleKind, RunLifecycleSemantics>;

function assertNever(value: never): never {
  throw new Error(`unexpected run lifecycle: ${String(value)}`);
}

function semanticsForKind(kind: RunLifecycleKind): RunLifecycleSemantics {
  switch (kind) {
    case 'planned': return RUN_LIFECYCLE_SEMANTICS.planned;
    case 'recovering': return RUN_LIFECYCLE_SEMANTICS.recovering;
    case 'running': return RUN_LIFECYCLE_SEMANTICS.running;
    case 'waiting-human': return RUN_LIFECYCLE_SEMANTICS['waiting-human'];
    case 'stopping': return RUN_LIFECYCLE_SEMANTICS.stopping;
    case 'succeeded': return RUN_LIFECYCLE_SEMANTICS.succeeded;
    case 'failed': return RUN_LIFECYCLE_SEMANTICS.failed;
    case 'stopped': return RUN_LIFECYCLE_SEMANTICS.stopped;
    case 'interrupted': return RUN_LIFECYCLE_SEMANTICS.interrupted;
    case 'archived': return RUN_LIFECYCLE_SEMANTICS.archived;
    case 'paused-for-deploy': return RUN_LIFECYCLE_SEMANTICS['paused-for-deploy'];
    default: return assertNever(kind);
  }
}

export function lifecycleForKind(kind: RunLifecycleKind, deployPause: DeployPause | null): RunLifecycle {
  switch (kind) {
    case 'planned':
    case 'recovering':
    case 'running':
    case 'waiting-human':
    case 'stopping':
    case 'succeeded':
    case 'failed':
    case 'stopped':
    case 'interrupted':
    case 'archived':
      if (deployPause !== null) throw new Error(`${kind} cannot carry deploy pause data`);
      return { kind, deployPause: null };
    case 'paused-for-deploy':
      if (deployPause === null) throw new Error('paused-for-deploy requires deploy pause data');
      return { kind, deployPause };
    default:
      return assertNever(kind);
  }
}

export function runLifecycleKind(lifecycle: RunLifecycle): RunLifecycleKind {
  switch (lifecycle.kind) {
    case 'planned': return 'planned';
    case 'recovering': return 'recovering';
    case 'running': return 'running';
    case 'waiting-human': return 'waiting-human';
    case 'stopping': return 'stopping';
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    case 'stopped': return 'stopped';
    case 'interrupted': return 'interrupted';
    case 'archived': return 'archived';
    case 'paused-for-deploy': return 'paused-for-deploy';
    default: return assertNever(lifecycle);
  }
}

export function projectRunState(lifecycle: RunLifecycle): RunLifecycleKind {
  return runLifecycleKind(lifecycle);
}

export function isTerminalRun(lifecycle: RunLifecycle): boolean {
  return semanticsForKind(runLifecycleKind(lifecycle)).terminal;
}

export function canQuarantineRun(lifecycle: RunLifecycle): boolean {
  return semanticsForKind(runLifecycleKind(lifecycle)).quarantine;
}

export function canTransitionRun(lifecycle: RunLifecycle, target: RunLifecycleKind): boolean {
  return semanticsForKind(runLifecycleKind(lifecycle)).transitions.has(target);
}

export function crashNormalizedLifecycle(lifecycle: RunLifecycle, pendingActivation: boolean): RunLifecycle {
  const kind = runLifecycleKind(lifecycle);
  if (semanticsForKind(kind).crash === 'preserve') return lifecycle;
  return lifecycleForKind(pendingActivation ? 'waiting-human' : 'interrupted', null);
}
