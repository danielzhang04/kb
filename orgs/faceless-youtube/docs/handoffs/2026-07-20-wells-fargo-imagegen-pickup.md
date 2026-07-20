# Pickup — 2026-07-20 — wells-fargo image-generation (fyt-run-001)

Card: `queue/working/6a5d53ea-aac22743.md` (`build:scene-images`, T2, workflow `fyt-run-001`).

**State: Pass 1 COMPLETE (3/3 cast locked). Pass 2 in progress.**

## Authorisation (checked, holds)

The parent card `queue/working/6a5d53ea-562cad3a.md` (`build:video-run`) records Daniel's verbatim
2026-07-19 instruction and explicitly authorises **one video's standard pipeline API usage
(ElevenLabs TTS + Gemini image gen, ~$15–30 per `knowledge/stack.md`)** on the ambient `.env` keys,
scoped prompt→render, no publish, no Poyais changes. `scripts/preamble.py` returns **PREAMBLE OK**
(today's cost ledger is all `0.0` — subscription steps — so the `budget.yaml` API-billed daily gate is
untouched).

> **Process note for future runs — I got this wrong first.** I initially searched `queue/` from the
> `C:/Users/danie/kb` worktree, which sits on `codex/dashboard-operational-surfaces`, and concluded no
> authorising card existed. **Coordination state lives on `ops`** (kb constitution, Branch rules) — the
> `ops` queue holds the whole `fyt-run-001` DAG. Always read `queue/` from an `ops` checkout
> (`kb-worktrees/dashboard-ops`) before concluding anything about a card's existence.

## Standing governance observation (for Daniel — not a blocker)

`governance/budget.yaml` sets `daily_usd_limit: 5.00` for API-billed steps, while `knowledge/stack.md`
budgets **~$15–30 per full video** (~120–180 gen calls). Those two numbers cannot both hold: no complete
video fits inside one day's ceiling. The preamble gate passes here only because the cost ledger records
subscription steps at `0.0` and image spend is not currently written to it at all. Worth reconciling —
either raise the ceiling, formalise a per-run waiver, or start logging image spend to the ledger so the
gate measures something real.

## Pass 1 outcome — 3/3 locked, 4 calls, ~$0.54

| Character | Gens | Verdict | Shots |
| --- | --- | --- | --- |
| `kovacevich` | 1 | PASS, no retry | L27 |
| `stumpf` | 2 (1 retry) | PASS on retry | L81, L96 |
| `tolstedt` | 1 | PASS, no retry | L94, L96, L105, L109 |

Seeded off `refs/base/base.png`, `--mode new_character`, `2:3`, style-only descriptor + auto-appended
§2c RIG-HOLD. Per-asset detail in `assets/library/manifest.json`; per-round reasoning and crop evidence
in `assets/image-gen-lab.md` (both under the gitignored `assets/` tree — on disk only).

**Not promoted to the channel registry** — Wells-Fargo-specific executives, unlikely to recur, so they
earn a per-video library slot only (skill Pass-1 step 6 criterion). `registry.json` untouched.

### Two portable lessons (candidates for the bible / VPW rules — need human confirmation, §G)

1. **Cut a comparison crop against the approved canonical before ruling a nose/ear FAIL.**
   `kovacevich` gen 1 looked like it had a nose; a deterministic midface crop beside
   `refs/base/base.png` showed the *canonical carries the identical shape* (the rig's chin/lower-lip
   detail, below the mouth). Bible §3 already says to judge against the canonical, not an idealised rig,
   and that over-calling costs as much as missing. The crop is free; the regen is not.
2. **On a no-ears rig, never author a receding/thinning hairline.** `stumpf` gen 1 used "THINNING
   silver-white hair, higher at the temples"; that exposed the flat side of the head and the engine
   filled it with fully-drawn ears (inner helix visible at 3–4×). The re-authored retry carried age on
   **build, brow and mouth linework** and authored the hair as a **full side-covering sweep from temple
   to jaw** — ears gone in one gen.

## Pass 2 — scope and mechanics

Conductor scope: **long-form + the 3 thumbnails only**; shorts (S01-*…S05-*) deferred. 200-call ceiling.

- 119 long-form shots, all `source: ai-gen`, `aspect_ratio` **16:9** — pass `--aspect 16:9` explicitly on
  every scene/plate gen (`forge.py` defaults to `2:3`).
- 6 shots carry `cast` (L27, L81, L94, L96, L105, L109) → seed `assets/library/<name>.png` + the shot's
  `pose_ref`/`expression_ref`. All 8 refs the cast arrays name resolve by registry **`name`** (not
  `tag`) — verified present.
- The other 113 are character-free technique (c) → `--mode environment`/`style`, each carrying a
  style-anchor seed (`refs/env/` anchor matched by register; forge hard-errors an unseeded env gen).
- 88 shots carry authored text → also seed `refs/env/lettering-marker-italic.png`.
- 14 crowd-bearing shots → also seed `refs/base/crowd-exemplar.png`.
- 12 delta-chain shots in 6 chains, generated in order:
  L05→L06 · L07→L08 · L11→L12→L13→L14 · L33→L34→L35→L36 · L37→L38 · L77→L78→L79→L80.
- 5 layered shots (L31, L44, L90, L99, L101) → plate + magenta-field cutout; cutout gens must **not** be
  16:9 (`forge.py cutout` hard-errors at ≥1.5 aspect).
- 3 thumbnails (primary + 2 challengers), 16:9, text overlay NOT baked.

**Staging-name collision — load-bearing.** `visual-kit/_staging/` still holds Poyais frames named
`L01.png`–`L125.png`. `forge.py gen` **skips a name that already exists in staging**, so unprefixed
Wells Fargo gens would silently no-op and `place` would copy *Poyais art* into this video. Use a `wf-`
prefix on every staging name, then place and rename to `scenes/<shot-id>.png`.

Then the one batched review (3 concurrent subagents: identity/rig on the crop battery, fidelity, style),
one re-authored retry per flagged frame, orchestrator-only `verified` stamping.

## Untouched, as required

`videos/2026-07-04-poyais` (parked at Daniel's watch-through gate 6) and the channel `registry.json`.
