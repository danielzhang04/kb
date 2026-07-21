export const meta = {
  name: "fyt-segment-c",
  description:
    "Committed workflow segment C of the faceless-YouTube pipeline: publish preflight -> MCP YouTube upload -> write publish record. This is the in-session T3 publish leg and runs ONLY after GATE 3 — its first line THROWS unless args.approvedBy is a non-empty string (the human publish approval on record). A failed stage stops the segment and returns what completed.",
  phases: [
    { title: "Publish preflight", detail: "publish_preflight.py validates the render, metadata, thumbnail and compliance are publish-ready." },
    { title: "Upload to YouTube", detail: "The MCP YouTube upload per publish-queue/SKILL.md — the in-session T3 action." },
    { title: "Write the publish record", detail: "write_publish_record.py records the upload result and the approving human." },
  ],
};

// DAG of record: orgs/faceless-youtube/workflows/video-run.md is the source of truth for the
// production DAG. NOTE: publishing/upload is deliberately NOT a stage in video-run.md — that
// workflow ends at a verified local render, and publish is a separate human-gated T3 leg. This
// segment IS that leg: it exists only downstream of GATE 3 and mirrors the publish-queue skill,
// not a video-run stage. preflight -> MCP upload -> publish record.
// Runtime contract: the tool wraps this body in an async function that supplies the globals
// agent(), parallel(), args, and log(); a top-level return is the segment result.
// Forbidden here (resume-safety / sandbox): Date.now(), Math.random(), argless new Date(),
// TS annotations, and any fs/path/process access — all file work happens inside the agents.

// GATE 3 enforcement: refuse to publish without a recorded human approval. This throws on the
// first line (before any work) so an unapproved run cannot upload.
if (typeof args.approvedBy !== "string" || args.approvedBy.trim() === "") {
  throw new Error(
    "segment-c refuses to publish: args.approvedBy must be a non-empty string naming the human " +
      "who granted the GATE 3 publish approval. No approval on record — halting before preflight."
  );
}

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
  return { segment: "c", gates, artifacts };
}

async function stage(stageId, title, skillPath, extra) {
  log(`[segment-c] ${stageId} :: ${title}`);
  const prompt =
    `Follow ${skillPath} for videoDir ${args.videoDir} ` +
    `(channel ${args.channel}, slug ${args.slug}). ` +
    `The GATE 3 human publish approval is on record: approvedBy="${args.approvedBy}". ` +
    (extra ? extra + " " : "") +
    `Your final text MUST be ONLY the JSON gate result {stage, ok, artifact, notes}: ` +
    `stage="${stageId}"; ok=true ONLY if the stage genuinely succeeded; ` +
    `artifact=the repo-relative path you wrote (or the uploaded video id, or ""); notes=a one-line status.`;
  return await agent(prompt, { label: stageId, phase: title, schema: gateSchema });
}

const preflight = await stage(
  "preflight",
  "Publish preflight",
  "orgs/faceless-youtube/.claude/skills/publish-queue/SKILL.md",
  "Run orgs/faceless-youtube/.claude/skills/publish-queue/scripts/publish_preflight.py to confirm the " +
    "render, metadata, finalized thumbnail and compliance are all publish-ready. ok=true ONLY on a clean preflight."
);
if (!record(preflight)) return done();

const upload = await stage(
  "upload",
  "Upload to YouTube",
  "orgs/faceless-youtube/.claude/skills/publish-queue/SKILL.md",
  "Perform the MCP YouTube upload exactly as publish-queue/SKILL.md specifies. This is the in-session T3 " +
    "publish action, authorized by approvedBy above. Set artifact to the uploaded YouTube video id; ok=true ONLY on a confirmed upload."
);
if (!record(upload)) return done();

const recordStage = await stage(
  "publish-record",
  "Write the publish record",
  "orgs/faceless-youtube/.claude/skills/publish-queue/SKILL.md",
  "Run orgs/faceless-youtube/.claude/skills/publish-queue/scripts/write_publish_record.py to record the " +
    "upload result and the approving human (approvedBy). ok=true ONLY if the publish record was written."
);
record(recordStage);
return done();
