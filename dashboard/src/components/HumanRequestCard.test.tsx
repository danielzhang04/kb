// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HumanRequestCard } from './HumanRequestCard';

const request = {
  requestRef: 'request-1', runRef: 'run-1', displayName: 'A run', shortRef: 1, stageRef: 'stage-1',
  kind: 'review' as const, revision: 1, state: 'open' as const, title: 'Review this', prompt: 'Review this',
  ask: 'Please review this work.', technicalDetail: null, response: null, createdAt: '', updatedAt: '',
};

describe('HumanRequestCard', () => {
  it('sends the selected decision with the operator response text', () => {
    const onRespond = vi.fn();
    render(<HumanRequestCard request={request} busy={false} onRespond={onRespond} />);

    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Please revise the opening.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));

    expect(onRespond).toHaveBeenCalledWith('changes-requested', 'Please revise the opening.');
  });
});
