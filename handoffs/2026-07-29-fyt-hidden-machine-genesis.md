# The Hidden Machine — channel genesis handoff — 2026-07-29 (evening, supersedes morning version)

**Topic:** Task 7 is CLOSED (2026-07-29 late: 7e docs gate passed, batch committed 4650293, branch
pushed through 4650293, `_style-lab/` pruned per F-clean). Arc PARKED by Daniel; resume at Task 9.
Work lives in worktree `C:/Users/danie/kb-worktrees/hidden-machine` on branch
`claude/hidden-machine-genesis`. Plan:
`docs/superpowers/plans/2026-07-28-hidden-machine-genesis-plan.md`. Operating rules for the resuming
terminal are unchanged from the morning handoff (boss orchestrates, ≤Opus workers, model verified by
transcript grep at grading, media law §H, .env hard ceiling, voiceover.py only for TTS).

## Gate outcomes (Daniel, 2026-07-29)

1. **V5 verdict** — implicit pass ("Saw the poyais one"), then ordered V6 (MacGregor plaza) + V7
   (riverside ghosts), delivered clean at $0.80 each. NO explicit verdict on V5/V6/V7 — recorded in
   the style bible as supporting evidence, not a gate. V4 (card tap) remains the Daniel-liked reference.
2. **Register** — **R1 screen-print editorial, revocable** ("default... may change in the future").
3. **Voice** — **Chris `iP95p4xoKVk53GoZ742B`**, eleven_v3 @ ST's new dials (stability 0.20, style 0.6),
   picked over Eric in round 2 (fresh clips at those dials + colon→semicolon paragraph fix for the
   too-long pause). Committed 83ac22b with consistency-proof-owed note. 2×3 dial round SKIPPED by
   Daniel's direct pick.
4. **Register doubt arc (mid-session)** — Daniel worried R1 "might not be the play." Resolved by:
   comps research (no riso precedent in ANY explainer niche; two-mode design is the convergent pattern
   of mixed narrative+mechanism channels; LEMMiNO discipline makes stills watchable) + a $1 watchability
   probe (43s: V4 open + stills at cadence + hybrid frames + data card + Chris VO, Remotion-rendered).
   **Daniel passed it** ("fine for now, iterate later") → hybrid doctrine locked: R1 full-texture
   narrative + R6-clear-line-in-R1-inks mechanism mode (locked registration) + flat data-card module.
5. **Canonicals (7d)** — approved: everyman = **charD slim-urban editorial** (4-variant sweep after
   Daniel rejected the first parka figure), machine-hall (border-cropped), coffee-shop (=A1),
   street-corner (re-roll after Daniel flagged A4's floating window-hands), mechanism-cutaway (=probe
   N1). Committed 8b78427 with registry seed.
6. **7e docs (style-bible.md + visual-grammar.md)** — **PASSED** ("Fine for now", 2026-07-29 late).
   Committed 4650293, branch pushed through it. `_style-lab/` pruned same session: remotion install +
   104 files deleted; 17 survivors = spend ledgers, findings.md, notes.md, `*.attempt`/`*.uncropped`
   evidence, and `veo/V4.mp4` (kept — bible §9 cites the card-tap clip as the Daniel-liked motion
   reference; deleting it would orphan the anchor).

## What WORKED (with evidence)

- **Full-bleed fix round** — 5 register-board frames re-rolled full-bleed ($1.07); board artifact
  rebuilt same URL: https://claude.ai/code/artifact/a3895866-c345-4d62-8f67-95fdceb240ad (now carries:
  register round B + lock sweep + canonical/character sections).
- **7c lock sweep PASSED** ($1.47, 11 calls) — zero style/identity degradation across a 4-delta edit
  chain + re-anchor; borders only on fresh gens (3/9); STRONG full-bleed law fixed the vignette mode
  (n=1). Findings: `videos/_style-lab/lock-sweep/findings.md`.
- **Watchability probe** — `videos/_style-lab/watchability-probe/probe.mp4` (43.2s, h264 1080p,
  word-level sync spot-checked). Standalone Remotion project in `watchability-probe/remotion/`
  (Remotion 4.0.500, bundled ffmpeg — system ffmpeg still absent, winget question still undecided).
- **Deterministic Pillow crop kills border drift** — machine-hall + charB canonicals cropped clean;
  sanctioned into doctrine (bible §2c); uncropped originals preserved beside them.
- **7e docs authored (Opus, verified claude-opus-5 ×60)** — style-bible.md + visual-grammar.md,
  zero-ST-token grep clean, full traceability map in the worker's report. UNCOMMITTED, awaiting gate.
- All worker grades model-grepped (sonnet ×27/×50/×58/×98/×105/×162/×175 across the session's workers,
  opus ×60); every paid batch pre-approved and ledgered.

## What Did NOT Work (and why)

- **Baseline full-bleed law on fresh generations** — 3/9 border violations in the sweep; edit-chains
  had zero. STRONG law untested vs the uniform-border-ring mode (only vignette, n=1). Wide establishing
  exteriors are the worst offenders. Doctrine: prefer chains, budget retries on fresh wides, crop fallback.
- **R1-S3 + R6-S2 board frames** — residual borders after their one retry (thin ring / pillarbox).
  Accepted on the board; they are not canonicals.
- **ST audio pools are URL manifests** (`sources.json`), NOT local audio files — a probe music bed
  would have required external fetches; skipped. Task 9 (audio kit copy) must account for this.
- **render-builder Remotion engine has no video-clip shot type** and no npm install in this worktree —
  could not embed V4.mp4; the probe used its own standalone Remotion project instead.
- **`python` on this box lacks Pillow** — crashes gen scripts AFTER a billable call returns; always `py -3`.
- **charB/charC/charD first attempts** — framing/prop drift (knee crop, phone-for-card, clipped head),
  fixed on retries; evidence preserved as `*.attempt1.png` in `_style-lab/canonicals/`.

## What Has NOT Been Tried Yet (= remaining, ordered)

1. **Task 9** — audio kit: copy ST pools (attribution moves with assets; NOTE pools are manifests not
   files), fresh audio/motion tokens minus retired fields (`docs/retired-features.md`); haiku worker;
   `py -3 -m json.tool` validation.
2. **Task 10** — guardrails + capability-map (`production_pipeline: stylized-compositing`). PRE-GATES
   for Daniel: fact-ledger accuracy bar, topic exclusions, AI-disclosure stance (ST scratched it for
   animated register; HM needs its own call).
3. **Tasks 11–13** — idea backlog (idea-generator skill, `HM-###`, zero ST-overlap), channel page +
   TO-DEVELOP.md, close-out (STATUS/decisions/STATE/index.html/forge-friction; SPEND RECONCILIATION —
   spend-c.md running totals are per-section and inconsistent; recompute the true lab total at close-out).
4. Optional: validation batch for the STRONG law vs uniform-border-ring mode (bible §2c DRAFT);
   explicit V5/V6/V7 verdicts if Daniel wants the motion doctrine fully gated.

## Current State of Files (worktree `kb-worktrees/hidden-machine`, branch `claude/hidden-machine-genesis`)

| File | Status | Notes |
| ---- | ------ | ----- |
| Branch `claude/hidden-machine-genesis` | PUSHED through 4650293 | 83ac22b voice lock, 8b78427 canonicals+registry, 4650293 doctrine (7e batch: style-bible, visual-grammar, registry.json, refs/mode/data-card.png, dna.md) |
| `visual-kit/` (bible, grammar, registry, refs/) | DONE, COMMITTED | 6 canonicals in refs/: everyman, 3 envs, mechanism-cutaway, data-card |
| `videos/_style-lab/` (gitignored, disk only) | PRUNED (F-clean, 2026-07-29 late) | 17 survivors: spend ledgers, findings.md, notes.md, attempt/uncropped evidence, veo/V4.mp4 (cited bible §9 reference). Board artifact URL remains the visual record; its rebuild script was pruned with the source frames |
| `voice-lab/` | DONE | voice-lab.md committed through round-2 Chris verdict; mp3s disk-only |
| Main kb checkout | on `claude/boss-20260729` | PR #99 merged by a parallel terminal; bricks-fresh untracked artifacts belong to the fresh-story workstream (4d8ee25) |

## Exact Next Step

Dispatch Task 9 (audio kit, haiku worker — remember ST pools are URL manifests, not local files).
Task 10's three pre-gate questions (fact-ledger bar, topic exclusions, AI-disclosure stance) are the
next human gate after that.

## Load list

- `orgs/faceless-youtube/CLAUDE.md`, `orgs/faceless-youtube/operating-law.md` (§D spend, §E options, §F-git, §H media)
- `orgs/faceless-youtube/docs/superpowers/plans/2026-07-28-hidden-machine-genesis-plan.md` (tasks 9–13)
- `orgs/faceless-youtube/channels/the-hidden-machine/visual-kit/style-bible.md` + `visual-grammar.md` (the gate objects)
- `orgs/faceless-youtube/channels/the-hidden-machine/visual-kit/registry/registry.json` + `channels/the-hidden-machine/dna.md`
- `orgs/faceless-youtube/channels/the-hidden-machine/videos/_style-lab/lock-sweep/findings.md` + `watchability-probe/notes.md`
- Board artifact: https://claude.ai/code/artifact/a3895866-c345-4d62-8f67-95fdceb240ad (rebuild via
  `_style-lab/scripts/build_board.py` — its OUT path is session-specific, update before running)
- Worktree `C:/Users/danie/kb-worktrees/hidden-machine`, branch `claude/hidden-machine-genesis` — do not rebase away
