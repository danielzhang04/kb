// @vitest-environment jsdom
/**
 * The workflow detail — one graph, one Launch, one list of runs.
 *
 * The headline assertions are the collapse itself: a run is reachable from the workflow that produced
 * it (through the server's grouping key, not a client-side re-derivation), running the workflow is ONE
 * button that needs nothing filled in first, and the engine vocabulary the surface used to lead with —
 * "compiled proposal", "proposal revision", "amendment", and now the parameterised governed launch
 * itself — is behind the technical fold or gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Workflows } from './Workflows';
import { SessionProvider } from '../lib/sessionContext';
import { WorkflowDetailBody as WorkflowDetail, type WorkflowDefEntry } from './WorkflowDetail';
import type { RunMetadataDto } from '../control/controlClient';

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

const def = (over: Partial<WorkflowDefEntry> & { ref: string }): WorkflowDefEntry => ({
  displayName: over.title ?? 'Video pipeline',
  shortRef: 1,
  project: 'kb',
  path: 'orgs/kb/workflows/video.md',
  sourceHash: 'a'.repeat(64),
  valid: true,
  title: 'Video pipeline',
  profile: 'standard',
  stageCount: 2,
  riskTier: 'T2',
  stages: [
    { id: 'write', action: 'write', target: 'script.md', riskTier: 'T1' },
    { id: 'render', action: 'render', target: 'out.mp4', riskTier: 'T2' },
  ],
  detail: null,
  ...over,
});

const run = (over: Partial<RunMetadataDto> & { runRef: string }): RunMetadataDto => ({
  ownerSubject: 'operator',
  predecessorRunRef: null,
  title: 'Rebuild the faceless video pipeline and republish the audio stage',
  displayName: 'Rebuild the faceless video pipeline and republish the audio stage',
  shortRef: 1,
  workflowRef: 'kb~video.md',
  proposalRef: 'wf-aaa',
  proposalRevision: 1,
  proposalHash: 'hash-a',
  publicationState: 'published',
  state: 'running',
  version: 1,
  managerSessionRef: 'sess-m',
  managerGeneration: 0,
  managerAssignment: null,
  createdAt: '2026-07-20T10:01:00.000Z',
  updatedAt: '2026-07-20T10:02:00.000Z',
  stageCount: 6,
  attemptCount: 11,
  sessionCount: 3,
  openHumanRequestCount: 0,
  eventCount: 340,
  ...over,
});

describe('reaching a workflow detail and coming back', () => {
  it('opens the detail on a workflow click and returns to the roster on back', () => {
    render(
      <SessionProvider>
        <Workflows
          definitions={{ items: [def({ ref: 'kb~video.md' }), def({ ref: 'kb~audio.md', title: 'Audio pipeline' })] }}
        />
      </SessionProvider>,
    );

    fireEvent.click(screen.getByTestId('workflow-open-kb~video.md'));

    const overlay = screen.getByRole('dialog');
    expect(within(overlay).getAllByTestId('entity-detail-workflow')).toHaveLength(1);
    expect(within(overlay).getByTestId('entity-detail-title').textContent).toBe('Video pipeline');
    expect(screen.getByTestId('workflow-def-kb~audio.md')).toBeTruthy();

    fireEvent.click(screen.getByTestId('entity-detail-close'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('entity-detail-workflow')).toBeNull();
    expect(screen.getByTestId('workflow-def-kb~audio.md')).toBeTruthy();
  });

  /**
   * A run's `workflowRef` outlives the definition it names once that file is deleted from `workflows/`.
   * This used to fall through to the roster with no message: the operator clicked a link, landed on a
   * list, and an invisible extra entry sat on the nav stack with no back affordance to pop it.
   */
  it('says a focused workflow is no longer registered instead of silently showing the roster', () => {
    const onBack = vi.fn();
    render(
      <SessionProvider>
        <Workflows
          definitions={{ items: [def({ ref: 'kb~video.md' })] }}
          focusWorkflowId="kb~deleted.md"
          onOpenWorkflow={vi.fn()}
          onBack={onBack}
        />
      </SessionProvider>,
    );

    expect(screen.queryByTestId('entity-detail-workflow')).toBeNull();
    expect(screen.getByTestId('workflow-not-found-ref').textContent).toBe('kb~deleted.md');
    expect(screen.queryByTestId('workflow-def-kb~video.md')).toBeNull();

    fireEvent.click(screen.getByTestId('workflow-not-found-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('does not call a workflow unregistered while the index is still loading', () => {
    // No `definitions` prop and no fetch result yet: the ref is UNKNOWN, not missing.
    render(<SessionProvider><Workflows focusWorkflowId="kb~video.md" onOpenWorkflow={vi.fn()} /></SessionProvider>);
    expect(screen.queryByTestId('workflow-not-found')).toBeNull();
  });
});

/**
 * The primary action is ONE button that needs nothing filled in first. The definition already says who
 * runs what, so running a workflow is a click, not a form. The governed direct launch — with the inputs
 * the definition declares — is still fully wired, one fold down, for the governing agent and power use.
 */
describe('one Run workflow button', () => {
  it('offers exactly one primary action, and it lands IN THIS PAGE on the Runs tab', () => {
    render(<WorkflowDetail
      entry={def({ ref: 'kb~video.md', parameters: ['channel', 'slug'] })}
      compiled={null}
      onLaunch={vi.fn()}
    />);

    expect(screen.getAllByTestId('workflow-run')).toHaveLength(1);

    // Leg 2: no navigation away. The click selects this detail's own Runs tab, where the session opens.
    fireEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
    expect(screen.getByLabelText('Live session for this workflow')).toBeTruthy();
  });

  it('moves the inputs and the direct Launch into the technical fold, still working', () => {
    const onParameterChange = vi.fn();
    const onLaunch = vi.fn();
    render(<WorkflowDetail
      entry={def({ ref: 'kb~video.md', parameters: ['channel', 'slug'] })}
      compiled={null}
      onLaunch={onLaunch}
      parameterValues={{ channel: 'the-second-take', slug: '2026-07-19-wells-fargo' }}
      onParameterChange={onParameterChange}
    />);

    const fold = screen.getByTestId('workflow-technical');
    expect(fold.contains(screen.getByTestId('workflow-direct-launch'))).toBe(true);
    expect(fold.contains(screen.getByLabelText('Workflow parameter channel'))).toBe(true);
    expect(fold.contains(screen.getByRole('button', { name: 'Launch' }))).toBe(true);

    fireEvent.change(screen.getByLabelText('Workflow parameter slug'), { target: { value: '2026-08-05-bricks' } });
    expect(onParameterChange).toHaveBeenCalledWith('slug', '2026-08-05-bricks');
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    expect(onLaunch).toHaveBeenCalled();
  });

  it('keeps the Flow tab as the landing section, so a visit never auto-opens a console', () => {
    render(<WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} surface="brief" />);
    expect(screen.getByTestId('workflow-agent-network')).toBeTruthy();
    // The console section only exists once the operator asks for the Runs tab.
    expect(screen.queryByLabelText('Live session for this workflow')).toBeNull();
  });
});

describe('the governed direct launch, with its inputs, behind the fold', () => {
  it('enables Launch when the definition compiles and states the refusal when it does not', () => {
    const onLaunch = vi.fn();
    const { rerender } = render(<WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} onLaunch={onLaunch} />);
    const launch = () => screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    expect(launch().disabled).toBe(false);
    fireEvent.click(launch());
    expect(onLaunch).toHaveBeenCalled();

    rerender(<WorkflowDetail
      entry={def({
        ref: 'kb~video.md', launchable: false, compileError: 'assigned-agent-not-runner-bound',
        compileDetail: "assigned agent 'worker-a' is not runner-bound",
      })}
      compiled={null}
      onLaunch={onLaunch}
    />);
    expect(launch().disabled).toBe(true);
    expect(screen.getByTestId('workflow-compile-unavailable').textContent)
      .toContain("assigned agent 'worker-a' is not runner-bound");
  });

  it('puts declared inputs beside the button and holds Launch until each is filled', () => {
    const onParameterChange = vi.fn();
    const { rerender } = render(<WorkflowDetail
      entry={def({ ref: 'kb~video.md', parameters: ['channel', 'slug'] })}
      compiled={null}
      onLaunch={vi.fn()}
      parameterValues={{}}
      onParameterChange={onParameterChange}
    />);
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Workflow parameter channel'), { target: { value: 'the-second-take' } });
    expect(onParameterChange).toHaveBeenCalledWith('channel', 'the-second-take');

    rerender(<WorkflowDetail
      entry={def({ ref: 'kb~video.md', parameters: ['channel', 'slug'] })}
      compiled={null}
      onLaunch={vi.fn()}
      parameterValues={{ channel: 'the-second-take', slug: '2026-07-19-wells-fargo' }}
      onParameterChange={onParameterChange}
    />);
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks Launch on a pending change and says so in plain words', () => {
    render(<WorkflowDetail
      entry={def({ ref: 'kb~video.md' })}
      compiled={null}
      onLaunch={vi.fn()}
      blockedReason="A change to this workflow is waiting for a human to review it, so it cannot run yet."
    />);
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(true);
    const blocked = screen.getByTestId('workflow-blocked').textContent ?? '';
    expect(blocked).toContain('waiting for a human to review it');
    // The machinery's own words never reach the operator.
    expect(blocked).not.toMatch(/amendment|canonical|proposal revision/i);
  });
});

describe('workflow -> its runs', () => {
  it('lists this workflow runs and opens one, grouped on the server key', () => {
    const onOpenRun = vi.fn();
    render(
      <SessionProvider>
        <Workflows
          definitions={{ items: [def({ ref: 'kb~video.md' })] }}
          focusWorkflowId="kb~video.md"
          onOpenWorkflow={vi.fn()}
          onOpenRun={onOpenRun}
          runs={[
            run({ runRef: 'run-7' }),
            run({ runRef: 'run-8', workflowRef: 'kb~audio.md' }),
          ]}
        />
      </SessionProvider>,
    );

    const overlay = screen.getByRole('dialog');
    expect(within(overlay).getByTestId('workflow-run-run-7')).toBeTruthy();
    expect(within(overlay).queryByTestId('workflow-run-run-8')).toBeNull();

    fireEvent.click(within(overlay).getByTestId('workflow-run-run-7'));
    expect(onOpenRun).toHaveBeenCalledWith('run-7');
  });

  it('badges every run row with the subject that owns it, engine-owned and own alike', () => {
    // A verified operator session lists every subject's runs in ONE list, so a row without an owner
    // badge is unidentifiable. The badge is uniform rather than foreign-only: a conditional badge
    // reads as an alert instead of provenance.
    render(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md' })}
        compiled={null}
        runs={[
          run({ runRef: 'run-7' }),
          run({ runRef: 'run-9', ownerSubject: 'dashboard-engine' }),
        ]}
      />,
    );
    expect(screen.getByTestId('workflow-run-run-7-owner').textContent).toBe('operator');
    expect(screen.getByTestId('workflow-run-run-9-owner').textContent).toBe('dashboard-engine');
  });

  it('renders the full run title without truncating it', () => {
    render(<WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} runs={[run({ runRef: 'run-7' })]} />);
    expect(screen.getByTestId('workflow-run-run-7').textContent).toContain(
      'Rebuild the faceless video pipeline and republish the audio stage',
    );
  });

  it('says "not loaded" rather than "never run" when the tab is locked', () => {
    render(<WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} />);
    expect(screen.getByTestId('workflow-runs-unloaded').textContent).toMatch(/unlock the dashboard/i);
    expect(screen.queryByTestId('workflow-runs-empty')).toBeNull();
  });

  it('says "has not run yet" when there genuinely are none', () => {
    render(<WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} runs={[]} />);
    expect(screen.getByTestId('workflow-runs-empty').textContent).toMatch(/has not run yet/i);
  });
});

describe('the graph is the surface, and the engine detail is behind one fold', () => {
  it('renders the agent graph in the LANDING body, behind no tab of its own', () => {
    render(<WorkflowDetail
      entry={def({
        ref: 'kb~video.md',
        stages: [{ id: 'write', title: 'Write', action: 'write', target: 'script.md', riskTier: 'T1', declaredAssignment: { agentId: 'worker-a', profileId: 'worker:claude:claude-sonnet-5' } }],
      })}
      compiled={null}
    />);
    // Leg 2 adds exactly ONE more section (the merged run/session history) — not the five engine tabs
    // this surface used to have, and the graph is still what an operator lands on.
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByTestId('workflow-agent-network')).toBeTruthy();
  });

  it('keeps ids, hashes and step scope inside the technical fold', () => {
    const hash = 'c'.repeat(64);
    render(<WorkflowDetail
      entry={def({ ref: 'kb~video.md' })}
      compiled={{
        ok: true,
        proposalId: 'wf-abc123',
        contentHash: hash,
        stages: [{
          id: 'render', title: 'Render', action: 'render', target: 'out.mp4',
          workOrder: 'Render the approved script to video.', riskTier: 'T2', dependsOn: ['write'],
          worker: { runtime: 'claude', model: 'claude-opus-4-8' }, requiredSkills: [],
          scope: { read: ['script.md'], write: ['out.mp4'] }, artifacts: [], checkpoints: [], humanGates: [],
        }],
      }}
    />);
    const fold = screen.getByTestId('workflow-technical');
    expect(fold.textContent).toContain('orgs/kb/workflows/video.md');
    expect(fold.textContent).toContain('wf-abc123');
    // In FULL — a sliced hash cannot be compared against anything, which is its only purpose.
    expect(fold.textContent).toContain(hash);
    expect(screen.getByTestId('workflow-stage-render').textContent).toContain('after write');
    expect(screen.getByTestId('workflow-stages').textContent).toContain('Render the approved script to video.');
    expect(screen.getByTestId('workflow-stages').textContent).toContain('script.md');
  });

  it('renders the reason a workflow does not read, as text rather than a title= tooltip', () => {
    render(<WorkflowDetail
      entry={def({ ref: 'kb~broken.md', valid: false, detail: 'stage "render" depends on unknown stage "mix"' })}
      compiled={null}
    />);
    expect(screen.getByTestId('workflow-invalid-detail').textContent).toContain(
      'stage "render" depends on unknown stage "mix"',
    );
    expect(screen.getByTestId('workflow-invalid-detail').textContent).toContain('depends on unknown stage');
  });

  it('surfaces checked-in governance diagnostics without calling the workflow broken', () => {
    render(<WorkflowDetail entry={def({
      ref: 'kb~governance.md',
      governanceProblems: [
        "workflow governance agent 'missing-governor' is not declared",
        "stage 'render' governance agent 'other-agent' is not declared for project 'kb'",
      ],
    })} compiled={null} />);
    const warning = screen.getByTestId('workflow-governance-problems');
    expect(warning.textContent).toContain('missing-governor');
    expect(warning.textContent).toContain('other-agent');
    expect(screen.queryByTestId('workflow-invalid-detail')).toBeNull();
  });

  it('says a compile failure out loud instead of leaving an empty panel', () => {
    render(<WorkflowDetail
      entry={def({ ref: 'kb~video.md', launchable: false, compileDetail: 'stage "render" requires skill "ffmpeg"' })}
      compiled={{ ok: false, error: 'unknown-skill', detail: 'stage "render" requires skill "ffmpeg"' }}
    />);
    expect(screen.getByTestId('workflow-compile-unavailable').textContent).toContain('requires skill "ffmpeg"');
  });
});
