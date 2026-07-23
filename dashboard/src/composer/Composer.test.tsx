// @vitest-environment jsdom
/**
 * C3 — the idea-first convergence surface. These tests drive Composer through the SAME injectable
 * `stream` DI seam ComposerChat exposes (so no real network / session / `claude` ever runs) plus an
 * injected `onDeploy` fake (C4's real dispatcher is built in parallel; C5 wires it). The load-bearing
 * behaviours: the surface starts in `idea` mode with the disambiguation seed; setting a concrete type
 * swaps that type's seed onto the NEXT turn (even mid-session — the resume id threads through untouched);
 * the draft preview shows the exact relpath + branch class and blocks Deploy until the draft validates.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Composer } from './Composer';
import { toDeploy } from './artifactTypes';
import type { ComposerStreamFn } from './chatClient';
import type { TimelineModel } from '../lib/timelineModel';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const REPLY = (text: string): TimelineModel => ({
  turns: [{ index: 0, model: 'claude-sonnet-5', timestamp: null, usage: null, steps: [{ kind: 'text', text }] }],
});

/** A recording fake stream: captures every composed prompt + resume id, echoes a reply, returns a fresh
 *  session id so turn N+1 rides the resume flow. */
function recordingStream(): { calls: Array<{ composerRef: string; prompt: string }>; stream: ComposerStreamFn } {
  const calls: Array<{ composerRef: string; prompt: string }> = [];
  const stream: ComposerStreamFn = vi.fn(async (composerRef, prompt, _token, onDelta) => {
    calls.push({ composerRef, prompt });
    onDelta(REPLY(`reply ${calls.length}`));
    return { ok: true };
  });
  return { calls, stream };
}

function sendTurn(text: string): void {
  fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: text } });
  fireEvent.submit(screen.getByLabelText('Composer prompt'));
}

const WORKFLOW_AGENT_ROSTER = [
  {
    id: 'fyt-runner', declared: true, projects: ['kb'], runnerBound: true,
    defaultProfile: 'manager:claude:claude-opus-4-8',
    allowedProfiles: ['manager:claude:claude-opus-4-8', 'manager:codex:gpt-5.6-sol'],
  },
  {
    id: 'manager-backup', declared: true, projects: ['kb'], runnerBound: false,
    defaultProfile: 'worker:codex:gpt-5.6-sol',
    allowedProfiles: ['manager:codex:gpt-5.6-sol', 'worker:codex:gpt-5.6-sol'],
  },
  {
    id: 'worker-primary', declared: true, projects: ['kb'], runnerBound: true,
    defaultProfile: 'worker:claude:claude-opus-4-8',
    allowedProfiles: ['worker:claude:claude-opus-4-8', 'worker:codex:gpt-5.6-sol'],
  },
  {
    id: 'worker-only', declared: true, projects: ['kb'], runnerBound: false,
    defaultProfile: 'worker:codex:gpt-5.6-sol',
    allowedProfiles: ['worker:codex:gpt-5.6-sol'],
  },
  {
    id: 'other-project', declared: true, projects: ['atlas'], runnerBound: true,
    defaultProfile: 'worker:claude:claude-opus-4-8',
    allowedProfiles: ['manager:claude:claude-opus-4-8', 'worker:claude:claude-opus-4-8'],
  },
  {
    id: 'observed-worker', declared: false, projects: ['kb'], runnerBound: true,
    defaultProfile: 'worker:claude:claude-opus-4-8',
    allowedProfiles: ['worker:claude:claude-opus-4-8'],
  },
];

function stubWorkflowRegistries(roster = WORKFLOW_AGENT_ROSTER): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (input === '/api/workflows/profiles') {
      return { ok: true, status: 200, json: async () => ({ profiles: ['research'] }) } as Response;
    }
    if (input === '/api/agents') {
      return { ok: true, status: 200, json: async () => roster } as Response;
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  }));
}

function fillWorkflowDraft(): void {
  fireEvent.change(screen.getByLabelText('Workflow filename'), { target: { value: 'brief.md' } });
  fireEvent.change(screen.getByLabelText('Workflow project'), { target: { value: 'kb' } });
  fireEvent.change(screen.getByLabelText('Workflow notes'), { target: { value: 'Research the brief.' } });
  fireEvent.change(screen.getByLabelText('Stage 1 action'), { target: { value: 'research' } });
  fireEvent.change(screen.getByLabelText('Stage 1 target'), { target: { value: 'orgs/kb' } });
  fireEvent.change(screen.getByLabelText('Stage 1 work order'), { target: { value: 'Research the brief.' } });
}

describe('Composer', () => {
  it('starts_in_idea_mode_with_disambiguation_seed', async () => {
    const { calls, stream } = recordingStream();
    render(<Composer sessionToken="tok" onDeploy={vi.fn()} onBack={vi.fn()} stream={stream} />);

    expect(screen.getByTestId('composer-type').textContent).toContain('idea');

    sendTurn('a tiny helper for triage');
    await waitFor(() => expect(calls).toHaveLength(1));
    // The idea-first disambiguation seed asks the model to help pick the type, and embeds the idea text.
    expect(calls[0].prompt).toMatch(/which TYPE this idea wants to become/);
    expect(calls[0].prompt).toContain('a tiny helper for triage');
    expect(calls[0].composerRef).toBe('local-preview');
  });

  it('setting_type_swaps_the_seed_on_next_turn', async () => {
    const { calls, stream } = recordingStream();
    render(<Composer sessionToken="tok" onDeploy={vi.fn()} onBack={vi.fn()} stream={stream} />);

    // Turn 1 in idea mode — establishes a resume session (sess-1).
    sendTurn('some idea');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].prompt).toMatch(/which TYPE this idea wants to become/);

    // Operator sets a concrete type mid-session.
    fireEvent.click(screen.getByRole('button', { name: 'Skill' }));

    // Turn 2 re-seeds with the SKILL creation prompt AND rides the in-flight resume id (continuity kept).
    sendTurn('make it a skill');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].prompt).toMatch(/Draft a SKILL/);
    expect(calls[1].composerRef).toBe('local-preview');
  });

  it('initialKind_preseeds_the_type', async () => {
    const { calls, stream } = recordingStream();
    render(
      <Composer initialKind="skill" sessionToken="tok" onDeploy={vi.fn()} onBack={vi.fn()} stream={stream} />,
    );

    expect(screen.getByTestId('composer-type').textContent).toContain('skill');
    expect((screen.getByRole('button', { name: 'Skill' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe(
      'true',
    );

    // The pre-seeded type drives the FIRST turn's seed.
    sendTurn('starts as a skill');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].prompt).toMatch(/Draft a SKILL/);
  });

  it('preview_shows_target_path_and_branch_class', () => {
    render(<Composer initialKind="skill" onDeploy={vi.fn()} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'My Helper' } });
    fireEvent.change(screen.getByLabelText('Skill description'), { target: { value: 'does a thing' } });
    fireEvent.change(screen.getByLabelText('Skill body'), { target: { value: 'the steps' } });

    expect(screen.getByTestId('composer-target').textContent).toContain('skills/learned/my-helper/SKILL.md');
    expect(screen.getByTestId('composer-branch').textContent).toMatch(/durable → PR to main/);

    // A Task resolves to the coordination class (queue → ops).
    cleanup();
    render(<Composer initialKind="task" onDeploy={vi.fn()} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Task project'), { target: { value: 'kb' } });
    fireEvent.change(screen.getByLabelText('Task action'), { target: { value: 'audit' } });
    fireEvent.change(screen.getByLabelText('Task target'), { target: { value: 'queue/' } });
    expect(screen.getByTestId('composer-target').textContent).toContain('queue/');
    expect(screen.getByTestId('composer-branch').textContent).toMatch(/coordination → ops/);
  });

  it('deploy_disabled_until_draft_validates', () => {
    render(<Composer initialKind="skill" onDeploy={vi.fn()} onBack={vi.fn()} />);
    const deploy = () => screen.getByRole('button', { name: 'Deploy' }) as HTMLButtonElement;
    expect(deploy().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'My Helper' } });
    fireEvent.change(screen.getByLabelText('Skill description'), { target: { value: 'does a thing' } });
    expect(deploy().disabled).toBe(true); // body still missing
    fireEvent.change(screen.getByLabelText('Skill body'), { target: { value: 'the steps' } });
    expect(deploy().disabled).toBe(false);
  });

  it('deploy_calls_injected_handler_with_plan', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'));
    const onDeploy = vi.fn();
    render(<Composer initialKind="skill" onDeploy={onDeploy} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'My Helper' } });
    fireEvent.change(screen.getByLabelText('Skill description'), { target: { value: 'does a thing' } });
    fireEvent.change(screen.getByLabelText('Skill body'), { target: { value: 'the steps' } });

    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(onDeploy).toHaveBeenCalledTimes(1);
    expect(onDeploy).toHaveBeenCalledWith(
      toDeploy('skill', {
        name: 'My Helper',
        description: 'does a thing',
        body: 'the steps',
        date: '2026-07-22',
      }),
    );
  });

  it('back_returns_to_underlying_view', () => {
    const onBack = vi.fn();
    render(<Composer onDeploy={vi.fn()} onBack={onBack} />);
    expect(screen.getByLabelText('Composer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('agent_is_offered_with_a_complete_deployable_form', () => {
    const onDeploy = vi.fn();
    render(<Composer initialKind="agent" onDeploy={onDeploy} onBack={vi.fn()} />);
    for (const label of ['Idea', 'Task', 'Workflow', 'Skill', 'Project', 'Agent']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }

    const deploy = screen.getByRole('button', { name: 'Deploy' }) as HTMLButtonElement;
    expect(deploy.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Agent id'), { target: { value: 'atlas-researcher' } });
    fireEvent.change(screen.getByLabelText('Agent role'), { target: { value: 'scout' } });
    fireEvent.change(screen.getByLabelText('Agent runtime'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByLabelText('Agent model'), { target: { value: 'gpt-5.6-sol' } });
    fireEvent.change(screen.getByLabelText('Agent projects'), { target: { value: 'atlas-prep, kb-ops' } });
    fireEvent.change(screen.getByLabelText('Agent description'), { target: { value: 'Researches Atlas sources.' } });
    fireEvent.change(screen.getByLabelText('Agent body'), { target: { value: '# Atlas researcher' } });

    expect(deploy.disabled).toBe(false);
    expect(screen.getByTestId('composer-target').textContent).toContain('agents/atlas-researcher.md');
    expect(screen.getByTestId('composer-deploy-note').textContent).toMatch(/runner-bound: false/i);
    fireEvent.click(deploy);
    expect(onDeploy).toHaveBeenCalledWith(
      toDeploy('agent', {
        id: 'atlas-researcher',
        role: 'scout',
        runtime: 'codex',
        model: 'gpt-5.6-sol',
        projects: ['atlas-prep', 'kb-ops'],
        description: 'Researches Atlas sources.',
        body: '# Atlas researcher',
      }),
    );
  });

  it('seeds the first turn of a persisted empty workspace', async () => {
    const { calls, stream } = recordingStream();
    render(<Composer
      composerSession={{
        composerRef: 'cw-persisted', title: 'New idea', state: 'open', sourceComposerRef: null, agent: null,
        createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z', turns: [],
      }}
      sessionToken="tok"
      onDeploy={vi.fn()}
      onBack={vi.fn()}
      stream={stream}
    />);

    sendTurn('research a governed workflow');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].composerRef).toBe('cw-persisted');
    expect(calls[0].prompt).toMatch(/which TYPE this idea wants to become/);
  });

  it('shows the durable agent identity and declaration revision for an agent workspace', () => {
    render(<Composer
      composerSession={{
        composerRef: 'cw-agent', title: 'Agent · fyt-runner', state: 'open', sourceComposerRef: null,
        agent: { id: 'fyt-runner', path: 'agents/fyt-runner.md', sourceHash: 'abcdef0123456789fedcba' },
        createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z', turns: [],
      }}
      onDeploy={vi.fn()}
    />);

    expect(screen.getByTestId('composer-agent-target').textContent).toContain('fyt-runner');
    expect(screen.getByTestId('composer-agent-target').textContent).toContain('agents/fyt-runner.md');
    expect(screen.getByTestId('composer-agent-target').textContent).toContain('abcdef012345');
  });

  it('states honestly what each deploy creates', () => {
    render(<Composer initialKind="task" onDeploy={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByTestId('composer-deploy-note').textContent).toMatch(/files a queue card/i);
    fireEvent.click(screen.getByRole('button', { name: 'Workflow' }));
    expect(screen.getByTestId('composer-deploy-note').textContent).toMatch(/does not run the workflow/i);
    fireEvent.click(screen.getByRole('button', { name: 'Skill' }));
    expect(screen.getByTestId('composer-deploy-note').textContent).toMatch(/does not promote or activate/i);
  });

  it('loads server-owned workflow profiles and never defaults one', async () => {
    const onDeploy = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/workflows/profiles') {
        return { ok: true, status: 200, json: async () => ({ profiles: ['research'] }) } as Response;
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }));
    render(<Composer initialKind="workflow" onDeploy={onDeploy} onBack={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Workflow filename'), { target: { value: 'brief.md' } });
    fireEvent.change(screen.getByLabelText('Workflow project'), { target: { value: 'kb' } });
    fireEvent.change(screen.getByLabelText('Workflow notes'), { target: { value: 'Research the brief.' } });
    fireEvent.change(screen.getByLabelText('Stage 1 action'), { target: { value: 'research' } });
    fireEvent.change(screen.getByLabelText('Stage 1 target'), { target: { value: 'orgs/kb' } });
    fireEvent.change(screen.getByLabelText('Stage 1 work order'), { target: { value: 'Research the brief.' } });
    const deploy = screen.getByRole('button', { name: 'Save definition' }) as HTMLButtonElement;
    expect(deploy.disabled).toBe(true);

    const profile = screen.getByLabelText('Execution profile') as HTMLSelectElement;
    await waitFor(() => expect(profile.disabled).toBe(false));
    expect(profile.value).toBe('');
    expect(deploy.disabled).toBe(true);
    fireEvent.change(profile, { target: { value: 'research' } });
    expect(deploy.disabled).toBe(false);
    fireEvent.click(deploy);
    expect(onDeploy).toHaveBeenCalledWith(expect.objectContaining({ relpath: 'orgs/kb/workflows/brief.md' }));
  });

  it('filters declared manager and worker selectors by project/profile role and states runner binding', async () => {
    stubWorkflowRegistries();
    render(<Composer initialKind="workflow" onDeploy={vi.fn()} onBack={vi.fn()} />);
    fillWorkflowDraft();

    const manager = screen.getByLabelText('Workflow manager agent') as HTMLSelectElement;
    const stage = screen.getByLabelText('Stage 1 agent') as HTMLSelectElement;
    const governor = screen.getByLabelText('Workflow governor') as HTMLSelectElement;
    const stageGovernor = screen.getByLabelText('Stage 1 governor') as HTMLSelectElement;
    await waitFor(() => expect(manager.options).toHaveLength(2));

    expect([...manager.options].map((option) => option.text)).toEqual([
      'No logical assignment',
      'fyt-runner · runner-bound',
    ]);
    expect([...stage.options].map((option) => option.text)).toEqual([
      'No logical assignment',
      'manager-backup · declared only',
      'worker-only · declared only',
      'worker-primary · runner-bound',
    ]);
    expect([...manager.options].map((option) => option.value)).not.toContain('manager-backup');
    expect([...stage.options].map((option) => option.value)).not.toContain('fyt-runner');
    expect([...governor.options].map((option) => option.text)).toEqual([
      'Unassigned governance',
      'fyt-runner · declared agent',
      'manager-backup · declared agent',
      'worker-only · declared agent',
      'worker-primary · declared agent',
    ]);
    expect([...stageGovernor.options].map((option) => option.value)).toEqual([
      '', 'fyt-runner', 'manager-backup', 'worker-only', 'worker-primary',
    ]);
    expect([...governor.options].map((option) => option.value)).not.toContain('other-project');
    expect([...governor.options].map((option) => option.value)).not.toContain('observed-worker');
    expect(screen.getByTestId('workflow-assignment-note').textContent).toMatch(/do not choose a technical executor/i);
    expect(screen.getByTestId('workflow-assignment-note').textContent).toMatch(/adapter availability/i);
  });

  it('selecting agents chooses the role default/first profile, allows overrides, and resets on switch', async () => {
    stubWorkflowRegistries();
    render(<Composer initialKind="workflow" onDeploy={vi.fn()} onBack={vi.fn()} />);
    fillWorkflowDraft();
    const manager = screen.getByLabelText('Workflow manager agent') as HTMLSelectElement;
    await waitFor(() => expect(manager.options).toHaveLength(2));

    fireEvent.change(manager, { target: { value: 'fyt-runner' } });
    const managerProfile = screen.getByLabelText('Workflow manager profile') as HTMLSelectElement;
    expect(managerProfile.value).toBe('manager:claude:claude-opus-4-8');
    expect([...managerProfile.options].map((option) => option.value)).toEqual([
      'manager:claude:claude-opus-4-8',
      'manager:codex:gpt-5.6-sol',
    ]);
    fireEvent.change(managerProfile, { target: { value: 'manager:codex:gpt-5.6-sol' } });
    expect(screen.getByTestId('workflow-manager-agent-selection').textContent).toMatch(/Profile override/i);

    const stage = screen.getByLabelText('Stage 1 agent') as HTMLSelectElement;
    fireEvent.change(stage, { target: { value: 'worker-primary' } });
    const stageProfile = screen.getByLabelText('Stage 1 profile') as HTMLSelectElement;
    expect(stageProfile.value).toBe('worker:claude:claude-opus-4-8');
    expect([...stageProfile.options].map((option) => option.value)).toEqual([
      'worker:claude:claude-opus-4-8',
      'worker:codex:gpt-5.6-sol',
    ]);
    fireEvent.change(stageProfile, { target: { value: 'worker:codex:gpt-5.6-sol' } });
    expect(screen.getByTestId('stage-1-agent-selection').textContent).toMatch(/Profile override/i);

    fireEvent.change(stage, { target: { value: 'worker-only' } });
    expect(stageProfile.value).toBe('worker:codex:gpt-5.6-sol');
    fireEvent.change(stage, { target: { value: '' } });
    expect(stage.value).toBe('');
    expect(stageProfile.disabled).toBe(true);
  });

  it('serializes selected logical manager and stage assignments without raw executor routing fields', async () => {
    const onDeploy = vi.fn();
    stubWorkflowRegistries();
    render(<Composer initialKind="workflow" onDeploy={onDeploy} onBack={vi.fn()} />);
    fillWorkflowDraft();
    const manager = screen.getByLabelText('Workflow manager agent') as HTMLSelectElement;
    await waitFor(() => expect(manager.options).toHaveLength(2));
    fireEvent.change(manager, { target: { value: 'fyt-runner' } });
    fireEvent.change(screen.getByLabelText('Stage 1 agent'), { target: { value: 'worker-only' } });
    const profile = screen.getByLabelText('Execution profile') as HTMLSelectElement;
    await waitFor(() => expect(profile.disabled).toBe(false));
    fireEvent.change(profile, { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }));

    const content = onDeploy.mock.calls[0][0].content as string;
    expect(content).toContain('manager:\n  agentId: "fyt-runner"\n  profileId: "manager:claude:claude-opus-4-8"\nstages:');
    expect(content).toContain('agentId: "worker-only"');
    expect(content).toContain('profileId: "worker:codex:gpt-5.6-sol"');
    expect(content).not.toContain('owner:');
    expect(content).not.toContain('runtime:');
    expect(content).not.toContain('model:');
  });

  it('selects declared project governance independently without creating execution assignments', async () => {
    const onDeploy = vi.fn();
    stubWorkflowRegistries();
    render(<Composer initialKind="workflow" onDeploy={onDeploy} onBack={vi.fn()} />);
    fillWorkflowDraft();

    const governor = screen.getByLabelText('Workflow governor') as HTMLSelectElement;
    await waitFor(() => expect(governor.options).toHaveLength(5));
    fireEvent.change(governor, { target: { value: 'manager-backup' } });
    fireEvent.change(screen.getByLabelText('Stage 1 governor'), { target: { value: 'worker-only' } });

    // Neither declared-only agent has a usable execution-manager profile. Governance remains selectable
    // because it is accountability metadata, not a runner/profile binding.
    expect((screen.getByLabelText('Workflow manager agent') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Stage 1 agent') as HTMLSelectElement).value).toBe('');
    const profile = screen.getByLabelText('Execution profile') as HTMLSelectElement;
    await waitFor(() => expect(profile.disabled).toBe(false));
    fireEvent.change(profile, { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }));

    const content = onDeploy.mock.calls[0][0].content as string;
    expect(content).toContain('governedBy: manager-backup');
    expect(content).toContain('governedBy: worker-only');
    expect(content).not.toContain('manager:');
    expect(content).not.toContain('agentId:');
    expect(content).not.toContain('profileId:');
    expect(content).not.toContain('runtime:');
    expect(content).not.toContain('model:');
  });

  it('keeps an unassigned legacy workflow deployable when the agent roster cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/workflows/profiles') {
        return { ok: true, status: 200, json: async () => ({ profiles: ['research'] }) } as Response;
      }
      if (input === '/api/agents') return { ok: false, status: 503, json: async () => ({}) } as Response;
      throw new Error(`unexpected fetch: ${String(input)}`);
    }));
    const onDeploy = vi.fn();
    render(<Composer initialKind="workflow" onDeploy={onDeploy} onBack={vi.fn()} />);
    fillWorkflowDraft();
    const profile = screen.getByLabelText('Execution profile') as HTMLSelectElement;
    await waitFor(() => expect(profile.disabled).toBe(false));
    fireEvent.change(profile, { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }));

    expect(onDeploy).toHaveBeenCalledTimes(1);
    expect(onDeploy.mock.calls[0][0].content).not.toContain('manager:');
    expect(onDeploy.mock.calls[0][0].content).not.toContain('agentId:');
    expect(screen.getByTestId('workflow-assignment-note').textContent).toMatch(/could not be loaded/i);
  });
});
