// @vitest-environment jsdom
/**
 * arc-3 step 4 — the workflow-definition detail.
 *
 * The headline assertion is workflow → its runs: before the `sourceTurnId` un-drop there was no way to
 * get from a definition to anything it had ever launched, so Launch printed a runRef into a status
 * string and the trail ended there. That path is pinned end to end here — through the real join, not a
 * stubbed run list — so a regression in either the un-drop or the join fails a test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Workflows } from './Workflows';
import { WorkflowDetail, type WorkflowDefEntry } from './WorkflowDetail';
import type { ProposalRevisionMetadataDto, RunMetadataDto } from '../control/controlClient';

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

const def = (over: Partial<WorkflowDefEntry> & { ref: string }): WorkflowDefEntry => ({
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

const revision = (over: Partial<ProposalRevisionMetadataDto> = {}): ProposalRevisionMetadataDto => ({
  proposalRef: 'wf-aaa',
  revision: 1,
  contentHash: 'hash-a',
  previousContentHash: null,
  createdAt: '2026-07-20T10:00:00.000Z',
  sourceComposerRef: 'workflow-registry',
  sourceTurnId: 'kb~video.md',
  approval: null,
  ...over,
});

const run = (over: Partial<RunMetadataDto> & { runRef: string }): RunMetadataDto => ({
  predecessorRunRef: null,
  title: 'Rebuild the faceless video pipeline and republish the audio stage',
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
  it('opens the detail on a definition click and returns to the list on back', () => {
    render(
      <Workflows
        definitions={{ items: [def({ ref: 'kb~video.md' }), def({ ref: 'kb~audio.md', title: 'Audio pipeline' })] }}
      />,
    );

    fireEvent.click(screen.getByTestId('workflow-open-kb~video.md'));

    expect(screen.getByTestId('entity-detail-workflow')).toBeTruthy();
    expect(screen.getByTestId('entity-detail-title').textContent).toBe('Video pipeline');
    expect(screen.queryByTestId('workflow-def-kb~audio.md')).toBeNull();

    fireEvent.click(screen.getByTestId('entity-detail-back'));

    expect(screen.queryByTestId('entity-detail-workflow')).toBeNull();
    expect(screen.getByTestId('workflow-def-kb~audio.md')).toBeTruthy();
  });

  /**
   * A `sourceTurnId` on an older run outlives the definition it names once that file is deleted from
   * `workflows/`. This used to fall through to the roster with no message: the operator clicked a link,
   * landed on a list, and an invisible extra entry sat on the nav stack with no back affordance to pop it.
   */
  it('says a focused definition is no longer registered instead of silently showing the roster', () => {
    const onBack = vi.fn();
    render(
      <Workflows
        definitions={{ items: [def({ ref: 'kb~video.md' })] }}
        focusWorkflowId="kb~deleted.md"
        onOpenWorkflow={vi.fn()}
        onBack={onBack}
      />,
    );

    expect(screen.queryByTestId('entity-detail-workflow')).toBeNull();
    // The dead ref is NAMED.
    expect(screen.getByTestId('workflow-not-found-ref').textContent).toBe('kb~deleted.md');
    // And the operator is not quietly dropped on a roster they did not ask for.
    expect(screen.queryByTestId('workflow-def-kb~video.md')).toBeNull();

    fireEvent.click(screen.getByTestId('workflow-not-found-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('does not call a definition unregistered while the index is still loading', () => {
    // No `definitions` prop and no fetch result yet: the ref is UNKNOWN, not missing.
    render(<Workflows focusWorkflowId="kb~video.md" onOpenWorkflow={vi.fn()} />);
    expect(screen.queryByTestId('workflow-not-found')).toBeNull();
  });

  it('visibly disables Launch for a parser-valid definition the compiler refuses', () => {
    render(
      <Workflows
        definitions={{ items: [def({
          ref: 'kb~unavailable.md', launchable: false, compileError: 'assigned-agent-not-runner-bound',
          compileDetail: "assigned agent 'worker-a' is not runner-bound",
        })] }}
      />,
    );
    const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    expect(screen.getByTestId('workflow-def-unavailable-kb~unavailable.md').textContent).toContain("assigned agent 'worker-a' is not runner-bound");
  });
});

/** The step-2 payoff, asserted through the real join rather than a hand-fed run list. */
describe('workflow -> its launched runs', () => {
  it('reaches the runs launched from this definition, via sourceTurnId', () => {
    const onNavigate = vi.fn();
    render(
      <Workflows
        definitions={{ items: [def({ ref: 'kb~video.md' })] }}
        focusWorkflowId="kb~video.md"
        onOpenWorkflow={vi.fn()}
        onNavigate={onNavigate}
        revisions={[revision(), revision({ proposalRef: 'wf-other', sourceTurnId: 'kb~audio.md' })]}
        runs={[
          run({ runRef: 'run-7', proposalRef: 'wf-aaa' }),
          run({ runRef: 'run-8', proposalRef: 'wf-other' }),
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId('entity-tab-runs'));

    // Only the run whose proposal this definition actually stamped.
    expect(screen.getByTestId('workflow-run-run-7')).toBeTruthy();
    expect(screen.queryByTestId('workflow-run-run-8')).toBeNull();

    // And it is a LIVE link into the run detail, not inert text.
    fireEvent.click(screen.getByTestId('workflow-run-run-7'));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'pipeline', focus: { kind: 'run', id: 'run-7' } });
  });

  it('renders the full run title without truncating it', () => {
    render(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md' })}
        compiled={null}
        runs={[run({ runRef: 'run-7' })]}
      />,
    );
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    expect(screen.getByTestId('workflow-run-run-7').textContent).toContain(
      'Rebuild the faceless video pipeline and republish the audio stage',
    );
  });

  it('says "not loaded" rather than "never launched" when there is no session', () => {
    render(<WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} />);
    fireEvent.click(screen.getByTestId('entity-tab-runs'));

    expect(screen.getByTestId('workflow-runs-unloaded').textContent).toMatch(/needs an unlocked cockpit session/i);
    expect(screen.queryByTestId('workflow-runs-empty')).toBeNull();
  });

  it('says "not launched yet" when the join genuinely returns nothing', () => {
    render(<WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} runs={[]} />);
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    expect(screen.getByTestId('workflow-runs-empty').textContent).toMatch(/not been launched yet/i);
  });
});

describe('fields the tables never rendered', () => {
  it('renders the invalid reason as readable text instead of a title= tooltip', () => {
    render(
      <WorkflowDetail
        activeSectionId="overview"
        entry={def({ ref: 'kb~broken.md', valid: false, detail: 'stage "render" depends on unknown stage "mix"' })}
        compiled={null}
      />,
    );
    expect(screen.getByTestId('workflow-invalid-detail').textContent).toContain(
      'stage "render" depends on unknown stage "mix"',
    );
  });

  it('renders the definition-level risk tier', () => {
    render(<WorkflowDetail activeSectionId="overview" entry={def({ ref: 'kb~video.md', riskTier: 'T3' })} compiled={null} />);
    expect(screen.getByTestId('workflow-facts').textContent).toContain('T3');
  });

  it('renders compiled stages with their dependencies and scope', () => {
    render(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md' })}
        compiled={{
          ok: true,
          proposalId: 'wf-abc123',
          contentHash: 'c'.repeat(64),
          stages: [{
            id: 'render', title: 'Render', action: 'render', target: 'out.mp4',
            workOrder: 'Render the approved script to video.', riskTier: 'T2', dependsOn: ['write'],
            worker: { runtime: 'claude', model: 'claude-opus-4-8' }, requiredSkills: [],
            scope: { read: ['script.md'], write: ['out.mp4'] }, artifacts: [], checkpoints: [], humanGates: [],
          }],
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('entity-tab-stages'));

    const stage = screen.getByTestId('workflow-stage-render');
    expect(stage.textContent).toContain('depends on write');
    const stages = screen.getByTestId('workflow-stages');
    expect(stages.textContent).toContain('Render the approved script to video.');
    expect(stages.textContent).toContain('script.md');
  });

  it('renders the compiled proposal identity in full', () => {
    const hash = 'c'.repeat(64);
    render(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md' })}
        compiled={{ ok: true, proposalId: 'wf-abc123', contentHash: hash, stages: [] }}
      />,
    );
    fireEvent.click(screen.getByTestId('entity-tab-compiled'));

    const compiled = screen.getByTestId('workflow-compiled');
    expect(compiled.textContent).toContain('wf-abc123');
    // In FULL — a sliced hash cannot be compared against anything, which is its only purpose.
    expect(compiled.textContent).toContain(hash);
  });

  it('surfaces a compile failure instead of an empty panel', () => {
    render(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md' })}
        compiled={{ ok: false, error: 'unknown-skill', detail: 'stage "render" requires skill "ffmpeg"' }}
      />,
    );
    fireEvent.click(screen.getByTestId('entity-tab-compiled'));
    expect(screen.getByTestId('workflow-compile-error').textContent).toContain('requires skill "ffmpeg"');
  });

  it('renders manager and stage declared assignments separately from immutable effective routing', () => {
    render(
      <WorkflowDetail
        entry={def({
          ref: 'kb~assigned.md',
          profile: 'research',
          manager: { agentId: 'manager-a', profileId: 'manager:claude:claude-opus-4-8' },
          stages: [{ id: 'write', action: 'write', target: 'script.md', riskTier: 'T1', declaredAssignment: { agentId: 'worker-a', profileId: 'worker:claude:claude-sonnet-5' } }],
        })}
        compiled={{
          ok: true, proposalId: 'wf-assigned', contentHash: 'a'.repeat(64),
          manager: { runtime: 'claude', model: 'claude-opus-4-8', requiredSkills: [], assignment: { agentId: 'manager-a', profileId: 'manager:claude:claude-opus-4-8', declarationPath: 'agents/manager-a.md', declarationHash: 'm'.repeat(64), runtime: 'claude', model: 'claude-opus-4-8' } },
          stages: [{ id: 'write', title: 'Write', action: 'write', target: 'script.md', workOrder: 'Write.', riskTier: 'T1', dependsOn: [], worker: { runtime: 'claude', model: 'claude-sonnet-5' }, requiredSkills: [], scope: { read: [], write: ['script.md'] }, artifacts: [], checkpoints: [], humanGates: [], assignment: { agentId: 'worker-a', profileId: 'worker:claude:claude-sonnet-5', declarationPath: 'agents/worker-a.md', declarationHash: 'w'.repeat(64), runtime: 'claude', model: 'claude-sonnet-5' } }],
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('entity-tab-overview'));
    expect(screen.getByTestId('workflow-manager-routing').textContent).toContain('manager-a · manager:claude:claude-opus-4-8');
    expect(screen.getByTestId('workflow-manager-routing').textContent).toContain('claude/claude-opus-4-8');
    expect(screen.getByTestId('workflow-manager-routing').textContent).toContain('m'.repeat(64));
    fireEvent.click(screen.getByTestId('entity-tab-stages'));
    expect(screen.getByTestId('workflow-stage-routing-write').textContent).toContain('worker-a · worker:claude:claude-sonnet-5');
    expect(screen.getByTestId('workflow-stage-routing-write').textContent).toContain('w'.repeat(64));
    expect(screen.getByTestId('entity-detail-facts').textContent).toContain('Workflow tool profile');
  });

  it('renders unassigned routing and exposes an exact compiler refusal as unavailable', () => {
    render(
      <WorkflowDetail
        entry={def({ ref: 'kb~unavailable.md', launchable: false, compileError: 'assigned-agent-not-runner-bound', compileDetail: "assigned agent 'worker-a' is not runner-bound" })}
        compiled={{ ok: false, error: 'assigned-agent-not-runner-bound', detail: "assigned agent 'worker-a' is not runner-bound" }}
      />,
    );
    fireEvent.click(screen.getByTestId('entity-tab-overview'));
    expect(screen.getByTestId('workflow-compile-unavailable').textContent).toContain("assigned agent 'worker-a' is not runner-bound");
    expect(screen.getByTestId('workflow-manager-routing').textContent).toContain('unassigned');
    fireEvent.click(screen.getByTestId('entity-tab-stages'));
    expect(screen.getByTestId('workflow-stage-routing-write').textContent).toContain('Effective routing unavailable');
  });
});
