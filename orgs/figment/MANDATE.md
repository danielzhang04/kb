# figment — mandate (operator's end goal, stated 2026-09-03)

This file is the standing definition of what figment is building. Every spec, plan, and worker
brief derives from it. GUARDRAILS.md still binds on top of it. Edited by the operator or the boss
session only.

## End state

An end-to-end automated pipeline that starts from ONE reference image of a fictional adult woman
and ends with continuously researched, monitored, and optimised accounts: Instagram first,
other social platforms as they earn it, and a Fanvue-class paid platform. Two content tiers from
one identity: Instagram-level (clothed/swimwear ceiling) and explicit (paid tier). Several
creators over time, each from her own reference image, run from one dashboard.

## The pipeline, stage by stage

1. **Anchor** — operator supplies the reference image (fictional, adult, cull-checked). It is
   the persona's identity source of record.
2. **Identity expansion** — one-reference conditioning (FLUX.2 klein 4B Base native path) into a
   balanced multi-view set; automated identity scoring; operator eye-gate.
3. **Persona LoRA** — trained on the expansion set. Scope of the LoRA: the face under motion
   (video frames), every camera angle and distance, body shape and proportions clothed, minimally
   clothed, and unclothed at various angles, so the identity holds across both tiers. See the
   tier constraint below for WHERE each part of that set is generated and trained.
4. **Register lock** — the operator's look (see `pipeline/look-spec-v2.md`, operator taste
   anchor) held as settings on top of the LoRA: makeup, skin finish, body, lighting families,
   wardrobe families. Calibration grids live here.
5. **Image generation with passes** — base render → face detailer → consistency check against the
   anchor (automated identity + register scoring) → upscale/detail pass → skin-texture pass
   (restore pores, micro-contrast, grain, phone-sensor character; any "skin enhancer" tool is
   kept only if it ADDS texture and dropped if it smooths or relights toward gloss) →
   mandatory visual QA → quarantine and regenerate failures. "Perfect or culled," never "good
   enough." Research stream: open face-detailer / image-detailer / de-gloss repos and ComfyUI
   nodes (Impact Pack FaceDetailer, skin-texture LoRAs, film-grain and sensor-simulation
   nodes, upscalers), evaluated on our outputs, licence-checked.
6. **Video generation with passes** — image-to-video (Wan 2.2 self-hosted backbone; Kling/Veo for
   the Instagram tier where terms allow) with the same detail, consistency, and QA passes on
   frames; face holds under motion. Video consistency and templates are first-class: research
   stream on identity-preserving I2V, frame-level face detailing, temporal de-gloss, and reel
   templates (formats, lengths, cuts, audio beds) built as reusable manifests.
7. **Content strategy from research** — what goes viral in the reference cohort: image types,
   account aesthetics, video formats, thirst-trap patterns, settings, trending audios, comment
   patterns, posting frequency, dances; per platform. Continuous, not one-off.
8. **Post and measure** — official APIs with AI disclosure set; per-account tracking, analytics,
   link-click and funnel attribution, revenue; audience AI-suspicion logged as signal.
9. **Optimise** — metrics feed the next batch's content mix and the research loop; the system
   runs unattended between operator gates.

## The dashboard

One working dashboard in the 10sorlabs "studio" shape rather than a status page: generate,
edit inputs, run flows, review QA boards, approve, schedule, post, and track analytics for every
account from one place. It runs on the kb agent architecture (same agents, same cards, same
ledgers) — either as a figment surface inside the kb VM dashboard or as a figment app that
drives the kb agent architecture directly; decide in the spec. Account tracking and analytics
are first-class views, not add-ons.

## Research streams (standing, not one-off)

- **Reference-cohort content analysis** — the inspiration board accounts and additions: which
  posts, formats, settings, and captions produce reach, saves, comments, link clicks; account
  aesthetic patterns; posting cadence. Read-only study per GUARDRAILS; evidence recorded with
  dates.
- **Platform trend research** — audios, hashtags, formats, dances, comment behaviour, frequency
  norms, per platform, refreshed on a cadence.
- **Tooling watch** — models, adapters, detailers, video engines, consistency tools; 10sorlabs
  and Eromify-class stacks as pattern references (never as dependencies).
- **Fanvue economics and operations** — pricing tiers and bundles, free+PPV vs subscription,
  price points, post cadence, what post types and formats get paid (from public counts,
  prices, creator reports, agency playbooks), profile/preview setups, messaging cadence and
  tone playbooks, funnel conversion. Public and read-only; explicit content itself is scored
  by the operator or a local model against the operator's rubric, never by Claude.
- **10sorlabs package (purchased 2026-09-03)** — modules, setup links, teaching videos, and
  playbooks at https://webpanel.10sorlabs.com/ (operator's account, signed in in his Chrome).
  Fold it into learning, research, infrastructure, and structuring across the board: read every
  module read-only, summarise into `research/r14-10sorlabs-package.md` (module map, workflows,
  settings, playbooks, tool list), and turn what applies into our own manifests and templates.
  Operator ruling: the build terminal has FREE REIN over the package — comb every module,
  follow every external link, download the package's own files (workflows, configs, guides,
  playbooks, infra notes) into `orgs/figment/research/10sorlabs-package/` (gitignored bulk;
  notes committed), watch and analyse the videos (claude-video-vision skill), and use all of
  it for research, building, infrastructure, and structuring. Rules: licensed content — notes
  and derived implementations in the repo, no verbatim redistribution; every linked package or
  install command is verified on its registry before use (the `npx eromify-mcp` lesson); its
  "skin enhancer" pass ADDS detail (operator confirmation 2026-09-03), so it is a candidate
  stage-5 detail pass to adopt and verify on our outputs; a separate de-gloss step handles
  renders that come out glossy.

## Operating principles for the build terminal (operator ruling 2026-09-03)

- **Parallelise wherever it does not hurt workflow or quality**: independent research
  streams, independent builds, and pods run concurrently; serial only where an output feeds
  the next step (anchor → composite → expansion → LoRA) or where a human gate sits.
- **Independent adversarial review and testing throughout**, not at the end: every unit of
  spend-controlling, identity-scoring, or posting code gets an adversarial review by a
  separate agent plus tests before it runs live; research gets claim-checks; images get
  mandatory visual QA. Reviews are by a different model/session than the author.
- **Smart, slim design**: files, skills, manifests, and agents carry only what changes
  behaviour; no bloat, no duplicate docs, no speculative abstractions. Prefer one
  well-named file over five thin ones; prefer extending an existing harness key over a new
  tool. Every new skill or script justifies itself by a stage it serves.
- **Research before training (operator ruling 2026-09-03)**: the 10sorlabs package pass
  (modules, videos, playbooks, downloads — especially module 11 training, module 10 dataset
  generation, module 16 prompt guide), the identity/tuning research, and the detailer/de-gloss
  research are completed and folded into the spec BEFORE any expansion or LoRA training pod
  runs. Pods for training come after the reading, not in parallel with it.
- **Stop rules**: human gates (anchor/composite pick, identity grid, register proof, batch
  approval, anything explicit-tier, any spend past a manifest ceiling) stop the run; the
  terminal parks the state, writes what it has, and waits.
- **Template catalogue** — Eromify's, 10sorlabs', and other public template and format
  catalogues studied as patterns and re-implemented natively (carousel types, posting
  templates, content mixes); nothing installed from them.

## Content-mix and carousel capability (built-in, both tiers)

Carousels and multi-format posts are first-class: a content-mix taxonomy per account (the
persona at angles, lifestyle, food, room, outfit flatlays, audience-liked aesthetic filler),
slot templates per carousel type, ordering and caption rules, generation of the non-persona
images with the same models and QA, and per-platform variants (Instagram, TikTok, Fanvue).
The research streams decide the mixes; the dashboard exposes them as editable templates.

## Voice (per creator, trained)

Each creator has her own voice, as real as the state of the art allows: a synthetic reference
voice designed for the persona (never cloned from a real person), then a per-creator
voice model (fine-tune or few-shot clone on an open-weight TTS with voice cloning), evaluated
blind against real phone-audio clips for naturalness, breath, and cadence; lip-sync for
talking video via an open lip-sync model; the same QA discipline (automated scoring + eye/ear
gate) as images. Research stream: current open-weight voice-cloning TTS and lip-sync models,
licences, quality reports; template library for voice-led formats (talking reels, voice notes,
DM voice replies on the paid tier via the local-model path).

## Fanvue automation (later stage)

Same identity, same pipeline, the explicit tier per the constraint below: content generation
from operator-authored templates, automated QA (identity, register, compliance classifier,
age gate), a local open model for captions and in-loop judgment where needed, scheduled
posting and messaging through the platform's supported channels, analytics back into the
optimisation loop.

## Tier constraint (binding, from GUARDRAILS #3 and the W0 board)

Rented compute (RunPod, fal, Replicate, Modal) prohibits adult content. Therefore: identity
expansion, LoRA training, and generation for the Instagram tier may run on pods; every
unclothed or explicit image — including the unclothed portion of the LoRA training set and the
training run that includes it — is generated and trained on operator-controlled hardware only,
by the operator. Agents build and test that path with clothed data; the operator runs it.
Separate stores, prompts, and accounts per tier.

## Budget (operator ruling 2026-09-03)

The overnight build terminal has a HARD CAP of **$50 total** for the creator-001 arc
(expected far lower). Enforcement: every pod through the harness with `--max-usd`; the
harness daily guard reads `governance/budget.yaml` (operator raises `daily_usd_limit` for the
run); the harness arc cap sums every `ledgers/cost/figment-*.tsv` row and refuses a create
that would exceed $50; every row published to `ops`. Zero spend on any platform (see
GUARDRAILS research-browsing ruling).

## What exists today (2026-09-03)

- Pod harness with spend guards, HTTP transport, QA toolkit, calibration driver, training
  scaffolding, identity checker: `pipeline/` (branch `claude/figment`).
- Research r1–r13 in `research/`; look-spec-v2 and the operator taste anchor in `pipeline/`.
- Model decisions: Z-Image (look) + FLUX.2 klein 4B Base (identity) on RunPod; Wan 2.2 for video.
- Open provisioning items: Fanvue written confirmation; Instagram professional test account +
  Meta token (Test 0); owned GPU for the explicit tier.

## Next

Operator supplies the anchor image. Next session opens with the architectural brainstorm and a
written spec for creator 001 end to end (stages 1–9 + dashboard), then the plan.
