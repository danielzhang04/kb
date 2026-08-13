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
  repositories: {
    forProject() { throw new Error('project is not registered'); },
    resolve() { throw new Error('repository binding identity is stale or unknown'); },
  },
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
 * The definition is EXECUTABLE: every stage but the two runner-owned merge nodes names a declared
 * agent, so compiling it requires the binding inputs. Routing/profile data stays synthetic (this file
 * must not drift with the live model registry), but the declarations come from the SAME worktree the
 * definition came from — proving the checked-out `agents/*.md` roster is what the definition actually
 * binds to.
 */
const REPO_ROOT = SOURCE.origin.slice(0, SOURCE.origin.length - DEF_PATH.split('/').join(sep).length);
const PROFILES: ExecutionProfile[] = [
  { id: 'manager:claude:claude-fable-5', role: 'manager', runtime: 'claude', model: 'claude-fable-5', capabilities: ['read', 'emit-events'] },
  { id: 'worker:claude:claude-fable-5', role: 'worker', runtime: 'claude', model: 'claude-fable-5', capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'] },
  { id: 'worker:claude:claude-sonnet-5', role: 'worker', runtime: 'claude', model: 'claude-sonnet-5', capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'] },
  // The canonical workflow still selects Claude explicitly, while the checked-out roster now declares
  // Codex defaults. Assignment validation resolves both the selected profile and each agent's declared
  // default, so the synthetic environment must contain both sets without changing canonical routing.
  { id: 'manager:codex:gpt-5.6-sol', role: 'manager', runtime: 'codex', model: 'gpt-5.6-sol', capabilities: ['read', 'emit-events'] },
  { id: 'worker:codex:gpt-5.6-sol', role: 'worker', runtime: 'codex', model: 'gpt-5.6-sol', capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'] },
  { id: 'worker:codex:gpt-5.6-terra', role: 'worker', runtime: 'codex', model: 'gpt-5.6-terra', capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'] },
];
const BINDING_ENVIRONMENT: CompileWorkflowEnvironment = {
  registry: REGISTRY,
  declaredAgents: readDeclaredAgentDetails(REPO_ROOT),
  executionProfiles: PROFILES,
  availableRuntimes: new Set<'claude' | 'codex'>(['claude', 'codex']),
};

/**
 * Stage order is the run's structure: a single chain, so no path can route around a gate.
 *
 * The last two columns are deliberately separate. `governedBy` is the accountable owner of every
 * stage; `agentId` is the EXECUTABLE binding. On the two merge nodes these now DIFFER: `fyt-runner`
 * governs `shots-merge`/`audio-plan-merge` — they sit at their declared position in its gate spine —
 * but `fyt-checker` is the executable `agentId`. That split is not incidental: `fyt-runner` is
 * declared with a MANAGER default execution profile and `compile.ts#resolveAssignment` requires a
 * stage's agent to have a WORKER one (`assigned-default-profile-role-mismatch`), so one agent cannot
 * be both this workflow's manager and one of its stage workers. `fyt-checker` already declares a
 * worker-role default profile, and the merge is a verification act — re-linting a plan it did not
 * author — so assigning it there strengthens author-never-grades rather than bending it. See the
 * ruling in video-run.md's single-writer section.
 */
const STAGES: Array<[string, string, string, string[], 'T2' | 'T3', string, string | null]> = [
  ['idea', 'Generate ranked idea briefs', 'research:idea-briefs', [], 'T2', 'fyt-story', 'fyt-story'],
  ['story', 'Research the picked idea and write the full long-form script', 'draft:long-form-script', ['idea'], 'T2', 'fyt-story', 'fyt-story'],
  ['judge-gate', 'Fresh-context acceptance verdict on the script', 'review:script-verdict', ['story'], 'T2', 'fyt-checker', 'fyt-checker'],
  ['packaging', 'Derive the shorts bench and author the metadata', 'draft:packaging', ['judge-gate'], 'T2', 'fyt-story', 'fyt-story'],
  ['visual-plan', 'Author the full shot list, motion plan, and lint', 'build:visual-plan', ['packaging'], 'T2', 'fyt-visuals', 'fyt-visuals'],
  ['shots-merge', 'Merge the staged shot and motion plans to the video root and re-lint there', 'build:shots-merge', ['visual-plan'], 'T2', 'fyt-runner', 'fyt-checker'],
  ['images', 'Generate the on-style stills for the slice', 'build:images', ['shots-merge'], 'T2', 'fyt-visuals', 'fyt-visuals'],
  ['image-review', 'Review every generated still and build the shot board', 'review:image-board', ['images'], 'T2', 'fyt-checker', 'fyt-checker'],
  ['audio', 'Generate narration and author the audio plan for the slice', 'build:audio', ['image-review'], 'T2', 'fyt-audio-render', 'fyt-audio-render'],
  ['audio-plan-merge', 'Merge the staged audio plan to the video root and re-lint there', 'build:audio-plan-merge', ['audio'], 'T2', 'fyt-runner', 'fyt-checker'],
  ['render', 'Assemble the finished cut for the slice', 'build:render', ['audio-plan-merge'], 'T2', 'fyt-audio-render', 'fyt-audio-render'],
  ['verify', 'Verify the render and run the compliance report', 'verify:render-compliance', ['render'], 'T2', 'fyt-checker', 'fyt-checker'],
  ['publish-private', 'Upload the finished cut as private', 'publish:private-upload', ['verify'], 'T3', 'fyt-publish', 'fyt-publish'],
];
const STAGE_COUNT = STAGES.length;

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
    expect(parsed.value.stages).toHaveLength(STAGE_COUNT);
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
    // Every stage is governed AND executable (an agent id plus the worker profile it binds through) —
    // including the two merge nodes, whose `governedBy` (`fyt-runner`) and `agentId` (`fyt-checker`)
    // now deliberately differ. See the STAGES comment for the ruling.
    expect(parsed.value.stages.map((s) => [s.id, s.governedBy, s.agentId ?? null, s.profileId ?? null]))
      .toEqual(STAGES.map(([id, , , , , owner, agent]) => [
        id, owner, agent, agent === null ? null : 'worker:claude:claude-fable-5',
      ]));
    // No stage is unbound any more: every stage, including both merge nodes, carries an executable
    // `agentId`.
    expect(parsed.value.stages.filter((s) => s.agentId === undefined).map((s) => s.id)).toEqual([]);
    // The merge nodes remain exactly the stages fyt-runner GOVERNS, even though fyt-checker executes them.
    expect(parsed.value.stages.filter((s) => s.governedBy === 'fyt-runner').map((s) => s.id))
      .toEqual(['shots-merge', 'audio-plan-merge']);
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

    // GATE-COVERAGE WALK. `deps` above pins the chain shape; this walks it and asserts, per stage, the
    // FULL set of gates every path to that stage must pass. Inserting the two merge nodes must not have
    // opened a route around anything, and the ordering of the sets is what proves it: g2 still gates
    // everything from `images` down, g3/g3b everything from `audio` down, g4 the upload.
    const byId = new Map(parsed.value.stages.map((s) => [s.id, s]));
    const blockingGates = (stageId: string): string[] => {
      const seen = new Set<string>();
      const gates = new Set<string>();
      const walk = (id: string): void => {
        if (seen.has(id)) return;
        seen.add(id);
        const stage = byId.get(id);
        if (!stage) throw new Error(`unknown stage '${id}'`);
        for (const gate of stage.humanGates ?? []) gates.add(gate.id);
        for (const dep of stage.dependsOn) walk(dep);
      };
      walk(stageId);
      return [...gates].sort();
    };
    expect(Object.fromEntries(parsed.value.stages.map((s) => [s.id, blockingGates(s.id)]))).toEqual({
      idea: [],
      story: ['g0-idea-pick'],
      'judge-gate': ['g0-idea-pick'],
      packaging: ['g0-idea-pick', 'g1-script'],
      'visual-plan': ['g0-idea-pick', 'g1-script'],
      // The merge runs BEFORE g2 by design — that is what makes the merged root file exist by the time
      // a human is asked to read it — so it is gated by g0+g1 and not by g2.
      'shots-merge': ['g0-idea-pick', 'g1-script'],
      images: ['g0-idea-pick', 'g1-script', 'g2-visual-plan'],
      'image-review': ['g0-idea-pick', 'g1-script', 'g2-visual-plan'],
      audio: ['g0-idea-pick', 'g1-script', 'g2-visual-plan', 'g3-image-board', 'g3b-narration-cost'],
      'audio-plan-merge': ['g0-idea-pick', 'g1-script', 'g2-visual-plan', 'g3-image-board', 'g3b-narration-cost'],
      render: ['g0-idea-pick', 'g1-script', 'g2-visual-plan', 'g3-image-board', 'g3b-narration-cost'],
      verify: ['g0-idea-pick', 'g1-script', 'g2-visual-plan', 'g3-image-board', 'g3b-narration-cost'],
      'publish-private': ['g0-idea-pick', 'g1-script', 'g2-visual-plan', 'g3-image-board', 'g3b-narration-cost', 'g4-publish-private'],
    });
  });

  it('makes the staging→root merge a real node between the plan author and its first reader', () => {
    // THE STRUCTURAL GAP THIS CLOSES. The single-writer law says a stage agent stages its plan and
    // fyt-runner copies it to the video root and re-lints before it counts. In the roster model the
    // STAGE AGENT prints the completion marker and is not the writer of the root files, so folding the
    // merge into `visual-plan`/`audio` left those stages held only to their `staging/` artifacts and
    // NOTHING server-side verified the merged root `shots.json` / `shots.motion.json` /
    // `audio-plan.json` — which is what `images`, `image-review` and `render` actually read, and what a
    // human is told to read at g2. As their own nodes, the merges declare the ROOT paths, so
    // `execution.ts` verifies them against the working tree before the run advances.
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const stage = (id: string) => parsed.value.stages.find((s) => s.id === id);
    const video = 'orgs/faceless-youtube/channels/<channel>/videos/<slug>';

    // The reader depends on the MERGE, never on the author directly — otherwise the merge is skippable.
    expect(stage('images')?.dependsOn).toEqual(['shots-merge']);
    expect(stage('render')?.dependsOn).toEqual(['audio-plan-merge']);
    expect(stage('shots-merge')?.dependsOn).toEqual(['visual-plan']);
    expect(stage('audio-plan-merge')?.dependsOn).toEqual(['audio']);

    // Declared artifacts are the ROOT files, not the staged ones. The staged/root split across the two
    // stages is the whole point: neither claim covers for the other.
    expect(stage('shots-merge')?.artifacts?.map((a) => a.path))
      .toEqual([`${video}/shots.json`, `${video}/shots.motion.json`]);
    expect(stage('audio-plan-merge')?.artifacts?.map((a) => a.path)).toEqual([`${video}/audio-plan.json`]);
    expect(stage('visual-plan')?.artifacts?.map((a) => a.path))
      .toEqual([`${video}/staging/shots.json`, `${video}/staging/shots.motion.json`]);
    expect(stage('audio')?.artifacts?.some((a) => a.path === `${video}/staging/audio-plan.json`)).toBe(true);

    // The merge nodes carry no gate: a gate here would be a second G2 asking a human to approve the
    // copy, and it would push the merge to the far side of the gate it exists to make honest.
    expect(stage('shots-merge')?.humanGates).toBeUndefined();
    expect(stage('audio-plan-merge')?.humanGates).toBeUndefined();

    // The work order must name the real lint CLI and the honest three-state verdict. A merge that
    // absorbs a HARD violation and reports DONE is the exact failure this node exists to prevent.
    const shotsOrder = stage('shots-merge')?.workOrder ?? '';
    expect(shotsOrder).toContain('visual-prompt-writer/scripts/lint_shots.py');
    expect(shotsOrder).toContain('motion-planner/scripts/lint_motion_plan.py');
    expect(shotsOrder).toContain('HARD violations: none');
    expect(shotsOrder).toContain('BLOCKED, never DONE');
    // Schema strictness is fail-closed: a missing or misspelled `schema` lints at full v2 strictness and
    // only an explicit v1 declaration earns the legacy heads-up, so "fixing" the key to quiet the lint
    // is a real, available cheat that the work order must forbid by name.
    expect(shotsOrder).toContain('faceless-youtube/shots@1');
    expect(shotsOrder).toMatch(/never (?:add, edit or remove|edit or add) a plan's `schema` key/i);
    const audioOrder = stage('audio-plan-merge')?.workOrder ?? '';
    expect(audioOrder).toContain('render-builder/scripts/lint_audio_plan.py');
    expect(audioOrder).toContain('audio-tokens.json');
    expect(audioOrder).toContain('0 error(s)');
    expect(audioOrder).toContain('BLOCKED, never DONE');
    // Both must say the re-lint happens at the ROOT, since that is the only run of it that resolves
    // this video's script, measured narration timings, and the channel's audio pools.
    for (const order of [shotsOrder, audioOrder]) expect(order).toContain('AT THE ROOT PATH');
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
    expect(compiled.value.stages).toHaveLength(STAGE_COUNT);
    expect(compiled.value.project).toBe('faceless-youtube');
    expect(compiled.value.proposalId).toMatch(/^wf-[a-f0-9]{48}$/);
    expect(compiled.value.governanceRefs).toContain('orgs/faceless-youtube/contract.md');
    // Routing comes from the AUTHORED assignments now, not the compiler's default picks: the runner
    // manages on Fable 5, every stage worker runs Fable 5 through its declared worker profile.
    expect(compiled.value.manager.model).toBe('claude-fable-5');
    expect(compiled.value.manager.assignment?.agentId).toBe('fyt-runner');
    // Every stage routes Fable 5 through its declared worker profile, including the two merge nodes:
    // there is no more compiler-default fallback stage, because `fyt-checker`'s worker binding covers
    // both — a generic sonnet worker is no longer standing in for the single writer of the video root.
    expect(compiled.value.stages.filter((s) => s.assignment).every((s) => s.worker.model === 'claude-fable-5')).toBe(true);
    expect(compiled.value.stages.filter((s) => !s.assignment).map((s) => [s.id, s.worker.model])).toEqual([]);
    expect(compiled.value.stages.map((s) => s.assignment?.agentId ?? null)).toEqual(STAGES.map(([, , , , , , agent]) => agent));
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
      const gatedStages = ['idea', 'story', 'judge-gate', 'packaging', 'visual-plan', 'shots-merge',
        'images', 'image-review', 'audio', 'audio-plan-merge', 'render', 'verify'];
      for (const id of gatedStages) {
        expect(order(id), `${id} work order must not trip the restricted-intent prose scan`)
          .not.toMatch(/\b(?:publish|publication|deploy|purchase|spend|payment|buy|credential|secret|api key|access token)\b/i);
      }
    });

    // ---------------------------------------------------------------------
    // Declared artifacts. `compile.ts` hardcoded `artifacts: []` and `WorkflowStageDef` had no
    // `artifacts` key, so the server-side declared-artifact verification in execution.ts
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
        // and fyt-runner alone merges them to the video root. The AUTHORING stage is therefore held to
        // the STAGED path, and the merge node that follows it is held to the ROOT path — the merged file
        // everything downstream reads. Both claims are declared; neither substitutes for the other.
        'visual-plan': [`${video}/staging/shots.json`, `${video}/staging/shots.motion.json`],
        'shots-merge': [`${video}/shots.json`, `${video}/shots.motion.json`],
        images: [`${video}/assets/scenes/manifest.json`],
        'image-review': [`${video}/assets/_review/merged.json`, `${video}/assets/board.html`],
        audio: [`${video}/assets/voiceover.manifest.json`, `${video}/staging/audio-plan.json`],
        'audio-plan-merge': [`${video}/audio-plan.json`],
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
      expect(all).toHaveLength(20);
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
      expect(compiled.value.stages.flatMap((s) => s.artifacts)).toHaveLength(20);
      expect(compiled.value.stages.find((s) => s.id === 'story')?.artifacts[1].path)
        .toBe('orgs/faceless-youtube/channels/unresolved-parameter-channel/videos/unresolved-parameter-slug/script.md');
    });
  });
});
