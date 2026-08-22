import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectEntityBrief, projectEntityList, projectEntitySummary, projectLiveEmpty, projectStepDag, resolveExecutionHost } from './project.ts';
import type { RunRow } from '../control/p2Contracts.ts';

const agent = { type: 'agent' as const, id: 'fyt-checker', sourcePath: 'agents/fyt-checker.md' as const };
const workflow = { type: 'workflow' as const, id: 'research-brief', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/research-brief.md' as const };
const summaryFixture = JSON.parse(readFileSync(new URL('./__fixtures__/entity-summary.json', import.meta.url), 'utf8')) as { revision: string; groups: string[] };
const detailFixture = JSON.parse(readFileSync(new URL('./__fixtures__/entity-detail.json', import.meta.url), 'utf8')) as { revision: string; liveEmpty: string };
const stepDagFixture = JSON.parse(readFileSync(new URL('../control/__fixtures__/dv3/step-dag.json', import.meta.url), 'utf8')) as { stages: string[]; edges: [string, string][] };

describe('entity projectors', () => {
  it('maps the current cloud and desktop routing tiers to the fixed P2 host labels', () => {
    expect(resolveExecutionHost('cloud')).toBe('vm');
    expect(resolveExecutionHost('desktop')).toBe('desktop');
  });
  it('groups agents by lexical primary project and places collapsed System last', () => {
    const result = projectEntityList(summaryFixture.revision, 'agent', [
      { ref: agent, projects: ['kb-ops', 'atlas-prep'], modelLabel: 'gpt-5.6-sol', temporalLabel: 'next 09:00', host: 'desktop', activeRuns: [], gatedRunCount: 0, latestRun: null, nextSchedule: null, hasFailure: false },
      { ref: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, group: 'system', projects: [], modelLabel: 'gpt-5.6-sol', temporalLabel: 'Never run · no schedule', host: 'vm', activeRuns: [], gatedRunCount: 0, latestRun: null, nextSchedule: null, hasFailure: false },
    ]);
    expect(result.groups.map((group) => [group.label, group.collapsed, group.items[0]?.humanName]))
      .toEqual([['Atlas Prep', false, 'FYT Checker'], ['System', true, 'Grader']]);
    expect(result.revision).toBe(summaryFixture.revision);
    expect(result.groups.map((group) => group.id)).toEqual(summaryFixture.groups);
    expect(result.items.map((item) => item.ref.id)).toEqual(['fyt-checker', 'grader']);
  });

  it('rejects a non-System agent without a valid project and derives exact status precedence', () => {
    const schedule = { scheduleId: 'schedule-1', scheduledFor: '2026-08-22T12:00:00.000Z', nextAt: '2026-08-22T12:00:00.000Z' };
    expect(() => projectEntityList('r1', 'agent', [{ ref: agent, projects: [], modelLabel: 'm', temporalLabel: 'x', host: 'vm', activeRuns: [], gatedRunCount: 0, latestRun: null, nextSchedule: null, hasFailure: false }])).toThrow('project-required');
    expect(projectEntitySummary({ ref: workflow, modelLabel: 'not-used', temporalLabel: 'next 09:00', host: 'vm', activeRuns: [], gatedRunCount: 1, latestRun: 'failed', nextSchedule: null, hasFailure: true }).status).toBe('needs-you');
    expect(projectEntitySummary({ ref: workflow, modelLabel: 'not-used', temporalLabel: 'next 09:00', host: 'vm', activeRuns: [run('running')], gatedRunCount: 0, latestRun: 'failed', nextSchedule: null, hasFailure: true }).status).toBe('running');
    expect(projectEntitySummary({ ref: workflow, modelLabel: 'not-used', temporalLabel: 'next 09:00', host: 'vm', activeRuns: [], gatedRunCount: 0, latestRun: 'failed', nextSchedule: null, hasFailure: true }).status).toBe('failed');
    expect(projectEntitySummary({ ref: workflow, modelLabel: 'not-used', temporalLabel: 'next 09:00', host: 'vm', activeRuns: [], gatedRunCount: 0, latestRun: null, nextSchedule: schedule, hasFailure: false }).status).toBe('scheduled');
    expect(projectEntitySummary({ ref: workflow, modelLabel: 'not-used', temporalLabel: 'next 09:00', host: 'vm', activeRuns: [run('running')], gatedRunCount: 0, latestRun: null, nextSchedule: schedule, hasFailure: false }).status).toBe('running');
    expect(projectEntitySummary({ ref: workflow, modelLabel: 'not-used', temporalLabel: 'next 09:00', host: 'vm', activeRuns: [], gatedRunCount: 0, latestRun: 'stopped', nextSchedule: schedule, hasFailure: false }).status).toBe('scheduled');
    expect(projectEntitySummary({ ref: workflow, modelLabel: 'not-used', temporalLabel: 'idle', host: 'vm', activeRuns: [], gatedRunCount: 0, latestRun: 'ok', nextSchedule: null, hasFailure: false }).status).toBe('idle');
  });

  it('keeps the card model workflow-safe and bounds Brief runs', () => {
    const summary = projectEntitySummary({ ref: workflow, modelLabel: 'gpt-5.6-sol', temporalLabel: 'next 09:00', host: 'vm', activeRuns: [], gatedRunCount: 0, latestRun: null, nextSchedule: null, hasFailure: false });
    expect(summary).toMatchObject({ humanName: 'Research Brief', modelLabel: 'varies', status: 'idle' });
    expect(projectEntityBrief({ purpose: 'Research a topic.', doingNow: 'Waiting.', recentRuns: Array.from({ length: 6 }, (_, index) => run('succeeded', `${index}`)), outputs: [], pendingGates: 0, schedule: null, autonomyTier: 'T2' }).recentRuns).toHaveLength(5);
    expect(projectLiveEmpty(null, null)).toBe('Never run · no schedule');
    expect(projectLiveEmpty(null, null)).toBe(detailFixture.liveEmpty);
    expect(projectLiveEmpty('2h ago', null)).toBe('Last ran 2h ago');
    expect(projectLiveEmpty(null, '09:00')).toBe('next 09:00');
    expect(projectLiveEmpty('2h ago', '09:00')).toBe('Last ran 2h ago · next 09:00');
  });

  it('emits definition-order step nodes and filters events only by selected stageRef', () => {
    const dag = projectStepDag({ stages: stepDagFixture.stages.map((stageRef) => ({ stageRef, label: stageRef === 'research' ? 'Research' : 'Write', dependsOn: stepDagFixture.edges.filter(([, to]) => to === stageRef).map(([from]) => from) })), events: [{ cursor: 2, stageRef: 'write' }, { cursor: 1, stageRef: 'research' }] });
    expect(dag.nodes.map((node) => node.stageRef)).toEqual(stepDagFixture.stages);
    expect(dag.edges).toEqual(stepDagFixture.edges.map(([from, to]) => ({ from, to })));
    expect(dag.eventsFor('write')).toEqual([{ cursor: 2, stageRef: 'write' }]);
    expect(dag.eventsFor(null)).toEqual([{ cursor: 2, stageRef: 'write' }, { cursor: 1, stageRef: 'research' }]);
  });
});

function run(lifecycle: 'running' | 'succeeded', suffix = ''): RunRow {
  return { runRef: `run-${suffix}`, title: 'Run', owner: workflow, lifecycle, streamKind: 'transcript', outcome: lifecycle === 'succeeded' ? 'ok' : null, createdAt: '2026-08-21T10:00:00.000Z', completedAt: lifecycle === 'succeeded' ? '2026-08-21T10:02:00.000Z' : null, elapsedMs: 120_000, toolsCalled: 0, lastLine: lifecycle, gateBadge: null };
}
