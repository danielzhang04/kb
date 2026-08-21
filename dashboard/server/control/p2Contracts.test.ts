import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AttentionEnvelope,
  ArchivedFrom,
  EntityStatus,
  HostKind,
  RunIdentityFields,
  RunEventPage,
  RunRow,
  RunOutcome,
  RunnableRef,
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
    }>();
  });

  it('pins the builder request contract to closed catalog identifiers', () => {
    expectTypeOf<EntityBuilderRequest>().toEqualTypeOf<{
      humanName: string; purpose: string; model: string; profile: string; tools: string[]; skills: string[]; connectors: string[]; filesystemRoots: string[];
    }>();
    expectTypeOf<CreateEntityRequest>().toMatchTypeOf<{ project?: string }>();
  });

  it('has no competing P2 noun declarations outside W0 files', () => {
    const declarations = /\b(?:interface|type)\s+(RunnableRef|EntitySummary|Schedule)\b/;
    const offenders = sourceFiles(resolve(dashboardRoot, 'server'))
      .concat(sourceFiles(resolve(dashboardRoot, 'src')))
      .map((path) => ({ path: relative(dashboardRoot, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }))
      .filter(({ path, text }) => !allowedDeclarations.has(path) && declarations.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('does not attach P2 identity fields or an inheritance clause to legacy Run shapes', () => {
    const types = readFileSync(resolve(here, 'types.ts'), 'utf8');
    const store = readFileSync(resolve(here, 'store.ts'), 'utf8');
    const storedRunBody = /interface\s+StoredRun(?:\s+extends\s+[^\{]+)?\s*\{([^}]*)\}/.exec(store)?.[1];
    expect(types).not.toMatch(/interface\s+Run\s+extends\s+RunIdentityFields/);
    expect(types).not.toMatch(/interface\s+Run\s*\{[\s\S]*?\b(?:owner|executionHost|terminalOutcome|completedAt|archivedFrom)\s*:/);
    expect(storedRunBody).toBeDefined();
    expect(storedRunBody).not.toMatch(/\b(?:owner|executionHost|terminalOutcome|completedAt|archivedFrom)\s*:/);
  });
});
