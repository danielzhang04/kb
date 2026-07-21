// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunCockpit } from './RunCockpit';
import type { OperationalEventDto, RunDetailDto } from './controlClient';

afterEach(cleanup);

const detail: RunDetailDto = {
  run: {
    runRef: 'run-1', predecessorRunRef: null, title: 'Synthetic control run', proposalRef: 'proposal-1', proposalRevision: 2,
    proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running', version: 4, managerSessionRef: 'session-manager',
    managerGeneration: 1,
    managerAssignment: {
      agentId: 'fyt-manager', declarationPath: 'agents/fyt-manager.md', declarationHash: 'm'.repeat(64),
      profileId: 'manager:claude:claude-sonnet-5', runtime: 'claude', model: 'claude-sonnet-5',
    },
    createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  },
  stages: [{
    stageRef: 'stage-1', runRef: 'run-1', stageId: 'compile', title: 'Compile proposal', dependsOn: [],
    canonicalCardRef: 'card-1', state: 'running', version: 2, currentAttemptRef: 'attempt-1',
    assignment: {
      agentId: 'fyt-worker', declarationPath: 'agents/fyt-worker.md', declarationHash: 'w'.repeat(64),
      profileId: 'worker:codex:gpt-5.6-sol', runtime: 'codex', model: 'gpt-5.6-sol',
    },
    createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  }],
  attempts: [{
    attemptRef: 'attempt-1', runRef: 'run-1', stageRef: 'stage-1', generation: 1,
    predecessorAttemptRef: null, runtime: 'codex', model: 'gpt-5.6-sol', state: 'running', version: 2,
    managedSessionRef: 'session-worker', createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  }],
  sessions: [{
    sessionRef: 'session-manager', runRef: 'run-1', stageRef: null, attemptRef: null, role: 'manager',
    generation: 1, predecessorSessionRef: null, runtime: 'claude', model: 'claude-sonnet-5', state: 'running',
    version: 2, createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  }],
  humanRequests: [{
    requestRef: 'request-1', runRef: 'run-1', stageRef: 'stage-1', kind: 'review', revision: 3,
    state: 'open', title: 'Review the diff', prompt: 'Is this change inside the approved scope?', response: null,
    createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  }],
};

const events: OperationalEventDto[] = [{
  cursor: 7, runRef: 'run-1', kind: 'tool', source: 'worker', stageRef: 'stage-1', attemptRef: 'attempt-1',
  sessionRef: 'session-worker', status: 'success', summary: null, command: null, toolName: 'apply_patch', path: null,
  diff: null, checkpoint: null, createdAt: '2026-07-18T10:01:00.000Z',
}];

/** The detail is tabbed now, so a section's content is asserted after activating its tab. */
function openTab(id: string): void {
  fireEvent.click(screen.getByTestId(`entity-tab-${id}`));
}

describe('RunCockpit', () => {
  it('projects manager, stage, attempt, canonical card, and public events', () => {
    render(<RunCockpit detail={detail} events={events} />);
    expect(screen.getByRole('heading', { name: 'Synthetic control run' })).toBeTruthy();
    expect(screen.getByText('session-manager')).toBeTruthy();
    expect(screen.getByText('fyt-manager · manager:claude:claude-sonnet-5')).toBeTruthy();

    openTab('stages');
    expect(screen.getByText('card-1')).toBeTruthy();
    const attempt = screen.getByTestId('run-attempt-attempt-1');
    expect(within(attempt).getByText('attempt 1')).toBeTruthy();
    expect(within(attempt).getByText('codex · gpt-5.6-sol')).toBeTruthy();
    expect(screen.getByTestId('run-stage-stage-1-assignment').textContent).toContain('fyt-worker · worker:codex:gpt-5.6-sol');
    expect(screen.getByText('Immutable logical assignment')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reroute Compile proposal/ })).toBeNull();

    openTab('timeline');
    expect(within(screen.getByLabelText('run run-1')).getByText('apply_patch')).toBeTruthy();
    expect(screen.getByText(/private reasoning and raw tool payloads are not part/i)).toBeTruthy();
  });

  it('names null run and stage assignments as unassigned without conflating them with executors', () => {
    const legacy: RunDetailDto = {
      ...detail,
      run: { ...detail.run, managerAssignment: null },
      stages: detail.stages.map((stage) => ({ ...stage, assignment: null })),
    };
    render(<RunCockpit detail={legacy} events={[]} />);
    expect(screen.getByText('unassigned')).toBeTruthy();
    openTab('stages');
    expect(screen.getByTestId('run-stage-stage-1-assignment').textContent).toContain('unassigned');
    expect(screen.getByText('codex · gpt-5.6-sol')).toBeTruthy();
  });

  it('offers an exact reroute only for a queued attempt whose stage has not started', () => {
    const onReroute = vi.fn();
    const queued: RunDetailDto = {
      ...detail,
      stages: detail.stages.map((stage) => ({ ...stage, state: 'ready', assignment: null })),
      attempts: detail.attempts.map((attempt) => ({ ...attempt, state: 'queued' })),
      sessions: [
        ...detail.sessions,
        {
          sessionRef: 'session-worker', runRef: 'run-1', stageRef: 'stage-1', attemptRef: 'attempt-1', role: 'worker',
          generation: 1, predecessorSessionRef: null, runtime: 'codex', model: 'gpt-5.6-sol', state: 'pending',
          version: 1, createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
        },
      ],
      humanRequests: [],
    };
    render(<RunCockpit detail={queued} events={[]} onReroute={onReroute} />);
    openTab('stages');
    expect(screen.getByText('Reroutable before start')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Reroute Compile proposal' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Runtime for Compile proposal'), { target: { value: 'claude' } });
    fireEvent.change(screen.getByLabelText('Model for Compile proposal'), { target: { value: 'claude-sonnet-5' } });
    fireEvent.click(button);
    expect(onReroute).toHaveBeenCalledWith(queued.stages[0], queued.attempts[0], 'claude', 'claude-sonnet-5');
  });

  it('withholds reroute controls and callbacks for an assigned queued stage', () => {
    const onReroute = vi.fn();
    const assignedQueued: RunDetailDto = {
      ...detail,
      stages: detail.stages.map((stage) => ({ ...stage, state: 'ready' })),
      attempts: detail.attempts.map((attempt) => ({ ...attempt, state: 'queued' })),
      sessions: [
        ...detail.sessions,
        {
          sessionRef: 'session-worker', runRef: 'run-1', stageRef: 'stage-1', attemptRef: 'attempt-1', role: 'worker',
          generation: 1, predecessorSessionRef: null, runtime: 'codex', model: 'gpt-5.6-sol', state: 'pending',
          version: 1, createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
        },
      ],
      humanRequests: [],
    };
    render(<RunCockpit detail={assignedQueued} events={[]} onReroute={onReroute} />);
    openTab('stages');
    expect(screen.getByText('Immutable logical assignment')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reroute Compile proposal' })).toBeNull();
    expect(screen.queryByLabelText('Runtime for Compile proposal')).toBeNull();
    expect(onReroute).not.toHaveBeenCalled();
  });

  it('keeps manager conversation separate from checkpoint-bound steering', () => {
    const onManagerMessage = vi.fn();
    const onSteer = vi.fn();
    render(<RunCockpit detail={detail} events={[]} onManagerMessage={onManagerMessage} onSteer={onSteer} />);

    fireEvent.change(screen.getByLabelText('Message manager'), { target: { value: 'Status, please.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onManagerMessage).toHaveBeenCalledWith('Status, please.');

    fireEvent.change(screen.getByLabelText('Safe checkpoint'), { target: { value: 'after-tests' } });
    fireEvent.change(screen.getByLabelText('Steering instruction'), { target: { value: 'Inspect the diff.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue steering' }));
    expect(onSteer).toHaveBeenCalledWith('after-tests', 'Inspect the diff.');
    expect(screen.getByText(/applies only when this checkpoint is reached/i)).toBeTruthy();
  });

  it('returns the durable Human Request object and revision-bound decision intent to integration code', () => {
    const onHumanResponse = vi.fn();
    render(<RunCockpit detail={detail} events={[]} onHumanResponse={onHumanResponse} />);
    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'Please narrow the scope.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(onHumanResponse).toHaveBeenCalledWith(detail.humanRequests[0], 'changes-requested', 'Please narrow the scope.');
  });

  it('does not offer an approval override for a governance refusal', () => {
    const refused: RunDetailDto = {
      ...detail,
      humanRequests: [{ ...detail.humanRequests[0], kind: 'governance-refusal' }],
    };
    render(<RunCockpit detail={refused} events={[]} onHumanResponse={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Approved' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Responded' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeTruthy();
  });

  it('offers Manager recovery only for a terminal or interrupted head', () => {
    const onManagerSuccessor = vi.fn();
    const interrupted: RunDetailDto = {
      ...detail,
      sessions: detail.sessions.map((session) => ({ ...session, state: 'interrupted' })),
    };
    render(<RunCockpit detail={interrupted} events={[]} onManagerSuccessor={onManagerSuccessor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start successor Manager' }));
    expect(onManagerSuccessor).toHaveBeenCalledTimes(1);
  });

  // ---- arc-3: the fields that were arriving in the browser and being discarded ----

  it('RENDERS THE DIFF BODY that the old event flattening discarded', () => {
    const patch = '@@ -1,3 +1,3 @@\n-const timeout = 30;\n+const timeout = 60;';
    const withDiff: OperationalEventDto[] = [{
      cursor: 9, runRef: 'run-1', kind: 'diff', source: 'worker', stageRef: 'stage-1',
      attemptRef: 'attempt-1', sessionRef: 'session-worker', status: 'success', summary: null,
      command: null, toolName: null, path: 'src/config.ts', diff: patch,
      createdAt: '2026-07-18T10:02:00.000Z', checkpoint: null,
    }];

    render(<RunCockpit detail={detail} events={withDiff} />);
    openTab('changes');

    expect(screen.getByTestId('run-change-9-diff').textContent).toBe(patch);
    expect(screen.getByText('src/config.ts')).toBeTruthy();
  });

  it('counts only diff-bearing events on the Changes tab', () => {
    const mixed: OperationalEventDto[] = [
      ...events,
      {
        cursor: 9, runRef: 'run-1', kind: 'diff', source: 'worker', stageRef: null, attemptRef: null,
        sessionRef: null, status: 'success', summary: null, command: null, toolName: null,
        path: 'src/a.ts', diff: '+one', createdAt: '2026-07-18T10:02:00.000Z', checkpoint: null,
      },
    ];

    render(<RunCockpit detail={detail} events={mixed} />);
    expect(within(screen.getByTestId('entity-tab-changes')).getByText('1')).toBeTruthy();
    expect(within(screen.getByTestId('entity-tab-timeline')).getByText('2')).toBeTruthy();
  });

  it('states honestly that no changes were recorded rather than showing an empty tab', () => {
    render(<RunCockpit detail={detail} events={events} />);
    openTab('changes');
    expect(screen.getByText(/No file changes have been recorded/i)).toBeTruthy();
  });

  /* ---- arc-3 fix: what the operator is NOT being shown, said out loud ---- */

  /**
   * The Activity stream already carried an honest note about its filtering. Changes — which the code
   * itself calls "the code history" — carried none, while every diff on it has been through
   * `redactSensitiveText(...).slice(0, 64 * 1024)` server-side and redacted again in `publicEvents.ts`.
   * A redacted, clipped diff rendered raw into a `<pre>` LOOKS complete. That is the failure mode.
   */
  it('discloses that diffs are redacted and capped, not raw patches', () => {
    const withDiff: OperationalEventDto[] = [{
      cursor: 9, runRef: 'run-1', kind: 'diff', source: 'worker', stageRef: null, attemptRef: null,
      sessionRef: null, status: 'success', summary: null, command: null, toolName: null,
      path: 'src/a.ts', diff: '+one', createdAt: '2026-07-18T10:02:00.000Z', checkpoint: null,
    }];
    render(<RunCockpit detail={detail} events={withDiff} />);
    openTab('changes');

    const note = screen.getByTestId('run-changes-note').textContent ?? '';
    expect(note).toMatch(/redacted/i);
    expect(note).toMatch(/64KB/i);
  });

  it('marks the specific diffs that were truncated, and only those', () => {
    const withDiffs: OperationalEventDto[] = [
      {
        cursor: 9, runRef: 'run-1', kind: 'diff', source: 'worker', stageRef: null, attemptRef: null,
        sessionRef: null, status: 'success', summary: null, command: null, toolName: null,
        path: 'src/small.ts', diff: '+one', createdAt: '2026-07-18T10:02:00.000Z', checkpoint: null,
      },
      {
        // Exactly the server's MAX_LONG_TEXT: this diff hit the slice and is NOT the whole change.
        cursor: 10, runRef: 'run-1', kind: 'diff', source: 'worker', stageRef: null, attemptRef: null,
        sessionRef: null, status: 'success', summary: null, command: null, toolName: null,
        path: 'src/huge.ts', diff: 'x'.repeat(64 * 1024), createdAt: '2026-07-18T10:03:00.000Z', checkpoint: null,
      },
    ];
    render(<RunCockpit detail={detail} events={withDiffs} />);
    openTab('changes');

    expect(screen.getByTestId('run-change-10-truncated')).toBeTruthy();
    expect(screen.queryByTestId('run-change-9-truncated')).toBeNull();
  });

  /**
   * The count mismatch the reviewer caught: the grid card printed the true `eventCount` while this tab
   * printed the capped `events.length`, so a 5,000-event run read "5000 events" in one place and "500"
   * in the other with nothing explaining the gap.
   */
  it('shows the run’s TRUE event count on the tab and says how much of it is on screen', () => {
    render(
      <RunCockpit
        detail={detail}
        events={events}
        eventWindow={{ events, seen: 5_000, complete: true }}
      />,
    );

    // Agrees with the grid card, not with the window length.
    expect(within(screen.getByTestId('entity-tab-timeline')).getByText('5000')).toBeTruthy();

    openTab('timeline');
    const note = screen.getByTestId('run-activity-window-note').textContent ?? '';
    expect(note).toMatch(/most recent/i);
    expect(note).toContain('5000');
  });

  it('does NOT claim "most recent" when paging stopped short of the tail', () => {
    render(
      <RunCockpit
        detail={detail}
        events={events}
        eventWindow={{ events, seen: 50_000, complete: false }}
      />,
    );
    openTab('timeline');

    const note = screen.getByTestId('run-activity-window-note').textContent ?? '';
    // The window here is an interior slice. Calling it the tail would be a lie.
    expect(note).not.toMatch(/most recent/i);
    expect(note).toMatch(/newest events are NOT shown/i);
  });

  it('says nothing extra when the whole trace fits in the window', () => {
    render(
      <RunCockpit detail={detail} events={events} eventWindow={{ events, seen: events.length, complete: true }} />,
    );
    openTab('timeline');
    expect(screen.queryByTestId('run-activity-window-note')).toBeNull();
  });

  it("renders a checkpoint's STATE as distinct from its NAME", () => {
    // The old chain read `summary` first, which on the broker path holds the STATE — so it printed
    // the bare word "reached" and lost "tests-green" entirely. Both must now be present and separate.
    const checkpointEvents: OperationalEventDto[] = [{
      cursor: 11, runRef: 'run-1', kind: 'checkpoint', source: 'manager', stageRef: 'stage-1',
      attemptRef: null, sessionRef: 'session-manager', status: 'success', summary: 'reached',
      command: null, toolName: null, path: null, diff: null, checkpoint: 'tests-green',
      createdAt: '2026-07-18T10:03:00.000Z',
    }];

    render(<RunCockpit detail={detail} events={checkpointEvents} />);
    openTab('timeline');

    const name = screen.getByTestId('run-event-11-checkpoint-name');
    const state = screen.getByTestId('run-event-11-checkpoint-state');

    expect(name.textContent).toBe('tests-green');
    expect(state.textContent).toBe('reached');
    // They are genuinely separate elements, not one concatenated string.
    expect(name).not.toBe(state);
  });

  it('distinguishes a blocked checkpoint from a reached one', () => {
    const blocked: OperationalEventDto[] = [{
      cursor: 12, runRef: 'run-1', kind: 'checkpoint', source: 'manager', stageRef: null,
      attemptRef: null, sessionRef: null, status: 'waiting', summary: 'blocked', command: null,
      toolName: null, path: null, diff: null, checkpoint: 'scope-review',
      createdAt: '2026-07-18T10:04:00.000Z',
    }];

    render(<RunCockpit detail={detail} events={blocked} />);
    openTab('timeline');

    const state = screen.getByTestId('run-event-12-checkpoint-state');
    expect(state.textContent).toBe('blocked');
    expect(state.className).toContain('run-activity__checkpoint--blocked');
  });

  it('renders the whole attempt chain, not only the current attempt', () => {
    const retried: RunDetailDto = {
      ...detail,
      attempts: [
        { ...detail.attempts[0], attemptRef: 'attempt-0', generation: 1, state: 'failed', predecessorAttemptRef: null },
        { ...detail.attempts[0], attemptRef: 'attempt-1', generation: 2, state: 'running', predecessorAttemptRef: 'attempt-0' },
      ],
    };

    render(<RunCockpit detail={retried} events={[]} />);
    openTab('stages');

    // The failed first attempt was previously invisible: only `stage.currentAttemptRef` was ever read.
    expect(screen.getByTestId('run-attempt-attempt-0')).toBeTruthy();
    const current = screen.getByTestId('run-attempt-attempt-1');
    expect(current.className).toContain('run-attempt--current');
    expect(within(current).getByText('retry of attempt-0')).toBeTruthy();
  });

  it('renders the managed-run dependency graph from dependsOn', () => {
    const chained: RunDetailDto = {
      ...detail,
      stages: [{ ...detail.stages[0], dependsOn: ['compile', 'lint'] }],
    };

    render(<RunCockpit detail={chained} events={[]} />);
    openTab('stages');

    expect(screen.getByTestId('run-stage-stage-1-depends').textContent).toBe('depends on compile, lint');
  });

  it('shows the proposal hash in full rather than sliced to 12 characters', () => {
    render(<RunCockpit detail={detail} events={[]} />);
    expect(within(screen.getByTestId('entity-detail-facts')).getByText('a'.repeat(64))).toBeTruthy();
  });

  it('offers the compiled checkpoints as a pick list instead of free text', () => {
    const onSteer = vi.fn();
    render(
      <RunCockpit
        detail={detail}
        events={[]}
        onSteer={onSteer}
        checkpoints={[{ id: 'after-tests', label: 'After tests' }, { id: 'after-review', label: 'After review' }]}
      />,
    );

    const select = screen.getByLabelText('Safe checkpoint');
    expect(select.tagName).toBe('SELECT');

    fireEvent.change(select, { target: { value: 'after-review' } });
    fireEvent.change(screen.getByLabelText('Steering instruction'), { target: { value: 'Narrow the scope.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue steering' }));

    expect(onSteer).toHaveBeenCalledWith('after-review', 'Narrow the scope.');
  });

  it('falls back to free text when the compiled checkpoint list could not be loaded', () => {
    // Steering must degrade, never disappear, if the proposal revision read fails.
    render(<RunCockpit detail={detail} events={[]} onSteer={vi.fn()} checkpoints={[]} />);
    expect(screen.getByLabelText('Safe checkpoint').tagName).toBe('INPUT');
  });

  it('flags the section that needs the operator', () => {
    render(<RunCockpit detail={detail} events={[]} />);
    expect(screen.getByTestId('entity-tab-overview-attention')).toBeTruthy();
  });

  it('calls back with the label of the surface it returns to', () => {
    const onBack = vi.fn();
    render(<RunCockpit detail={detail} events={[]} onBack={onBack} backLabel="All runs" />);

    const back = screen.getByTestId('entity-detail-back');
    expect(back.textContent).toContain('All runs');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('reports tab changes so the nav stack can restore them, and honours a controlled section', () => {
    const onSectionChange = vi.fn();
    render(
      <RunCockpit detail={detail} events={[]} activeSectionId="changes" onSectionChange={onSectionChange} />,
    );

    // The controlled section wins over the default first tab.
    expect(screen.getByTestId('entity-tab-changes').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('entity-tab-overview').getAttribute('aria-selected')).toBe('false');

    fireEvent.click(screen.getByTestId('entity-tab-stages'));
    expect(onSectionChange).toHaveBeenCalledWith('stages');
  });

  it('links a stage to its canonical queue card', () => {
    const onNavigate = vi.fn();
    render(<RunCockpit detail={detail} events={[]} onNavigate={onNavigate} />);
    openTab('stages');

    fireEvent.click(screen.getByTestId('run-stage-stage-1-card'));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'tasks', focus: { kind: 'card', id: 'card-1' } });
  });

  /**
   * arc-3 step 2 — the run's edges out. These are the links that were structurally missing: a run could
   * not name the workflow that produced it, the agent doing its work, or the run it was retried from.
   */
  describe('cross-entity links', () => {
    it('links a run to the agent working it, derived through the stage canonical card owner', () => {
      const onNavigate = vi.fn();
      render(
        <RunCockpit
          detail={detail}
          events={[]}
          onNavigate={onNavigate}
          cardOwners={new Map([['card-1', 'claude-worker']])}
        />,
      );

      fireEvent.click(screen.getByTestId('entity-link-claude-worker'));
      expect(onNavigate).toHaveBeenCalledWith({ view: 'agents', focus: { kind: 'agent', id: 'claude-worker' } });
    });

    it('labels the agent link as derived, because the join is indirect', () => {
      render(<RunCockpit detail={detail} events={[]} onNavigate={vi.fn()} cardOwners={new Map([['card-1', 'claude-worker']])} />);
      expect(screen.getByTestId('entity-link-claude-worker').textContent).toContain('via queue cards');
    });

    it('offers no agent link when the stage card has no owner', () => {
      render(<RunCockpit detail={detail} events={[]} onNavigate={vi.fn()} cardOwners={new Map()} />);
      expect(screen.queryByTestId('entity-link-claude-worker')).toBeNull();
    });

    it('links a run back to the workflow definition it was launched from', () => {
      const onNavigate = vi.fn();
      render(<RunCockpit detail={detail} events={[]} onNavigate={onNavigate} workflowId="video-pipeline" />);

      fireEvent.click(screen.getByTestId('entity-link-video-pipeline'));
      expect(onNavigate).toHaveBeenCalledWith({ view: 'workflows', focus: { kind: 'workflow', id: 'video-pipeline' } });
    });

    it('links a retried run to its predecessor', () => {
      const onNavigate = vi.fn();
      const retried = { ...detail, run: { ...detail.run, predecessorRunRef: 'run-0' } };
      render(<RunCockpit detail={retried} events={[]} onNavigate={onNavigate} />);

      fireEvent.click(screen.getByTestId('entity-link-run-0'));
      expect(onNavigate).toHaveBeenCalledWith({ view: 'pipeline', focus: { kind: 'run', id: 'run-0' } });
    });
  });

  it('does not call this surface a terminal', () => {
    render(<RunCockpit detail={detail} events={events} />);
    expect(screen.getByTestId('entity-tab-timeline').textContent).toContain('Activity stream');
    expect(document.body.textContent).not.toMatch(/terminal/i);
  });
});
