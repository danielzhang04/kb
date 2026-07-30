/**
 * D15 — compile-proof for the faceless-youtube `video-run` workflow definition.
 *
 * This test drives the REAL org file at `orgs/faceless-youtube/workflows/video-run.md` through the
 * SAME registry validation + compiler the real registry route uses. It proves the definition that
 * actually ships compiles clean: valid shape, expected DAG, preserved risk floors, resolvable profile.
 *
 * HISTORY — why there is no fixture here anymore.
 * An earlier revision embedded the definition as a TypeScript string literal and asked humans, in a
 * comment, to "keep this byte-identical" with the org file, calling drift "the bug this test exists to
 * catch". The test contained no file read whatsoever, so it could not catch that bug or any other:
 * the fixture and the org file were free to diverge with the suite fully green. The copy has been
 * deleted. `loadOrgDef` (see orgDefSource.ts) locates the one real file — across git worktrees, since
 * the org tree and the dashboard currently sit on different branches — and everything below compiles
 * THAT text. There is no second artifact left, so fixture-vs-definition drift cannot be expressed at
 * all. Cross-BRANCH drift is a different thing and is merely detected: the file may come from a
 * sibling worktree on another branch, so the test asserts on `SOURCE.origin` to keep the source it
 * compiled visible. If no live working tree has the file, `loadOrgDef` throws with a loud,
 * self-explaining error rather than falling back to anything stale.
 */
import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instantiateWorkflowDef, parseWorkflowDef } from './defs.ts';
import { compileWorkflowDef, type CompileWorkflowEnvironment } from './compile.ts';
import { loadOrgDef } from './orgDefSource.ts';
import { validateServerCompiledPlanProposal } from '../control/proposal.ts';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import type { ExecutionProfile } from '../control/policy.ts';
import type { RuntimeSkillRegistry } from '../control/environment.ts';

const REGISTRY: RuntimeSkillRegistry = {
  runtimes: {
    claude: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    codex: ['gpt-5.6-sol'],
  },
  skills: [],
  // The proposal validator fails CLOSED on `profile`: an absent or empty list admits nothing, so a
  // registry without this field refuses every compiled proposal.
  workflowProfiles: ['research', 'gmail-triage', 'drive-author', 'producer'],
};

// The server-owned execution profiles the registry route knows about (design D13). `producer` is the
// faceless pipeline profile: Bash + Read/Write/Edit + the local image/TTS/render scripts, and NEVER any
// publish/upload tool. Derived from the registry above so the def parser and the proposal validator
// cannot drift apart on what the closed set contains.
const KNOWN_PROFILES = new Set(REGISTRY.workflowProfiles);

const DEF_PATH = 'orgs/faceless-youtube/workflows/video-run.md';

// Module-scope load: if the definition is unreachable this throws here and the WHOLE file fails with
// OrgDefNotFoundError naming every location searched. That loud failure is deliberate — a skipped or
// silently-defaulted test is what let the old fixture rot.
const SOURCE = loadOrgDef(DEF_PATH);
const VIDEO_RUN_DEF = SOURCE.text;

/**
 * The definition is now EXECUTABLE: every stage names a declared agent, so compiling it requires the
 * binding inputs. Routing/profile data stays synthetic (this file must not drift with the live model
 * registry), but the declarations come from the SAME worktree the definition came from — proving the
 * checked-out `agents/*.md` roster is what the definition actually binds to.
 */
const REPO_ROOT = SOURCE.origin.slice(0, SOURCE.origin.length - DEF_PATH.split('/').join(sep).length);
const PROFILES: ExecutionProfile[] = [
  { id: 'manager:claude:claude-fable-5', role: 'manager', runtime: 'claude', model: 'claude-fable-5', capabilities: ['read', 'emit-events'] },
  { id: 'worker:claude:claude-fable-5', role: 'worker', runtime: 'claude', model: 'claude-fable-5', capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'] },
  { id: 'worker:claude:claude-sonnet-5', role: 'worker', runtime: 'claude', model: 'claude-sonnet-5', capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'] },
];
const BINDING_ENVIRONMENT: CompileWorkflowEnvironment = {
  registry: REGISTRY,
  declaredAgents: readDeclaredAgentDetails(REPO_ROOT),
  executionProfiles: PROFILES,
  availableRuntimes: new Set<'claude' | 'codex'>(['claude', 'codex']),
};

/** Stage order is the run's structure: a single chain, so no path can route around a gate. */
const STAGES: Array<[string, string, string, string[], 'T2' | 'T3', string]> = [
  ['idea', 'Generate ranked idea briefs', 'research:idea-briefs', [], 'T2', 'fyt-story'],
  ['story', 'Research the picked idea and write the full long-form script', 'draft:long-form-script', ['idea'], 'T2', 'fyt-story'],
  ['judge-gate', 'Fresh-context acceptance verdict on the script', 'review:script-verdict', ['story'], 'T2', 'fyt-checker'],
  ['packaging', 'Derive the shorts bench and author the metadata', 'draft:packaging', ['judge-gate'], 'T2', 'fyt-story'],
  ['visual-plan', 'Author the full shot list, motion plan, and lint', 'build:visual-plan', ['packaging'], 'T2', 'fyt-visuals'],
  ['images', 'Generate the on-style stills for the slice', 'build:images', ['visual-plan'], 'T2', 'fyt-visuals'],
  ['image-review', 'Review every generated still and build the shot board', 'review:image-board', ['images'], 'T2', 'fyt-checker'],
  ['audio', 'Generate narration and author the audio plan for the slice', 'build:audio', ['image-review'], 'T2', 'fyt-audio-render'],
  ['render', 'Assemble the finished cut for the slice', 'build:render', ['audio'], 'T2', 'fyt-audio-render'],
  ['verify', 'Verify the render and run the compliance report', 'verify:render-compliance', ['render'], 'T2', 'fyt-checker'],
  ['publish-private', 'Upload the finished cut as private', 'publish:private-upload', ['verify'], 'T3', 'fyt-publish'],
];

describe('video-run workflow definition (compile-proof)', () => {
  it('is loaded from the real org file on disk, never from an inline copy', () => {
    // Guards the property the old test lacked. If someone reintroduces a fixture, or the loader
    // starts returning something that is not the shipped definition, this fails.
    // `origin` must be a real file in a live working tree — a git-object origin (`git:<ref>`) is no
    // longer producible and must never come back: it served whichever ref sorted first alphabetically,
    // including refs where the definition was stale or deleted.
    expect(SOURCE.origin).toBeTruthy();
    expect(SOURCE.origin).not.toMatch(/^git:/);
    expect(existsSync(SOURCE.origin)).toBe(true);
    expect(SOURCE.origin.endsWith(DEF_PATH.split('/').join(sep))).toBe(true);
    expect(['worktree-local', 'worktree-sibling']).toContain(SOURCE.via);
    expect(VIDEO_RUN_DEF.length).toBeGreaterThan(1000);
    expect(VIDEO_RUN_DEF.startsWith('---\nid: video-run\n')).toBe(true);
  });

  it('parses to a valid definition against the known execution profiles', () => {
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe('video-run');
    expect(parsed.value.project).toBe('faceless-youtube');
    expect(parsed.value.title).toBe('Produce one video (faceless pipeline)');
    // NB: this reads the PARSED DEFINITION. It says nothing about whether the compiler copies the
    // profile onto the proposal — see the compiled-proposal assertion further down, which is the one
    // that actually guards `compile.ts`'s `profile: def.profile`.
    expect(parsed.value.profile).toBe('producer');
    expect(parsed.value.stages).toHaveLength(11);
    expect(parsed.value.parameters).toEqual(['channel', 'slug', 'slice']);
    expect(parsed.value.manager).toEqual({ agentId: 'fyt-runner', profileId: 'manager:claude:claude-fable-5' });
  });

  it('pins every stage id and title the dashboard launches from', () => {
    // The dashboard renders these strings in the launch UI, so they are contract, not cosmetics.
    // Pinning them means ANY edit to a stage's identity must be made deliberately, here and in the
    // definition together — it cannot slip through as an incidental change.
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.stages.map((s) => [s.id, s.title, s.action]))
      .toEqual(STAGES.map(([id, title, action]) => [id, title, action]));
    // Every stage is executable, not merely governed: an agent id plus the worker profile it binds
    // through. `governedBy` remains, for display continuity only.
    expect(parsed.value.stages.map((s) => [s.id, s.agentId, s.profileId, s.governedBy]))
      .toEqual(STAGES.map(([id, , , , , agent]) => [id, agent, 'worker:claude:claude-fable-5', agent]));
  });

  it('rejects the definition when `producer` is not a server-owned profile', () => {
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: new Set(['research']) });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain("profile 'producer'");
  });

  it('is a single gated chain, so no path can route around a human gate', () => {
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const deps = Object.fromEntries(parsed.value.stages.map((s) => [s.id, [...s.dependsOn].sort()]));
    // The spec draws packaging ∥ visual-plan; they are deliberately serialized here because a
    // parallel branch out of judge-gate would run visual-plan WITHOUT passing the G1 script gate
    // (gates block only the stage that declares them). visual-prompt-writer runs after metadata
    // anyway, so the serialization costs nothing and buys the structural halt.
    expect(deps).toEqual(Object.fromEntries(STAGES.map(([id, , , dependsOn]) => [id, [...dependsOn].sort()])));
    // Gates are declared on the stage they must hold back — the stage AFTER the judged work, because
    // `execution.ts#stageBoundary` evaluates a stage's gates before it prepares any attempt for it.
    expect(Object.fromEntries(parsed.value.stages
      .filter((s) => s.humanGates?.length)
      .map((s) => [s.id, s.humanGates?.map((gate) => gate.id)]))).toEqual({
      story: ['g0-idea-pick'],
      packaging: ['g1-script'],
      images: ['g2-visual-plan'],
      // A stage may declare more than one gate; `stageBoundary` raises them one at a time, in
      // declaration order, and holds the stage until every one is recorded approved.
      audio: ['g3-image-board', 'g3b-narration-cost'],
      'publish-private': ['g4-publish-private'],
    });
    // EVERY paid stage carries its own recorded cost authorization, and only paid stages do. Reachability
    // through the G2-gated images stage is not a record: the control plane authorizes spend PER STAGE, so
    // a targeted single-stage re-run of narration (which fyt-runner owns) would otherwise have called a
    // paid API with no authorization recorded against the stage that called it.
    expect(parsed.value.stages.flatMap((s) => (s.humanGates ?? [])
      .filter((gate) => gate.spendAuthorization === true)
      .map((gate) => `${s.id}:${gate.id}`))).toEqual(['images:g2-visual-plan', 'audio:g3b-narration-cost']);
    expect(parsed.value.stages.flatMap((s) => s.humanGates ?? []).every((gate) => gate.kind === 'approval')).toBe(true);
  });

  it('keeps every stage at or above its classified floor, with only the upload at T3', () => {
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.stages.map((s) => [s.id, s.classifiedFloor, s.riskTier]))
      .toEqual(STAGES.map(([id, , , , riskTier]) => [id, riskTier, riskTier]));
  });

  it('lifts an under-declared render stage back to its T2 floor (floor preserved through parse)', () => {
    // Operates on the real text: find the render stage's declared tier and lower it in-memory only.
    const lowered = VIDEO_RUN_DEF.replace(
      /(- id: render\n(?:.*\n)*?    riskTier: )T2/,
      '$1T1',
    );
    expect(lowered).not.toBe(VIDEO_RUN_DEF); // the substitution must actually have applied
    const parsed = parseWorkflowDef(lowered, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const render = parsed.value.stages.find((s) => s.id === 'render');
    expect(render?.declaredRiskTier).toBe('T1');
    expect(render?.riskTier).toBe('T2');
  });

  it('compiles to a proposal that passes the real proposal validator', () => {
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const compiled = compileWorkflowDef(parsed.value, BINDING_ENVIRONMENT);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.stages).toHaveLength(11);
    expect(compiled.value.project).toBe('faceless-youtube');
    expect(compiled.value.proposalId).toMatch(/^wf-[a-f0-9]{48}$/);
    expect(compiled.value.governanceRefs).toContain('orgs/faceless-youtube/contract.md');
    // Routing comes from the AUTHORED assignments now, not the compiler's default picks: the runner
    // manages on Fable 5, every stage worker runs Fable 5 through its declared worker profile.
    expect(compiled.value.manager.model).toBe('claude-fable-5');
    expect(compiled.value.manager.assignment?.agentId).toBe('fyt-runner');
    expect(compiled.value.stages.every((s) => s.worker.model === 'claude-fable-5')).toBe(true);
    expect(compiled.value.stages.map((s) => s.assignment?.agentId)).toEqual(STAGES.map(([, , , , , agent]) => agent));
    // The declared gates must reach the COMPILED stages: `compile.ts` hardcoded `humanGates: []` for
    // its whole life, which made an org definition's declared halt structure unenforceable.
    expect(compiled.value.stages.flatMap((s) => s.humanGates.map((gate) => [s.id, gate.id, gate.spendAuthorization ?? false]))).toEqual([
      ['story', 'g0-idea-pick', false],
      ['packaging', 'g1-script', false],
      ['images', 'g2-visual-plan', true],
      ['audio', 'g3-image-board', false],
      ['audio', 'g3b-narration-cost', true],
      ['publish-private', 'g4-publish-private', false],
    ]);
    // The real definition's `producer` profile must land on the PROPOSAL, not merely in the parsed
    // def. Without `compile.ts`'s `profile: def.profile`, this workflow's workers spawn with no
    // --allowedTools at all, and every assertion above still passes.
    expect(compiled.value.profile).toBe('producer');
    const validated = validateServerCompiledPlanProposal(compiled.value as unknown, REGISTRY);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.profile).toBe('producer');
  });

  // -------------------------------------------------------------------------
  // Truthfulness guards. The dashboard launches runs FROM this definition, so an operator reads it
  // to decide whether to launch. A previous revision told them the workflow spent nothing while the
  // images stage was in fact billing a paid Gemini API. These assertions make that specific lie
  // un-reintroducible: restoring the old wording turns the suite red.
  // -------------------------------------------------------------------------
  describe('operator-facing truthfulness', () => {
    it('never claims the workflow spends no real money', () => {
      expect(VIDEO_RUN_DEF).not.toContain('spend no real money');
      expect(VIDEO_RUN_DEF).not.toContain('no spend beyond the configured local image stack');
      expect(VIDEO_RUN_DEF).not.toContain('Heavyweight local generation only');
    });

    it('declares the images stage as paid, API-backed, ceilinged, and gated on G2', () => {
      const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const images = parsed.value.stages.find((s) => s.id === 'images');
      expect(images).toBeDefined();
      const order = images?.workOrder ?? '';
      expect(order).toMatch(/cost-bearing/i);
      expect(order).toMatch(/Gemini image API/i);
      expect(order).toMatch(/130-200 generation calls/);
      expect(order).toMatch(/call ceiling/i);
      // The authorization is the recorded G2 approval now, not a queue card — and the work order must
      // say so, because the operator reads it to know what releases this stage.
      expect(order).toMatch(/recorded approval of gate g2-visual-plan/i);
      // The gate lives on THIS stage, so approving it and starting the paid work are the same event.
      expect(images?.humanGates).toEqual([expect.objectContaining({ id: 'g2-visual-plan', spendAuthorization: true })]);
    });

    it('documents the cost law and the single G2 authorization in the prose body', () => {
      expect(VIDEO_RUN_DEF).toMatch(/## Cost law/);
      expect(VIDEO_RUN_DEF).toMatch(/ElevenLabs/);
      expect(VIDEO_RUN_DEF).toMatch(/single authorization for both/i);
      expect(VIDEO_RUN_DEF).toMatch(/spendAuthorization: true/);
      // The audio stage calls a paid API too. It is ONE human decision, taken at G2 — and the body must
      // say why that decision is nonetheless restated on the audio stage: reachability is not a record,
      // and the control plane authorizes cost per stage, so a single-stage re-run needs its own.
      expect(VIDEO_RUN_DEF).toMatch(/reachability is\s+not a record/);
      expect(VIDEO_RUN_DEF).toMatch(/g3b-narration-cost/);
      const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const audio = parsed.value.stages.find((s) => s.id === 'audio');
      expect(audio?.workOrder).toMatch(/SAME recorded g2-visual-plan authorization/);
      expect(audio?.workOrder).toMatch(/g3b-narration-cost records that one decision against this stage/);
      expect(audio?.humanGates?.find((gate) => gate.id === 'g3b-narration-cost'))
        .toEqual(expect.objectContaining({ kind: 'approval', spendAuthorization: true }));
    });

    it('states where each gate is declared and what the machine pre-vet is', () => {
      expect(VIDEO_RUN_DEF).toMatch(/g0-idea-pick/);
      expect(VIDEO_RUN_DEF).toMatch(/g4-publish-private/);
      expect(VIDEO_RUN_DEF).toMatch(/before\*? it prepares any attempt/i);
      expect(VIDEO_RUN_DEF).toMatch(/author-never-grades/i);
    });

    it('documents the single-writer staging rule the conductor enforces', () => {
      expect(VIDEO_RUN_DEF).toMatch(/single-writer/i);
      expect(VIDEO_RUN_DEF).toMatch(/staging\//);
      expect(VIDEO_RUN_DEF).toMatch(/re-lint/i);
    });
  });

  describe('paths match the real on-disk tree', () => {
    it('targets the real channels tree, never the nonexistent orgs/faceless-youtube/videos', () => {
      const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      for (const stage of parsed.value.stages) {
        expect(stage.target).toBe('orgs/faceless-youtube/channels');
      }
      expect(VIDEO_RUN_DEF).not.toContain('target: orgs/faceless-youtube/videos');
    });

    it('names the artifact filenames the pipeline actually writes', () => {
      const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const order = (id: string) => parsed.value.stages.find((s) => s.id === id)?.workOrder ?? '';
      // The run wrote judge-verdict.md, not judge.md.
      expect(order('judge-gate')).toContain('judge-verdict.md');
      expect(order('judge-gate')).not.toMatch(/[^-]judge\.md/);
      // The run wrote shorts/short-NN.md, one file per short, not a single shorts.md.
      expect(order('packaging')).toContain('shorts/short-NN.md');
      expect(order('packaging')).not.toMatch(/[^-]shorts\.md/);
      expect(order('packaging')).toContain('metadata.json');
      expect(order('visual-plan')).toContain('shots.json');
      expect(order('visual-plan')).toContain('shots.motion.json');
      expect(order('audio')).toContain('audio-plan.json');
      expect(order('verify')).toContain('compliance-report.md');
      // render-builder writes into `assets/`, not the video root: `assets/final.mp4`,
      // `assets/shorts/short-NN.mp4`, `assets/render.manifest.json` (skill contract + the
      // 2026-07-19-wells-fargo run's own render.manifest.json, whose piece `out` is `assets/final.mp4`).
      expect(order('render')).toContain('assets/final.mp4');
      expect(order('render')).toContain('assets/render.manifest.json');
      expect(order('render')).not.toMatch(/videos\/<slug>\/final\.mp4/);
      // The restricted-intent scanner in execution.ts parks any stage whose PROSE says `publish`.
      // Only the upload stage may trip it (its action declares the intent); every other work order
      // must state the gate without the trigger word, or the run parks permanently on a false
      // positive (the PR #58 self-lint-report failure mode).
      const gatedStages = ['idea', 'story', 'judge-gate', 'packaging', 'visual-plan', 'images', 'image-review', 'audio', 'render', 'verify'];
      for (const id of gatedStages) {
        expect(order(id), `${id} work order must not trip the restricted-intent prose scan`)
          .not.toMatch(/\b(?:publish|publication|deploy|purchase|spend|payment|buy|credential|secret|api key|access token)\b/i);
      }
    });

    // ---------------------------------------------------------------------
    // Declared artifacts. `compile.ts` hardcoded `artifacts: []` and `WorkflowStageDef` had no
    // `artifacts` key, so the server-side declared-artifact verification in rosterSessions.ts#deliver
    // iterated an empty list on all eleven stages: a bare `FYT-STAGE-DONE story <token>` with nothing on
    // disk was accepted as `succeeded`, and the run advanced to G1 asking a human to approve a script
    // that did not exist. The filenames below are the ones the SKILLS actually write, checked against
    // channels/the-second-take/videos/2026-07-19-wells-fargo (and channels/the-second-take/videos/
    // _bricks-seg for the gitignored assets/board.html + assets/final.mp4).
    // ---------------------------------------------------------------------
    it("declares the load-bearing output of EVERY stage, so no stage succeeds on an agent's word alone", () => {
      const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.stages.filter((s) => (s.artifacts ?? []).length === 0).map((s) => s.id)).toEqual([]);
      const paths = Object.fromEntries(parsed.value.stages.map((s) => [s.id, (s.artifacts ?? []).map((a) => a.path)]));
      const video = 'orgs/faceless-youtube/channels/<channel>/videos/<slug>';
      expect(paths).toEqual({
        idea: [`${video}/brief.md`],
        story: [`${video}/research.md`, `${video}/script.md`],
        'judge-gate': [`${video}/judge-verdict.md`],
        packaging: [`${video}/metadata.json`],
        // The three shared JSON plans are single-writer: the stage agent produces them under `staging/`
        // and fyt-runner alone merges them to the video root. The stage can therefore only be held to the
        // STAGED path — the merge is not a DAG node, so nothing here verifies the merged root file.
        'visual-plan': [`${video}/staging/shots.json`, `${video}/staging/shots.motion.json`],
        images: [`${video}/assets/scenes/manifest.json`],
        'image-review': [`${video}/assets/_review/merged.json`, `${video}/assets/board.html`],
        audio: [`${video}/assets/voiceover.manifest.json`, `${video}/staging/audio-plan.json`],
        render: [`${video}/assets/final.mp4`, `${video}/assets/render.manifest.json`],
        verify: [`${video}/render-verify.md`, `${video}/compliance-report.md`],
        'publish-private': [`${video}/publish-record.json`],
      });
      // Every declared path sits inside its own stage's target tree (the defs.ts containment rule),
      // carries an operator-facing description, and has a workflow-unique id, so a park message names
      // exactly one missing file.
      for (const stage of parsed.value.stages) {
        for (const artifact of stage.artifacts ?? []) {
          expect(artifact.path.startsWith(`${stage.target}/`)).toBe(true);
          expect(artifact.description.trim().length).toBeGreaterThan(0);
        }
      }
      const ids = parsed.value.stages.flatMap((s) => (s.artifacts ?? []).map((a) => a.id));
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('interpolates channel and slug into every declared artifact path at launch', () => {
      const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const launched = instantiateWorkflowDef(parsed.value, {
        channel: 'the-second-take', slug: '2026-07-19-wells-fargo', slice: '2min',
      });
      expect(launched.ok).toBe(true);
      if (!launched.ok) return;
      const compiled = compileWorkflowDef(launched.value, BINDING_ENVIRONMENT);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      const all = compiled.value.stages.flatMap((s) => s.artifacts.map((a) => a.path));
      expect(all).toHaveLength(17);
      // An unsubstituted placeholder is a path no file can ever have — every run would park at every
      // stage — and `unresolved-parameter-` is the compiler's stand-in for a RAW compile, which a launch
      // must never produce.
      expect(all.every((path) => !path.includes('<') && !path.includes('unresolved-parameter-'))).toBe(true);
      expect(all.every((path) => path.startsWith('orgs/faceless-youtube/channels/the-second-take/videos/2026-07-19-wells-fargo/'))).toBe(true);
      expect(validateServerCompiledPlanProposal(compiled.value as unknown, REGISTRY)).toMatchObject({ ok: true });
      // The declared bar reaches the object the roster adapter re-derives delivery from — the compiled
      // stage — not merely the parsed definition.
      expect(compiled.value.stages.find((s) => s.id === 'story')?.artifacts.map((a) => a.id)).toEqual(['research', 'script']);
    });

    it('still compiles to a VALID proposal uninstantiated, as the list preview and amendment routes do', () => {
      // `compiledPreview` (workflows list `launchable`) and the assignment/governance amendment route
      // both compile the RAW definition, and the amendment route runs the result through the real
      // validator. A placeholder path would fail it, so the compiler renders one as a path-safe
      // symbolic segment rather than emptying the artifact list.
      const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const compiled = compileWorkflowDef(parsed.value, BINDING_ENVIRONMENT);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(validateServerCompiledPlanProposal(compiled.value as unknown, REGISTRY)).toMatchObject({ ok: true });
      expect(compiled.value.stages.flatMap((s) => s.artifacts)).toHaveLength(17);
      expect(compiled.value.stages.find((s) => s.id === 'story')?.artifacts[1].path)
        .toBe('orgs/faceless-youtube/channels/unresolved-parameter-channel/videos/unresolved-parameter-slug/script.md');
    });
  });
});
