// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkflowStepGraph } from './WorkflowStepGraph';

afterEach(cleanup);

describe('WorkflowStepGraph', () => {
  it('renders definition-order steps and selects one stream predicate without a second viewer', () => {
    const onSelect = vi.fn();
    render(<WorkflowStepGraph dag={{ nodes: [{ stageRef: 'research', label: 'Research' }, { stageRef: 'write', label: 'Write' }], edges: [{ from: 'research', to: 'write' }], eventsFor: () => [] }} selectedStageRef={null} onSelectStage={onSelect} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['All', 'Research', 'Write']);
    fireEvent.click(screen.getByRole('button', { name: 'Write' }));
    expect(onSelect).toHaveBeenCalledWith('write');
  });
});
