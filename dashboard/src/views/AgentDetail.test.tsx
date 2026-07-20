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
import { AgentDetail, type AgentDetailRow } from './AgentDetail';
import type { AgentRosterEntry } from '../../server/agents/roster';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { RunMetadataDto } from '../control/controlClient';

afterEach(cleanup);

function agent(over: Partial<AgentDetailRow> & { id: string }): AgentDetailRow {
  return {
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
    description: null,
    ledger: { dispatches: 0, steps: 0, days: 0 },
    sources: [],
    ...over,
  };
}

function entry(over: Partial<AgentRosterEntry> & { id: string }): AgentRosterEntry {
  return {
    role: null,
    working: false,
    current: null,
    projects: [],
    cardCount: 0,
    ledger: { dispatches: 0, steps: 0, days: 0, lastActive: null },
    sources: [],
    effective: { runtime: 'claude', model: 'claude-opus-4-8', sourceRuntime: 'policy', sourceModel: 'policy' },
    declared: false,
    runnerBound: false,
    declaredRuntime: null,
    declaredModel: null,
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
  predecessorRunRef: null,
  title: 'Rebuild the faceless video pipeline',
  proposalRef: 'wf-aaa',
  proposalRevision: 1,
  proposalHash: 'hash-a',
  publicationState: 'published',
  state: 'running',
  version: 1,
  managerSessionRef: 'sess-m',
  managerGeneration: 0,
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
    render(<Agents snapshot={EMPTY_INDEX} roster={[entry({ id: 'claude-worker' }), entry({ id: 'codex-worker' })]} />);

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
      <Agents
        snapshot={EMPTY_INDEX}
        roster={[entry({ id: 'claude-worker' })]}
        focusAgentId={null}
        onOpenAgent={onOpenAgent}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-open-claude-worker'));
    expect(onOpenAgent).toHaveBeenCalledWith('claude-worker');
    // Controlled: the view does NOT open it locally behind the stack's back.
    expect(screen.queryByTestId('entity-detail-agent')).toBeNull();
  });

  it('falls back to the roster when the focused agent is not on it', () => {
    render(
      <Agents
        snapshot={EMPTY_INDEX}
        roster={[entry({ id: 'claude-worker' })]}
        focusAgentId="deleted-agent"
        onOpenAgent={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('entity-detail-agent')).toBeNull();
    expect(screen.getByTestId('agent-row-claude-worker')).toBeTruthy();
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
        })}
      />,
    );

    expect(screen.queryByTestId('agent-not-declared')).toBeNull();
    expect(screen.getByTestId('agent-description').textContent).toBe(
      'Executes graded build cards on the claude runtime.',
    );
    const declared = screen.getByTestId('agent-declared');
    expect(declared.textContent).toContain('claude-opus-4-8');
  });
});

describe('fields the roster fetched and never rendered', () => {
  it('surfaces the ledger rollups as steps, never as money', () => {
    render(
      <AgentDetail
        agent={agent({ id: 'claude-worker', ledger: { dispatches: 12, steps: 340, days: 5 }, lastActive: '2026-07-20' })}
      />,
    );
    fireEvent.click(screen.getByTestId('entity-tab-activity'));

    const ledger = screen.getByTestId('agent-ledger');
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
        agent={agent({ id: 'claude-worker', working: true, current: { action: 'build', id: 'card-100' } })}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId('entity-tab-work'));
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

    expect(onNavigate).toHaveBeenCalledWith({ view: 'pipeline', focus: { kind: 'run', id: 'run-7' } });
  });

  /**
   * "We did not look" and "we looked and found none" are different claims. Conflating them is how a
   * dashboard starts lying quietly, so they are worded differently and pinned separately.
   */
  it('distinguishes runs-not-loaded from runs-none', () => {
    const { rerender } = render(<AgentDetail agent={agent({ id: 'claude-worker' })} />);
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    expect(screen.getByTestId('agent-runs-unloaded').textContent).toMatch(/needs an unlocked cockpit session/i);

    rerender(<AgentDetail agent={agent({ id: 'claude-worker' })} runs={[]} />);
    expect(screen.queryByTestId('agent-runs-unloaded')).toBeNull();
    expect(screen.getByTestId('agent-runs-empty').textContent).toMatch(/No managed run/i);
  });

  it('labels the run join as derived, because it goes through queue cards', () => {
    render(<AgentDetail agent={agent({ id: 'claude-worker' })} runs={[]} />);
    fireEvent.click(screen.getByTestId('entity-tab-runs'));
    const section = screen.getByLabelText('Runs this agent is working');
    expect(within(section).getByText(/Derived via queue cards/i)).toBeTruthy();
  });
});
