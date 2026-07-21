---
id: video-run
project: faceless-youtube
title: Produce one video (faceless pipeline)
profile: producer
stages:
  - id: idea
    title: Pick and brief one video idea
    action: research:idea
    target: orgs/faceless-youtube/channels
    riskTier: T2
    workOrder: "Invoke the idea-generator skill for this channel. Read dna.md + performance.md + idea-backlog.md, then write a ranked idea brief for one video into channels/<channel>/videos/<slug>/brief.md and pick the single idea to produce. No external calls, no spend."
  - id: research
    title: Research the picked idea into a sourced dossier
    action: research:dossier
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [idea]
    workOrder: "Invoke the researcher skill on the picked idea brief. Produce a sourced, verified dossier at channels/<channel>/videos/<slug>/research.md that the scriptwriter writes from. WebSearch/WebFetch only; cite every claim; take no external action."
  - id: script
    title: Write the long-form voiceover script
    action: draft:long-form-script
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [research]
    workOrder: "Invoke the long-form-writer skill. Turn brief.md + research.md into the long-form voiceover script at channels/<channel>/videos/<slug>/script.md, following the channel storytelling grammar. Draft only. Stage under staging/ and let the conductor merge, per the single-writer rule below."
  - id: judge-gate
    title: Fresh-eyes acceptance gate on the script
    action: review:script-gate
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [script]
    workOrder: "Invoke the proxy-judge skill as a fresh-context acceptance gate on script.md. Emit an accept/revise/reject verdict to channels/<channel>/videos/<slug>/judge-verdict.md. This gate stands where the human stands; a reject halts the run for a human decision BEFORE the images stage spends real money."
  - id: shorts
    title: Derive the short-form bench
    action: draft:shorts
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [judge-gate]
    workOrder: "Invoke the shorts-writer skill. Derive the self-contained vertical shorts bench from the accepted long-form script into ONE FILE PER SHORT at channels/<channel>/videos/<slug>/shorts/short-01.md, short-02.md, ... Draft only."
  - id: metadata
    title: Author publishing metadata (no upload)
    action: draft:metadata
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [judge-gate]
    workOrder: "Invoke the metadata-writer skill. Write the YouTube publishing metadata (titles, description, tags, chapters, thumbnail concepts) for the long-form and each scripted short into channels/<channel>/videos/<slug>/metadata.json. This authors metadata only; it does NOT publish or upload."
  - id: shots
    title: Build the visual shot list and prompts
    action: build:shot-list
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [judge-gate]
    workOrder: "Invoke the visual-prompt-writer skill. Build the B-roll shot list + thumbnail generation prompts into channels/<channel>/videos/<slug>/shots.json from the accepted script, then re-lint. No pixel generation here. Stage under staging/shots.json; the conductor merges — shots.json is a single-writer file."
  - id: motion
    title: Plan the per-shot motion layers
    action: build:motion-plan
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [shots]
    workOrder: "Invoke the motion-planner skill. Read shots.json and emit the derived per-shot layer/motion plan at channels/<channel>/videos/<slug>/shots.motion.json. Planning only; no rendering. Stage under staging/shots.motion.json; the conductor merges — shots.motion.json is a single-writer file."
  - id: images
    title: Generate the on-style stills (SPENDS REAL MONEY)
    action: build:images
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [shots]
    workOrder: "Invoke the image-generation skill against the locked style bible. Materialize every plate/cutout still for shots.json into the video asset library. THIS STAGE SPENDS REAL MONEY on the paid Gemini image API (gemini-3-pro-image, billed per generated image) — a full long-form video runs roughly 130-200 generation calls, on the order of twenty US dollars. It therefore requires explicit per-run human authorization recorded on a queue card BEFORE it starts; without that recorded authorization, halt and ask. Honour the run's call ceiling and log actual spend."
  - id: image-review
    title: Batched review of every generated still (the image gate)
    action: review:image-gate
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [images, motion]
    workOrder: "Run the batched image review that image-generation/SKILL.md specifies as prose — now a real DAG node, not an optional prose step. Open EVERY scene PNG under channels/<channel>/videos/<slug>/assets/scenes/ AND every layered shot's plate + cutouts, enumerating the full reviewable surface from the motion plan's cutout_layer_ids so nothing renders unreviewed (never just scenes/<shot-id>.png). Dispatch the three concurrent review mandates (identity/rig, fidelity, style) over the whole batch; transcribe every authored in-image line LETTER-BY-LETTER against the still_prompt and treat a garbled, misspelled or partial render as blocking; silence on any seeded or foreground figure is disallowed — each gets a forced PASS/FAIL. Write the shard rulings + merged.json under channels/<channel>/videos/<slug>/assets/_review/, then END by stamping channels/<channel>/videos/<slug>/assets/scenes/manifest.json review_status per shot — verified, or parked with its reasons — via image-generation/scripts/stamp_review.py. The artifact of this stage is the honestly-stamped manifest; the DAG is NOT satisfied by PNG files merely existing on disk. fyt-run-001 law: a stage never holds the gate that blocks its own work — this node is run by the conductor/orchestrator, NEVER by the generating agent, which grades its own frames leniently."
  - id: voiceover
    title: Generate the narration audio (paid TTS)
    action: build:voiceover
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [judge-gate]
    workOrder: "Invoke the voiceover skill. Turn script.md (and each publish-tagged short) into narration audio plus a manifest under channels/<channel>/videos/<slug>/ that render-builder syncs visuals to. This calls the paid ElevenLabs TTS API and is covered by the same per-run authorization as the images stage. Heavyweight TTS; no publish."
  - id: audio-plan
    title: Author the unified audio plan
    action: build:audio-plan
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [script, shots, voiceover]
    workOrder: "Invoke the audio-director skill. It reads script.md AND shots.json AND the voiceover manifest — placement is a judgment grounded in all three. Author the unified audio plan (SFX, pauses, music beds, dry spans) at channels/<channel>/videos/<slug>/audio-plan.json. Planning only. Stage under staging/audio-plan.json; the conductor merges — audio-plan.json is a single-writer file."
  - id: render
    title: Assemble the finished cut (heavyweight)
    action: build:render
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [metadata, shorts, motion, image-review, audio-plan]
    workOrder: "Invoke the render-builder skill. Assemble the finished MP4(s) for the long-form and each publish-tagged short via the local Remotion engine from shots.json + the verified stills + the voiceover audio + the audio plan into channels/<channel>/videos/<slug>/. Local render, no API spend; first runs stay orchestrator-driven. Produces local files only; it does NOT upload or publish."
  - id: verify
    title: Verify the render against the manifests
    action: verify:render
    target: orgs/faceless-youtube/channels
    riskTier: T2
    dependsOn: [render]
    workOrder: "Invoke render-builder's verification pass on the rendered output: confirm the MP4(s) exist, match the shot/audio manifests, and clear the no-slop bar. Write a pass/fail note to channels/<channel>/videos/<slug>/render-verify.md. No publish; a human reviews before any upload, which is out of this workflow."
---

# video-run — produce one faceless-YouTube video

Runs this project's pipeline to produce ONE video from a picked idea through a verified render. The
channel and the video slug are supplied at launch time (like the research-brief template's topic);
wherever a work order says channels/<channel>/videos/<slug>/, substitute the launch-supplied values.

The real on-disk tree is channels/<channel>/videos/<slug>/ — for example
channels/the-second-take/videos/2026-07-19-wells-fargo/. There is no orgs/faceless-youtube/videos
directory; an earlier revision of this definition claimed one and was wrong.

The DAG mirrors the pipeline skills: idea -> research -> script -> judge-gate, then the accepted script
fans out into the short-form bench, the publishing metadata, and the visual shot list; shots feed the
motion plan and the still generation; the generated stills then pass the batched image-review gate
(which reads the motion plan to enumerate every plate + cutout) before anything renders; the script
feeds the voiceover; the audio plan converges the script, the shot list and the voiceover; and
everything converges on render + verify.

## Spend

**This workflow is not free.** Two stages call paid external APIs on the project's ambient keys:

- **images** — the paid Gemini image API (gemini-3-pro-image), billed per generated image. A full
  8-15 minute long-form video runs roughly 130-200 generation calls including retries, which comes to
  roughly seventeen US dollars for a typical run and about twenty-seven at the 200-call working
  ceiling. Measured evidence: the 2026-07-19 wells-fargo run's image-generation lab notes.
- **voiceover** — the paid ElevenLabs TTS API.

Both stages require **explicit per-run human authorization recorded on a queue card** before they
start. An agent that reaches the images stage without such a card on the run's parent must halt and
ask, not proceed. Log actual spend; do not rely on the daily budget gate to catch it, because image
spend is not currently written to the cost ledger.

Every other stage is language or local compute and carries no marginal API cost.

## Single-writer staging rule (load-bearing)

`shots.json`, `shots.motion.json`, `audio-plan.json` and the asset manifests are **single-writer**
files. Stage agents do **not** write them directly. Each stage agent writes its output into
`channels/<channel>/videos/<slug>/staging/`, and **only the conductor/orchestrator** merges staged
output into the video root and then **re-lints** the merged result.

This exists because parallel stages otherwise clobber each other's edits to the same shared JSON —
two agents both writing `audio-plan.json` was an observed, real failure in this project. Skipping the
merge-then-re-lint step ships plan-level logic errors straight into paid generation.

## Boundaries

- **Publishing / upload is NOT a stage.** This workflow ends at a verified local render. Uploading to
  YouTube is a separate, human-gated T3 step that does not exist in this definition, and the producer
  profile carries no upload tool.
- **Render + image + voiceover stages are heavyweight.** First runs stay orchestrator-driven; the
  definition exists so the dashboard can launch later runs once the pipeline is warm.
- **The judge-gate is a real gate.** A reject halts the run for a human decision before any
  heavyweight production spends time, local resources, or money.
- Handle no credentials as objects. Spend money ONLY on the images and voiceover stages, ONLY within
  a per-run authorization recorded on a queue card, and never beyond that run's declared ceiling.
  Take no external action beyond the researcher's read-only web access and those two authorized APIs.
