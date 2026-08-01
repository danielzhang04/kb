import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadWorkflowCompileEnvironment, workflowProfileIds } from '../control/environment.ts';
import { compileWorkflowDef } from './compile.ts';
import { instantiateWorkflowDef, parseWorkflowDef } from './defs.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SOURCE = readFileSync(fileURLToPath(new URL('../../../orgs/faceless-youtube/workflows/thin-slice-run.md', import.meta.url)), 'utf8');
const STORY_DECLARATION = readFileSync(fileURLToPath(new URL('../../../agents/fyt-story.md', import.meta.url)), 'utf8');
const VIDEO = 'orgs/faceless-youtube/channels/the-second-take/videos/2026-07-31-thin';

function compiledThin() {
  const parsed = parseWorkflowDef(SOURCE, { knownProfiles: workflowProfileIds() });
  expect(parsed).toMatchObject({ ok: true });
  if (!parsed.ok) throw new Error(parsed.detail);
  const instantiated = instantiateWorkflowDef(parsed.value, {
    channel: 'the-second-take', slug: '2026-07-31-thin', slice: 'opening-8-shots-450-chars',
  });
  if (!instantiated.ok) throw new Error(instantiated.detail);
  expect(instantiated).toMatchObject({ ok: true });
  const compiled = compileWorkflowDef(instantiated.value, loadWorkflowCompileEnvironment(REPO_ROOT));
  expect(compiled).toMatchObject({ ok: true });
  if (!compiled.ok) throw new Error(compiled.detail);
  return compiled.value;
}

function within(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

describe('checked-out FYT all-Codex thin-slice workflow', () => {
  it('compiles the shipped definition without restricted-intent vocabulary', () => {
    const proposal = compiledThin();
    const restricted = /\b(?:credential|password|private key|api key|access token|secret|purchase|spend|payment|credit card|buy|publish|publication|deploy|release externally|upload externally)\b/i;
    expect(proposal.manager).toMatchObject({ runtime: 'codex', model: 'gpt-5.6-sol' });
    expect(proposal.stages).toHaveLength(13);
    expect(proposal.stages.every((stage) => stage.assignment?.runtime === 'codex')).toBe(true);
    expect(proposal.stages.every((stage) => !restricted.test(stage.action) && !restricted.test(stage.workOrder))).toBe(true);
    expect(proposal.stages.some((stage) => stage.riskTier === 'T3' || stage.action.startsWith('publish:'))).toBe(false);
    expect(proposal.stages.flatMap((stage) => stage.humanGates)
      .some((gate) => gate.publicationAuthorization === true)).toBe(false);
  });

  it('materializes governance reads and exact per-stage write targets', () => {
    const proposal = compiledThin();
    expect(proposal.scope.read).toEqual(['CLAUDE.md', 'AGENTS.md', 'governance', 'orgs/faceless-youtube']);
    const targets = Object.fromEntries(proposal.stages.map((stage) => [stage.id, stage.target]));
    expect(targets).toEqual({
      idea: VIDEO,
      story: VIDEO,
      'judge-gate': `${VIDEO}/reviews/script`,
      packaging: VIDEO,
      'visual-plan': VIDEO,
      'shots-merge': VIDEO,
      'slice-contract': `${VIDEO}/checks/slice`,
      images: VIDEO,
      'image-review': `${VIDEO}/assets/_review`,
      audio: VIDEO,
      'audio-plan-merge': VIDEO,
      render: VIDEO,
      verify: `${VIDEO}/verification`,
    });
    for (const stage of proposal.stages) expect(stage.scope.write).toEqual([stage.target]);
  });

  it('keeps independent checker outputs outside every reviewed subject path', () => {
    const proposal = compiledThin();
    const scope = (id: string) => proposal.stages.find((stage) => stage.id === id)?.scope.write ?? [];

    expect(scope('judge-gate')).toEqual([`${VIDEO}/reviews/script`]);
    expect(within(`${VIDEO}/script.md`, scope('judge-gate'))).toBe(false);
    expect(within(`${VIDEO}/research.md`, scope('judge-gate'))).toBe(false);

    expect(scope('slice-contract')).toEqual([`${VIDEO}/checks/slice`]);
    expect(within(`${VIDEO}/script.md`, scope('slice-contract'))).toBe(false);
    expect(within(`${VIDEO}/staging/shots.json`, scope('slice-contract'))).toBe(false);

    expect(scope('image-review')).toEqual([`${VIDEO}/assets/_review`]);
    expect(within(`${VIDEO}/assets/scenes/manifest.json`, scope('image-review'))).toBe(false);
    expect(within(`${VIDEO}/assets/scenes/shot-001.png`, scope('image-review'))).toBe(false);

    expect(scope('verify')).toEqual([`${VIDEO}/verification`]);
    expect(within(`${VIDEO}/assets/final.mp4`, scope('verify'))).toBe(false);
    expect(within(`${VIDEO}/assets/render.manifest.json`, scope('verify'))).toBe(false);
  });

  it('aligns the thin story order and write scope with the story declaration', () => {
    const proposal = compiledThin();
    const story = proposal.stages.find((stage) => stage.id === 'story');
    expect(story?.scope.write).toEqual([VIDEO]);
    expect(story?.artifacts.map((artifact) => artifact.path)).toEqual([
      `${VIDEO}/research.md`, `${VIDEO}/script.md`,
    ]);
    expect(story?.artifacts.every((artifact) => within(artifact.path, story.scope.write))).toBe(true);
    expect(story?.workOrder).toMatch(/write a fresh research\.md.*write the WHOLE long-form script\.md directly/i);

    expect(STORY_DECLARATION).toContain('write your owned');
    expect(STORY_DECLARATION).toContain('directly at the');
    expect(STORY_DECLARATION).toContain("These are fyt-story's single-writer outputs, not shared JSON");
    expect(STORY_DECLARATION).toMatch(/Never write a shared JSON plan .* to the video\s+root/);
    expect(STORY_DECLARATION).toContain('writes it under `staging/`');
    expect(STORY_DECLARATION).not.toContain('Never write a single-writer artifact to its root path');
    expect(STORY_DECLARATION).not.toContain('the runner is the only writer of the video root');
  });

  it('pins narrowed checker outputs and their downstream references', () => {
    const proposal = compiledThin();
    const stage = (id: string) => proposal.stages.find((candidate) => candidate.id === id);
    expect(stage('judge-gate')?.artifacts.map((artifact) => artifact.path))
      .toEqual([`${VIDEO}/reviews/script/judge-verdict.md`]);
    expect(stage('packaging')?.workOrder).toContain('reviews/script/judge-verdict.md');
    expect(stage('slice-contract')?.artifacts.map((artifact) => artifact.path))
      .toEqual([`${VIDEO}/checks/slice/thin-run-slice.json`]);
    expect(stage('images')?.workOrder).toContain('checks/slice/thin-run-slice.json');
    expect(stage('image-review')?.artifacts.map((artifact) => artifact.path)).toEqual([
      `${VIDEO}/assets/_review/merged.json`, `${VIDEO}/assets/_review/board.html`,
    ]);
    expect(stage('audio')?.workOrder).toContain('assets/_review/merged.json');
    expect(stage('verify')?.artifacts.map((artifact) => artifact.path)).toEqual([
      `${VIDEO}/verification/render-verify.md`, `${VIDEO}/verification/compliance-report.md`,
    ]);
  });
});
