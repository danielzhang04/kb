export const meta = {
  name: "fyt-segment-a",
  description:
    "Committed workflow segment A of the faceless-YouTube video pipeline: idea -> research -> script -> judge-gate. The deterministic spine that runs up to GATE 1 (the human script-acceptance gate). Each stage is one subagent that follows a project skill and returns a JSON gate result; a failed/refused gate stops the segment and returns what completed so the runner can resume the same run with paid stages still cached.",
  phases: [
    { title: "Pick and brief one video idea", detail: "idea-generator writes a ranked brief and picks one idea. No spend." },
    { title: "Research the picked idea into a sourced dossier", detail: "researcher produces a sourced, verified dossier the scriptwriter is leashed to. Read-only web only." },
    { title: "Write the long-form voiceover script", detail: "long-form-writer turns brief + dossier into the staged long-form script." },
    { title: "Fresh-eyes acceptance gate on the script", detail: "proxy-judge stands where the human stands; a reject halts the run BEFORE any paid stage (this is GATE 1)." },
  ],
};

// DAG of record: orgs/faceless-youtube/workflows/video-run.md (the video-run def is the
// source of truth for stage identity, order, and dependencies). This segment mirrors the
// idea -> research -> script -> judge-gate spine of that DAG, cut exactly at GATE 1.
// Runtime contract: the tool wraps this body in an async function that supplies the
// globals agent(), parallel(), args, and log(); a top-level return is the segment result.
// Forbidden here (resume-safety / sandbox): Date.now(), Math.random(), argless new Date(),
// TS annotations, and any fs/path/process access — all file work happens inside the agents.

// Every stage's final text is validated against this gate-result shape.
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

// record() files a gate result and reports whether the segment may continue.
function record(result) {
  gates[result.stage] = result;
  if (result && result.artifact) artifacts.push(result.artifact);
  return !!(result && result.ok === true);
}

function done() {
  return { segment: "a", gates, artifacts };
}

// One stage == one agent() following one skill for this video, returning the gate JSON.
async function stage(stageId, title, skillPath, extra) {
  log(`[segment-a] ${stageId} :: ${title}`);
  const prompt =
    `Follow ${skillPath} for videoDir ${args.videoDir} ` +
    `(channel ${args.channel}, slug ${args.slug}). ` +
    `Write staged output per the single-writer staging rule in ` +
    `orgs/faceless-youtube/workflows/video-run.md: stage your output under ` +
    `${args.videoDir}/staging/ and let the conductor merge + re-lint the single-writer files. ` +
    (extra ? extra + " " : "") +
    `Your final text MUST be ONLY the JSON gate result {stage, ok, artifact, notes}: ` +
    `stage="${stageId}"; ok=true ONLY if the stage genuinely succeeded; ` +
    `artifact=the repo-relative path you wrote (or ""); notes=a one-line status.`;
  return await agent(prompt, { label: stageId, phase: title, schema: gateSchema });
}

const idea = await stage(
  "idea",
  "Pick and brief one video idea",
  "orgs/faceless-youtube/.claude/skills/idea-generator/SKILL.md",
  "Read dna.md + performance.md + idea-backlog.md; write a ranked brief and pick ONE idea to produce. No external calls, no spend."
);
if (!record(idea)) return done();

const research = await stage(
  "research",
  "Research the picked idea into a sourced dossier",
  "orgs/faceless-youtube/.claude/skills/researcher/SKILL.md",
  "WebSearch/WebFetch only; cite every claim; take no external action. Produce the sourced dossier the scriptwriter writes from."
);
if (!record(research)) return done();

const script = await stage(
  "script",
  "Write the long-form voiceover script",
  "orgs/faceless-youtube/.claude/skills/long-form-writer/SKILL.md",
  "Turn brief.md + research.md into the long-form voiceover script with [B-ROLL]/[PAUSE] cues, following the channel storytelling grammar. Draft only."
);
if (!record(script)) return done();

const judge = await stage(
  "judge-gate",
  "Fresh-eyes acceptance gate on the script",
  "orgs/faceless-youtube/.claude/skills/proxy-judge/SKILL.md",
  "This is GATE 1. Emit an accept/revise/reject verdict to judge-verdict.md. Return ok=true ONLY for an accept; a revise or reject is ok=false and halts the run for a human decision BEFORE any paid stage spends money."
);
record(judge);
return done();
