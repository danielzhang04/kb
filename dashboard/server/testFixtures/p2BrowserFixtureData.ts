import { readFileSync } from 'node:fs';
import { SYSTEM_ENTITY_GROUP_ID } from '../entities/contracts.ts';

export const P2_BROWSER_SCENARIOS = [
  'p2-entity-groups-overlay',
  'p2-run-lifecycle-step-filter',
  'p2-gate-dedupe-t3',
  'p2-stream-reconnect-goldens',
  'p2-schedule-cas-invalid',
  'p2-schedule-load-error',
  'p2-home-full',
  'p2-home-partial-failure',
  'p2-run-actions',
] as const;

export type P2BrowserScenario = (typeof P2_BROWSER_SCENARIOS)[number];

export function isP2BrowserScenario(value: string): value is P2BrowserScenario {
  return P2_BROWSER_SCENARIOS.includes(value as P2BrowserScenario);
}

const NOW = '2026-08-21T12:00:00.000Z';
const AGENT_OWNER = { type: 'agent', id: 'fyt-checker', sourcePath: 'agents/fyt-checker.md' } as const;
const WORKFLOW_OWNER = {
  type: 'workflow', id: 'research-brief', project: 'kb-ops',
  sourcePath: 'orgs/kb-ops/workflows/research-brief.md',
} as const;

function agentOwner(id: string): { type: 'agent'; id: string; sourcePath: `agents/${string}.md` } {
  return { type: 'agent', id, sourcePath: `agents/${id}.md` };
}

function workflowOwner(id: string, project: string): {
  type: 'workflow'; id: string; project: string; sourcePath: `orgs/${string}/workflows/${string}.md`;
} {
  return { type: 'workflow', id, project, sourcePath: `orgs/${project}/workflows/${id}.md` };
}

function runRow(owner: typeof AGENT_OWNER | typeof WORKFLOW_OWNER, lifecycle = 'waiting-human') {
  return {
    runRef: 'run-fixture', title: 'P2 fixture run', owner, lifecycle, outcome: null,
    createdAt: '2026-08-21T10:00:00.000Z', completedAt: null, streamKind: 'transcript',
    elapsedMs: 7_200_000, toolsCalled: 2, lastLine: 'Waiting for operator input.', gateBadge: '1',
  };
}

function entitySummary(
  ref: ReturnType<typeof agentOwner> | ReturnType<typeof workflowOwner>,
  humanName: string,
  options: { status?: string; model?: string; temporal?: string; host?: 'vm' | 'desktop'; gates?: number } = {},
) {
  const gates = options.gates ?? 0;
  return {
    ref,
    humanName,
    status: options.status ?? 'idle',
    modelLabel: options.model ?? (ref.type === 'workflow' ? 'varies' : 'gpt-5.6-terra'),
    temporalLabel: options.temporal ?? 'Never run · no schedule',
    host: options.host ?? 'vm',
    gatedRunCount: gates,
    activeRuns: gates > 0 ? [runRow(ref as typeof AGENT_OWNER)] : [],
    latestRun: gates > 0 ? 'failed' : null,
    nextSchedule: null,
  };
}

const AGENT_GROUPS = [
  {
    id: 'atlas-prep', label: 'atlas-prep', collapsed: false,
    items: [entitySummary(agentOwner('atlas-research'), 'Atlas Research')],
  },
  {
    id: 'faceless-youtube', label: 'faceless-youtube', collapsed: false,
    items: [entitySummary(AGENT_OWNER, 'FYT Checker', {
      status: 'needs-you', model: 'gpt-5.6-sol', temporal: 'ran 2h ago · failed', host: 'desktop', gates: 1,
    })],
  },
  {
    id: 'kb-ops', label: 'kb-ops', collapsed: false,
    items: [entitySummary(agentOwner('kb-operator'), 'KB Operator')],
  },
  {
    id: SYSTEM_ENTITY_GROUP_ID, label: 'System', collapsed: true,
    items: [
      ['agent-maintainer', 'Agent Maintainer'],
      ['context-lifecycle', 'Context Lifecycle'],
      ['demo-agent', 'Demo Agent'],
      ['dispatcher-cloud', 'Dispatcher Cloud'],
      ['grader', 'Grader'],
      ['hygiene', 'Hygiene'],
      ['learnings-implementer', 'Learnings Implementer'],
      ['lessons-miner', 'Lessons Miner'],
      ['model-audit', 'Model Audit'],
      ['system-sweeper', 'System Sweeper'],
    ].map(([id, name]) => entitySummary(agentOwner(id), name)),
  },
];

const WORKFLOW_GROUPS = [
  {
    id: 'faceless-youtube', label: 'faceless-youtube', collapsed: false,
    items: [entitySummary(workflowOwner('video-run', 'faceless-youtube'), 'Video Run')],
  },
  {
    id: 'kb-ops', label: 'kb-ops', collapsed: false,
    items: [entitySummary(WORKFLOW_OWNER, 'Research Brief', {
      status: 'scheduled', model: 'varies', temporal: 'next 09:00', host: 'vm',
    })],
  },
];

export function p2EntityList(kind: 'agents' | 'workflows') {
  const groups = kind === 'agents' ? AGENT_GROUPS : WORKFLOW_GROUPS;
  return { revision: `fixture-${kind}-1`, groups, items: groups.flatMap((group) => group.items) };
}

export function p2EntityDetail(kind: 'agents' | 'workflows', id: string) {
  const list = p2EntityList(kind);
  const fallback = list.items[0];
  const summary = list.items.find((item) => item.ref.id === id) ?? fallback;
  const workflow = kind === 'workflows' ? {
    stepDag: {
      nodes: [{ stageRef: 'research', label: 'Research' }, { stageRef: 'write', label: 'Write' }],
      edges: [{ from: 'research', to: 'write' }],
    },
    parameters: [],
    runGraph: {
      runRef: 'run-fixture',
      stages: [
        { stageRef: 'stage-research', stageId: 'research', title: 'Research', dependsOn: [], state: 'succeeded' },
        { stageRef: 'stage-write', stageId: 'write', title: 'Write', dependsOn: ['stage-research'], state: 'running' },
      ],
      attempts: [
        { attemptRef: 'attempt-research', stageRef: 'stage-research', state: 'succeeded' },
        { attemptRef: 'attempt-write', stageRef: 'stage-write', state: 'running' },
      ],
      events: p2RunEvents().items.map(({ cursor, stageRef, kind: eventKind, summary: eventSummary, createdAt }) => ({
        cursor, stageRef, kind: eventKind, summary: eventSummary, createdAt,
      })),
    },
  } : undefined;
  return {
    revision: `fixture-${kind}-${summary.ref.id}-1`,
    summary,
    brief: {
      purpose: `Operate ${summary.humanName}.`, doingNow: summary.activeRuns.length > 0 ? 'Waiting for operator input.' : 'Idle.',
      recentRuns: summary.activeRuns, outputs: [], pendingGates: summary.gatedRunCount,
      schedule: summary.nextSchedule, autonomyTier: 'T1',
    },
    details: {
      sourcePath: summary.ref.sourcePath, sourceRevision: '1'.repeat(64), tools: [], declaredCeiling: 'T1',
      replaces: [], buildsOn: [], knowledgeSources: [], skills: [], schemas: [], lineage: [], grades: [],
      ids: [summary.ref.id],
      ...(workflow ? { workflow } : {}),
    },
  };
}

function operationalEvent(cursor: number, stageRef: string | null, summary: string) {
  return {
    cursor, runRef: 'run-fixture', kind: 'lifecycle', source: 'system', stageRef,
    attemptRef: null, sessionRef: null, status: null, summary,
    command: null, toolName: null, path: null, diff: null, checkpoint: null,
    createdAt: new Date(Date.parse(NOW) + cursor * 1_000).toISOString(),
  };
}

const GOLDEN_TRANSCRIPTS = [
  { stageRef: 'research', url: new URL('../control/__fixtures__/dv3/transcripts/claude-real-sanitized.jsonl', import.meta.url) },
  { stageRef: 'write', url: new URL('../control/__fixtures__/dv3/transcripts/codex-real-sanitized.jsonl', import.meta.url) },
] as const;

export function p2RunEvents(stageRef: string | null = null, after = 0, limit = 250, includeUnknownProvider = false) {
  let cursor = 0;
  const items = GOLDEN_TRANSCRIPTS.flatMap((golden) => readFileSync(golden.url, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => operationalEvent(++cursor, golden.stageRef, line)));
  if (includeUnknownProvider) {
    items.push(operationalEvent(++cursor, null, '{"provider":"future-cli","raw":"<b>future output</b>"}'));
  }
  const filtered = (stageRef === null ? items : items.filter((event) => event.stageRef === stageRef))
    .filter((event) => event.cursor > after);
  const page = filtered.slice(0, limit);
  return {
    revision: 'c'.repeat(64),
    items: page,
    nextCursor: filtered.length > page.length ? page.at(-1)?.cursor ?? null : null,
  };
}

export function p2RunDetail(scenario: P2BrowserScenario) {
  const t3 = scenario === 'p2-gate-dedupe-t3';
  return {
    ok: true,
    value: {
      streamKind: 'transcript',
      run: {
        runRef: 'run-fixture', predecessorRunRef: null, title: 'P2 fixture run', displayName: 'P2 Fixture Run', shortRef: 1,
        workflowRef: 'research-brief', proposalRef: 'proposal-fixture', proposalRevision: 1,
        proposalHash: '2'.repeat(64), publicationState: 'published', state: t3 ? 'waiting-human' : 'running',
        version: 3, managerSessionRef: 'session-manager', managerGeneration: 1, managerAssignment: null,
        owner: t3 ? AGENT_OWNER : WORKFLOW_OWNER, executionHost: 'vm', terminalOutcome: null,
        completedAt: null, archivedFrom: null, createdAt: '2026-08-21T10:00:00.000Z', updatedAt: NOW,
      },
      ownerSubject: 'operator',
      stages: [
        {
          stageRef: 'research', runRef: 'run-fixture', stageId: 'research', title: 'Research', dependsOn: [],
          canonicalCardRef: null, state: 'succeeded', version: 2, currentAttemptRef: null, assignment: null,
          createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T11:00:00.000Z',
        },
        {
          stageRef: 'write', runRef: 'run-fixture', stageId: 'write', title: 'Write', dependsOn: ['research'],
          canonicalCardRef: null, state: t3 ? 'waiting-human' : 'running', version: 2, currentAttemptRef: null, assignment: null,
          createdAt: '2026-08-21T11:00:00.000Z', updatedAt: NOW,
        },
      ],
      attempts: [], sessions: [],
      ...(scenario === 'p2-run-actions' ? { outputs: [
        { kind: 'repository-file', label: 'Built', path: 'output/p2-browser-report.md' },
        { kind: 'artifact', label: 'Fixture value', path: 'artifacts/ghp_fixture_secret_123' },
        { kind: 'external-pr', label: 'Review', owner: 'openai', repository: 'kb', number: 42 },
      ] } : {}),
      humanRequests: t3 ? [{
        requestRef: 'request-t3', runRef: 'run-fixture', displayName: 'P2 Fixture Run', shortRef: 1,
        stageRef: 'write', kind: 'approval', revision: 1, state: 'open', title: 'Approve result',
        prompt: 'Approve the reviewed result.', ask: 'The reviewed result needs your approval.', technicalDetail: null,
        response: null, createdAt: NOW, updatedAt: NOW,
      }] : [],
      stageGenerations: [], generationSupersessions: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [],
    },
  };
}

export const P2_ATTENTION = {
  revision: 'd'.repeat(64),
  pairs: [{ runRef: 'run-fixture', owner: AGENT_OWNER }],
  agents: { 'fyt-checker': 1 },
  workflows: {},
};

export const P2_SCHEDULE = {
  id: 'a'.repeat(64), owner: WORKFLOW_OWNER,
  cadence: { source: '0 9 * * *', words: 'daily at 09:00' },
  nextAt: '2026-08-22T13:00:00.000Z', lastOutcome: 'ok', armed: true,
  origin: 'operator', mirroredAt: null, mirrorPath: 'orgs/kb-ops/HEARTBEAT.md', version: 2,
};

export const P2_SCHEDULE_COLLECTION = { scheduleCollectionRevision: 4, rows: [P2_SCHEDULE] };

const HOME_FULL = {
  revision: 'home:fixture:p2',
  generatedAt: NOW,
  sections: [
    { state: 'ready', data: { section: 'running-now', runs: [runRow(WORKFLOW_OWNER, 'running')] } },
    { state: 'ready', data: { section: 'attention-counts', agents: 1, workflows: 0, inbox: 0 } },
    {
      state: 'ready', data: { section: 'next-schedules', occurrences: [{
        scheduleId: P2_SCHEDULE.id, scheduledFor: P2_SCHEDULE.nextAt, nextAt: P2_SCHEDULE.nextAt, owner: WORKFLOW_OWNER,
      }] },
    },
    { state: 'ready', data: { section: 'version', label: 'VM', sha: '64fb3d02', activatedAt: '2026-08-21T10:00:00.000Z' } },
    {
      state: 'ready', data: { section: 'recent-outcomes', outcomes: [{
        runRef: 'run-complete', title: 'Grader', completedAt: '2026-08-21T09:00:00.000Z', outcome: 'ok',
      }] },
    },
  ],
};

export function p2Home(partial: boolean) {
  const fixture = structuredClone(HOME_FULL);
  if (partial) fixture.sections[2] = { state: 'unavailable', reason: 'schedules-unavailable' } as never;
  return fixture;
}
