// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EntityDetail } from '../../server/entities/contracts.ts';
import { WorkflowDetailBody, WorkflowTechnicalDetails } from './WorkflowDetail';

afterEach(cleanup);

const detail = {
  summary: { temporalLabel: 'Never run \u00b7 no schedule', activeRuns: [{ runRef: 'run-7', title: 'Research', lifecycle: 'running', outcome: null, elapsedMs: 12_000, toolsCalled: 3, lastLine: 'Checking sources.', gateBadge: '1 pending' }] },
  brief: { purpose: 'Produce a cited brief.', doingNow: 'Researching.', autonomyTier: 'T2', pendingGates: 1, schedule: { nextAt: '2026-08-23T12:00:00.000Z' }, recentRuns: [], outputs: [{ kind: 'artifact', label: 'Cited brief', path: 'orgs/kb-ops/output/brief.md' }] },
  details: {
    sourcePath: 'orgs/kb-ops/workflows/research-brief.md', sourceRevision: 'a'.repeat(64), tools: [], declaredCeiling: 'T2',
    replaces: [], buildsOn: [], knowledgeSources: [], skills: [], schemas: ['workflow-definition/v1'], lineage: [], grades: [], ids: ['research-brief'],
    workflow: {
      stepDag: { nodes: [{ stageRef: 'definition-brief', label: 'Brief' }, { stageRef: 'definition-review', label: 'Review' }], edges: [{ from: 'definition-brief', to: 'definition-review' }] }, parameters: [],
      runGraph: {
        runRef: 'run-7',
        stages: [
          { stageRef: 'stage-brief-immutable', stageId: 'brief', title: 'Brief', dependsOn: [], state: 'succeeded' },
          { stageRef: 'stage-review-immutable', stageId: 'review', title: 'Review', dependsOn: ['brief'], state: 'running' },
        ],
        attempts: [],
        events: [
          { cursor: 1, stageRef: 'stage-brief-immutable', kind: 'message', summary: 'Brief completed.', createdAt: '2026-08-22T01:00:00.000Z' },
          { cursor: 2, stageRef: 'stage-review-immutable', kind: 'tool', summary: 'Reviewing citations.', createdAt: '2026-08-22T01:01:00.000Z' },
        ],
      },
    },
  },
} as unknown as EntityDetail;

describe('WorkflowDetailBody', () => {
  it('renders immutable run stages, filters their ordered event stream, and opens the exact Live row', () => {
    const open = vi.fn();
    render(<WorkflowDetailBody detail={detail} onOpenRun={open} />);
    expect(screen.getByTestId('workflow-step-graph')).toBeTruthy();
    expect(screen.getByText('Brief completed.')).toBeTruthy();
    expect(screen.getByText('Reviewing citations.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Brief' }));
    expect(screen.getByText('Brief completed.')).toBeTruthy();
    expect(screen.queryByText('Reviewing citations.')).toBeNull();
    const row = screen.getByRole('button', { name: /^Research / });
    expect(row.textContent).toBe('Research \u00b7 running \u00b7 12s \u00b7 3 tools \u00b7 Checking sources. \u00b7 1 pending');
    fireEvent.click(row);
    expect(open).toHaveBeenCalledWith('run-7');
  });

  it('keeps Brief and the single closed technical disclosure data separate', () => {
    const { rerender } = render(<WorkflowDetailBody detail={detail} surface="brief" />);
    expect(screen.getByText('Produce a cited brief.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cited brief' }).getAttribute('href')).toBe('/files?path=orgs%2Fkb-ops%2Foutput%2Fbrief.md');
    rerender(<WorkflowTechnicalDetails detail={detail} />);
    expect(screen.getByText('orgs/kb-ops/workflows/research-brief.md')).toBeTruthy();
  });
});
