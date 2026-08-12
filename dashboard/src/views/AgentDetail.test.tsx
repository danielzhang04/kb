// @vitest-environment jsdom
/**
 * arc-3 step 3 — the agent detail.
 *
 * Two things are pinned here above all: that an agent row is REACHABLE (click in, back out — which the
 * view previously had no way to do at all), and that a missing `agents/<id>.md` produces an explicit
 * stated absence rather than a panel of blanks. The second matters because `agents/` does not exist in
 * this checkout, so the not-declared path is the one every real operator hits today.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Agents } from './Agents';
import { SessionProvider } from '../lib/sessionContext';
import { AgentDetail, type AgentDetailRow } from './AgentDetail';
import type { AgentRosterEntry } from '../../server/agents/roster';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { RunMetadataDto } from '../control/controlClient';

afterEach(cleanup);

function agent(over: Partial<AgentDetailRow> & { id: string }): AgentDetailRow {
  return {
    display: { displayName: over.id, shortRef: 1 },
    role: null,
    working: false,
    current: null,
    projects: [],
    cardCount: 0,
    lastActive: null,
    declared: false,
    runnerBound: false,
    declaredRuntime: null,
    declaredModel: null,
    defaultProfile: null,
    allowedProfiles: null,
    description: null,
    ledger: { dispatches: 0, steps: 0, days: 0 },
    sources: [],
    ...over,
  };
}

function entry(over: Partial<AgentRosterEntry> & { id: string }): AgentRosterEntry {
  return {
    displayName: over.id,
    shortRef: 1,
    role: null,
    working: false,
    current: null,
    projects: [],
    cardCount: 0,
    ledger: { dispatches: 0, steps: 0, days: 0, lastActive: null },
    sources: [],
    effective: { runtime: 'claude', model: 'claude-opus-4-8', sourceRuntime: 'policy', sourceModel: 'policy' },
    declared: true,
    runnerBound: false,
    declaredRuntime: null,
    declaredModel: null,
    defaultProfile: null,
    allowedProfiles: null,
    description: null,
    ...over,
  };
}

const EMPTY_INDEX: PlaneAIndex = {
  cards: {},
  ledgers: {
    dispatch: { count: 0, cards: 0, byProject: {} },
    cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
    grades: { count: 0, rows: [] },
    activity: { count: 0, rows: [] },
  },
  orgStates: [],
};

const run = (over: Partial<RunMetadataDto> & { runRef: string }): RunMetadataDto => ({
  ownerSubject: 'operator',
  predecessorRunRef: null,
  title: 'Rebuild the faceless video pipeline',
  displayName: 'Rebuild the faceless video pipeline',
  shortRef: 1,
  workflowRef: null,
  proposalRef: 'wf-aaa',
  proposalRevision: 1,
  proposalHash: 'hash-a',
  publicationState: 'published',
  state: 'running',
  version: 1,
  managerSessionRef: 'sess-m',
  managerGeneration: 0,
  managerAssignment: null,
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:01:00.000Z',
  stageCount: 1,
  attemptCount: 1,
  sessionCount: 1,
  openHumanRequestCount: 0,
  eventCount: 4,
  ...over,
});

describe('reaching an agent detail and coming back', () => {
  it('opens the detail on a row click and returns to the full list on back', () => {
    render(<SessionProvider><Agents snapshot={EMPTY_INDEX} roster={[entry({ id: 'claude-worker' }), entry({ id: 'codex-worker' })]} /></SessionProvider>);

    // The roster is a list of every agent...
    expect(screen.getByTestId('agent-row-claude-worker')).toBeTruthy();
    expect(screen.getByTestId('agent-row-codex-worker')).toBeTruthy();

    fireEvent.click(screen.getByTestId('agent-open-claude-worker'));

    // ...and is REPLACED by the one agent's detail, not appended to.
    expect(screen.getByTestId('entity-detail-agent')).toBeTruthy();
    expect(screen.getByTestId('entity-detail-title').textContent).toContain('claude-worker');
    expect(screen.queryByTestId('agent-row-codex-worker')).toBeNull();

    fireEvent.click(screen.getByTestId('entity-detail-back'));

    expect(screen.queryByTestId('entity-detail-agent')).toBeNull();
    expect(screen.getByTestId('agent-row-claude-worker')).toBeTruthy();
    expect(screen.getByTestId('agent-row-codex-worker')).toBeTruthy();
  });

  it('drives the open agent through the nav stack when one is wired', () => {
    const onOpenAgent = vi.fn();
    render(
      <SessionProvider>
        <Agents
          snapshot={EMPTY_INDEX}
          roster={[entry({ id: 'claude-worker' })]}
          focusAgentId={null}
          onOpenAgent={onOpenAgent}
        />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByTestId('agent-open-claude-worker'));
    expect(onOpenAgent).toHaveBeenCalledWith('claude-worker');
    // Controlled: the view does NOT open it locally behind the stack's back.
    expect(screen.queryByTestId('entity-detail-agent')).toBeNull();
  });

  /**
   * This used to fall through to the roster with no message, which is a SILENT degradation: the operator
   * clicks a link, lands somewhere else, and an invisible extra entry sits on the nav stack with no back
   * affordance rendered to pop it. The dead link is now named, with a way back.
   */
  it('says so explicitly when the focused agent is not on the roster, and offers a way back', () => {
    const onBack = vi.fn();
    render(
      <SessionProvider>
        <Agents
          snapshot={EMPTY_INDEX}
          roster={[entry({ id: 'claude-worker' })]}
          focusAgentId="deleted-agent"
          onOpenAgent={vi.fn()}
          onBack={onBack}
        />
      </SessionProvider>,
    );

    expect(screen.queryByTestId('entity-detail-agent')).toBeNull();
    // The missing id is NAMED, not swallowed.
    expect(screen.getByTestId('agent-not-found-ref').textContent).toBe('deleted-agent');
    // And the operator is not silently dumped on a roster they did not ask for.
    expect(screen.queryByTestId('agent-row-claude-worker')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-not-found-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('does not cry "not found" while the roster is still loading', () => {
    // No snapshot and no roster: nothing has loaded, so a focused id is UNKNOWN, not missing.
    render(<SessionProvider><Agents focusAgentId="claude-worker" onOpenAgent={vi.fn()} /></SessionProvider>);
    expect(screen.queryByTestId('agent-not-found')).toBeNull();
  });
});

/**
 * The state every agent is in today, because `agents/` does not exist in this checkout. It must read as
 * a stated absence, never as a failed load.
 */
describe('the not-declared empty state', () => {
  it('names the missing file explicitly rather than rendering blanks', () => {
    render(<AgentDetail agent={agent({ id: 'claude-worker', sources: ['queue'] })} />);

    const panel = screen.getByTestId('agent-not-declared');
    expect(panel.textContent).toContain('agents/claude-worker.md');
    expect(panel.textContent).toMatch(/observed/i);
    expect(panel.textContent).toMatch(/queue cards it owns/i);
  });

  it('says the purpose is unrecorded instead of leaving it empty', () => {
    render(<AgentDetail agent={agent({ id: 'claude-worker' })} />);
    const absent = screen.getByTestId('agent-description-absent');
    expect(absent.textContent).toMatch(/No description recorded/i);
  });

  it('disappears entirely once a declaration exists, and renders the description', () => {
    render(
      <AgentDetail
        agent={agent({
          id: 'claude-worker',
          declared: true,
          description: 'Executes graded build cards on the claude runtime.',
          declaredModel: 'claude-opus-4-8',
          declaredRuntime: 'claude',
          defaultProfile: 'worker:claude:claude-opus-4-8',
          allowedProfiles: ['worker:claude:claude-opus-4-8', 'worker:codex:gpt-5.6-sol'],
        })}
      />,
    );

    expect(screen.queryByTestId('agent-not-declared')).toBeNull();
    expect(screen.getByTestId('agent-description').textContent).toBe(
      'Executes graded build cards on the claude runtime.',
    );
    const declared = screen.getByTestId('agent-declared');
    expect(declared.textContent).toContain('claude-opus-4-8');
    expect(screen.getByTestId('agent-default-profile').textContent).toContain('worker:claude:claude-opus-4-8');
    expect(screen.getByTestId('agent-allowed-profiles').textContent).toContain('worker:codex:gpt-5.6-sol');
  });

  it('states legacy profile nulls instead of rendering blank execution-profile fields', () => {
    render(<AgentDetail agent={agent({ id: 'legacy-runner', declared: true })} />);

    expect(screen.getByTestId('agent-default-profile').textContent).toMatch(/not declared \(legacy\)/i);
    expect(screen.getByTestId('agent-allowed-profiles').textContent).toMatch(/not declared \(legacy\)/i);
  });

  it('renders declaration-backed instructions, codebases, workflows, and runner facts without inventing them', () => {
    render(
      <AgentDetail
        agent={agent({ id: 'fyt-runner', declared: true })}
        detailState="ready"
        detail={{
          id: 'fyt-runner',
          declaration: {
            path: 'agents/fyt-runner.md',
            source: 'faceless-youtube',
            instructions: '## Operating instructions\n\nRun the approved workflow stages in order and stop at human gates.\n\n<script>doEvil()</script>',
            defaultProfile: 'worker:claude:claude-opus-4-8',
            allowedProfiles: ['worker:claude:claude-opus-4-8'],
          },
          codebases: [{ project: 'faceless-youtube', path: 'orgs/faceless-youtube', relationship: 'owns pipeline work' }],
          workflows: [{ ref: 'video-run', title: 'Video run', path: 'orgs/faceless-youtube/workflows/video-run.md', relationship: 'stage runner' }],
          howItRuns: { summary: 'Claims approved queue stages', runner: 'codex-worker', command: 'workflow run video-run' },
        }}
      />,
    );

    expect(screen.getByTestId('agent-declaration').textContent).toContain('agents/fyt-runner.md');
    const instructions = screen.getByTestId('agent-instructions');
    expect(within(instructions).getByRole('heading', { name: 'Operating instructions' })).toBeTruthy();
    expect(instructions.textContent).toContain('human gates');
    expect(instructions.querySelector('script')).toBeNull();
    expect(instructions.textContent).toContain('<script>doEvil()</script>');
    expect(screen.getByTestId('agent-codebases').textContent).toContain('faceless-youtube');
    expect(screen.getByTestId('agent-workflows').textContent).toContain('video-run');
    expect(screen.getByTestId('agent-how-it-runs').textContent).toContain('codex-worker');
    expect(screen.getByTestId('agent-default-profile').textContent).toContain('worker:claude:claude-opus-4-8');
    expect(screen.getByTestId('agent-allowed-profiles').textContent).toContain('worker:claude:claude-opus-4-8');
  });

  /**
   * "Run agent" no longer navigates to the Terminal destination — it starts the session on the agent's
   * own Runs tab, so the operator stays on the page they were reading. The console's own behaviour
   * (spawn/attach/cap) is covered in `AgentDetailConsole.test.tsx`; this pins the action and the gate.
   */
  it('offers "Run agent" only for a declared agent, and lands it on this page', () => {
    const onSectionChange = vi.fn();
    const { rerender } = render(
      <AgentDetail agent={agent({ id: 'fyt-runner', declared: true })} onSectionChange={onSectionChange} />,
    );

    fireEvent.click(screen.getByTestId('agent-run'));
    // It shows the Runs tab (where the session lives) and tells any controlling nav stack to follow.
    expect(screen.getByTestId('entity-tab-runs').getAttribute('aria-selected')).toBe('true');
    expect(onSectionChange).toHaveBeenCalledWith('runs');
    expect(screen.getByLabelText('Live session for this agent')).toBeTruthy();

    // No declaration = nothing to prime a session with, so the action is not offered at all.
    rerender(<AgentDetail agent={agent({ id: 'observed-only', declared: false })} onSectionChange={onSectionChange} />);
    expect(screen.queryByTestId('agent-run')).toBeNull();
  });

  /**
   * The de-jargon rule for this surface: `declared`, `runner-bound` and `binding` are terms of art. They
   * may exist inside the technical fold; they may not be the first thing an operator reads.
   */
  it('keeps machinery terms and the declaration file out of the primary surface, inside ONE fold', () => {
    render(
      <AgentDetail
        agent={agent({ id: 'fyt-runner', declared: true, runnerBound: true, declaredRuntime: 'claude' })}
        detailState="ready"
        detail={{
          id: 'fyt-runner',
          declaration: { path: 'agents/fyt-runner.md', source: 'faceless-youtube', instructions: '', defaultProfile: null, allowedProfiles: null },
          codebases: [],
          workflows: [],
          howItRuns: null,
        }}
      />,
    );

    const fold = screen.getByTestId('agent-technical');
    expect(fold.textContent).toContain('agents/fyt-runner.md');
    expect(fold.textContent).toMatch(/runner/i);
    // Exactly ONE fold on this surface.
    expect(document.querySelectorAll('.entity-fold')).toHaveLength(1);

    // Everything outside the fold is plain language.
    fold.remove();
    expect(document.body.textContent).not.toMatch(/runner-bound|\bbinding\b|DECLARED/i);
    expect(document.body.textContent).not.toContain('agents/fyt-runner.md');
  });

  it('links a related workflow to its canonical detail and Launch surface', () => {
    const onNavigate = vi.fn();
    render(
      <AgentDetail
        agent={agent({ id: 'fyt-runner', declared: true })}
        detailState="ready"
        detail={{
          id: 'fyt-runner', declaration: null, codebases: [],
          workflows: [{ ref: 'video-run', title: 'Video run', path: 'orgs/faceless-youtube/workflows/video-run.md', relationship: 'stage runner' }],
          howItRuns: null,
        }}
        onNavigate={onNavigate}
      />,
    );

    const workflow = screen.getByTestId('agent-workflow-video-run');
    expect(workflow.textContent).toContain('Open workflow');
    fireEvent.click(workflow);
    expect(onNavigate).toHaveBeenCalledWith({ view: 'workflows', focus: { kind: 'workflow', id: 'video-run' } });
  });
});

describe('fields the roster fetched and never rendered', () => {
  it('surfaces the ledger rollups as steps, never as money', () => {
    render(
      <AgentDetail
        agent={agent({ id: 'claude-worker', ledger: { dispatches: 12, steps: 340, days: 5 }, lastActive: '2026-07-20' })}
      />,
    );

    // Ledger rollups are machinery: they live inside the one technical fold, not in primary UI.
    const ledger = within(screen.getByTestId('agent-technical')).getByTestId('agent-ledger');
    expect(ledger.textContent).toContain('12');
    expect(ledger.textContent).toContain('340');
    expect(ledger.textContent).toContain('5');
    // BINDING: steps and tokens only. No dollar figure may ever reach this surface.
    expect(document.body.textContent).not.toMatch(/\$|usd/i);
  });

  it('shows which roster sources produced the row', () => {
    render(<AgentDetail agent={agent({ id: 'claude-worker', declared: true, sources: ['queue', 'ledger'] })} />);
    const chips = screen.getByTestId('agent-sources');
    expect(chips.textContent).toContain('declared');
    expect(chips.textContent).toContain('queue');
    expect(chips.textContent).toContain('ledger');
  });
});

describe('agent work and runs', () => {
  it('links the agent current card into Tasks', () => {
    const onNavigate = vi.fn();
    render(
      <AgentDetail
        agent={agent({ id: 'claude-worker', working: true, current: { action: 'build', id: 'card-100', displayName: 'build', shortRef: 4 } })}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-current-card-100'));

    expect(onNavigate).toHaveBeenCalledWith({ view: 'tasks', focus: { kind: 'card', id: 'card-100' } });
  });

  it('links a joined run into the run detail', () => {
    const onNavigate = vi.fn();
    render(
      <AgentDetail agent={agent({ id: 'claude-worker' })} runs={[run({ runRef: 'run-7' })]} onNavigate={onNavigate} />,
    );
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    fireEvent.click(screen.getByTestId('agent-run-run-7'));

    expect(onNavigate).toHaveBeenCalledWith({ view: 'workflows', focus: { kind: 'run', id: 'run-7' } });
  });

  /**
   * "We did not look" and "we looked and found none" are different claims. Conflating them is how a
   * dashboard starts lying quietly, so they are worded differently and pinned separately.
   */
  it('distinguishes runs-not-loaded from runs-none', () => {
    const { rerender } = render(<AgentDetail agent={agent({ id: 'claude-worker' })} />);
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    expect(screen.getByTestId('agent-runs-unloaded').textContent).toMatch(/needs an unlocked session/i);

    rerender(<AgentDetail agent={agent({ id: 'claude-worker' })} runs={[]} />);
    expect(screen.queryByTestId('agent-runs-unloaded')).toBeNull();
    expect(screen.getByTestId('agent-runs-empty').textContent).toMatch(/No run is working a task/i);
  });

  it('labels the run join as derived, because it goes through queue cards', () => {
    render(<AgentDetail agent={agent({ id: 'claude-worker' })} runs={[]} />);
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    const section = screen.getByLabelText('Runs this agent is working');
    expect(within(section).getByText(/Derived via queue cards/i)).toBeTruthy();
  });

  /** A silently truncated join is worse than a stated partial one, so the bound is disclosed. */
  it('discloses the scan bound when the join was capped', () => {
    render(<AgentDetail agent={agent({ id: 'claude-worker' })} runs={[]} runScanLimit={20} />);
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    const section = screen.getByLabelText('Runs this agent is working');
    expect(section.textContent).toContain('20 most recent runs');
  });

  it('claims no scan bound when nothing was scanned', () => {
    render(<AgentDetail agent={agent({ id: 'claude-worker' })} runScanLimit={20} />);
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    const section = screen.getByLabelText('Runs this agent is working');
    expect(section.textContent).not.toContain('20 most recent runs');
  });
});
