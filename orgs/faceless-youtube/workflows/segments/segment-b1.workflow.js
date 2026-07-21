export const meta = {
  name: "fyt-segment-b1",
  description:
    "Committed workflow segment B1 of the faceless-YouTube pipeline: shorts and metadata (parallel) -> shots -> motion -> images and voiceover (parallel, both paid-guarded) -> image-review (conductor-side) -> shot-board build. The deterministic spine that runs up to GATE 2 (the human shot-board gate). Paid stages run ONLY when args.spendAuthorized === true; otherwise they return an explicit refusal and the segment stops. A failed/refused gate stops the segment and returns what completed so the runner can resume the same run with paid stages still cached.",
  phases: [
    { title: "Derive the short-form bench", detail: "shorts-writer derives one file per short from the accepted script. Draft only." },
    { title: "Author publishing metadata (no upload)", detail: "metadata-writer writes titles, description, tags, chapters, thumbnail concepts. No upload." },
    { title: "Build the visual shot list and prompts", detail: "visual-prompt-writer builds the staged B-roll shot list + thumbnail prompts. No pixels." },
    { title: "Plan the per-shot motion layers", detail: "motion-planner emits the staged per-shot plate + cutout plan. Planning only." },
    { title: "Generate the on-style stills (SPENDS REAL MONEY)", detail: "image-generation materializes every plate/cutout via the paid Gemini image API. Paid-guarded." },
    { title: "Generate the narration audio (paid TTS)", detail: "voiceover renders narration via the paid ElevenLabs TTS API. Paid-guarded." },
    { title: "Batched review of every generated still (the image gate)", detail: "Conductor-side agent runs the batched three-mandate review and stamps the manifest via stamp_review.py. Never the generating agent." },
    { title: "Build the shot board", detail: "shot-board build_board.py assembles the human GATE 2 review artifact." },
  ],
};

// DAG of record: orgs/faceless-youtube/workflows/video-run.md (the video-run def is the
// source of truth for stage identity, order, and dependencies). This segment mirrors the
// fan-out after judge-gate: shorts + metadata + shots (parallelizable), shots -> motion +
// images, images + motion -> image-review, judge-gate -> voiceover; cut at GATE 2 with the
// shot-board build appended as the conductor-side review artifact.
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

// A parallel stage may resolve null (a thrown thunk) — treat that as a failed gate.
function recordAll(stageIds, results) {
  let allOk = true;
  for (let i = 0; i < stageIds.length; i++) {
    const r =
      results[i] ||
      { stage: stageIds[i], ok: false, artifact: "", notes: "stage threw or returned nothing." };
    if (!record(r)) allOk = false;
  }
  return allOk;
}

function done() {
  return { segment: "b1", gates, artifacts };
}

function prompt(stageId, skillPath, extra) {
  return (
    `Follow ${skillPath} for videoDir ${args.videoDir} ` +
    `(channel ${args.channel}, slug ${args.slug}). ` +
    `Write staged output per the single-writer staging rule in ` +
    `orgs/faceless-youtube/workflows/video-run.md: stage your output under ` +
    `${args.videoDir}/staging/ and let the conductor merge + re-lint the single-writer files ` +
    `(shots.json, shots.motion.json and the asset manifests are single-writer). ` +
    (extra ? extra + " " : "") +
    `Your final text MUST be ONLY the JSON gate result {stage, ok, artifact, notes}: ` +
    `stage="${stageId}"; ok=true ONLY if the stage genuinely succeeded; ` +
    `artifact=the repo-relative path you wrote (or ""); notes=a one-line status.`
  );
}

async function stage(stageId, title, skillPath, extra) {
  log(`[segment-b1] ${stageId} :: ${title}`);
  return await agent(prompt(stageId, skillPath, extra), {
    label: stageId,
    phase: title,
    schema: gateSchema,
  });
}

// --- shorts ∥ metadata --------------------------------------------------------------------
log("[segment-b1] parallel: shorts ∥ metadata");
const fanout = await parallel([
  () =>
    agent(
      prompt(
        "shorts",
        "orgs/faceless-youtube/.claude/skills/shorts-writer/SKILL.md",
        "Derive the self-contained vertical shorts bench, ONE FILE PER SHORT. Draft only."
      ),
      { label: "shorts", phase: "Derive the short-form bench", schema: gateSchema }
    ),
  () =>
    agent(
      prompt(
        "metadata",
        "orgs/faceless-youtube/.claude/skills/metadata-writer/SKILL.md",
        "Write YouTube publishing metadata (titles, description, tags, chapters, thumbnail concepts). Authors metadata only; does NOT publish or upload."
      ),
      { label: "metadata", phase: "Author publishing metadata (no upload)", schema: gateSchema }
    ),
]);
if (!recordAll(["shorts", "metadata"], fanout)) return done();

// --- shots -> motion ----------------------------------------------------------------------
const shots = await stage(
  "shots",
  "Build the visual shot list and prompts",
  "orgs/faceless-youtube/.claude/skills/visual-prompt-writer/SKILL.md",
  "Build the B-roll shot list + thumbnail generation prompts from the accepted script, then re-lint. No pixel generation here."
);
if (!record(shots)) return done();

const motion = await stage(
  "motion",
  "Plan the per-shot motion layers",
  "orgs/faceless-youtube/.claude/skills/motion-planner/SKILL.md",
  "Read shots.json and emit the derived per-shot layer/motion plan (plate + cutout layers). Planning only; no rendering."
);
if (!record(motion)) return done();

// --- PAID GUARD: images ∥ voiceover -------------------------------------------------------
// Both stages call paid external APIs on the project's ambient keys. They run ONLY with an
// explicit per-run human authorization (args.spendAuthorized === true, recorded on a queue
// card). Without it we do NOT spawn them and do NOT silently skip — we file an explicit
// refusal gate and stop the segment.
if (args.spendAuthorized !== true) {
  const refusal = (stageId) => ({
    stage: stageId,
    ok: false,
    artifact: "",
    notes:
      "REFUSED: paid stage requires args.spendAuthorized === true (explicit per-run human " +
      "authorization recorded on a queue card). Not spending. Re-run with authorization to resume.",
  });
  record(refusal("images"));
  record(refusal("voiceover"));
  log("[segment-b1] paid stages refused — args.spendAuthorized is not true");
  return done();
}

// Targeted regen: when resumeShotIds is supplied, image-generation regenerates ONLY those
// shots and reuses the cached stills for everything else.
const regenNote =
  Array.isArray(args.resumeShotIds) && args.resumeShotIds.length
    ? "TARGETED REGEN: regenerate ONLY these shot ids and reuse the cached stills for every " +
      "other shot: " + args.resumeShotIds.join(", ") + ". "
    : "";

log("[segment-b1] parallel: images ∥ voiceover (paid, authorized)");
const paid = await parallel([
  () =>
    agent(
      prompt(
        "images",
        "orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md",
        regenNote +
          "THIS STAGE SPENDS REAL MONEY on the paid Gemini image API (gemini-3-pro-image), " +
          "billed per generated image. Seed every generation from the locked style bible, " +
          "honour the run's declared call ceiling, and log actual spend."
      ),
      {
        label: "images",
        phase: "Generate the on-style stills (SPENDS REAL MONEY)",
        schema: gateSchema,
      }
    ),
  () =>
    agent(
      prompt(
        "voiceover",
        "orgs/faceless-youtube/.claude/skills/voiceover/SKILL.md",
        "This calls the paid ElevenLabs TTS API and is covered by the same per-run " +
          "authorization as images. Produce assets/vo.mp3, the shorts mp3s, and the voiceover manifest."
      ),
      { label: "voiceover", phase: "Generate the narration audio (paid TTS)", schema: gateSchema }
    ),
]);
if (!recordAll(["images", "voiceover"], paid)) return done();

// --- image-review (conductor-side gate) ---------------------------------------------------
const review = await stage(
  "image-review",
  "Batched review of every generated still (the image gate)",
  "orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md",
  "You are the CONDUCTOR-SIDE reviewer, NEVER the generating agent (fyt-run-001 law: a node " +
    "never holds the gate that blocks its own work; the generator grades its own frames leniently). " +
    "Open EVERY scene PNG under " + args.videoDir + "/assets/scenes/ AND every layered shot's " +
    "plate + cutouts, enumerating the full reviewable surface from the motion plan's " +
    "cutout_layer_ids. Dispatch the three concurrent review mandates (identity/rig, fidelity, " +
    "style); transcribe every authored in-image line LETTER-BY-LETTER against the still_prompt and " +
    "treat any garbled/misspelled/partial render as BLOCKING; force a PASS/FAIL on every seeded or " +
    "foreground figure. Write the shard rulings + merged.json under " + args.videoDir + "/assets/_review/, " +
    "then END by stamping " + args.videoDir + "/assets/scenes/manifest.json review_status per shot via " +
    "orgs/faceless-youtube/.claude/skills/image-generation/scripts/stamp_review.py. The artifact is the " +
    "honestly-stamped manifest; ok=true ONLY if every reviewable frame is verified (no parked blockers)."
);
if (!record(review)) return done();

// --- shot-board build (GATE 2 review artifact) --------------------------------------------
const board = await stage(
  "board",
  "Build the shot board",
  "orgs/faceless-youtube/.claude/skills/shot-board/SKILL.md",
  "Run orgs/faceless-youtube/.claude/skills/shot-board/scripts/build_board.py to assemble the shot-board " +
    "review artifact for GATE 2 (the human shot-board gate). Local assembly only; no spend."
);
record(board);
return done();
