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

afterEach(() => cleanup());

const REPLY = (text: string): TimelineModel => ({
  turns: [{ index: 0, model: 'claude-sonnet-5', timestamp: null, usage: null, steps: [{ kind: 'text', text }] }],
});

/** A recording fake stream: captures every composed prompt + resume id, echoes a reply, returns a fresh
 *  session id so turn N+1 rides the resume flow. */
function recordingStream(): { calls: Array<{ prompt: string; resumeId?: string }>; stream: ComposerStreamFn } {
  const calls: Array<{ prompt: string; resumeId?: string }> = [];
  const stream: ComposerStreamFn = vi.fn(async (prompt, resumeId, _token, onDelta) => {
    calls.push({ prompt, resumeId });
    onDelta(REPLY(`reply ${calls.length}`));
    return { ok: true, resumeId: `sess-${calls.length}` };
  });
  return { calls, stream };
}

function sendTurn(text: string): void {
  fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: text } });
  fireEvent.submit(screen.getByLabelText('Composer prompt'));
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
    expect(calls[0].resumeId).toBeUndefined();
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
    expect(calls[1].resumeId).toBe('sess-1');
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
    const onDeploy = vi.fn();
    render(<Composer initialKind="skill" onDeploy={onDeploy} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'My Helper' } });
    fireEvent.change(screen.getByLabelText('Skill description'), { target: { value: 'does a thing' } });
    fireEvent.change(screen.getByLabelText('Skill body'), { target: { value: 'the steps' } });

    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(onDeploy).toHaveBeenCalledTimes(1);
    expect(onDeploy).toHaveBeenCalledWith(
      toDeploy('skill', { name: 'My Helper', description: 'does a thing', body: 'the steps' }),
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

  it('states honestly what each deploy creates', () => {
    render(<Composer initialKind="task" onDeploy={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByTestId('composer-deploy-note').textContent).toMatch(/files a queue card/i);
    fireEvent.click(screen.getByRole('button', { name: 'Workflow' }));
    expect(screen.getByTestId('composer-deploy-note').textContent).toMatch(/does not run the workflow/i);
    fireEvent.click(screen.getByRole('button', { name: 'Skill' }));
    expect(screen.getByTestId('composer-deploy-note').textContent).toMatch(/does not promote or activate/i);
  });
});
