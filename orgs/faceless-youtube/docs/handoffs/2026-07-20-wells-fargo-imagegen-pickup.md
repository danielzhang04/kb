# Pickup — 2026-07-20 — wells-fargo image-generation (fyt-run-001)

**State: Pass 1 COMPLETE. Pass 2 NOT STARTED — halted at a spend gate, needs Daniel.**

## What ran

`image-generation` on `channels/the-second-take/videos/2026-07-19-wells-fargo`, scoped by the
conductor to long-form + the 3 thumbnails (shorts S01-*..S05-* deferred to a later run).

- Pass 0 skipped — `needed_assets` is empty.
- **Pass 1 complete: 3/3 new cast locked** — `kovacevich`, `stumpf`, `tolstedt` in
  `assets/library/` + `manifest.json`, seeded off `refs/base/base.png`, `--mode new_character`, `2:3`.
  `stumpf` took the one allowed re-authored retry (drawn ears); the other two shipped on gen 1.
- **4 API calls, ~$0.54.** Full per-round reasoning, crop evidence and the two portable lessons are in
  `assets/image-gen-lab.md` (that path is gitignored, so it lives on disk only — read it there).
- Pass 2 (119 long-form scenes + 5 plate/cutout pairs + 3 thumbnails, ~130 calls, **~$17–18**) was
  **not started**.

## Why it stopped

The batch breaches the repo's money law three ways, independently:

| Law | Says | This batch |
| --- | --- | --- |
| `governance/budget.yaml` | `daily_usd_limit: 5.00` | ~$17–18 (~3.5×); the 200-call ceiling is ~$26.80 (>5×) |
| `governance/risk-tiers.md` | T4 real money = "never unattended, never carded" | cannot be delegated to a card at all |
| `contract.md` | `acts-alone` = STATE.md/wiki/DRAFT reports only; "daily budget breached" is `wakes-me-up` | squarely `queues-for-me` |

The run brief stated the owner had authorised this run's API spend and that it was "recorded on the
run's parent card". **No such card exists** — `queue/{inbox,working,approvals,done}` holds only cadence
cards, one verify card and one wake-me card; nothing references `fyt-run-001`, `ST-033`, or this video.
`STATE.md` does name fyt-run-001 as the next planned run, so the run itself is expected — it is the
**spend authorisation** that is missing, and per risk-tiers a card could not carry it anyway.

The 4 calls already spent are inside the daily limit and were the operating-law §D
"confirm the step is correctly configured before a batch run" probe.

## Decision Daniel needs to make

Pass 2 needs an attended, explicit go-ahead for **~$17–18 of Gemini image spend against a $5/day
ceiling**. Either raise/waive the ceiling for this run, or split Pass 2 across days inside the $5 limit
(~37 images/day, ~4 days), or defer.

## Corrections to project docs (found while checking, not yet applied)

- **`knowledge/stack.md` spend-log row for Gemini is stale.** It records image gen as blocked on the
  free tier (429, needs billing) as of 2026-07-03. **The key now generates** — 4/4 calls returned images.
  Worth correcting, and the row still says "log actual spend here as it accrues" while carrying no
  actual image spend for the Poyais run either.
- **`governance/budget.yaml` at $5/day cannot fund one video.** `stack.md` itself budgets
  "**~$15–30 per full 8–15 min video all-pro** (~120–180 gen calls)". So the daily limit and the
  documented per-video cost are in direct contradiction — *any* full video run trips the ceiling. That
  is a governance question for Daniel, not something to route around per video.

## Resume instructions (no rework needed — Pass 1 output is durable)

1. Seed each `cast` figure from `assets/library/<name>.png` + its `pose_ref`/`expression_ref`. All 8
   refs the cast arrays name resolve by registry **`name`** (not `tag`) — verified present.
2. **Prefix every staging name** (`wf-L01`, …). `visual-kit/_staging/` still holds Poyais frames named
   `L01.png`–`L125.png`, and `forge.py gen` skips a name already in staging — unprefixed Wells Fargo
   gens would silently inherit Poyais art and `place` would copy it into this video. Place, then rename
   to `scenes/<shot-id>.png`.
3. 6 shots carry `cast` (L27, L81, L94, L96, L105, L109). The other 113 are character-free technique (c)
   and each needs a style-anchor seed (`refs/env/` anchor matched by register).
4. 88 shots carry authored text → also seed `refs/env/lettering-marker-italic.png`.
   14 are crowd-bearing → also seed `refs/base/crowd-exemplar.png`.
5. 12 delta-chain shots in 6 chains must generate in order:
   L05→L06 · L07→L08 · L11→L12→L13→L14 · L33→L34→L35→L36 · L37→L38 · L77→L78→L79→L80.
6. 5 layered shots (L31, L44, L90, L99, L101) need plate + magenta-field cutout; cutout gens must not be
   16:9 (`forge.py cutout` hard-errors at ≥1.5 aspect).
7. Long-form scenes are `16:9` — pass `--aspect 16:9` explicitly on every scene/plate gen (forge
   defaults to `2:3`).
8. Then the one batched review (3 concurrent subagents: identity/rig on the crop battery, fidelity,
   style), one re-authored retry per flagged frame, orchestrator-only `verified` stamping.

## Untouched, as required

`videos/2026-07-04-poyais` (parked at Daniel's watch-through gate 6) and the channel `registry.json`
were not modified. The three new characters were deliberately **not** promoted to the channel registry —
Wells-Fargo-specific executives, unlikely to recur.
