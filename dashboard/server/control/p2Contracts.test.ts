import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AttemptSessionPublicRow,
  AttentionEnvelope,
  ArchivedFrom,
  PublicExit,
  EntityStatus,
  HostKind,
  RunIdentityFields,
  RunEventPage,
  RunRow,
  RunOutcome,
  RunnableRef,
  ScheduleOccurrence,
} from './p2Contracts.ts';
import type { CreateEntityRequest, EntityBuilderRequest } from '../entities/contracts.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(here, '..', '..');
const allowedDeclarations = new Set([
  'server/control/types.ts',
  'server/control/p2Contracts.ts',
  'server/control/p2Contracts.test.ts',
  'server/entities/contracts.ts',
  'server/entities/contracts.test.ts',
  'server/schedules/contracts.ts',
  'server/schedules/contracts.test.ts',
  'server/home/contracts.ts',
  'server/home/contracts.test.ts',
]);

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  }).filter((path) => /\.(?:ts|tsx)$/.test(path));
}

describe('P2 control contracts', () => {
  it('keeps trusted runnable and run identity shapes closed', () => {
    expectTypeOf<RunnableRef>().toEqualTypeOf<
      | { type: 'agent'; id: string; sourcePath: `agents/${string}.md` }
      | { type: 'workflow'; id: string; project: string; sourcePath: `orgs/${string}/workflows/${string}.md` }
    >();
    expectTypeOf<RunOutcome>().toEqualTypeOf<'ok' | 'failed' | 'stopped' | 'interrupted' | 'abandoned'>();
    expectTypeOf<ArchivedFrom>().toEqualTypeOf<'succeeded' | 'failed' | 'stopped' | 'interrupted' | 'waiting-human'>();
    expectTypeOf<EntityStatus>().toEqualTypeOf<'running' | 'needs-you' | 'failed' | 'idle' | 'scheduled'>();
    expectTypeOf<HostKind>().toEqualTypeOf<'vm' | 'desktop'>();
    expectTypeOf<RunIdentityFields>().toEqualTypeOf<{
      owner: RunnableRef;
      executionHost: HostKind;
      terminalOutcome: RunOutcome | null;
      completedAt: string | null;
      archivedFrom: ArchivedFrom | null;
    }>();
  });

  it('keeps stream and attention envelopes revisioned', () => {
    expectTypeOf<RunEventPage>().toMatchTypeOf<{ revision: string; items: unknown[]; nextCursor: number | null }>();
    expectTypeOf<AttentionEnvelope>().toMatchTypeOf<{ revision: string; pairs: unknown[]; agents: Record<string, number>; workflows: Record<string, number> }>();
    expectTypeOf<RunRow>().toEqualTypeOf<{
      runRef: string;
      title: string;
      owner: RunnableRef;
      lifecycle: import('./runLifecycle.ts').RunLifecycleKind;
      outcome: RunOutcome | null;
      createdAt: string;
      completedAt: string | null;
      streamKind: 'pty' | 'transcript';
      sessionId?: string;
      elapsedMs?: number;
      toolsCalled?: number;
      lastLine?: string;
      gateBadge?: string | null;
    }>();
    expectTypeOf<ScheduleOccurrence>().toEqualTypeOf<{
      scheduleId: string;
      scheduledFor: string;
      nextAt: string;
      owner: RunnableRef;
    }>();
  });

  it('pins the builder request contract to closed catalog identifiers', () => {
    expectTypeOf<EntityBuilderRequest>().toEqualTypeOf<{
      humanName: string; purpose: string; model: string; profile: string; tools: string[]; skills: string[]; connectors: Array<{ server: string; tools: string[] }>; filesystemRoots: string[];
    }>();
    expectTypeOf<CreateEntityRequest>().toMatchTypeOf<{ project?: string }>();
  });

  it('has no competing P2 noun declarations or structural DTO copies outside W0 files', () => {
    const declarations = /\b(?:interface|type)\s+(?:RunnableRef|RunnableRefDto|RunOutcomeDto|ArchivedFromDto|RunDto|EntitySummary|Schedule)\b/;
    const runDtoFields = [
      'owner', 'executionHost', 'terminalOutcome', 'completedAt', 'archivedFrom', 'runRef', 'predecessorRunRef',
      'title', 'displayName', 'shortRef', 'workflowRef', 'proposalRef', 'proposalRevision', 'proposalHash',
      'publicationState', 'state', 'version', 'managerSessionRef', 'managerGeneration', 'managerAssignment',
      'agentWorkspaceLaunch', 'createdAt', 'updatedAt',
    ].sort().join(',');
    const structuralDuplicate = (text: string): boolean => {
      const interfaces = text.matchAll(/\binterface\s+([A-Za-z0-9_]+)(?:\s+extends[^\{]+)?\s*\{([\s\S]*?)^\}/gm);
      return [...interfaces].some((match) => [...match[2].matchAll(/^\s{2}([A-Za-z0-9_]+)\??:/gm)]
        .map((field) => field[1]).sort().join(',') === runDtoFields);
    };
    const offenders = sourceFiles(resolve(dashboardRoot, 'server'))
      .concat(sourceFiles(resolve(dashboardRoot, 'src')))
      .map((path) => ({ path: relative(dashboardRoot, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }))
      .filter(({ path, text }) => !allowedDeclarations.has(path) && (declarations.test(text) || structuralDuplicate(text)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('attaches P2 identity exactly once through RunIdentityFields at the W6.1 cutover', () => {
    const types = readFileSync(resolve(here, 'types.ts'), 'utf8');
    const storeTypes = readFileSync(resolve(here, 'storeTypes.ts'), 'utf8');
    const storedRunBody = /interface\s+StoredRun(?:\s+extends\s+[^\{]+)?\s*\{([^}]*)\}/.exec(storeTypes)?.[1];
    expect(types).toMatch(/interface\s+Run\s+extends\s+RunIdentityFields/);
    expect(types).not.toMatch(/interface\s+Run\s*\{[\s\S]*?\b(?:owner|executionHost|terminalOutcome|completedAt|archivedFrom)\s*:/);
    expect(storedRunBody).toBeDefined();
    expect(storedRunBody).not.toMatch(/\b(?:owner|executionHost|terminalOutcome|completedAt|archivedFrom)\s*:/);
  });
});

describe('[C-M4] AttemptSessionPublicRow (control DTO copy)', () => {
  it('declares the exact nine keys, closed launcher/state enums, and nullable exit/endedAt', () => {
    expectTypeOf<keyof AttemptSessionPublicRow>().toEqualTypeOf<
      'attemptRef' | 'sessionId' | 'launcher' | 'state' | 'startedAt' | 'endedAt' | 'exit'
      | 'controllerClaimed' | 'liveControl'
    >();
    expectTypeOf<AttemptSessionPublicRow['launcher']>().toEqualTypeOf<'claude' | 'codex'>();
    expectTypeOf<AttemptSessionPublicRow['state']>().toEqualTypeOf<
      'starting' | 'live' | 'closing' | 'exited' | 'abandoned'
    >();
    expectTypeOf<AttemptSessionPublicRow['endedAt']>().toEqualTypeOf<string | null>();
    expectTypeOf<AttemptSessionPublicRow['exit']>().toEqualTypeOf<PublicExit | null>();
    expectTypeOf<AttemptSessionPublicRow['controllerClaimed']>().toEqualTypeOf<boolean>();
    expectTypeOf<AttemptSessionPublicRow['liveControl']>().toEqualTypeOf<boolean>();
  });

  it('stays byte-identical to the shared ptyProtocol declaration it duplicates', () => {
    const shared = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../shared/ptyProtocol.ts'), 'utf8');
    const local = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './p2Contracts.ts'), 'utf8');
    const body = /export type AttemptSessionPublicRow = \{[^}]*\};/;
    const sharedMatch = shared.match(body);
    const localMatch = local.match(body);
    expect(sharedMatch).not.toBeNull();
    expect(localMatch?.[0]).toBe(sharedMatch?.[0]);
  });

  it('keeps every internal-only field off the public row', () => {
    const row: AttemptSessionPublicRow = {
      attemptRef: 'attempt-1', sessionId: 'pty-' + 'a'.repeat(32), launcher: 'claude',
      state: 'live', startedAt: '2026-08-23T00:00:00.000Z', endedAt: null, exit: null,
      controllerClaimed: false, liveControl: true,
    };
    for (const forbidden of ['operator', 'browserSessionRef', 'managedSessionRef', 'transcriptRef',
      'epochId', 'argv', 'env', 'cwd']) {
      expect(Object.hasOwn(row, forbidden)).toBe(false);
    }
  });
});
