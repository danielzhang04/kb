# bricks 6c2 slice complete — 2026-08-07

**Topic:** Phase 6c slice 2 (second tenth, shots L26–L50) driven from the crashed prior terminal's
resume point to the machine limit: 19/19 STEP-1 figure cards verified, **23/25 scenes verified +
promoted, 2 parked with mechanism diagnoses**, spend **$2.301/$5.00** (ledgered on ops c8fa4e1).
Branch `claude/bricks-doctrine-reset` @ **2495d8c** (pushed, remote == local). PAUSED at Daniel's
R-A..R-E gate on the standing board URL. Supersedes `2026-08-06-fyt-bricks-p6b-gate.md` (consumed,
deleted in this push — p6b's P1–P5 were ruled and are logged in `knowledge/decisions.md`).

### What WORKED (with evidence)
- **Takeover protocol** — prior terminal died mid-run (retry cards minted 23:06, no verdicts);
  8-min quiescence monitor on `_staging`/scratchpad confirmed it dead before seizing. Zero collisions.
- **Forge texture-strip mechanism fix** — micro-pattern adjectives ("quilted"…) stripped at
  `figure_card_payload` (NOT `costume_clause` — that feeds `costume_key` hashing; stripping there
  would have silently renamed/re-minted every performer card). 211→213 tests green, zero name churn,
  L32 card then passed first-try after 2 prose retries had failed. Evidence: commit ede2f56,
  `test_forge_seed_requirement.py`, `6c2-genlog.md`.
- **Wave 2 minting via `6c2_drive.py`** — 24/25 first session (L38 8×503), stragglers landed via a
  bounded background re-driver loop (cycle 5, ~50min outage). All 503s billed $0.
- **Two disjoint fresh-eyes verifiers + ONE stamping writer** — no `review.json` races; every verdict
  measurement-backed (pixel line-weights, ink hue/R−B, px-diff vs parents). Records:
  `6c2-w2verify-a/b/r1/r2.json`.
- **Surgical retry wave 8/8 pass, zero re-roll regressions** — corrective one-span replaces built
  from verify records (`6c2-w2retry.overlay.json`).
- **L49 root fix** — shots.json prose pinned a navy suit contradicting the canonical brown
  (generator obeyed prose); fixed at prose + logged in decisions.md, retry then passed.
- **Board** — `scratchpad/_build_6c2_board.py` → standing URL
  https://claude.ai/code/artifact/767b9074-aee3-4d3d-817f-1319f2187325 (23/25, parked cards show
  live-parsed diagnoses, R-A..R-E on top). Asserts fail-loud on manifest counts.

### What Did NOT Work (and why)
- **Tone/scale/spatial-relation prompt instructions** — content instructions landed 8/8 (strip the
  rack, blank the bucket, dress him brown); "warm ink" measured no-op ×3 (children track the L28
  seed's ink: seed +3.0 → children +1.1…+2.1 vs cards +19…+42), "small and muted" made the bucket
  MORE saturated, "shaft beside him" failed twice, "stage-LEFT" landed 8% off. Express correctives
  as objects+states; relative position needs a mechanism.
- **Delta mechanism holds place, not face** — place held 0.00–0.11% px in every chain child; one
  head redrawn 30–38%. L34 FAIL proved the cause is a SPEC GAP: `seed_roles` never assigns
  expression authority, so one spec resolved it oppositely per figure (ibm-suit ← parent,
  miniscribe-rep ← canonical). Do NOT re-roll L34 — fix the preamble.
- **Re-roll collateral (1 case)** — L39-fix landed 3/4 correctives but drew a nose+ear on a
  previously rig-clean face. Whole re-roll risks the landed staging; face-only corrective next.
- **Scene retry mechanism limits** (hit repeatedly, all by design): `_retry_scene` forbids additive
  `instruction` (one exact replace-span only), `_EXPRESSION_RETRY` bans expr-vocabulary in spans,
  retries may not be named for their canonical shot (`name == shot` refused), `_is_scene_seed()`
  only resolves `assets/scenes/` paths (adding a _staging seed = refused as additive), and a scoped
  rebuild SILENTLY DROPS a place seed whose plate isn't in the overlay — fix = $0 scope-scaffold
  entry (see genlog; the L44 near-miss).
- **`stamp_review.py` has no rename form** — `-fix → canonical` promotion is a direct sha-verified
  copy; parked entries are hand-edited in the manifest (tool ignores ids absent from merged.json).
- **assets/** is GITIGNORED** — scene PNGs are machine-local; manifest carries shas. (ede2f56's
  message wrongly claims PNGs committed; only manifests/records went in.)

### What Has NOT Been Tried Yet
- **L39 face-only corrective** (~$0.039): keep the landed stencil/load-bed staging, correct only
  nose/ear/mouth register. Restate the rig law in ANY targeted retry (staging-only correctives leave
  the rig free to drift — proven this run).
- **L34 fix**: doctrine-window edit giving `seed_roles` an expression-authority field, then re-delta
  off L33 (~$0.039). Candidate frames for both parked shots sit in `_staging/` (shas in manifest).
- **Mechanism queue for the next doctrine window**: (a) seed_roles expression authority; (b) R-C
  delta figure-pinning proposal; (c) scene-prompt texture-adjective surface (the forge strip covers
  STEP-1 cards ONLY — scene prose can still author "quilted"); (d) L48-class card pose drift
  (`_retry_step1` accepts only expression|rig; pose is neither); (e) ochre scenes pull darkest-3%
  into rock not outline (batch measurement question).
- **Phases 6c3+** — remaining ~8 tenths (L51–L246) of the 246-shot re-authored shots.json, gated on
  Daniel's R-A..R-E rulings (esp. R-A ink seed + R-D saturation, which shape how 6c3 mints).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/` | DONE | 23 PNGs (machine-local) + manifest.json 23 verified / 2 parked, shas verified |
| `.../scratchpad/6c2-*` (genlog, 4 verify sets, overlays, drive specs/logs, board + builder) | DONE | full run record, committed |
| `.../shots.json` | DONE | L49 navy→brown fix only |
| `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py` + `test_forge_seed_requirement.py` | DONE | texture strip, 213 green |
| `orgs/faceless-youtube/knowledge/decisions.md` | DONE | L49 ruling 2026-08-07, flagged for Daniel |
| `visual-kit/_staging/` (machine-local, gitignored) | WIP | all candidates; parked L34.png + L39-fix.png; rejects in `_rejected-6c2*` |
| R-A..R-E rulings | TODO | Daniel, at the board URL |
| L34 + L39 | TODO | parked; next moves above — do NOT plain re-roll |

### Exact Next Step
Get Daniel's R-A..R-E rulings at
https://claude.ai/code/artifact/767b9074-aee3-4d3d-817f-1319f2187325. Then: doctrine window for the
mechanism queue (seed_roles expression authority first — it unblocks L34), L39 face-only corrective,
re-verify + promote both, board refresh, then 6c3 under whatever R-A/R-D rulings say.

### Load list
- this handoff
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/6c2-genlog.md` (authoritative run narrative incl. spend)
- `.../scratchpad/6c2-w2verify-r2.md` (the two parked diagnoses in full)
- `.../assets/scenes/manifest.json`
- `orgs/faceless-youtube/knowledge/decisions.md` (2026-08-06/07 entries)
- `memory/claude-boss.md` (2026-08-07 lessons)
- Skills: `orgs/faceless-youtube/.claude/skills/image-generation/` (forge, stamp_review)
- Gotchas that still bind: forge ONLY with `--kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit`;
  Windows python never MSYS paths; `_staging`/`review.json`/`assets/**` gitignored machine-local;
  workers never commit; model-grep every grade; ink measure on every verification; stamp_review.py
  sole writer of review.json; scene-retry limits above.
