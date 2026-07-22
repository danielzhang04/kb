/**
 * Static FYT segment contracts.  The runner wraps each source body in an async function, so this
 * suite parses that same body shape but never evaluates it: no agents, paid APIs, workers, publishing,
 * or video assets are touched here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWorkflowDef } from './defs.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FYT = (...parts: string[]) => join(REPO_ROOT, 'orgs', 'faceless-youtube', ...parts);
const SEGMENTS = ['segment-a.workflow.js', 'segment-b1.workflow.js', 'segment-b2.workflow.js', 'segment-c.workflow.js'] as const;
const META_NAMES = {
  'segment-a.workflow.js': 'fyt-segment-a',
  'segment-b1.workflow.js': 'fyt-segment-b1',
  'segment-b2.workflow.js': 'fyt-segment-b2',
  'segment-c.workflow.js': 'fyt-segment-c',
} as const;
const AsyncFunction = Object.getPrototypeOf(async function () { /** runtime wrapper shape */ }).constructor as new (source: string) => Function;

function source(path: string): string {
  return readFileSync(FYT('workflows', 'segments', path), 'utf8').replace(/\r\n?/g, '\n');
}

/** Remove only the exported metadata; the remainder is the async body consumed by the runner. */
function runnerBody(input: string): string {
  const body = input.replace(/^export const meta = \{[\s\S]*?\n\};\n/, '');
  expect(body).not.toBe(input);
  return body;
}

function executableBody(input: string): string {
  // Segment comments deliberately name their forbidden forms.  Strip line comments before looking
  // for executable syntax; no source string in these runner bodies contains `//`.
  return runnerBody(input).replace(/\/\/[^\n]*/g, '');
}

function indexOfOrFail(input: string, needle: string): number {
  const index = input.indexOf(needle);
  expect(index, `missing static contract fragment: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
}

function parsedVideoRun() {
  const workflow = readFileSync(FYT('workflows', 'video-run.md'), 'utf8').replace(/\r\n?/g, '\n');
  const parsed = parseWorkflowDef(workflow, { knownProfiles: new Set(['producer']) });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.detail);
  return { workflow, definition: parsed.value };
}

function stage(definition: ReturnType<typeof parsedVideoRun>['definition'], id: string) {
  const found = definition.stages.find((candidate) => candidate.id === id);
  expect(found, `missing video-run stage: ${id}`).toBeDefined();
  if (!found) throw new Error(`missing video-run stage: ${id}`);
  return found;
}

describe('checked-out FYT segment static contracts', () => {
  it('syntax-compiles all four runner bodies without evaluating them', () => {
    for (const segment of SEGMENTS) {
      const checkedOut = source(segment);
      expect(() => new AsyncFunction(runnerBody(checkedOut))).not.toThrow();
    }
  });

  it('pins each segment metadata, strict gate envelope, fail-stop result, and sandbox contract', () => {
    for (const segment of SEGMENTS) {
      const checkedOut = source(segment);
      const body = runnerBody(checkedOut);
      const executable = executableBody(checkedOut);
      const segmentId = META_NAMES[segment].replace('fyt-segment-', '');
      expect(checkedOut).toContain(`name: "${META_NAMES[segment]}"`);
      expect(body).toContain('additionalProperties: false');
      expect(body).toContain('required: ["stage", "ok", "artifact", "notes"]');
      expect(body).toContain('stage: { type: "string" }');
      expect(body).toContain('ok: { type: "boolean" }');
      expect(body).toContain('artifact: { type: "string" }');
      expect(body).toContain('notes: { type: "string" }');
      expect(body).toContain('source of truth');
      expect(body).toContain('function record(result)');
      expect(body).toContain('return !!(result && result.ok === true);');
      expect(body).toContain(`return { segment: "${segmentId}", gates, artifacts };`);

      // These target executable syntactic forms rather than the documented forbidden-token comment.
      expect(executable).not.toMatch(/\bDate\.now\s*\(/);
      expect(executable).not.toMatch(/\bMath\.random\s*\(/);
      expect(executable).not.toMatch(/\bnew\s+Date\s*\(\s*\)/);
      expect(executable).not.toMatch(/\b(?:fs|path|process)\s*\./);
      expect(executable).not.toMatch(/\b(?:require\s*\(|import\s+).*?['"](?:node:)?(?:fs|path)['"]/);
      expect(executable).not.toMatch(/\b(?:interface|type)\s+[A-Za-z_$]/);
    }
  });

  it('parses the exact video-run DAG, paid stages, and no-publish boundary', () => {
    const { workflow, definition } = parsedVideoRun();
    expect(definition.parameters).toEqual(['channel', 'slug']);
    expect(definition.stages).toHaveLength(14);
    expect(definition.stages.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      action: candidate.action,
      dependsOn: candidate.dependsOn,
      riskTier: candidate.riskTier,
    }))).toEqual([
      { id: 'idea', title: 'Pick and brief one video idea', action: 'research:idea', dependsOn: [], riskTier: 'T2' },
      { id: 'research', title: 'Research the picked idea into a sourced dossier', action: 'research:dossier', dependsOn: ['idea'], riskTier: 'T2' },
      { id: 'script', title: 'Write the long-form voiceover script', action: 'draft:long-form-script', dependsOn: ['research'], riskTier: 'T2' },
      { id: 'judge-gate', title: 'Fresh-eyes acceptance gate on the script', action: 'review:script-gate', dependsOn: ['script'], riskTier: 'T2' },
      { id: 'shorts', title: 'Derive the short-form bench', action: 'draft:shorts', dependsOn: ['judge-gate'], riskTier: 'T2' },
      { id: 'metadata', title: 'Author publishing metadata (no upload)', action: 'draft:metadata', dependsOn: ['judge-gate'], riskTier: 'T2' },
      { id: 'shots', title: 'Build the visual shot list and prompts', action: 'build:shot-list', dependsOn: ['judge-gate'], riskTier: 'T2' },
      { id: 'motion', title: 'Plan the per-shot motion layers', action: 'build:motion-plan', dependsOn: ['shots'], riskTier: 'T2' },
      { id: 'images', title: 'Generate the on-style stills (SPENDS REAL MONEY)', action: 'build:images', dependsOn: ['shots'], riskTier: 'T2' },
      { id: 'image-review', title: 'Batched review of every generated still (the image gate)', action: 'review:image-gate', dependsOn: ['images', 'motion'], riskTier: 'T2' },
      { id: 'voiceover', title: 'Generate the narration audio (paid TTS)', action: 'build:voiceover', dependsOn: ['judge-gate'], riskTier: 'T2' },
      { id: 'audio-plan', title: 'Author the unified audio plan', action: 'build:audio-plan', dependsOn: ['script', 'shots', 'voiceover'], riskTier: 'T2' },
      { id: 'render', title: 'Assemble the finished cut (heavyweight)', action: 'build:render', dependsOn: ['metadata', 'shorts', 'motion', 'image-review', 'audio-plan'], riskTier: 'T2' },
      { id: 'verify', title: 'Verify the render against the manifests', action: 'verify:render', dependsOn: ['render'], riskTier: 'T2' },
    ]);
    const imageReview = stage(definition, 'image-review');
    const render = stage(definition, 'render');
    const audioPlan = stage(definition, 'audio-plan');
    const verify = stage(definition, 'verify');
    const images = stage(definition, 'images');
    const voiceover = stage(definition, 'voiceover');
    expect(imageReview.action).toBe('review:image-gate');
    expect(imageReview.dependsOn).toEqual(['images', 'motion']);
    expect(render.dependsOn).toContain('image-review');
    expect(render.dependsOn).not.toContain('images');
    expect(audioPlan.dependsOn).toEqual(['script', 'shots', 'voiceover']);
    expect(verify.dependsOn).toEqual(['render']);
    expect(images.workOrder).toContain('SPENDS REAL MONEY');
    expect(images.workOrder).toContain('paid Gemini image API');
    expect(images.workOrder).toContain('explicit per-run human authorization recorded on a queue card');
    expect(images.workOrder).toContain("run's call ceiling");
    expect(images.workOrder).toContain('log actual spend');
    expect(voiceover.workOrder).toContain('paid ElevenLabs TTS API');
    expect(voiceover.workOrder).toContain('same per-run authorization as the images stage');
    // Metadata says it does not upload; no stage identity or action can publish/upload. The single
    // title mention is the explicit non-upload disclosure, not a hidden publish stage.
    expect(definition.stages.filter((candidate) => /(?:publish|upload)/i.test(candidate.id)
      || /(?:publish|upload)/i.test(candidate.action))).toEqual([]);
    expect(definition.stages.filter((candidate) => /(?:publish|upload)/i.test(candidate.title)).map((candidate) => ({
      id: candidate.id, title: candidate.title,
    }))).toEqual([{ id: 'metadata', title: 'Author publishing metadata (no upload)' }]);
    expect(workflow).toContain('Publishing / upload is NOT a stage.');
    expect(workflow).toContain('separate, human-gated T3 step');
  });

  it('pins the complete independent full-surface image-review contract', () => {
    const { definition } = parsedVideoRun();
    const order = stage(definition, 'image-review').workOrder;
    expect(order).toContain('Open EVERY scene PNG');
    expect(order).toContain("every layered shot's plate + cutouts");
    expect(order).toContain("motion plan's cutout_layer_ids");
    expect(order).toContain('three concurrent review mandates (identity/rig, fidelity, style)');
    expect(order).toContain('LETTER-BY-LETTER');
    expect(order).toContain('forced PASS/FAIL');
    expect(order).toContain('seeded or foreground figure');
    expect(order).toContain('merged.json');
    expect(order).toContain('stamp_review.py');
    expect(order).toContain('verified, or parked');
    expect(order).toContain('conductor/orchestrator, NEVER by the generating agent');
  });

  it('keeps segment A ordered and fail-stopped through the terminal judge gate', () => {
    const a = source('segment-a.workflow.js');
    const idea = indexOfOrFail(a, 'const idea = await stage(');
    const ideaStop = indexOfOrFail(a, 'if (!record(idea)) return done();');
    const research = indexOfOrFail(a, 'const research = await stage(');
    const researchStop = indexOfOrFail(a, 'if (!record(research)) return done();');
    const script = indexOfOrFail(a, 'const script = await stage(');
    const scriptStop = indexOfOrFail(a, 'if (!record(script)) return done();');
    const judge = indexOfOrFail(a, 'const judge = await stage(');
    const terminalRecord = indexOfOrFail(a, 'record(judge);\nreturn done();');
    expect([idea, ideaStop, research, researchStop, script, scriptStop, judge, terminalRecord]).toEqual([...new Set([idea, ideaStop, research, researchStop, script, scriptStop, judge, terminalRecord])].sort((x, y) => x - y));
    expect(a).toContain('"judge-gate"');
  });

  it('keeps B1 refusal gates for both paid stages before any paid agent calls', () => {
    const b1 = source('segment-b1.workflow.js');
    const guard = indexOfOrFail(b1, 'if (args.spendAuthorized !== true)');
    const imagesRefusal = indexOfOrFail(b1, 'record(refusal("images"));');
    const voiceoverRefusal = indexOfOrFail(b1, 'record(refusal("voiceover"));');
    const stop = indexOfOrFail(b1, 'log("[segment-b1] paid stages refused');
    const paidCalls = indexOfOrFail(b1, 'const paid = await parallel([');
    const guardReturn = b1.lastIndexOf('return done();', paidCalls);
    const imagesCall = indexOfOrFail(b1, 'label: "images"');
    const voiceoverCall = indexOfOrFail(b1, 'label: "voiceover"');
    expect(guard).toBeLessThan(imagesRefusal);
    expect(imagesRefusal).toBeLessThan(voiceoverRefusal);
    expect(voiceoverRefusal).toBeLessThan(stop);
    expect(guardReturn).toBeGreaterThan(stop);
    expect(guardReturn).toBeLessThan(paidCalls);
    expect(paidCalls).toBeLessThan(imagesCall);
    expect(paidCalls).toBeLessThan(voiceoverCall);
    expect(b1).toContain('ok: false');
    expect(b1).toContain('return done();');
  });

  it('keeps B1 full-surface conductor review after the paid result fail-stop', () => {
    const b1 = source('segment-b1.workflow.js');
    const paidStop = indexOfOrFail(b1, 'if (!recordAll(["images", "voiceover"], paid)) return done();');
    const review = indexOfOrFail(b1, 'const review = await stage(');
    const reviewStop = indexOfOrFail(b1, 'if (!record(review)) return done();');
    expect(paidStop).toBeLessThan(review);
    expect(review).toBeLessThan(reviewStop);
    expect(b1).toContain('CONDUCTOR-SIDE reviewer, NEVER the generating agent');
    expect(b1).toContain('Open EVERY scene PNG');
    expect(b1).toContain("every layered shot's ");
    expect(b1).toContain('plate + cutouts');
    expect(b1).toContain("cutout_layer_ids");
    expect(b1).toContain('three concurrent review mandates');
    expect(b1).toContain('LETTER-BY-LETTER');
    expect(b1).toContain('force a PASS/FAIL');
    expect(b1).toContain('merged.json');
    expect(b1).toContain('stamp_review.py');
    expect(b1).toContain('honestly-stamped manifest');
  });

  it('keeps B2 motion-plan render before verification, thumbnail, and compliance', () => {
    const b2 = source('segment-b2.workflow.js');
    const render = indexOfOrFail(b2, 'const render = await stage(');
    const motionPlan = indexOfOrFail(b2, 'passing --motion-plan pointed at');
    const renderStop = indexOfOrFail(b2, 'if (!record(render)) return done();');
    const verify = indexOfOrFail(b2, 'const verify = await stage(');
    const verifyStop = indexOfOrFail(b2, 'if (!record(verify)) return done();');
    const thumb = indexOfOrFail(b2, 'const thumb = await stage(');
    const thumbStop = indexOfOrFail(b2, 'if (!record(thumb)) return done();');
    const compliance = indexOfOrFail(b2, 'const compliance = await stage(');
    expect(render).toBeLessThan(motionPlan);
    expect(motionPlan).toBeLessThan(renderStop);
    expect(renderStop).toBeLessThan(verify);
    expect(verify).toBeLessThan(verifyStop);
    expect(verifyStop).toBeLessThan(thumb);
    expect(thumb).toBeLessThan(thumbStop);
    expect(thumbStop).toBeLessThan(compliance);
  });

  it('keeps C blank approval refusal before the first possible agent call', () => {
    const c = source('segment-c.workflow.js');
    const guard = indexOfOrFail(c, 'if (typeof args.approvedBy !== "string" || args.approvedBy.trim() === "")');
    const throws = indexOfOrFail(c, 'throw new Error(');
    const stageFunction = indexOfOrFail(c, 'async function stage(');
    const agentCall = indexOfOrFail(c, 'return await agent(');
    const preflight = indexOfOrFail(c, 'const preflight = await stage(');
    expect(guard).toBeLessThan(throws);
    expect(throws).toBeLessThan(stageFunction);
    expect(stageFunction).toBeLessThan(agentCall);
    expect(agentCall).toBeLessThan(preflight);
  });
});
