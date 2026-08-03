# Repair-wave plan + price — bricks-fresh (2026-07-30)

Zero-spend planning artifact. No image gens, no API calls, no commits were made producing this —
`forge.py batch` (no `--shots`) run twice ($0, never loads a key), `assets/scenes/manifest.json`,
`shots.json`, `board-verdict.md` and `fix-design.md` read directly. Every count below is derived from
those four sources + the forge dry-run's own dependency graph, not guessed. Source dumps used to build
this: `scratchpad/full-batch-stdout.txt` (per-shot seed/cast resolution, all 215 shots), `full-batch-
stderr.txt` (the 39 SEEDING LAW violations), `report_data.json`, `shot_deps.json` (this session's
scratch, safe to delete after review).

---

## 1. THE TARGET SET — 142 shots, derived

`condemned (107, parsed from board-verdict.md) ∪ parked (31, assets/scenes/manifest.json review_status)
∪ forge violations (39, live forge.py batch --shots-free run) ∪ chain parents (16, forge's own
dependency graph) − dogfood-complete (4 of the 5; L61 stays in scope for its retry)`

| Source | Count | How derived |
| --- | --- | --- |
| Condemned (board-verdict.md, per-shot lines parsed, ranges expanded) | 107 | Matches fix-design.md's own "condemn set 107" exactly — cross-check passed |
| Parked | 31 | `assets/scenes/manifest.json` → `review_status == "parked"` (not guessed — this is the actual field; matches the "31 parked" figure used everywhere else) |
| Forge SEEDING LAW violations | 39 | Live `forge.py batch --kit visual-kit --batch shots.json --out ...` (no `--shots`), $0, `SystemExit` after printing all 39 |
| → net-new from violations (not already in condemned/parked) | 6 | L19, L22, L28, L163, L179, L199 |
| → net-new from parked (not already condemned) | 17 | L01, L07, L08, L09, L12, L15, L16, L20, L21, L25, L35, L36, L39, L97, L112, L205, L215 |
| Union (condemn ∪ parked ∪ violations) | 130 | |
| minus 4 dogfood-complete (L45, L60\*, L116, L143) | −4 | L61 stays (needs its 1 authored retry) — see §2 note on L60/L61 below |
| Chain parents pulled in (forge's own dependency graph — a target shot's parent frame must exist before it can seed) | +16 | L05, L06, L13, L14, L26, L27, L45\*, L60\*, L80, L86, L98, L116\*, L143\*, L152, L180, L190 |
| **FINAL TARGET SET** | **142** | 4 of these (L45, L60, L116, L143, marked \*) are already generated — 3 genuinely done, 1 (L60) reopened, see below |

\* **L45, L116, L143 are done and stay done — free.** **L60 is NOT free — reopened by the qt-wiles
re-mint** (see Risk 1): its picked plate seeded the old (stethoscope) `qt-wiles` canonical, now stale.

**Full target list (142 ids):** L01–L03, L05–L09, L12–L22, L25–L28, L31–L36, L39, L40, L45–L47, L49–L54,
L60–L68, L70–L73, L78, L80–L83, L85–L91, L93, L97–L105, L107–L109, L112, L114–L119, L122,
L123, L126–L131, L133, L136–L138, L143, L144, L146–L148, L152–L158, L160–L163, L169–L175, L179–L184,
L190–L194, L196–L201, L205–L208, L215.

**No circular parent-child condemns found** — the dependency-graph BFS from all 142 targets to their
parents terminated cleanly with no cycle.

**Net remaining work: 138 shots** (142 minus the 3 genuinely-free dogfood shots: L45, L116, L143), plus
one reopened composite (L60) — the wave's real gen bill is priced against 138 + L60's 2 gens, in §3.

---

## 2. RE-AUTHORING SCOPE — 43 need VPW scoped-repair, 95 regen as-authored

**qt-wiles re-mint first, before anything else touches him** (fix-design's own "Must land BEFORE any
regen" table). Blocks: the canonical + every qt-wiles STEP-1 figure, including the 2 dogfood already
made (see Risk 1).

| Class | Count | Shots |
| --- | --- | --- |
| `anon_foreground` → named cast or crowd (tier law, fix 3) | 33 | L08,L17,L18,L19,L20,L21,L22,L34,L49,L50,L66,L67,L93,L100,L101,L107,L108,L109,L115,L123,L133,L144,L160,L161,L162,L163,L169,L170,L179,L191,L199,L200,L201 |
| Over-cap restaging (>4 seeds, hard error) | 6 | L28, L53, L54, L62, L68, L197 |
| Prose-vs-seed cuts (doctrine, named on the board) | 2 | L91 (`action-shrug` + "practiced shrug" prose), L196 (`surrender` + "palms raised" prose) |
| Word-sync fix-8 (three shot edits) | 3 | **L02** splits into two shots (opens on "Pac-Man" not "and one") · **L03** box art re-authored to read "scam" · **L197** merges into L198 (one-word span) |
| **Union, needs VPW scoped-repair** | **43** | (overlaps resolved: L197 counted once) |
| **Regen as-authored** — prompt is fine, defect is structural (missing seed / cross-video plate / never generated two-step) | **95** | everything else in the 138 |

Pose-name replacements: **zero found.** None of the 39 forge violations are a missing-primitive error
(forge would raise that class distinctly); the only classes hit were `anon_foreground` and over-cap.
The dogfood's own pose-repair case (L60's un-backticked `sit`) is already fixed. **New risk this
creates**, not an old one: VPW's re-authoring pass must draw poses only from the existing
`registry.json` inventory (fix 3's closed-pose-inventory rule) while converting 33 `anon_foreground`
shots to named/crowd — the check is a post-edit `forge batch --shots --dry-run`, $0.

---

## 3. GEN COUNT + reuse math

**STEP-1 figure frames — 30 distinct `(character, pose, expression)` combos, deduped**

Raw (non-deduped) STEP-1 token demand across the 36 needs-work shots that carry one: **39 occurrences**
→ deduped to **29** unique combos (reuse saves 9 gens, ~$0.35) + **1 more** forced by the qt-wiles
re-mint (his dogfood combo, `action-powerstance--expr-deadpan`, is now stale) = **30 total**.
None of the 30 exist on disk under the new canonical — all are fresh `GENERATE`, none `REUSED`.

| Character | Distinct combos needed |
| --- | --- |
| `qt-wiles` (8 new + 1 stale-redo) | 9 |
| `brick-foreman` | 9 |
| `auditor-rep` | 4 |
| `miniscribe-rep` | 6 |
| `hq-banker` | 1 |
| `ibm-suit` | 1 |
| **Total** | **30** |

**Place plates — 73 places (= every PLACE-FIRST shot in the target set, forge-confirmed, not the
video's full 215-shot place count)**

Split by whether the place recurs (2+ shots at that `stage` anywhere in the 215-shot video — worth a
taste-pick since later shots inherit it) or is a true one-off (nothing downstream to protect):

| Place shape | Count | Treatment | Gens |
| --- | --- | --- | --- |
| **Recurring stage** (candidate batch, human taste-pick) | 33 | 2 candidates each (dogfood's own L60 precedent) | 66 |
| **Standalone single-shot place** (infographic/map/reaction-shot classes — first-shot-is-plate, no downstream to protect) | 40 | 1 gen each | 40 |
| **Total place gens** | 73 places | | **106** |

**Delta / composed gens (seed off an existing or above-minted plate + canonicals)** — 65 shots, 1 gen
each = **65**.

**Canonical re-mint** — `qt-wiles` (businessman, no stethoscope, per Daniel's 2026-07-30 ruling) = **1**.

**L60 remint-redo** — the picked plate's composite must be regenerated once the new `qt-wiles` STEP-1
figure exists (its own place/candidates do NOT need redoing — only the composite) = **1**.

**Fix-8 shot-count wash** — L02 splits (+1 shot) and L197 merges into L198, which was already
regenerating (−1 shot, no net gen added). Net effect on gen count: **0**.

### Full gen tally

| Line | Count | Tier | Rate | Subtotal |
| --- | --- | --- | --- | --- |
| Canonical re-mint (`qt-wiles`) | 1 | 2K | $0.134 | $0.134 |
| STEP-1 figure gens | 30 | 1K | $0.039 | $1.170 |
| Place-plate candidate batches (33 places × 2) | 66 | 2K | $0.134 | $8.844 |
| Place-plate single gens (40 standalone) | 40 | 2K | $0.134 | $5.360 |
| Delta/composed scene gens | 65 | 2K | $0.134 | $8.710 |
| L60 remint-redo composite | 1 | 2K | $0.134 | $0.134 |
| **Subtotal (203 gens)** | | | | **$24.352** |
| Retry contingency (see below) | | | | **$3.653** |
| **Recommended cap** | | | | **≈ $30** |

**Retry budget.** The skill allows one retry per flagged frame. The dogfood's *observed fired rate* was
**0 / 9 (0 %)** — its one flag (L61) was reported honestly and left parked, not retried, per review
discipline; its *flagged rate* was 1/9 (11 %). Pricing the 0 %-fired baseline (i.e., not assuming every
flag consumes a retry) **plus a stated 15 % contingency** on the gen subtotal covers a realistic
flag-and-retry rate across 203 gens without assuming the worst case. $24.352 × 1.15 ≈ $28.00; rounding
up for a 3rd candidate on a handful of contentious places → **$30 cap recommended**.

---

## 4. PRICE vs the old pipeline (same 138-shot set)

| | Gens | Basis | Total |
| --- | --- | --- | --- |
| **Old pipeline** (4-seed single-gen, no STEP-1, reuses free cross-video plates — no place-mint cost) | 138 | 138 × $0.134 | **$18.49** |
| **New pipeline** (two-step + fix-2 in-video plates, this wave) | 203 | see §3 tally | **$24.35** (pre-contingency) |
| **Delta the two-step + own-plates design adds** | +65 gens | +30 STEP-1 ($1.17) + 33 extra candidate-batch gens ($4.42) + remint/redo ($0.27) | **+$5.86 (+31.7 %)** |

The entire delta is the price of two rulings, not the two-step recipe itself: (a) STEP-1 figure
isolation ($1.17 — cheap, 1K tier) and (b) **no cross-video plates, ever** — every place now mints its
own look, priced as 33 candidate batches ($4.42) rather than free channel-register reuse. (b) is the
larger of the two and is the one Daniel ruled on directly (fix 2, "no cross-video env plates EVER").

---

## 5. EXECUTION PLAN

**Step 0 — stale-`_staging` sweep (dogfood friction fix, must run first).** `forge.py gen`'s
`preflight_batch` treats any `<shot-id>.png` already in `_staging/` as done, regardless of which recipe
(old vs. two-step) produced it. Every one of this wave's 138 shots has a stale pre-fix PNG sitting there
from the original 04:52–07:13 run. Clear or `--force` every target id before Phase 1 — otherwise the
wave silently ships pre-fix frames under post-fix filenames, exactly as the dogfood nearly did on L45.

| Phase | What | Agent / mechanism |
| --- | --- | --- |
| 0 | Stale-staging sweep — clear/verify all 138 target ids in `_staging/` | mechanical (Bash), $0 |
| 0.5 | `qt-wiles` re-mint (businessman, no stethoscope) | image-generation skill, 1 gen, human-picked |
| 1 | VPW scoped-repair — 43 shots (§2) + Step 3a cast/colour-style declaration for the whole video | `visual-prompt-writer` skill, Claude subagent, **sonnet** (standard build work) |
| 2 | `forge batch --shots <phase-ids> --dry-run` per phase — re-verify $0 before any spend | mechanical, $0 |
| 3 | **Mint + human-pick the 33 recurring places' plates** (candidate batches) | image-generation skill; **human taste-pick gate per place** |
| 4 | Bases/stage-heads off those plates + the 40 standalone places | image-generation skill |
| 5 | Chain members, in board order, off their now-fixed parents | image-generation skill |
| 6 | Standalone condemned/violated shots not yet covered | image-generation skill |
| 7 | L60 remint-redo + L61's retry (already flagged, fix applied in Phase 1) | image-generation skill |
| 8 | The 3 word-sync edits (L02 split, L03, L197 merge) — last, since they change the shot list | `visual-prompt-writer` + image-generation |
| 9 | Slimmed fresh-eyes review, **one pass per act batch** (fix 7 — no self-check, no 3-agent fan-out) | Claude subagent, **sonnet**, per act |
| 10 | Shot-board rebuild | `shot-board` skill |

**Human gates, in order:** qt-wiles remint approval (Phase 0.5) → **33 place taste-picks** (Phase 3,
the wave's real bottleneck for human attention) → per-act fresh-eyes sign-off (Phase 9) → final board
pass-through (Phase 10).

**Wall-clock estimate:** ~6–10 hours of agent + human time, not continuous — likely 2–3 working
sessions. Rough split: 0.5 h setup/remint, 2–4 h VPW re-authoring pass (43 shots + the cast/colour-style
plan, done as one coherent pass so the video's declared cast stays consistent — not parallelized per
act), 2–3 h gens (203 gens; dogfood observed 30 s–3 min per gen with one anomalous 13–14 min stall —
lesson from dogfood §8b: let a stalled gen run rather than kill-and-restart), 2–2.5 h review (7 acts ×
~15–20 min), 0.25 h board rebuild. The 33 taste-pick gates are the actual bottleneck on Daniel's
attention, not the gens themselves.

---

## 6. RISKS — checked honestly against the current law

1. **The qt-wiles re-mint reopens 2 of the 5 "done" dogfood shots.** L60 and L61 both seed `qt-wiles`
   under the OLD (stethoscope) canonical — fix-design's own "Must land BEFORE any regen" table says the
   dogfood's step-1 figures for him are stale, but the dogfood ran *before* that ruling landed. Net:
   only L45, L116, L143 are genuinely free; L60 needs 1 new STEP-1 figure + 1 composite regen ($0.173),
   L61 needs its already-flagged retry redone against the corrected figure. Priced in §3; do not report
   this wave as "5 shots already done" — it is 3.
2. **L97/L99 id↔pixel misbinding — the target set mechanically includes a shot that shouldn't regen.**
   L97 sits in the 31-parked list (pulled into the target set by the union rule), but per board-verdict's
   own boss addendum, L97's pixels on disk are a **clean box** and Daniel explicitly passed it ("L97
   fine"). The real swamp defect is on **L99**, which is independently condemned via board-verdict's rig
   text regardless of the swamp confusion. **Recommendation: skip regenerating L97** (verify-only, correct
   its manifest `review_status` instead of spending a gen on a shot that's already right) — this is a live
   instance of the exact open risk fix-design recorded and Daniel declined to fix structurally
   (NOT-DOING: verdict↔pixel binding). Saves 1 candidate-batch worth of gens if caught before Phase 3.
3. **73 places need fresh minting, not fix-design's own "~5–8" estimate.** fix-design's risk/cost section
   for fix 2 estimated "~5–8 places × 2–3 candidates ≈ 15–25 gens ≈ $2–3.4" — that was a hand estimate for
   a hypothetical fresh video, not this wave. The forge-derived, wave-scoped number is **73 places** (33
   recurring, needing a taste-pick; 40 genuine one-offs). This is the single largest reason this wave's
   price ($24–30) is materially higher than a naive reading of fix-design's own cost line would suggest —
   surfacing it here rather than under-pricing the gate ask.
4. **No missing pose primitives — but the re-authoring pass could introduce one.** All 138 target shots'
   authored poses currently resolve against `registry.json` (forge raised zero "primitive not found"
   errors). The risk is prospective: VPW's Phase 1 pass, converting 33 `anon_foreground` shots to named
   cast, must draw only from the existing pose inventory (fix 3's closed-inventory rule) — a fresh
   `forge batch --shots --dry-run` after Phase 1, before any Phase-3+ spend, is the check, and it is
   already step 2 of the execution plan.
5. **≤2-cast cap and prose-vs-seed competition remain self-checked** (fix-design's own accepted risk,
   NOT-DOING). Two of the 43 VPW-repair shots restage 2-named-cast + crowd combinations not yet
   probe-validated the way L60's shape was (`twostep-probe/results.md` covers exactly one 2-cast+crowd
   case). L184 (`hq-banker`+`qt-wiles`) and L191 (`hq-banker`+`auditor-rep`) are new combinations for this
   cap shape — not fatal (forge's hard 4-seed cap still catches a genuinely over-budget slate), but worth
   a specific look in the Phase 9 review pass rather than assuming the L60 probe result generalizes.
6. **No circular parent-child condemns** — checked, not assumed. The full 142-shot dependency BFS
   terminates cleanly.

---

*Derivation was built from two live `forge.py batch --kit visual-kit --batch shots.json` runs (no
`--shots`, $0, never loads a key — confirmed by exit behavior) against `assets/scenes/manifest.json`
and `board-verdict.md`. The intermediate scratch files (stdout/stderr captures, dependency-graph JSON)
have been cleaned up per F-clean — this doc and the source files above are the durable record; the
derivation is reproducible by re-running the same `forge.py batch` command at $0.*
