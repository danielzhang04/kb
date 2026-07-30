# VPW + image-gen prompting integration — plan (2026-07-29)

**Goal:** encode the approved learnings (bricks segment run + `knowledge/research/image-prompting/SYNTHESIS.md`)
into pipeline LOGIC — doctrine, lint, forge — then re-run VPW staged on the full bricks script.
**Daniel rulings (2026-07-29):** structured `figures` field + forge expansion · act-by-act staged VPW,
one worker · Tier-2 verify upgrades built before the Phase-5 slice. Provenance: seg critic findings
(5/15 were rig-clause defects), vendor-documented reference-constraint + ordering guidance, measured
long-prompt degradation, 25-char/3-phrase lettering ceilings, 5-character-reference slot budget.

**Law for every edit:** integrate in place, never append; keep files compact; each rule single-homed;
`curate-doc` discipline. No behavior change outside what this plan names. ZERO image/TTS spend.

---

## 1. The `figures` field (spec — both W1 and W3 build to THIS, not to their own reading)

Optional per-shot key in `shots.json` v2, alongside `still_prompt`:

```json
"figures": { "anon_foreground": ["the worker at the dock edge"], "crowd": true }
```

- `anon_foreground`: one entry per anonymous LARGE/foreground figure (§2e tier), each entry the exact
  phrase the prompt uses for that figure. Omit key if none.
- `crowd`: true when the shot stages §2d-tier background/crowd figures. Omit if false.
- Prompts NEVER contain the §2d/§2e clause text any more. VPW declares; forge expands at gen time.

**Forge expansion rules** (rides the §2c auto-append pattern, `forge.py` ~L143–209, templates read
from style-bible §2d/§2e blockquotes via `blockquote_after`):
- Base/standalone shot: §2e template pluralized over the `anon_foreground` list, opening by naming the
  entries verbatim ("The following figures — X; Y — are anonymous, non-recurring people drawn on the
  FULL base family rig …"), closing with an explicit binding: no other figure in the image takes this
  clause; named cast keep their canonical descriptions. `crowd: true` → §2d clause appended.
- Delta shot (`stage_role: "delta"`): held-figure wording instead — "the anonymous figure(s) [list]
  are unchanged, exactly as established" — never the invent-a-distinct-outfit wording (that instruction
  is for first establishment only).
- Assembly order per gen: [still_prompt] + [figures expansion] + [§2c when it fires today] + [suffix].

## 2. Ownership map — who edits what

### W1 — doctrine cluster (Opus): style-bible, visual-grammar, VPW SKILL, shots-schema, critics
- **style-bible §2d/§2e**: clauses stay as the verbatim templates (forge reads them); the authorship
  lines change — "declared via the shot's `figures` field; `forge.py` expands" replaces "VPW authors
  into the still_prompt". §2e loses nothing else; the delta-mode wording rule is stated here once.
- **visual-grammar**:
  - §2 figure routing bullet: route by size → DECLARE in `figures`, never paste clauses. Named cast
    inline registry names unchanged.
  - §2 new ordering law (one bullet): a prompt reads in three zones — named cast + pinned identity
    FIRST; the scene second; the payload LAST (the quoted lettering, or on a delta the one change,
    stated as the final clause: "only this changes").
  - §1 chain logic: a delta prompt is a compact restatement of the held scene, then the change as the
    FINAL clause. (Merge with the existing ≤3-delta text; don't duplicate it.)
  - §2 figure cap (one bullet): plan ≤5 must-stay-distinct figures per shot (the model's
    character-reference budget); >3 figures in physical interaction = flag `notes` high-risk.
  - §6 or §1 (wherever exclusions naturally sit): absence is authored as a positive property of the
    surface ("blank and unlettered", "an empty street") — never "no X, no Y" lists.
- **VPW SKILL.md**:
  - Step 2.3: after registry naming — author the `figures` field per the routing; clause text banned
    from prompts (lint enforces).
  - Step 2.4: fold the ordering law reference (one line pointing at the grammar; no restatement).
  - **Step 3 rewritten to the staged protocol** (scriptwriter's shape): (a) split the script into its
    acts (the natural arcs); (b) per-act plan first — environments/stages, which beats get the striking
    staging (opening / 55–65% re-arm / final-20% peak), density budget; (c) author act by act; BEFORE
    each act re-read `example-shots.md` + grammar §1–3 (register decays over one long pass; the re-read
    holds the back half at the front half's level); AFTER each act run lint on the partial file and a
    one-paragraph drift self-audit (non-literal share, class variety, red-ink count, cadence vs plan).
    Critic (step 8) stays whole-file.
- **shots-schema.md**: `figures` field spec + one example (§1 spec above, condensed).
- **critics.md charter**: integrate into the existing questions (never a bolted-on list): pose-prose
  leakage (body pose/finger mechanics written as prose); figure cap + interaction flag honored;
  attribute-bleed risk on multi-figure shots (shared descriptors minimized, geometry pinned:
  scale/gaze/interaction); countable elements n≥3 staged countably; ordering-law compliance; judge
  whole-scene fit and per-element fit as separate calls; exclusions authored positive-state.

### W2 — lint (Opus): `lint_shots.py` only
Match the file's existing discipline: every new guard documented with the real counter-example that
tuned it; ASCII-safe messages; tune against the `_bricks-seg/shots.json` artifact (0 false positives
required on it after its `figures` retrofit in Phase 3 testing — see §4).
1. `word_cap_check` gains a char cap: quoted literal >25 chars → HARD (keep the 4-word cap).
2. New HARD: >3 quoted literals in one prompt (thumbnail prompts included).
3. New SOFT: any literal word ≥9 chars (garble risk; suggest shorter/common word).
4. New SOFT: negation-list phrasing — two+ "no <noun>" clauses in one sentence → suggest positive-state
   authoring ("blank and unlettered"). Tune to NOT fire on single absences or lint's `_ABSENCE` idioms.
5. New HARD: `shot_class` not in the schema's closed enum (list imported/copied from shots-schema §1).
6. New HARD: rig-clause fingerprint in `still_prompt` ("FULL base family rig", "CROWD RIG:") — the
   regression guard for the figures migration.
7. `figures` shape validation: wrong types/unknown keys → HARD; `anon_foreground` entry not found as a
   substring of its shot's `still_prompt` → SOFT (declared figure the prompt never stages).

### W3 — forge + image-gen (Opus): `forge.py`, image-generation SKILL
- `figures` expansion per §1 spec (template source: bible §2d/§2e blockquotes; extend the §2c
  auto-append site, same non-identity-mode guard logic where applicable).
- Resolution probe: verify gen calls request the model's top resolution tier; fix if not; record the
  finding in the SKILL if a dial existed and was set low.
- DSG-lite verification in the verify loop: per generated still, one LLM call decomposes the assembled
  prompt into a small dependency-ordered checklist of atomic facts (entities → attributes → relations →
  lettering); one multimodal call answers each in order, short-circuiting children when a parent fails;
  per-item results logged to the shot's review record. Keep the existing style-bible §3 rig checks —
  this ADDS adherence checking, it does not replace the rig judge.
- Surgical retries: a retry rewrites only the failing clause(s) of the shot prompt (plus targeted
  tactics: letter-by-letter spelling on a garbled literal), never a whole-prompt rewrite; retry cause
  logged. Budget/attempt caps unchanged.
- NO generation calls in this phase — code + docs only, unit-testable dry (expansion printable for a
  sample shot without an API call).

## 3. Explicit non-goals
- No negative-prompt doctrine flip (Google-vs-OpenAI conflict rides the Phase-5 slice as a live A/B).
- No anchor-restatement rule for named cast (the slice tests trust-the-reference implicitly).
- No new files beyond this plan; no README/registry changes; `registry.json` untouched (prop kind
  already doctrine).

## 4. Phase 3 verification (boss-run)
- Planted-defect lint tests: each new guard fires on a crafted bad shot AND stays silent on the
  `_bricks-seg` artifact retrofitted with `figures` fields (retrofit = part of the test, done by W2's
  grader run, not committed as product).
- Forge dry test: expansion printed for one base shot with 2 anon figures + crowd, and one delta —
  wording matches §1 spec; zero API calls.
- Fresh-eyes AUTHORING probe: a cold agent given only the updated doctrine authors a valid 3-shot
  fragment (figures field, ordering law, delta-final-change) — proves the doctrine teaches.
- Dedup/single-home review across all edited files; model verification of every worker by transcript grep.

## 4b. Post-slice iteration list (2026-07-29) — APPLIED 2026-07-30 in the speed wave, residuals below
Evidence: `_bricks-seg/gen-log.md` (systemic findings), `seg-log.md` (VPW friction F-1…F-14), boss review.
Applied (two-worker wave, boss-graded, tests green):
1. `base.png` auto-seeded on §2e anonymous figures (forge; warns rather than exceeding the 4-seed cap;
   never fires on identity passes).
2. Registry `no_hands` flag suppresses forge's §2c hands clause when EVERY figure is flagged; fails
   closed on any unflagged/unattributable figure. `pc-boxy` flagged.
3. Two-gen identity pass MANDATORY on scene-heavy single-HUMAN-cast shots; SKIPPED for personified
   objects (image-generation SKILL).
4. Forge `reject` subcommand + `reject_first`: rejected frame moves to `_staging/_rejected/`
   (timestamped, evidence preserved) then regens; `register` semantics untouched.
5. Famous-adjacent staging LAW applied (grammar, next to evergreen-references): positive divergent
   geometry/palette, never omission/prohibition.
6. Rig-verify: paired crops against the approved canonical required for a flagged shape call to stand
   (bible §3 + image-generation SKILL).
7. VPW doctrine batch: F-1, F-2, F-3, F-4, F-5, F-6, F-8, F-13, F-14 applied (grammar third ordering
   branch; lint identity-tag guard fixed with correct control-leak diagnosis; slug discriminator;
   §13a-ii precedence; delta-timing bases <2.0s exempt; one-entry-per-body; density-conditioned
   front-loading; re-attention wording).
8. image-generation §Report defers to shot-board + boss presentation; worker Artifacts banned.
9. SPEED: forge batch mode is now a dependency-aware topological scheduler (`after:` +
   seed-derived edges, `--concurrency` default 4, cycle-detect fail-closed before spend, failure skips
   descendants only, race-safe ledger/staging); crop battery parallelized (`--batch`). Review machinery
   replaced by the ESCALATION MODEL (Daniel ruling 2026-07-30): judges rule at viewing scale in one
   batched pass; crop battery only on flagged shots; a rig-DEFECT ruling is admissible only with a
   paired crop vs the canonical (evidence to condemn, not acquit); DSG-lite scoped to lettering-bearing
   + notes-flagged shots.

Residuals (open):
- `pc-boxy` Macintosh-adjacent trade-dress + prop-vs-character slug asymmetry (F-12): Daniel rules at
  the full-video board gate.
- Design-decision frictions skipped by the wave: F-7 (§2e deliberately-identical anon figures wording),
  F-9 (accent-red collision dial), F-10 (universal.md "first 3–5s" ambiguity), F-11 (registry pose
  vocabulary single-slot).

## 5. Phase 4/5 notes
- Phase 4: full staged VPW on `2026-07-28-bricks-fresh` (thumbnails + `shorts: []`), new protocol,
  critic, lint, boss judgment vs the seg baseline, Daniel gate.
- Phase 5: image-gen Pass 1 gate (asset ruling + spend approval BEFORE any gen token), canonicals,
  ~2-min slice through the upgraded verify loop, boss judgment, shot-board artifact, Daniel gate.
