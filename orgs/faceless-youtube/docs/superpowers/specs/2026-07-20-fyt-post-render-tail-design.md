# FYT Runner + post-render tail — design

**Date:** 2026-07-20
**Status:** approved in brainstorm (Daniel); build authorized 2026-07-20 (this terminal). Read together with
`2026-07-20-fyt-runner-synthesis-design.md`, which merges this design with the fyt-run-001 structural findings
and records the scope decisions for the build arc.

## Context

Everything through render is built and proven (poyais R12: rendered, verified, watch-through passed).
Downstream of `assets/final.mp4` the project is a design with empty slots: `compliance-check`,
`publish-queue`, `analytics-reporter`, and an orchestrator are specified in `.claude/skills/README.md`
but not implemented; thumbnails exist only as concepts in `metadata.json`; YouTube OAuth slots in
`.env` are declared but empty; no channel exists yet.

Binding project law (unchanged by this design):
- **Stage-0 autonomy** — a human approves every publish; publish is never `acts-alone`.
- **Unaudited OAuth app** — the API can only upload `private`; only a human in Studio can make a video public.
- `metadata.json` already hard-codes `privacy_status: "private"` and `contains_synthetic_media: true`.

## Decisions (from brainstorm Q&A)

| Decision | Choice |
|---|---|
| Arc goal | Build the whole tail as a complete system, then run poyais through it as first test |
| Orchestrator shape | One agent (**FYT Runner**, id `fyt-runner`) running committed workflow scripts; agent = judgment + human gates, workflows = deterministic spine. Replaces `faceless-producer`. |
| Scope | FYT-specific, deliberately. No generic "content pipeline" abstraction at n=1. |
| Autonomy | On-demand only. Daniel initiates every video; the runner never self-starts or self-spends. |
| Human gates | Three: script review, **image board review (new)**, publish approval |
| Compliance depth | Mechanical + provenance (see §Compliance-check) |
| YouTube transport | Hybrid: youtube-uploader MCP for upload (human-gated, creds stay in MCP); small read-only direct-API client via `.env` OAuth for analytics (headless-capable) |
| Analytics sink | Org-local JSON + `performance.md` digest; standalone dashboard published as a Claude artifact at a stable URL. NOT in the kb fleet dashboard. |
| Dashboard hosting | Claude artifact, regenerated+republished each analytics run at the same URL; org keeps the link in `DASHBOARD.md` |
| Cost | $0 additional. Both YouTube APIs are free within quota; OAuth client free; artifact hosting free. |

## Architecture

### FYT Runner (agent `fyt-runner`)

kb agent definition; supersedes `faceless-producer`. On-demand: "make a video about X for
channel Y" drives the full pipeline, pausing only at the three human gates. Responsibilities:

- Launch each workflow segment; read per-stage gate results from the workflow journal.
- On stage failure: diagnose, repair (possibly invoking stage skills directly), then **resume the
  same workflow run** so completed stages stay cached (no re-spend of TTS/image money).
- Enforce the money rule: TTS and image generation run at most once per approved script; retries
  of paid stages require existing artifacts to be genuinely unusable, and re-synthesis of
  existing-good VO is forbidden (vo.mp3 reuse law).
- Write a run report per video (stage outcomes, retries, spend estimate, deviations).
- Self-learning: append agent lessons to `memory/fyt-runner.md` (kb constitution loop) and
  pipeline lessons to `orgs/faceless-youtube/knowledge/` so they outlive the agent.

### Workflow segments (committed scripts, cut at the human gates)

- **Segment A:** idea-generator → researcher → long-form-writer → proxy-judge
  → **GATE 1: Daniel reviews script**
- **Segment B1:** shorts-writer + metadata-writer → visual-prompt-writer → motion-planner →
  image-generation ∥ voiceover → build shot board
  → **GATE 2: Daniel reviews the shot board; may iterate images with the agent**
- **Segment B2:** audio-director → render-builder → verify → thumbnail render → compliance-check
  → **GATE 3: Daniel watch-through + compliance report + publish approval**
- **Segment C:** publish-queue (upload private via MCP, write publish record)

Voiceover runs in B1 (script is approved by then, so the spend is safe) and does not block image
iteration; audio-director needs VO timings and so stays in B2. Each stage = one `agent()` call
invoking the existing stage skill; each stage's exit condition = its artifact exists and passes
that skill's own gate. Workflow resume caching is the crash-recovery story.

### Gate 2: the shot board (new component)

Generator (part of the runner's tooling, reusable standalone) builds a self-contained HTML board
and publishes it as a **per-video artifact** (stable URL per video, republished on every iteration
round):

- **Cast & props section:** every reference in the video's `library/` — image, id, description.
- **Shot cards, in story order:** downscaled image (JPEG data-URI, ~480px, board stays well under
  size limits), shot id, the exact script lines the shot covers, intended motion from
  `shots.motion.json` (camera move / hold / rig flags), and any lint flags.
- Iteration loop: Daniel comments ("redo shot 43, change the costume") → agent regenerates via
  image-generation skill → board republishes to the same URL → repeat until Daniel says proceed.

### Thumbnail stage (closing the existing partial)

New small stage in B2: render the primary thumbnail concept from `metadata.json` into a real
1280×720 `assets/thumbnail.png` via the image-generation skill. Challenger concepts may be
rendered too (future A/B); only the primary is required for the gate.

### compliance-check (skill)

Mechanical + provenance. One report a human reads at Gate 3: `compliance-report.md` in the video dir.

Mechanical checks (hard pass/fail):
- `render.manifest.json` gates green (state=rendered, LUFS, duration, splice checks)
- `metadata.json` complete and API-valid (title/description length limits, tag count/length,
  category id, chapters monotonic and within duration)
- `privacy_status: "private"` and synthetic-media disclosure set
- Every licensed asset (music, SFX, CC-BY imagery) accounted for in a credit block present in the
  description; no orphan licenses
- `assets/thumbnail.png` exists, 1280×720

Provenance summary (judgment, warn-level): which research sources the script drew on, flagging any
passage leaning too hard on a single source. No deep plagiarism/IP audit in v1 (explicitly out of
scope — Daniel chose mechanical+provenance over the deep audit).

### publish-queue (skill)

Runs only after explicit approval at Gate 3, in a live session (T3 action):
- Maps `metadata.json` 1:1 onto the YouTube Data API upload payload; pushes `final.mp4` via the
  **youtube-uploader MCP**. Always `private`. Credentials never leave the MCP.
- Writes `publish-record.json`: video ID, URL, timestamp, uploaded metadata snapshot, file checksum.
- **Deliberately manual in Studio** (two clicks at a gate Daniel already attends; MCP can't do
  them): setting the thumbnail image, and flipping private→public whenever Daniel chooses.

### analytics-reporter (skill) + dashboard

- Small read-only Python client; OAuth refresh token in the already-reserved `.env` slots
  (`YOUTUBE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`), scopes: `youtube.readonly` +
  `yt-analytics.readonly`. Values never printed/logged (ambient-credential rule).
- Pulls per-channel and per-video metrics: views, watch time, avg view duration, retention curve,
  impressions CTR, subscribers gained. Writes plain JSON under
  `orgs/faceless-youtube/analytics/<channel>/` (raw pulls + rollups).
- Appends a digest per cycle to each channel's `performance.md` — closing the designed loop
  (idea-generator reads it to learn what worked).
- Dashboard generator renders one self-contained HTML page from the JSON — all channels, a tab per
  channel, per-video drilldowns, retention/CTR graphs — republished as a **Claude artifact at one
  stable URL**. `DASHBOARD.md` in the org carries the link. Refresh = one command now; a scheduled
  kb Routine later is a config addition, not a redesign. Data lives in files, so the dashboard is
  rebuildable anywhere if it ever outgrows artifacts.
- Freshness expectation: as fresh as the last run; YouTube's own analytics lag ~24–48h, so this is
  the right fidelity. Artifacts can't fetch externally (CSP) — data is baked in at generation.

## Data flow (new artifacts)

```
video dir:    assets/thumbnail.png, compliance-report.md, publish-record.json, shot-board (artifact URL noted in run report)
channel dir:  performance.md (digests appended)
org:          analytics/<channel>/*.json, DASHBOARD.md (stable dashboard URL)
kb:           memory/fyt-runner.md (agent lessons)
```

## Error handling

- Workflow spine: per-stage retry for transient failures (known case: Remotion delayRender flake
  under load — retry once before diagnosing); everything else fails the stage and wakes the agent.
- Agent repair mode: diagnose, fix, resume the cached run. Paid stages are never blindly re-run.
- Upload failures: publish-queue is idempotent — it checks for an existing `publish-record.json`
  and never double-uploads; partial-upload failure leaves no record and is safe to retry in-session.
- Analytics failures: warn and keep last-good dashboard; never publish a partial dashboard.

## Testing

- Every skill ships network-free tests against fixtures (fake manifests, canned API JSON),
  matching the org's existing test culture (voiceover/render suites).
- Board + dashboard generators tested on poyais's real artifacts (no network needed).
- Live test article: **poyais** — enters at B2's tail (thumbnail → compliance), then C once the
  channel + MCP auth exist. First full A→C run is the next new video.

## Build order

1. compliance-check (pure local reads; immediately testable on poyais)
2. Thumbnail stage
3. Shot-board generator (testable on poyais's shots + library)
4. publish-queue (MCP wiring + record)
5. analytics-reporter + dashboard (client, JSON store, generator, artifact publish)
6. FYT Runner agent + workflow segments (orchestrates all of the above; lands last)
7. End-to-end: poyais through B2-tail + C; then first fresh video A→C

## One-time human setup (Daniel)

- Create the YouTube channel(s)
- Authenticate the youtube-uploader MCP (in-session OAuth)
- Google Cloud: free OAuth client for the analytics scopes + one consent flow; paste refresh token
  into `.env` (~10 min)
- Note: the YouTube API audit (to ever allow API-driven public publishes) remains optional and
  unscoped here; Stage-0 law makes it unnecessary for now.

## Out of scope (v1)

- Deep originality/IP audit (deliberately traded down to mechanical+provenance)
- Scheduled/self-initiating production cadence (design supports adding a Routine later)
- Generic multi-project content-pipeline abstraction
- kb fleet-dashboard integration (explicitly excluded by Daniel)
- A/B thumbnail automation (concepts are ranked in metadata.json; Studio handles experiments)
