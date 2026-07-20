/**
 * D15 — compile-proof for the faceless-youtube `video-run` workflow definition.
 *
 * The definition's live home is another branch (the faceless-youtube org), so it is NOT authored into
 * `orgs/` here. Instead the EXACT text that will land there is embedded below as a fixture and driven
 * through the SAME registry validation + compiler the real registry route uses. This proves the def
 * compiles clean — valid shape, expected DAG, preserved risk floors, resolvable profile — before it is
 * placed in the org.
 *
 * If this fixture and the org file ever drift, that is the bug this test exists to catch: keep them
 * byte-identical.
 */
import { describe, expect, it } from 'vitest';
import { parseWorkflowDef } from './defs.ts';
import { compileWorkflowDef } from './compile.ts';
import { validatePlanProposal } from '../control/proposal.ts';
import type { RuntimeSkillRegistry } from '../control/environment.ts';

const REGISTRY: RuntimeSkillRegistry = {
  runtimes: {
    claude: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    codex: ['gpt-5.6-sol'],
  },
  skills: [],
};

// The server-owned execution profiles the registry route knows about (design D13). `producer` is the
// faceless pipeline profile: Bash + Read/Write/Edit + the local image/TTS/render scripts, and NEVER any
// publish/upload tool.
const KNOWN_PROFILES = new Set(['research', 'gmail-triage', 'drive-author', 'producer']);

// ---------------------------------------------------------------------------
// The EXACT definition content that will be placed at orgs/faceless-youtube/workflows/video-run.md.
// Keep this byte-identical with the org file. The text is deliberately free of backticks, backslashes,
// and ${...} so this template literal needs NO escaping — what you read here is exactly what the org
// file contains, with no unescaping step that could let the two drift.
// ---------------------------------------------------------------------------
const VIDEO_RUN_DEF = `---
id: video-run
project: faceless-youtube
title: Produce one video (faceless pipeline)
profile: producer
stages:
  - id: idea
    title: Pick and brief one video idea
    action: research:idea
    target: orgs/faceless-youtube/videos
    riskTier: T2
    workOrder: "Invoke the idea-generator skill for this channel. Read dna.md + performance.md + idea-backlog.md, then write a ranked idea brief for one video into videos/<slug>/brief.md and pick the single idea to produce. No external calls, no spend."
  - id: research
    title: Research the picked idea into a sourced dossier
    action: research:dossier
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [idea]
    workOrder: "Invoke the researcher skill on the picked idea brief. Produce a sourced, verified dossier at videos/<slug>/research.md that the scriptwriter writes from. WebSearch/WebFetch only; cite every claim; take no external action."
  - id: script
    title: Write the long-form voiceover script
    action: draft:long-form-script
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [research]
    workOrder: "Invoke the long-form-writer skill. Turn videos/<slug>/brief.md + videos/<slug>/research.md into the long-form voiceover script at videos/<slug>/script.md, following the channel storytelling grammar. Draft only."
  - id: judge-gate
    title: Fresh-eyes acceptance gate on the script
    action: review:script-gate
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [script]
    workOrder: "Invoke the proxy-judge skill as a fresh-context acceptance gate on videos/<slug>/script.md. Emit an accept/revise/reject verdict to videos/<slug>/judge.md. This gate stands where the human stands; a reject halts the run for a human decision before any heavyweight production."
  - id: shorts
    title: Derive the short-form bench
    action: draft:shorts
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [judge-gate]
    workOrder: "Invoke the shorts-writer skill. Derive the self-contained vertical shorts bench from the accepted long-form at videos/<slug>/script.md into videos/<slug>/shorts.md. Draft only."
  - id: metadata
    title: Author publishing metadata (no upload)
    action: draft:metadata
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [judge-gate]
    workOrder: "Invoke the metadata-writer skill. Write the YouTube publishing metadata (titles, description, tags, chapters, thumbnail concepts) for the long-form and each scripted short into videos/<slug>/metadata.json. This authors metadata only; it does NOT publish or upload."
  - id: shots
    title: Build the visual shot list and prompts
    action: build:shot-list
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [judge-gate]
    workOrder: "Invoke the visual-prompt-writer skill. Build the B-roll shot list + thumbnail generation prompts into videos/<slug>/shots.json from the accepted script. No pixel generation here."
  - id: motion
    title: Plan the per-shot motion layers
    action: build:motion-plan
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [shots]
    workOrder: "Invoke the motion-planner skill. Read videos/<slug>/shots.json and emit the derived per-shot layer/motion plan at videos/<slug>/shots.motion.json. Planning only; no rendering."
  - id: images
    title: Generate the on-style stills
    action: build:images
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [shots]
    workOrder: "Invoke the image-generation skill against the locked style bible. Materialize every plate/cutout still for videos/<slug>/shots.json into the video asset library. Heavyweight local generation only; no spend beyond the configured local image stack."
  - id: voiceover
    title: Generate the narration audio
    action: build:voiceover
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [judge-gate]
    workOrder: "Invoke the voiceover skill. Turn videos/<slug>/script.md (and each publish-tagged short) into narration audio plus a manifest under videos/<slug>/ that render-builder syncs visuals to. Heavyweight TTS; no publish."
  - id: audio-plan
    title: Author the unified audio plan
    action: build:audio-plan
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [voiceover]
    workOrder: "Invoke the audio-director skill. Author the unified audio plan (SFX, pauses, music beds, dry spans) at videos/<slug>/audio-plan.json from the script + shots.json + voiceover. Planning only."
  - id: render
    title: Assemble the finished cut (heavyweight)
    action: build:render
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [metadata, shorts, motion, images, audio-plan]
    workOrder: "Invoke the render-builder skill. Assemble the finished MP4(s) for the long-form and each publish-tagged short via the local Remotion engine from shots.json + the verified stills + the voiceover audio + the audio plan into videos/<slug>/. Heavyweight render; first runs stay orchestrator-driven. Produces local files only; it does NOT upload or publish."
  - id: verify
    title: Verify the render against the manifests
    action: verify:render
    target: orgs/faceless-youtube/videos
    riskTier: T2
    dependsOn: [render]
    workOrder: "Invoke render-builder's verification pass on the rendered output under videos/<slug>/: confirm the MP4(s) exist, match the shot/audio manifests, and clear the no-slop bar. Write a pass/fail note to videos/<slug>/render-verify.md. No publish; a human reviews before any upload, which is out of this workflow."
---

# video-run — produce one faceless-YouTube video

Runs this project's pipeline to produce ONE video from a picked idea through a verified render. The video
slug is supplied at launch time (like the research-brief template's topic); wherever a work order says
videos/<slug>/, substitute the launch-supplied slug.

The DAG mirrors the pipeline skills: idea -> research -> script -> judge-gate, then the accepted script
fans out into the short-form bench, the publishing metadata, and the visual shot list; shots feed the
motion plan and the still generation; the script feeds the voiceover and then the audio plan; and
everything converges on render + verify.

## Boundaries

- **Publishing / upload is NOT a stage.** This workflow ends at a verified local render. Uploading to
  YouTube is a separate, human-gated T3 step that does not exist in this definition, and the producer
  profile carries no upload tool.
- **Render + image + voiceover stages are heavyweight.** First runs stay orchestrator-driven; the
  definition exists so the dashboard can launch later runs once the pipeline is warm.
- **The judge-gate is a real gate.** A reject halts the run for a human decision before any heavyweight
  production spends time or local resources.
- Handle no credentials as objects; spend no real money; take no external action beyond the researcher's
  read-only web access.
`;

describe('video-run workflow definition (compile-proof)', () => {
  it('parses to a valid definition against the known execution profiles', () => {
    const parsed = parseWorkflowDef(VIDEO_RUN_DEF, { knownProfiles: KNOWN_PROFILES });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe('video-run');
    expect(parsed.value.project).toBe('faceless-youtube');
    expect(parsed.value.profile).toBe('producer');
    expect(parsed.value.stages).toHaveLength(13);
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
    // shots -> motion + images ; voiceover -> audio-plan
    expect(deps.motion).toEqual(['shots']);
    expect(deps.images).toEqual(['shots']);
    expect(deps['audio-plan']).toEqual(['voiceover']);
    // render converges the production artifacts; verify follows render
    expect(deps.render).toEqual(['audio-plan', 'images', 'metadata', 'motion', 'shorts']);
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
    const lowered = VIDEO_RUN_DEF.replace(
      'title: Assemble the finished cut (heavyweight)\n    action: build:render\n    target: orgs/faceless-youtube/videos\n    riskTier: T2',
      'title: Assemble the finished cut (heavyweight)\n    action: build:render\n    target: orgs/faceless-youtube/videos\n    riskTier: T1',
    );
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
    expect(compiled.value.stages).toHaveLength(13);
    expect(compiled.value.project).toBe('faceless-youtube');
    expect(compiled.value.proposalId).toMatch(/^wf-[a-f0-9]{48}$/);
    expect(compiled.value.governanceRefs).toContain('orgs/faceless-youtube/contract.md');
    // manager routes to opus, workers to sonnet, from the registry
    expect(compiled.value.manager.model).toBe('claude-opus-4-8');
    expect(compiled.value.stages.every((s) => s.worker.model === 'claude-sonnet-5')).toBe(true);
    const validated = validatePlanProposal(compiled.value as unknown, REGISTRY);
    expect(validated.ok).toBe(true);
  });
});
