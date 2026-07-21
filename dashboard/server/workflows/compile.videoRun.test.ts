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
import { parseWorkflowDef } from './defs.ts';
import { compileWorkflowDef } from './compile.ts';
import { loadOrgDef } from './orgDefSource.ts';
import { validatePlanProposal } from '../control/proposal.ts';
import type { RuntimeSkillRegistry } from '../control/environment.ts';

const REGISTRY: RuntimeSkillRegistry = {
  runtimes: {
    claude: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
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
    expect(parsed.value.stages).toHaveLength(14);
  });

  it('pins every stage id and title the dashboard launches from', () => {
    // The dashboard renders these strings in the launch UI, so they are contract, not cosmetics.
    // Pinning them means ANY edit to a stage's identity must be made deliberately, here and in the
    // definition together — it cannot slip through as an incidental change.
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.stages.map((s) => [s.id, s.title])).toEqual([
      ['idea', 'Pick and brief one video idea'],
      ['research', 'Research the picked idea into a sourced dossier'],
      ['script', 'Write the long-form voiceover script'],
      ['judge-gate', 'Fresh-eyes acceptance gate on the script'],
      ['shorts', 'Derive the short-form bench'],
      ['metadata', 'Author publishing metadata (no upload)'],
      ['shots', 'Build the visual shot list and prompts'],
      ['motion', 'Plan the per-shot motion layers'],
      ['images', 'Generate the on-style stills (SPENDS REAL MONEY)'],
      ['image-review', 'Batched review of every generated still (the image gate)'],
      ['voiceover', 'Generate the narration audio (paid TTS)'],
      ['audio-plan', 'Author the unified audio plan'],
      ['render', 'Assemble the finished cut (heavyweight)'],
      ['verify', 'Verify the render against the manifests'],
    ]);
  });

  it('rejects the definition when `producer` is not a server-owned profile', () => {
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: new Set(['research']) });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain("profile 'producer'");
  });

  it('has the expected dependency graph shape (fan-out at judge-gate, convergence at render)', () => {
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const deps = Object.fromEntries(parsed.value.stages.map((s) => [s.id, [...s.dependsOn].sort()]));
    expect(deps.idea).toEqual([]);
    expect(deps.research).toEqual(['idea']);
    expect(deps.script).toEqual(['research']);
    expect(deps['judge-gate']).toEqual(['script']);
    // judge-gate fans out to the short bench, the metadata, the shot list, and the voiceover
    expect(deps.shorts).toEqual(['judge-gate']);
    expect(deps.metadata).toEqual(['judge-gate']);
    expect(deps.shots).toEqual(['judge-gate']);
    expect(deps.voiceover).toEqual(['judge-gate']);
    // shots -> motion + images
    expect(deps.motion).toEqual(['shots']);
    expect(deps.images).toEqual(['shots']);
    // image-review is the batched gate on every generated still, gated on both the stills and the
    // motion plan (it enumerates the reviewable surface from the motion plan's cutout_layer_ids)
    expect(deps['image-review']).toEqual(['images', 'motion']);
    // audio-plan converges script + shots + voiceover: the audio-director skill reads script.md and
    // shots.json as well as the voiceover, so depending on voiceover alone under-declared its inputs.
    expect(deps['audio-plan']).toEqual(['script', 'shots', 'voiceover']);
    // render converges the production artifacts (now gated behind the image-review stamp instead of
    // the raw images stage); verify follows render
    expect(deps.render).toEqual(['audio-plan', 'image-review', 'metadata', 'motion', 'shorts']);
    expect(deps.verify).toEqual(['render']);
  });

  it('classifies every stage to a T2 floor and never lowers it (all actions in registry namespaces)', () => {
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const stage of parsed.value.stages) {
      expect(stage.classifiedFloor).toBe('T2');
      expect(stage.riskTier).toBe('T2');
    }
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
    const compiled = compileWorkflowDef(parsed.value, { registry: REGISTRY });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.stages).toHaveLength(14);
    expect(compiled.value.project).toBe('faceless-youtube');
    expect(compiled.value.proposalId).toMatch(/^wf-[a-f0-9]{48}$/);
    expect(compiled.value.governanceRefs).toContain('orgs/faceless-youtube/contract.md');
    // manager routes to opus, workers to sonnet, from the registry
    expect(compiled.value.manager.model).toBe('claude-opus-4-8');
    expect(compiled.value.stages.every((s) => s.worker.model === 'claude-sonnet-5')).toBe(true);
    // The real definition's `producer` profile must land on the PROPOSAL, not merely in the parsed
    // def. Without `compile.ts`'s `profile: def.profile`, this workflow's workers spawn with no
    // --allowedTools at all, and every assertion above still passes.
    expect(compiled.value.profile).toBe('producer');
    const validated = validatePlanProposal(compiled.value as unknown, REGISTRY);
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

    it('declares the images stage as paid, API-backed, and human-authorized per run', () => {
      const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const images = parsed.value.stages.find((s) => s.id === 'images');
      expect(images).toBeDefined();
      const order = images?.workOrder ?? '';
      expect(order).toContain('SPENDS REAL MONEY');
      expect(order).toMatch(/Gemini image API/i);
      expect(order).toMatch(/per-run human authorization recorded on a queue card/i);
    });

    it('documents spend and the queue-card authorization in the prose body', () => {
      expect(VIDEO_RUN_DEF).toMatch(/## Spend/);
      expect(VIDEO_RUN_DEF).toMatch(/ElevenLabs/);
      expect(VIDEO_RUN_DEF).toMatch(/authorization recorded on a queue card/i);
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
      // The run wrote shorts/short-01.md ... short-05.md, not a single shorts.md.
      expect(order('shorts')).toContain('shorts/short-01.md');
      expect(order('shorts')).not.toContain('shorts.md');
    });
  });
});
