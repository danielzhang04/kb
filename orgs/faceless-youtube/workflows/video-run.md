---
id: video-run
project: faceless-youtube
title: Produce one video (faceless pipeline)
profile: producer
governedBy: fyt-runner
manager:
  agentId: fyt-runner
  profileId: manager:claude:claude-fable-5
parameters: [channel, slug, slice]
stages:
  - id: idea
    title: Generate ranked idea briefs
    action: research:idea-briefs
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-story
    agentId: fyt-story
    profileId: worker:claude:claude-fable-5
    workOrder: "Invoke the idea-generator skill for the <channel> channel. Read its dna.md, performance.md and idea-backlog.md, then write ranked, differentiated idea briefs for this run into channels/<channel>/videos/<slug>/brief.md. Author briefs only — the human picks and edits one at gate g0-idea-pick, which blocks the next stage until it is approved. Read-only local work; no external calls and no API cost. Ignore the <slice> parameter here: it scopes generation downstream, never planning."
    artifacts:
      - id: brief
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/brief.md
        description: The ranked idea briefs the human reads and edits at gate g0-idea-pick.
  - id: story
    title: Research the picked idea and write the full long-form script
    action: draft:long-form-script
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-story
    agentId: fyt-story
    profileId: worker:claude:claude-fable-5
    dependsOn: [idea]
    humanGates:
      - id: g0-idea-pick
        kind: approval
        prompt: "GATE 0 — pick the idea. Read the ranked briefs in channels/<channel>/videos/<slug>/brief.md, edit the one you want produced, then approve to release research and scripting. Iterate in the fyt-story terminal first if the briefs are not there yet."
    workOrder: "Invoke the researcher skill on the picked brief, then long-form-writer. Produce the sourced dossier at channels/<channel>/videos/<slug>/research.md (read-only web access, every claim cited) and the long-form voiceover script at channels/<channel>/videos/<slug>/script.md, following the channel storytelling grammar. Script the WHOLE video regardless of the <slice> the downstream stages will realize. research.md and script.md have exactly one writer — you — so write them at those paths directly; the single-writer staging law in the body below covers the shared JSON plans, not these two. fyt-story never grades its own script."
    artifacts:
      - id: research
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/research.md
        description: The sourced dossier behind the script, every claim cited.
      - id: script
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/script.md
        description: The full long-form voiceover script — the artifact judged at judge-gate and approved at g1-script.
  - id: judge-gate
    title: Fresh-context acceptance verdict on the script
    action: review:script-verdict
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-checker
    agentId: fyt-checker
    profileId: worker:claude:claude-fable-5
    dependsOn: [story]
    workOrder: "Invoke the proxy-judge skill as a fresh-context acceptance verdict on channels/<channel>/videos/<slug>/script.md, judged against the channel storytelling grammar and its calibration set. Write accept/revise/reject with reasons to channels/<channel>/videos/<slug>/judge-verdict.md. This is the machine pre-vet standing in front of gate g1-script: the human reads this verdict before approving. fyt-checker never reviews an artifact it authored and never converts an inconclusive read into a pass. The <slice> is irrelevant here — the whole script is judged."
    artifacts:
      - id: judge-verdict
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/judge-verdict.md
        description: The fresh-context accept/revise/reject verdict the human reads at gate g1-script.
  - id: packaging
    title: Derive the shorts bench and author the metadata
    action: draft:packaging
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-story
    agentId: fyt-story
    profileId: worker:claude:claude-fable-5
    dependsOn: [judge-gate]
    humanGates:
      - id: g1-script
        kind: approval
        prompt: "GATE 1 — approve the script. Read channels/<channel>/videos/<slug>/script.md against fyt-checker's judge-verdict.md. Approving releases packaging and, behind it, the visual plan. Iterate with fyt-story in its terminal before approving if the script needs work."
    workOrder: "Invoke the shorts-writer skill, then metadata-writer, against the approved script. Write one file per short to channels/<channel>/videos/<slug>/shorts/short-NN.md and the YouTube metadata (title plus challengers, description, tags, hashtags, chapters, pinned-comment copy) for the long-form and each short to channels/<channel>/videos/<slug>/metadata.json. Authoring only — this stage never uploads anything anywhere. The shorts files and metadata.json each have exactly one writer, so write them at those paths directly; the staging law covers the shared JSON plans, not these. The <slice> does not narrow this stage: metadata covers the whole video."
    artifacts:
      - id: metadata
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/metadata.json
        description: Title plus challengers, description, tags, hashtags, chapters and pinned-comment copy for the long-form and every short.
  - id: visual-plan
    title: Author the full shot list, motion plan, and lint
    action: build:visual-plan
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-visuals
    agentId: fyt-visuals
    profileId: worker:claude:claude-fable-5
    dependsOn: [packaging]
    workOrder: "Invoke the visual-prompt-writer skill, then motion-planner, then re-run the shot lint. visual-prompt-writer authors the FULL video's plan — never only the <slice>; the slice scopes what gets generated downstream, never what gets planned. Write channels/<channel>/videos/<slug>/shots.json and channels/<channel>/videos/<slug>/shots.motion.json into channels/<channel>/videos/<slug>/staging/ for fyt-runner to merge and re-lint — both are single-writer files. No pixels are generated here and no API is called."
    artifacts:
      - id: staged-shots
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/staging/shots.json
        description: The full shot list, staged for fyt-runner to merge and re-lint at the video root.
      - id: staged-motion
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/staging/shots.motion.json
        description: The derived motion plan, staged for fyt-runner to merge and re-lint at the video root.
  - id: images
    title: Generate the on-style stills for the slice
    action: build:images
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-visuals
    agentId: fyt-visuals
    profileId: worker:claude:claude-fable-5
    dependsOn: [visual-plan]
    humanGates:
      - id: g2-visual-plan
        kind: approval
        prompt: "GATE 2 — approve the visual plan, and with it this run's paid-generation authorization. Read the merged shots.json and shots.motion.json plus the lint result. Approving is the ONLY thing that releases paid image generation on this run, and it is also the recorded authorization for the narration API in the audio stage further down this same path. It authorizes nothing on any other run and nothing outside this run's declared call ceiling."
        spendAuthorization: true
    workOrder: "Invoke the image-generation skill against the channel's locked style bible, for the shots inside <slice> only. This is the run's one cost-bearing generation node: it calls the paid Gemini image API, billed per generated image. A full long-form video measures roughly 130-200 generation calls including retries; a two-minute slice is a small fraction of that. Honour the run's declared call ceiling, log the actual cost, and stop and ask rather than exceed it. This stage runs only on the recorded approval of gate g2-visual-plan above. fyt-visuals never reviews or stamps its own frames."
    artifacts:
      - id: scene-manifest
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/assets/scenes/manifest.json
        description: The generated-scene manifest — one entry per shot in the slice, with its attempt history. review_status is stamped later, by fyt-checker, never here.
  - id: image-review
    title: Review every generated still and build the shot board
    action: review:image-board
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-checker
    agentId: fyt-checker
    profileId: worker:claude:claude-fable-5
    dependsOn: [images]
    workOrder: "Open EVERY still generated for the <slice> under channels/<channel>/videos/<slug>/assets/scenes/, plus every layered shot's plate and cutouts enumerated from the motion plan's cutout_layer_ids, so nothing reaches a render unreviewed. Run the three review mandates (identity/rig, fidelity, style) across the batch; transcribe every authored in-image line letter-by-letter against its still_prompt and treat a garbled, misspelled or partial render as blocking; every seeded or foreground figure gets a forced PASS or FAIL — silence is disallowed. Write the shard rulings and merged.json under channels/<channel>/videos/<slug>/assets/_review/, stamp channels/<channel>/videos/<slug>/assets/scenes/manifest.json review_status per shot (verified, or parked with its reasons) via image-generation/scripts/stamp_review.py, then build the human-facing board with the shot-board skill. The artifact of this stage is the honestly-stamped manifest plus board.html — PNGs merely existing on disk satisfy nothing. A stage never holds the gate that blocks its own work: fyt-visuals generated these frames and never grades them."
    artifacts:
      - id: review-merged
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/assets/_review/merged.json
        description: The merged shard rulings — a forced PASS or FAIL per seeded and foreground figure, silence disallowed.
      - id: shot-board
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/assets/board.html
        description: The human review surface for gate g3-image-board, badged verified / parked / unreviewed per shot.
  - id: audio
    title: Generate narration and author the audio plan for the slice
    action: build:audio
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-audio-render
    agentId: fyt-audio-render
    profileId: worker:claude:claude-fable-5
    dependsOn: [image-review]
    humanGates:
      - id: g3-image-board
        kind: approval
        prompt: "GATE 3 — approve the shot board. Open channels/<channel>/videos/<slug>/assets/board.html and read fyt-checker's stamped manifest: verified versus parked, shot by shot. Approving releases narration and the audio plan. Send parked shots back to fyt-visuals for regeneration before approving."
      - id: g3b-narration-cost
        kind: approval
        prompt: "GATE 3b — the narration half of the SAME authorization you gave at GATE 2. This stage calls the paid ElevenLabs narration API, billed per character of the slice's script range; a two-minute slice is cents, a full long-form is dollars. You already authorized this cost at g2-visual-plan, and this second approval exists so the authorization is RECORDED against the stage that actually calls the API: a targeted single-stage repair or re-run of narration then has an authorization of its own instead of inheriting one by DAG reachability. Approve here as the same decision, or reject to hold narration while everything else stands."
        spendAuthorization: true
    workOrder: "Invoke the voiceover skill, then audio-director, for the <slice>. Turn the script's slice range into narration audio plus channels/<channel>/videos/<slug>/assets/voiceover.manifest.json that the render syncs visuals to, then author the unified SFX, pause, music-bed and dry-span plan at channels/<channel>/videos/<slug>/audio-plan.json. The paid narration API called here is the narration half of the SAME recorded g2-visual-plan authorization; gate g3b-narration-cost records that one decision against this stage too, so a later single-stage re-run of narration still runs under an authorization recorded on the stage that calls the API. audio-plan.json is a single-writer file — stage it under channels/<channel>/videos/<slug>/staging/ for fyt-runner to merge and re-lint."
    artifacts:
      - id: voiceover-manifest
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/assets/voiceover.manifest.json
        description: Every narration piece with its measured duration — the timing the render syncs visuals to.
      - id: staged-audio-plan
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/staging/audio-plan.json
        description: The unified SFX, pause, music-bed and dry-span plan, staged for fyt-runner to merge and re-lint at the video root.
  - id: render
    title: Assemble the finished cut for the slice
    action: build:render
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-audio-render
    agentId: fyt-audio-render
    profileId: worker:claude:claude-fable-5
    dependsOn: [audio]
    workOrder: "Invoke the render-builder skill to assemble the <slice> into channels/<channel>/videos/<slug>/assets/final.mp4 and each short MP4 under channels/<channel>/videos/<slug>/assets/shorts/, via the local Remotion engine, from the merged shots.json, the verified stills, the narration audio and audio-plan.json. Local compute only — no external API is called and no cost is incurred. Write channels/<channel>/videos/<slug>/assets/render.manifest.json. This produces local files; it never uploads them. fyt-audio-render does not verify its own cut."
    artifacts:
      - id: final-cut
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/assets/final.mp4
        description: The assembled long-form cut for the slice. Media output, gitignored by design; the server checks the working tree, not git.
      - id: render-manifest
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/assets/render.manifest.json
        description: What was rendered, per piece — scene counts, durations, audio resolution and state.
  - id: verify
    title: Verify the render and run the compliance report
    action: verify:render-compliance
    target: orgs/faceless-youtube/channels
    riskTier: T2
    governedBy: fyt-checker
    agentId: fyt-checker
    profileId: worker:claude:claude-fable-5
    dependsOn: [render]
    workOrder: "Run render-builder's verification pass over the rendered <slice>: confirm the MP4s exist, match the shot and audio manifests, and clear the no-slop bar; write the pass/fail note to channels/<channel>/videos/<slug>/render-verify.md. Then invoke the compliance-check skill for the mechanical and provenance report at channels/<channel>/videos/<slug>/compliance-report.md (PASS or FAIL, with the failing checks named). fyt-audio-render built this cut and does not verify it. These two reports are the machine pre-vet the human reads at GATE 4 before the private upload is authorized."
    artifacts:
      - id: render-verify
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/render-verify.md
        description: The pass/fail note on the rendered slice against the shot and audio manifests.
      - id: compliance-report
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/compliance-report.md
        description: The mechanical and provenance report, PASS or FAIL with the failing checks named.
  - id: publish-private
    title: Upload the finished cut as private
    action: publish:private-upload
    target: orgs/faceless-youtube/channels
    riskTier: T3
    governedBy: fyt-publish
    agentId: fyt-publish
    profileId: worker:claude:claude-fable-5
    dependsOn: [verify]
    humanGates:
      - id: g4-publish-private
        kind: approval
        prompt: "GATE 4 — render and compliance approved. Read channels/<channel>/videos/<slug>/render-verify.md and compliance-report.md, watch the cut, then approve to authorize the PRIVATE upload. This approval covers a private upload only: the public flip and the thumbnail set stay human-only in YouTube Studio and are not part of this run."
        publicationAuthorization: true
    workOrder: "Invoke the publish-queue skill to upload the finished <slice> cut for channels/<channel>/videos/<slug>/ to YouTube as PRIVATE, only after gate g4-publish-private is approved and compliance-report.md reads PASS. Record the resulting video id and its private state to channels/<channel>/videos/<slug>/publish-record.json. Flipping a video public and setting its thumbnail are Studio actions a human performs — this stage never performs them. Analytics is fyt-publish's standing duty outside this DAG, not a stage here."
    artifacts:
      - id: publish-record
        path: orgs/faceless-youtube/channels/<channel>/videos/<slug>/publish-record.json
        description: The durable proof of the completed private upload — video id, private state, and the idempotency record that stops a second attempt.
---

# video-run — produce one faceless-YouTube video

Runs this project's pipeline to produce ONE video, from a fresh idea through a private upload. The
channel, the video slug, and the slice are supplied at launch; wherever a work order says
`channels/<channel>/videos/<slug>/`, substitute the launch-supplied values.

The real on-disk tree is `channels/<channel>/videos/<slug>/` — for example
`channels/the-second-take/videos/2026-07-19-wells-fargo/`. There is no `orgs/faceless-youtube/videos`
directory.

## Launch parameters

- `channel` — the channel folder under `channels/`. Agents carry no channel doctrine; they load
  `channels/<channel>/dna.md`, its grammar and its style data as DATA at spawn. Any agent runs
  equivalently on any channel.
- `slug` — the video folder, `YYYY-MM-DD-topic`.
- `slice` — the shot/time subrange that gets *realized*. Planning stages (idea, story, judge-gate,
  packaging, visual-plan) always cover the WHOLE video; only images, audio, render and the private
  upload are scoped to the slice. A maiden or trial run uses about two minutes.

## The roster

Six agents, each owning whole stages end to end: `fyt-runner` (conductor and single-writer merger),
`fyt-story` (idea → script → shorts → metadata), `fyt-visuals` (shots → motion → stills),
`fyt-audio-render` (narration → audio plan → render), `fyt-publish` (private upload), and
`fyt-checker`, which is not a phase but the cross-cutting fresh-context gate service standing in
front of every human gate.

## The gates (G0–G4) and where they are declared

A stage's `humanGates` block **that stage**: the control plane evaluates a stage's declared gates
*before* it prepares any attempt for it. So each gate is declared on the stage it must hold back —
which is the stage AFTER the work being judged, never the stage producing it. Read the table as
"approving X releases Y":

| Gate | Judges the output of | Declared on (and therefore blocks) |
| --- | --- | --- |
| `g0-idea-pick` | idea | story |
| `g1-script` | story + judge-gate | packaging |
| `g2-visual-plan` | visual-plan | images |
| `g3-image-board` | image-review | audio |
| `g3b-narration-cost` | (the cost of this stage's own paid call) | audio |
| `g4-publish-private` | verify | publish-private |

A stage may declare more than one gate, and `audio` does: the control plane raises them one at a
time, in declaration order, and the stage stays held until every one is recorded approved.

The DAG is deliberately a single chain, so no path routes around a gate: every stage downstream of
an unapproved gate is unreachable, not merely discouraged. Each gate is pre-vetted by a machine
check first — `fyt-checker`'s judge verdict, stamped manifest, render-verify and compliance report —
so the human is always approving a reviewed artifact, never a raw one. Gates surface in the
dashboard Inbox; iterate with the owning agent in its terminal, then approve there.

## Cost law

**This workflow is not free.** Two nodes call paid external APIs on the project's ambient keys:

- **images** — the paid Gemini image API (`gemini-3-pro-image`), billed per generated image. A full
  8–15 minute long-form video measures roughly 130–200 generation calls including retries, which is
  on the order of seventeen US dollars for a typical run and about twenty-seven at the 200-call
  working ceiling (measured: the 2026-07-19 wells-fargo run's image-generation lab notes). A
  two-minute slice is a small fraction of that.
- **audio** — the paid ElevenLabs TTS API for narration.

**`g2-visual-plan` is the single authorization for both**, and it is recorded on both paid stages.
It is declared on `images`, and `audio` is reachable only by passing through it — but reachability is
not a record. The control plane authorizes SPEND PER STAGE, so a targeted single-stage repair or
re-run of narration (which `fyt-runner` explicitly owns) would have called a paid API with no
authorization recorded anywhere against the stage that called it. `audio` therefore also carries
`g3b-narration-cost` with `spendAuthorization: true`: the same human decision, restated where the
call actually happens, so no paid node in this definition can run without a recorded approval on its
own stage. Those two are the ONLY gates carrying `spendAuthorization: true` — no card, no per-stage
exception, and approving any other gate authorizes nothing paid. Log actual cost: the daily budget
guard will not catch image cost, because image cost is not written to the cost ledger today.

Every other stage is language work or local compute and carries no marginal API cost.

## Single-writer staging law (load-bearing)

`shots.json`, `shots.motion.json` and `audio-plan.json` are **single-writer** files — the three shared
JSON plans more than one stage reads. Stage agents do **not** write them directly at the video root:
each writes its copy into `channels/<channel>/videos/<slug>/staging/`, and **only fyt-runner** merges
staged output into the video root and then **re-lints** the merged result.

This exists because parallel stages otherwise clobber each other's edits to the same shared JSON —
two agents both writing `audio-plan.json` was an observed, real failure in this project. Skipping the
merge-then-re-lint step ships plan-level logic errors straight into paid generation.

Files with exactly ONE writer are outside this law and are written at their real paths directly:
`brief.md`, `research.md`, `script.md`, `shorts/short-NN.md`, `metadata.json`, `judge-verdict.md`,
the scene and review manifests, `board.html`, the rendered MP4s, `render.manifest.json`,
`render-verify.md`, `compliance-report.md`, `publish-record.json`. That matches the on-disk shape of
the 2026-07-19 wells-fargo run, whose `staging/` holds exactly the three shared JSON plans.

## Declared artifacts (what makes a stage's success checkable)

Every stage declares the load-bearing files it must leave on disk. These are verified
**server-side** against the working tree before the completion is accepted, so an agent's word alone
never advances the run: a stage that reports done with nothing written parks for a human instead of
handing the next gate an artifact that does not exist. Two consequences worth knowing:

- The three staged plans are declared at their `staging/` paths, because that is what the stage agent
  itself produces. Nothing here verifies fyt-runner's staging→root merge — the merge is not a DAG
  node, so the merged root file is checked only by the lint fyt-runner re-runs on it.
- Media artifacts (`assets/final.mp4`) are gitignored by design. The check reads the working tree,
  not git, so an ignored file still counts as produced.

## Author-never-grades

No agent grades its own phase's output. `fyt-checker` owns all four machine gates — judge-gate,
image-review, render-verify + compliance — and produces none of the artifacts it judges.
`fyt-runner` conducts and merges but stamps nothing: a stage never holds the gate that blocks its
own work, and neither does its dispatcher. `image-review` is a real DAG node with a stamped manifest
as its artifact, not a prose step inside image generation — PNG files existing on disk satisfy
nothing.

## Boundaries

- **The upload is PRIVATE only.** Flipping a video public and setting its thumbnail are human-only
  Studio actions outside this definition.
- **Analytics is not a stage.** It is `fyt-publish`'s standing duty outside this DAG.
- Handle no credentials as objects. Incur paid-API cost ONLY on the `images` and `audio` stages,
  ONLY under the recorded `g2-visual-plan` approval (restated on `audio` as `g3b-narration-cost`),
  and never beyond that run's declared ceiling.
  Take no external action beyond the researcher's read-only web access, those two paid APIs, and the
  gated private upload.
