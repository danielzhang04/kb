# The Hidden Machine — channel genesis handoff — 2026-07-29

**Topic:** Boss-orchestrated first-pass infrastructure build for "The Hidden Machine" (hidden-systems channel, concept A1) in `orgs/faceless-youtube/`, per plan `docs/superpowers/plans/2026-07-28-hidden-machine-genesis-plan.md`. Session paused mid-Task-7/8 with two Daniel gates open. Work lives in worktree `C:/Users/danie/kb-worktrees/hidden-machine` on branch `claude/hidden-machine-genesis` (pushed to origin 2026-07-29).

## Operating rules for the resuming terminal (non-negotiable, from Daniel)

- Boss orchestrates; every substantive build goes to a ≤Opus worker (haiku mechanical / sonnet standard / opus taste-critical). Worker model VERIFIED by grepping the subagent transcript `~/.claude/projects/C--Users-danie-kb/<session-id>/subagents/agent-<id>.jsonl` for `"model":` — first line of every grade. The harness-reported `.output` path greps empty; use the projects path.
- Per-task PRE-GATES: ask ALL clarifying/taste questions BEFORE building. Post-task summaries. No content iteration without Daniel.
- Review media law (§H operating-law): images → Artifact with zoomable images (lightbox); video/audio → open in device player (`cmd //c start <path>`); files → VS Code. Daniel approved the auto-open-player behavior explicitly.
- Never handle credentials as objects. `.env` at repo root + worktree holds GEMINI_API_KEY + ELEVENLABS_API_KEY (Daniel recreated them after an earlier loss episode — NEVER read/copy/create/sweep .env). `scripts/hooks/hard_ceiling_guard.js` blocks Bash touching .env — load env inside Python only (see `load_env` in the lab scripts).
- Voice generation ONLY via `.claude/skills/voiceover/scripts/voiceover.py`; never hand-rolled TTS calls. Read-only GET /v1/voices discovery is fine.

## OPEN DANIEL GATES (present one at a time, in this order)

1. **V5 verdict** — Poyais ship-deck Veo clip (`videos/_style-lab/veo/V5.mp4` under the-hidden-machine) was opened in his player right before pause; no reaction captured. It's the 40-character on-model stress test on ST's own style. Ask for the verdict first; fold into motion doctrine.
2. **Register pick from the 6×3 round-B board** (tabled by Daniel "for one sec", never returned). Artifact: https://claude.ai/code/artifact/a3895866-c345-4d62-8f67-95fdceb240ad — R1 + R4 carried over un-regenerated, challengers R6 clear-line cutaway / R7 linocut noir / R8 gouache storybook / R9 flat paper collage, same 3 scenes each. On-record boss recommendation: R9 first, R6 second, hybrid legal (one register as base world + R6 cutaway grammar as composition rule).
3. **Voice ear gate round 1** — 5 clips in `channels/the-hidden-machine/voice-lab/auditions/round-1/` (01-roger, 02-eric, 03-chris, 04-george, 05-bill; all ElevenLabs premades — fingerprint caveat given, round-1b shared-library dig is a legal alternative). He picks 2 finalists → round 2 = 2×3 fresh dial variants (never ST's 0.20/0.6 dials) → lock into dna.md §Voiceover. Gated answers already given: warm male mid-30s+, test paragraph approved, lean 5→2×3 spend.

## What WORKED (with evidence)

- **Register round B board (6×3)** — 12 new images `_style-lab/register/R6-S1..R9-S3.png` all 1376×768; artifact rebuilt and published same-URL. Spend: 14 billable calls $1.876 (2 duplicate calls from a retry race, logged in `_style-lab/register/spend-c.md`). Board findings: R9 is the only fully clean full-bleed style; R6-S3 best theme-fit image of the lab; R7 all render as photographed prints; R8 has postcard/letterbox framing drift.
- **Motion recipe proven twice** — single anchor frame + directed prompt + style-lock clause on Veo 3.1 Fast (`veo-3.1-fast-generate-preview`, $0.10/s, 8s max, native audio):
  - V4 = Daniel's card-tap prompt verbatim on R1-S1, 54.3s latency, $0.80. Daniel liked it ("No it's good"; "there was another video I saw that wasn't anywhere near as good" = V1/V2 keyframe interpolation).
  - V5 = ST Poyais superseded frame L54 (ship-deck ~40 characters), directed beats (doctor nod+bag grip, LAW-book hug, baby rock, crowd sway, ambient ocean/creak/gulls), 53.8s, $0.80. Verdict pending (gate 1).
- **Doctrine finding**: single-frame + prompt BEATS first+last-frame interpolation when keyframes aren't canon-locked — interpolation inherits keyframe flaws. Candidate doctrine line at register lock.
- **Full-motion cost model** (told to Daniel): 8-min full-motion = 60×8s ≈ $48 Veo + $8.04 anchors + ~25% retakes ≈ $56–70/video; hybrid (15–20 motion-worthy beats) ≈ $15–25/video. Hybrid band is the candidate doctrine number.
- **Voice lab round 1** — 5 auditions delivered under lean cap, ID3-verified >348KB each; `voice-lab/voice-lab.md` committed (12e6397). Miles `vSjOBQp24DUB2COr2xI9` permanently excluded.
- **Veo REST quirks nailed down** (in `_style-lab/scripts/veo_probe_step2_generate.py`): image field is `{bytesBase64Encoded, mimeType}` NOT `inlineData`; `numberOfVideos` rejected; `durationSeconds` must be JSON number; `lastFrame` requires `durationSeconds: 8`; bills only delivered output.
- **Grades transcript-grepped**: register-B worker claude-sonnet-5 ×92; voice worker claude-sonnet-5 ×69.

## What Did NOT Work (and why)

- **First+last-frame Veo interpolation (V1/V2)** — visibly worse because the flick keyframes weren't canon-locked; do not retry until frames are canonical.
- **Register-B worker relaunch race** — worker relaunched the gen script on an apparent hang (WinError 10054 stall) without killing the first run → skip-check race → 2 duplicate billable calls (R9-S2/S3). Lesson: kill before relaunch.
- **`shared-voices` search** — HTTP 400 on the filter combo used; only account premades auditioned. Round-1b would need a different query shape.
- **voiceover.py outside a channel** — requires dna.md two dirs up; worker used disposable `channels/_audition-tmp-hm-r1/` scaffold, then deleted it (verified gone). Real dna.md untouched (dna edit only at voice lock).
- **Round-B prompt drift (flagged, NOT re-rolled)**: R6-S1 diagram arrows + thin border despite no-labels rule; R6-S2 portrait insert; R7 photographed-print framing (worst R7-S1); R8-S1 postcard frame, R8-S2 letterbox. → a **full-bleed / single-panel law** must be written into the register lock.
- **Daniel's 10s clip ask** — Veo caps at 8s; ran 8s, told him.
- **ffmpeg absent on machine** — Pillow GIFs used instead; `winget install ffmpeg` offered, undecided.

## What Has NOT Been Tried Yet (= remaining plan tasks)

After the three gates clear, per plan `docs/superpowers/plans/2026-07-28-hidden-machine-genesis-plan.md`:
- **Task 7c–7e**: register lock sweep (write full-bleed/single-panel law; consistency probe in the locked register via iterative-edit-chain — Nano Banana `gemini-3-pro-image` 2K $0.134/img, consistency comes from prior-frame-as-input + delta instruction, big deltas re-anchor on canon refs), canonical anchors → `refs/` + `registry.json`, style-bible + visual-grammar (OPUS worker). Also: lock motion doctrine (single-frame+prompt recipe + $15–25 hybrid band), re-run a V4-style proof in the LOCKED register, then `_style-lab/` prune (F-clean, only at lock).
- **Task 8 finish**: finalist round 2×3 dials → dna.md §Voiceover.
- **Task 9**: audio kit — copy ST pools, fresh tokens minus retired fields (per `docs/retired-features.md`), haiku worker, `python -m json.tool` validation.
- **Task 10**: guardrails + capability-map (`production_pipeline: stylized-compositing`); PRE-GATES: fact-ledger accuracy bar, topic exclusions, AI-disclosure stance (note: AI-disclosure was scratched for ST's animated register — HM needs its own call).
- **Tasks 11–13**: idea backlog via idea-generator; channel-page draft + TO-DEVELOP.md; close-out (STATE/decisions.md/forge-friction log incl. .env-sweep failure, relaunch-race duplicate billing, false security flag; memory lessons; spend reconciliation).
- Fix F5 hair-flip / F3 pulse-hides-card when canonicalizing flick frames.
- Verify researcher honors `research_scope: capped-to-descent-chain` before first video.

## Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| worktree `kb-worktrees/hidden-machine`, branch `claude/hidden-machine-genesis` | WIP, pushed | Commits through 12e6397 (voice-lab.md). **At PR time: rebuild branch clean — cherry-pick ONLY genesis commits; foreign commits fb3df37/38f25b4/814765d/8377de2 belong to another effort.** |
| `channels/the-hidden-machine/` (dna.md, storytelling-grammar.md, reference-channels.md, idea-backlog.md, ...) | DONE (tasks 1–6) | Identity/doctrine/format/grammar locked by Daniel 2026-07-28 |
| `channels/the-hidden-machine/videos/_style-lab/` | WIP, **gitignored — disk only** | register/ (R1..R9 PNGs + spend-c.md), veo/ (V1–V5.mp4 + spend.md), flick/, scripts/ (all session lab scripts + board HTML, copied for persistence) |
| `channels/the-hidden-machine/voice-lab/` | WIP | voice-lab.md committed; 5 mp3s gitignored, disk only |
| Register board artifact | DONE | https://claude.ai/code/artifact/a3895866-c345-4d62-8f67-95fdceb240ad (rebuild via `_style-lab/scripts/build_board.py`, same file path → same URL) |
| Spend ledgers | WIP — **reconcile at close-out** | veo `spend.md` per-call rows authoritative; running-total columns understate (register-B $1.876 lives only in spend-c.md). True lab total ≈ $10.038 (register A $2.010 + B $1.876 + palette/flick/veo chain through V5 $0.80 each for V4/V5). Recompute cumulative at close-out. |
| ST Poyais frames | note | Production L*.png gone from repo; only `_superseded-2026-07-16/` and `_superseded-2026-07-18-r10/` survive (V5 used r10 L54.png) |

## Exact Next Step

Open with gate 1: ask Daniel for his V5 verdict (offer to reopen `...\the-hidden-machine\videos\_style-lab\veo\V5.mp4` in his player). Then gate 2 (register pick from the artifact board), then gate 3 (voice finalists). Do not build anything until the register gate clears — everything in Task 7c+ depends on the pick.

## Load list

- `orgs/faceless-youtube/_index.md`, `STATE.md`, `contract.md` (project preamble)
- `docs/superpowers/plans/2026-07-28-hidden-machine-genesis-plan.md` (the plan; tasks 7–14)
- `docs/superpowers/specs/2026-07-28-hidden-machine-genesis-design.md`
- `orgs/faceless-youtube/operating-law.md` (§D spend gates, §E options, §F-git, §H review media law)
- `orgs/faceless-youtube/channels/the-hidden-machine/dna.md` + `storytelling-grammar.md`
- `orgs/faceless-youtube/channels/the-hidden-machine/voice-lab/voice-lab.md`
- Worktree-only (disk): `channels/the-hidden-machine/videos/_style-lab/scripts/` (gen + veo + board scripts), `register/spend-c.md`, `veo/spend.md`
- `memory/claude-boss.md` (2026-07-29 lessons section)
