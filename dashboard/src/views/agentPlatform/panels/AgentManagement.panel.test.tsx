// @vitest-environment jsdom
/**
 * Agent Management panel (Wave-1 U4) — the headline Agent Platform panel.
 *
 * These tests pin what the panel exists to guarantee: it registers itself by file drop (no
 * shared-file edit), it renders the extended roster from `/api/agents`, it keeps DECLARED agents and
 * OBSERVED runtime identities in separate sections and never asks the daemon for a declaration that
 * cannot exist, opening a declared row shows the declaration fields, and every field degrades to an
 * explicit "not declared" line rather than a blank.
 *
 * The fixture ids below are NEUTRAL placeholders, not a transcript of `agents/*.md` — the point is
 * the SHAPE (`declared: true` rows with the six schema fields empty, `declared: false` rows that came
 * from queue/ledger observation only), which is what the live union endpoint returns.
 *
 * Three failure paths are pinned, because this panel talks to the daemon: a dead roster fetch, a 404
 * (the daemon answering correctly that no declaration exists) and a 422 (a declaration that exists
 * but cannot be used) must each produce their OWN named state, never one generic "unavailable".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { AGENT_PLATFORM_PANELS } from '../registry';
import { panel } from './AgentManagement.panel';
import type { AgentRosterEntry } from '../../../../server/agents/roster';

/** A full roster entry with sane defaults — tests override only the fields they are about. */
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
    effective: { runtime: 'claude', model: 'claude-sonnet-5', sourceRuntime: 'policy', sourceModel: 'policy' },
    declared: true,
    runnerBound: false,
    declaredRuntime: null,
    declaredModel: null,
    tools: null,
    knowledgeSource: null,
    autonomyTier: null,
    skills: null,
    whatItReplaces: null,
    buildsOn: null,
    defaultProfile: null,
    allowedProfiles: null,
    description: null,
    ...over,
  };
}

/** Declared agents whose six schema fields are all empty — the live shape today. */
const PLAIN_IDS = ['alpha-agent', 'beta-agent', 'gamma-agent', 'delta-agent'];

/**
 * Identities the union endpoint reports from queue ownership / ledger writes ALONE. No `agents/<id>.md`
 * exists for them, so a declaration read can only ever 404.
 */
const OBSERVED_IDS = ['dispatcher-cloud', 'dispatcher-desktop-fallback', 'worker-desktop'];

const ROSTER: AgentRosterEntry[] = [
  ...PLAIN_IDS.map((id) =>
    entry({ id, role: 'work', description: id === 'alpha-agent' ? 'Ships dashboard slices.' : null }),
  ),
  // A declaration naming a model its runtime refuses: the server drops the unusable pair and answers
  // with the POLICY model. The badge must show the resolved model, never the refused declared string.
  entry({ id: 'refused-model-agent', role: 'work', declaredModel: 'model-the-runtime-refuses' }),
  entry({
    id: 'ladder-architect',
    role: 'manage',
    working: true,
    description: 'Designs the ladder.',
    effective: { runtime: 'claude', model: 'claude-opus-5', sourceRuntime: 'policy', sourceModel: 'policy' },
    tools: ['Read', 'Write', 'Bash'],
    knowledgeSource: ['orgs/kb/_index.md', 'governance/risk-tiers.md'],
    autonomyTier: 'T2',
    skills: ['code-review', 'inspector'],
    whatItReplaces: 'the manual triage pass',
    buildsOn: ['alpha-agent', 'beta-agent'],
  }),
  ...OBSERVED_IDS.map((id) => entry({ id, declared: false, sources: ['queue'] })),
];

/** The `/api/agents/:id` payload, in the shape `server/agents/routes.ts` actually returns. */
function detailFor(id: string, declaration: Record<string, unknown> | null, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    declaration:
      declaration === null
        ? null
        : {
            path: `agents/${id}.md`,
            source: 'agents-declaration',
            instructions: null,
            defaultProfile: null,
            allowedProfiles: null,
            tools: null,
            knowledgeSource: null,
            autonomyTier: null,
            skills: null,
            whatItReplaces: null,
            buildsOn: null,
            ...declaration,
          },
    codebases: [],
    workflows: [],
    howItRuns: null,
    ...extra,
  };
}

const DETAILS: Record<string, unknown> = {
  ...Object.fromEntries(PLAIN_IDS.map((id) => [id, detailFor(id, {})])),
  'refused-model-agent': detailFor('refused-model-agent', {}),
  'ladder-architect': detailFor(
    'ladder-architect',
    {
      instructions: 'Read the contract, then walk the ladder one rung at a time and never skip a gate.',
      tools: ['Read', 'Write', 'Bash'],
      knowledgeSource: ['orgs/kb/_index.md', 'governance/risk-tiers.md'],
      autonomyTier: 'T2',
      skills: ['code-review', 'inspector'],
      whatItReplaces: 'the manual triage pass',
      buildsOn: ['alpha-agent', 'beta-agent'],
    },
    {
      codebases: [{ project: 'kb', path: 'orgs/kb', relationship: 'owns' }],
      workflows: [{ ref: 'wf-ladder', title: 'Ladder review', path: 'workflows/ladder.yaml', relationship: 'governs' }],
      howItRuns: { summary: 'Declared only: no runner currently claims this agent.', runner: null, command: null },
    },
  ),
};

function ok(body: unknown): unknown {
  return { ok: true, status: 200, json: async () => body };
}
function fail(status: number, body: unknown = {}): unknown {
  return { ok: false, status, json: async () => body };
}

/** Ids whose declaration read the daemon answers with 404 / 422, exercised by the failure tests. */
const NO_DECLARATION = 'ghost-agent';
const INVALID_DECLARATION = 'broken-agent';
/** The 422 body's `declaration` is an AgentDeclarationProblem OBJECT, not a sentence — the real wire
 *  shape from `server/agents/routes.ts`. A string fixture here would pass while live data never matched. */
const DECLARATION_PROBLEM = { id: 'broken-agent', source: 'agents/broken-agent.md', problem: 'malformed-frontmatter' };
/** What the panel must render from it: the source that is broken, and how. */
const DECLARATION_PROBLEM_TEXT = 'agents/broken-agent.md: malformed-frontmatter';

/**
 * Route the panel's two endpoints, recording every call so a test can assert a fetch NEVER happened.
 * `roster`/`detail` let one leg die while the other still answers.
 */
let calls: string[] = [];
function stubFetch({ roster = 'ok', detail = 'ok' }: { roster?: 'ok' | 'fail'; detail?: 'ok' | 'fail' } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/agents') {
        if (roster === 'fail') throw new Error('roster unreachable');
        return ok(ROSTER);
      }
      const match = /^\/api\/agents\/(.+)$/.exec(url);
      if (match) {
        if (detail === 'fail') throw new Error('detail unreachable');
        const id = decodeURIComponent(match[1]);
        if (id === INVALID_DECLARATION) return fail(422, { error: 'agent-declaration-invalid', declaration: DECLARATION_PROBLEM });
        const body = DETAILS[id];
        return body ? ok(body) : fail(404, { error: 'agent-not-declared' });
      }
      return fail(404);
    }),
  );
}

/** Render the panel exactly as the section shell does — through its own `render()`. */
function renderPanel(): void {
  render(panel.render());
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  calls = [];
  stubFetch();
});

describe('AgentManagement panel', () => {
  it('registers itself in the panel registry by file drop alone', () => {
    const found = AGENT_PLATFORM_PANELS.find((p) => p.id === 'agent-management');
    expect(found).toBeTruthy();
    expect(found?.title).toBe('Agent Management');
    expect(found?.description.length).toBeGreaterThan(0);
  });

  it('renders one row per declared agent, each with a model badge, a status and its description', async () => {
    renderPanel();

    for (const id of [...PLAIN_IDS, 'refused-model-agent', 'ladder-architect']) {
      expect(await screen.findByTestId(`ap-agentmgmt-row-${id}`)).toBeTruthy();
    }

    // Status comes off `working`: the one working agent reads running, the rest idle.
    expect(screen.getByTestId('ap-agentmgmt-status-ladder-architect').className).toContain('mc-status-dot--running');
    expect(within(screen.getByTestId('ap-agentmgmt-row-ladder-architect')).getByText('working')).toBeTruthy();
    expect(screen.getByTestId('ap-agentmgmt-status-alpha-agent').className).toContain('mc-status-dot--idle');

    // The roster already carries a one-line description — the list renders it rather than discarding it.
    expect(within(screen.getByTestId('ap-agentmgmt-row-alpha-agent')).getByText('Ships dashboard slices.')).toBeTruthy();
    expect(screen.getByTestId('ap-agentmgmt-version-alpha-agent').textContent).toBe('v1');
  });

  it('badges the RESOLVED model only — never a declared model the runtime refused', async () => {
    renderPanel();
    await screen.findByTestId('ap-agentmgmt-row-ladder-architect');

    expect(within(screen.getByTestId('ap-agentmgmt-row-ladder-architect')).getByTestId('model-badge').textContent).toBe('claude-opus-5');
    const refused = within(screen.getByTestId('ap-agentmgmt-row-refused-model-agent')).getByTestId('model-badge');
    expect(refused.textContent).toBe('claude-sonnet-5');
    expect(screen.queryByText('model-the-runtime-refuses')).toBeNull();
  });

  it('separates observed runtime identities from declared agents and never reads a declaration for them', async () => {
    renderPanel();
    await screen.findByTestId('ap-agentmgmt-row-alpha-agent');

    const observed = screen.getByTestId('ap-agentmgmt-observed');
    expect(within(observed).getByText(/observed runtime identities — no declaration/i)).toBeTruthy();

    for (const id of OBSERVED_IDS) {
      // Present, but in the observed group only — never as an openable declared row.
      expect(within(observed).getByTestId(`ap-agentmgmt-observed-row-${id}`)).toBeTruthy();
      expect(screen.queryByTestId(`ap-agentmgmt-row-${id}`)).toBeNull();
      // Not a button: there is no declaration to open, so the panel offers no affordance that
      // would make the daemon answer 404 for a question it should never have been asked.
      expect(within(observed).getByTestId(`ap-agentmgmt-observed-row-${id}`).tagName).not.toBe('BUTTON');
      fireEvent.click(within(observed).getByTestId(`ap-agentmgmt-observed-row-${id}`));
      expect(calls).not.toContain(`/api/agents/${id}`);
    }
  });

  it('opens a detail card carrying every declared field the ladder added', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('ap-agentmgmt-row-ladder-architect'));

    const detail = await screen.findByTestId('ap-agentmgmt-detail');
    const body = within(detail);
    expect(body.getByText('manage')).toBeTruthy();
    expect(body.getByTestId('ap-agentmgmt-tools').textContent).toContain('Read');
    expect(body.getByTestId('ap-agentmgmt-tools').textContent).toContain('Bash');
    expect(body.getByTestId('ap-agentmgmt-ceiling').textContent).toContain('T2');
    expect(body.getByTestId('ap-agentmgmt-replaces').textContent).toContain('the manual triage pass');
    expect(body.getByTestId('ap-agentmgmt-builds-on').textContent).toContain('alpha-agent');
    expect(body.getByTestId('ap-agentmgmt-knowledge').textContent).toContain('governance/risk-tiers.md');
    expect(body.getByTestId('ap-agentmgmt-skills').textContent).toContain('code-review');
    expect(body.getByTestId('ap-agentmgmt-version').textContent).toBe('v1');
    expect(body.getByTestId('ap-agentmgmt-version-field').textContent).toContain('v1');

    // Deep linking is not this panel's to own — it says so in plain words instead of faking a link.
    expect(body.getByTestId('ap-agentmgmt-deeplink').textContent).toContain('ladder-architect');
    expect(body.getByTestId('ap-agentmgmt-deeplink').textContent).toContain('Agents view');
  });

  it('renders the facts the detail fetch actually buys: how it runs, codebases, workflows, instructions', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('ap-agentmgmt-row-ladder-architect'));

    const body = within(await screen.findByTestId('ap-agentmgmt-detail'));
    expect(body.getByTestId('ap-agentmgmt-description').textContent).toContain('Designs the ladder.');
    expect(body.getByTestId('ap-agentmgmt-how-it-runs').textContent).toContain('no runner currently claims');
    expect(body.getByTestId('ap-agentmgmt-codebases').textContent).toContain('orgs/kb');
    expect(body.getByTestId('ap-agentmgmt-workflows').textContent).toContain('Ladder review');
    // A preview line, not a dump of the whole declaration body.
    expect(body.getByTestId('ap-agentmgmt-instructions').textContent).toContain('Read the contract');
    expect(body.getByTestId('ap-agentmgmt-source').textContent).toContain('agents/ladder-architect.md');
  });

  it('says "not declared" for every field a live agent leaves empty — never blank, never undefined', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('ap-agentmgmt-row-beta-agent'));

    const detail = await screen.findByTestId('ap-agentmgmt-detail');
    for (const field of ['tools', 'ceiling', 'replaces', 'builds-on', 'knowledge', 'skills']) {
      const cell = within(detail).getByTestId(`ap-agentmgmt-${field}`);
      expect(cell.textContent).toContain('not declared');
      expect(cell.textContent).not.toContain('undefined');
      expect(cell.textContent).not.toContain('null');
    }
  });

  it('tells the operator WHY every field is empty — new schema, not a failed read', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('ap-agentmgmt-row-beta-agent'));

    const note = within(await screen.findByTestId('ap-agentmgmt-detail')).getByTestId('ap-agentmgmt-schema-note');
    expect(note.textContent).toMatch(/schema/i);
    expect(note.textContent).toMatch(/no .*declaration .*(fills|yet)/i);
    // And it separates the CLAIMED ceiling from the earned ladder, which is a different panel.
    expect(note.textContent).toMatch(/claims/i);
    expect(note.textContent).toMatch(/Autonomy Ladder/i);
  });

  it('labels the tier as a declared ceiling (advisory) and never as a bare autonomy tier', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('ap-agentmgmt-row-ladder-architect'));

    const detail = await screen.findByTestId('ap-agentmgmt-detail');
    expect(within(detail).getByText(/declared ceiling \(advisory\)/i)).toBeTruthy();
    expect(screen.queryByText(/autonomy tier/i)).toBeNull();
  });

  it('returns to the list from the detail card', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('ap-agentmgmt-row-ladder-architect'));
    await screen.findByTestId('ap-agentmgmt-detail');
    expect(screen.queryByTestId('ap-agentmgmt-row-beta-agent')).toBeNull();

    fireEvent.click(screen.getByTestId('ap-agentmgmt-back'));
    expect(await screen.findByTestId('ap-agentmgmt-row-beta-agent')).toBeTruthy();
    expect(screen.queryByTestId('ap-agentmgmt-detail')).toBeNull();
  });

  it('degrades to a named error state when the roster fetch fails', async () => {
    stubFetch({ roster: 'fail' });
    expect(() => renderPanel()).not.toThrow();

    expect(await screen.findByTestId('ap-agentmgmt-list-error')).toBeTruthy();
    expect(screen.queryByTestId('ap-agentmgmt-row-beta-agent')).toBeNull();
  });

  it('reads a 404 as "no declaration" — the daemon answered, it did not fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === '/api/agents') return ok([entry({ id: NO_DECLARATION, declared: true })]);
        return fail(404, { error: 'agent-not-declared' });
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByTestId(`ap-agentmgmt-row-${NO_DECLARATION}`));

    const msg = await screen.findByTestId('ap-agentmgmt-detail-no-declaration');
    expect(msg.textContent).toMatch(/observed runtime identity, no declaration/i);
    expect(screen.queryByTestId('ap-agentmgmt-detail-unavailable')).toBeNull();
  });

  it('surfaces the declaration problem on a 422 instead of a generic failure line', async () => {
    stubFetch();
    renderPanel();
    // A declared row whose file exists but cannot be used.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === '/api/agents') return ok([entry({ id: INVALID_DECLARATION, declared: true })]);
        return fail(422, { error: 'agent-declaration-invalid', declaration: DECLARATION_PROBLEM });
      }),
    );
    cleanup();
    renderPanel();
    fireEvent.click(await screen.findByTestId(`ap-agentmgmt-row-${INVALID_DECLARATION}`));

    const msg = await screen.findByTestId('ap-agentmgmt-detail-invalid');
    expect(msg.textContent).toContain(DECLARATION_PROBLEM_TEXT);
  });

  it('degrades to unavailable when the detail fetch fails outright, and back still works', async () => {
    stubFetch({ detail: 'fail' });
    renderPanel();
    fireEvent.click(await screen.findByTestId('ap-agentmgmt-row-beta-agent'));

    expect(await screen.findByTestId('ap-agentmgmt-detail-unavailable')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ap-agentmgmt-back'));
    expect(await screen.findByTestId('ap-agentmgmt-row-beta-agent')).toBeTruthy();
  });
});
