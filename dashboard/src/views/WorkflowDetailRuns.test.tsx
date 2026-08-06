// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkflowDetail, type WorkflowDefEntry } from './WorkflowDetail';
import type { RunMetadataDto } from '../control/controlClient';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(cleanup);

const workflow = (): WorkflowDefEntry => ({
  ref: 'kb~video.md', displayName: 'Video pipeline', shortRef: 1, project: 'kb',
  path: 'orgs/kb/workflows/video.md', sourceHash: 'a'.repeat(64), valid: true,
  title: 'Video pipeline', profile: 'standard', stageCount: 1, riskTier: 'T1',
  stages: [{ id: 'write', action: 'write', target: 'script.md', riskTier: 'T1' }], detail: null,
});

const run = (runRef: string): RunMetadataDto => ({
  runRef, displayName: `Run ${runRef}`, shortRef: 7, workflowRef: 'kb~video.md', state: 'running',
  publicationState: 'published', createdAt: '2026-08-06T12:00:00.000Z',
  updatedAt: '2026-08-06T12:01:00.000Z', openHumanRequestCount: 0,
} as RunMetadataDto);

describe('WorkflowDetail governed Runs tab', () => {
  it('lists governed runs only and opens one in RunDetail', () => {
    const onOpenRun = vi.fn();
    render(<WorkflowDetail entry={workflow()} compiled={null} runs={[run('run-7')]} onOpenRun={onOpenRun} />);

    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    fireEvent.click(screen.getByTestId('workflow-run-run-7'));

    expect(screen.getByTestId('workflow-runs')).toBeTruthy();
    expect(onOpenRun).toHaveBeenCalledWith('run-7');
  });

  it('keeps an unloaded run list distinct from an empty governed history', () => {
    const { rerender } = render(<WorkflowDetail entry={workflow()} compiled={null} />);
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    expect(screen.getByTestId('workflow-runs-unloaded')).toBeTruthy();

    rerender(<WorkflowDetail entry={workflow()} compiled={null} runs={[]} />);
    expect(screen.getByTestId('workflow-runs-empty').textContent).toMatch(/has not run yet/i);
  });
});
