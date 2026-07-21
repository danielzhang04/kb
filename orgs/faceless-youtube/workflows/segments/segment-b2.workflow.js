export const meta = {
  name: "fyt-segment-b2",
  description:
    "Committed workflow segment B2 of the faceless-YouTube pipeline: audio-plan -> render (with --motion-plan) -> verify -> thumbnail finalize -> compliance check. The deterministic spine that runs up to GATE 3 (the human publish-approval gate). No paid external APIs in this segment — render is local Remotion compute. A failed gate stops the segment and returns what completed so the runner can resume the same run with completed stages still cached.",
  phases: [
    { title: "Author the unified audio plan", detail: "audio-director converges script + shots + voiceover into the staged audio plan. Planning only." },
    { title: "Assemble the finished cut (heavyweight)", detail: "render-builder assembles the MP4(s) via local Remotion from stills + VO + audio plan + --motion-plan. No API spend." },
    { title: "Verify the render against the manifests", detail: "render-builder verification pass confirms the MP4(s) match the shot/audio manifests and clear the no-slop bar." },
    { title: "Finalize the thumbnail", detail: "finalize_thumbnail.py commits the reviewed thumbnail after the thumb review." },
    { title: "Compliance check", detail: "compliance_check.py runs the pre-publish compliance gate." },
  ],
};

// DAG of record: orgs/faceless-youtube/workflows/video-run.md (the video-run def is the
// source of truth for stage identity, order, and dependencies). This segment mirrors the
// convergence tail: audio-plan (script + shots + voiceover) -> render -> verify, then appends
// the thumbnail-finalize and compliance conductor-side tail CLIs that guard GATE 3.
// Runtime contract: the tool wraps this body in an async function that supplies the globals
// agent(), parallel(), args, and log(); a top-level return is the segment result.
// Forbidden here (resume-safety / sandbox): Date.now(), Math.random(), argless new Date(),
// TS annotations, and any fs/path/process access — all file work happens inside the agents.

const gateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["stage", "ok", "artifact", "notes"],
  properties: {
    stage: { type: "string" },
    ok: { type: "boolean" },
    artifact: { type: "string" },
    notes: { type: "string" },
  },
};

const gates = {};
const artifacts = [];

function record(result) {
  gates[result.stage] = result;
  if (result && result.artifact) artifacts.push(result.artifact);
  return !!(result && result.ok === true);
}

function done() {
  return { segment: "b2", gates, artifacts };
}

async function stage(stageId, title, skillPath, extra) {
  log(`[segment-b2] ${stageId} :: ${title}`);
  const prompt =
    `Follow ${skillPath} for videoDir ${args.videoDir} ` +
    `(channel ${args.channel}, slug ${args.slug}). ` +
    `Write staged output per the single-writer staging rule in ` +
    `orgs/faceless-youtube/workflows/video-run.md: stage your output under ` +
    `${args.videoDir}/staging/ and let the conductor merge + re-lint the single-writer files ` +
    `(audio-plan.json is single-writer). ` +
    (extra ? extra + " " : "") +
    `Your final text MUST be ONLY the JSON gate result {stage, ok, artifact, notes}: ` +
    `stage="${stageId}"; ok=true ONLY if the stage genuinely succeeded; ` +
    `artifact=the repo-relative path you wrote (or ""); notes=a one-line status.`;
  return await agent(prompt, { label: stageId, phase: title, schema: gateSchema });
}

const audio = await stage(
  "audio-plan",
  "Author the unified audio plan",
  "orgs/faceless-youtube/.claude/skills/audio-director/SKILL.md",
  "Read script.md AND shots.json AND the voiceover manifest — placement is a judgment grounded in all three. Author the unified audio plan (SFX, pauses, music beds, dry spans). Planning only."
);
if (!record(audio)) return done();

const render = await stage(
  "render",
  "Assemble the finished cut (heavyweight)",
  "orgs/faceless-youtube/.claude/skills/render-builder/SKILL.md",
  "Assemble the finished MP4(s) via the local Remotion engine from shots.json + the verified stills " +
    "+ the voiceover audio + the audio plan, passing --motion-plan pointed at " + args.videoDir +
    "/shots.motion.json. Local render, no API spend. Produces local files only; does NOT upload or publish."
);
if (!record(render)) return done();

const verify = await stage(
  "verify",
  "Verify the render against the manifests",
  "orgs/faceless-youtube/.claude/skills/render-builder/SKILL.md",
  "Run render-builder's verification pass: confirm the MP4(s) exist, match the shot/audio manifests, " +
    "and clear the no-slop bar. Write a pass/fail note to render-verify.md; ok=true ONLY on a clean pass."
);
if (!record(verify)) return done();

const thumb = await stage(
  "thumbnail",
  "Finalize the thumbnail",
  "orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md",
  "After the thumbnail review passes, commit the reviewed thumbnail by running " +
    "orgs/faceless-youtube/.claude/skills/image-generation/scripts/finalize_thumbnail.py for this video. " +
    "ok=true ONLY if a reviewed thumbnail was finalized."
);
if (!record(thumb)) return done();

const compliance = await stage(
  "compliance",
  "Compliance check",
  "orgs/faceless-youtube/.claude/skills/compliance-check/SKILL.md",
  "Run the pre-publish compliance gate via " +
    "orgs/faceless-youtube/.claude/skills/compliance-check/scripts/compliance_check.py for this video. " +
    "This guards GATE 3 (the human publish-approval gate); ok=true ONLY if compliance passes clean."
);
record(compliance);
return done();
