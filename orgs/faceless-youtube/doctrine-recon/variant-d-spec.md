# Variant D — design spec (2026-08-20, rev 2 after adversarial REJECT of rev 1)

Owner: boss session. Base: `claude/bricks-variant-vb` tip (`17becaaf`), new branch `claude/bricks-variant-vd`.
Evidence: `V/scratchpad/taste-audit/vd-{chain,palette,occupancy,crowd-density}-forensics*.md` + adversarial
verdicts; `variant-d-spec-adv.md` (rev-1 verdict, all 12 findings addressed below). `V` =
`channels/the-second-take/videos/2026-07-28-bricks-fresh`; skill paths are under `orgs/faceless-youtube/.claude/skills/`;
kit = `orgs/faceless-youtube/channels/the-second-take/visual-kit/`.
Daniel's rulings 2026-08-20: chains where a beat naturally holds the camera, never forced or overloaded; blue/orange
disliked as a *default*, not banned; occupancy has a missing 1–3-figure middle, crowds of 50 have "no point"; no new
when/when-not rules; prompts must not grow; exemplar stays this round ("either").

## 1. Goal

A fourth doctrine variant, judged on the same 12 shots beside va/vb/vc, built from four criterion changes that
restore liked-era *judgment* the restoration dropped. Success is the board reading better to Daniel on chains,
palette, occupancy and crowd scale. There are no numeric targets an author could optimise toward (rev-1 §5 counts
removed — F4/F5/F6/F8): every acceptance check is a blind reviewer applying the criterion shot by shot and
*reporting* the resulting distribution afterwards. Render register is out of scope.

## 2. What does NOT change

Cast promotion + seeding; crowd rig appearance and poyais proportion; crowd exemplar seed (remint = open item;
probe A3 shows the seed reproduces its own lineup + costume); style tile; `global_prompt_suffix` empty; forge seed
mechanics and P3 gates; delta cap (one authoritative value, §3.1); no quotas, bans, count gates, or new sections.

## 3. The four criterion changes — every edit replaces text at its home, deletes superseded wording in the same
patch, and updates the tests that mirror it. The writing-plans step produces the exact old→new matrix per file (F9).

### 3.1 Chains — hold-camera criterion, symmetric critic, honest lint
- `visual-prompt-writer/references/shots-schema.md` 370-395 (grouping) and 378-380: *chain consecutive beats when
  the camera/set and primary subject can hold and the next beat makes exactly one visually distinct, story-needed
  state change; hard-cut when the vantage, setting, primary subject or register must change.* Reveal/enumeration are
  examples. Keep line 366 (the HARD one-change sentence), ≤3 deltas, timing, per-member `vo_ref`. One positive
  example in the existing paragraph (shop counter: PC newly unpacked on the held frame) and one negative (hero
  object → relational two-object diagram = hard cut).
- `scripts/lint_shots.py` 249-253, 743-746, 186-190: wording aligned to the criterion. `_NON_MATERIAL_DELTA`
  (726-729) unchanged. **Lint does not decide materiality** (F3): the 26 fresh no-ops (`poyais-register-audit.md`
  59-73, from `f1c3b1aa:V/shots.json`) become the critic's calibration corpus, stored as a fixture the critic brief
  points at, not a lint HARD.
- `references/critics.md` 45-50: the critic judges (a) could camera/set/subject hold — missed hold; (b) does each
  delta visibly advance story state — forced hold / no-op. Both directions, no totals.
- `image-generation/SKILL.md` 196-200 vs 223-231: generation reads stage metadata for parent routing; integrative vs
  discrete decides regeneration vs layer, never whether a stage may be authored.
- `visual-prompt-writer/SKILL.md` 130-164, 156-157, 230: stages are decided *after* shots exist by the schema
  criterion; the plan lock records partition/cast/place boundaries, never a closed stage list.
- **Delta cap authority (F9):** schema's ≤3 is canonical (liked run had 4-member chains). `universal.md` 1358-1364,
  motion-planner `animation-rules.md` 22-24 + 35-42, render-builder `shots-motion-schema.md` 7-11/27-33, and the
  test comments (`test_stage_check.py`, `test_forge_place_and_gates.py` 291-300) are brought to ≤3 and to
  "authoring decides the stage; realization decides layer vs regeneration". `visual-grammar.md` 59-66 (expression
  delta) kept, as an example of a valid state change.

### 3.2 Palette — per-stage commitment with a physical basis; recurrence judged, never gated
- `style-bible.md` 217-220: *each stage commits a dominant field derived from its light source and dominant
  material, plus at most two supporting colours; complements are valid when those facts create them; a palette turn
  changes the dominant field, not the names of the same pair. Colour with no physical or story cause is not written.*
- `visual-prompt-writer/SKILL.md` Step 3 plan lock: palette recorded **per stage** as *field + basis* (liked-era
  requirement, dropped by the restoration). Transport (F7): the stage's field+basis sentence goes in the base shot's
  existing `notes` field — no schema change; a standalone shot is its own stage (F7 "distinct stage" = distinct
  `stage` id, standalones count as one each, same-place re-bases are distinct).
- `references/critics.md` 52-56: keep "do not police palette codes"; the one plan-level check becomes: a dominant axis
  repeated across distinct stages without a stated basis. Holds exempt.
- `image-generation/SKILL.md` fresh-eyes review gate: invoke the existing scene-board command
  (`build_review_artifact.py` 214-271); cards carry `still_prompt`, stage, and the base's `notes` basis, plus per-frame
  warm/cool field share and a complementary-pair share with a 165–240° cool band. Advisory only — the reviewer judges
  role-grounding and unjustified repetition (F6: liked L10/L11/L24 are justified pairs; no zero-recurrence gate).
- Out of scope: tile, third-colour quotas, hue-angle lint on prose.

### 3.3 Occupancy — decide from who acts; give the pair a verified home
- `visual-grammar.md` 147 (story-bearer sentence) becomes: *Decide occupancy from who is acting in this beat: no
  human when mechanism, quantity, place, object or absence is the subject; one seeded performer for one person's
  decision/action/reaction; a seeded pair when an exchange, relationship or shared labour makes the sentence true;
  the simplified crowd rig only when the subject is the mass.* Three staging examples in the same paragraph: clerk +
  customer exchanging a box; two workers at one bench; manager + auditor over one ledger. Figures stay small,
  mid/rear, in a structured world.
- Pair execution (F10): a non-contact pair is two `cast` records on a fresh base (already legal, `shots-schema.md`
  170); a contact pair uses an existing interaction/pose route from `registry.json` or emits `needed_assets` and stops
  at the existing human gate. No three-person promise; `shots-schema.md` 179 wording limited to the verified path.
- `visual-prompt-writer/SKILL.md` 140-141: decision order subject → acting participants → occupancy → class → cast →
  tableau; 125 keeps the grammar as the only normative home.
- The critic's human-use question lives at `style-bible.md` 190-200 (Casting/Staging canonical question;
  `critics.md` 50 is only a pointer — anchor correction): it becomes *who acts in this sentence, and would removing
  every visible person hide that causal subject?* plus *is each crowd's narrated subject genuinely the mass?*
- `scripts/lint_shots.py`: diagnostics only — zero-human runs (ids, duration, VO), crowd shots with VO and
  neighbours, 1–2-cast shots with asset/base renderability.

### 3.4 Crowd — restore the positive-rear-zone clause; forge expands the rig, VPW stops reciting it
- Mechanism (F1, verified on vb): `forge.py` 184-188 loads `desc_crowdrig = blockquote_after(bible, "CROWD-RIG
  clause")` and `figures_expansion` (162-166, 235-246, 817-820) appends it when `figures.crowd` is true — but the
  bible has no such block (its §2d is the empty suffix), so the path is dead and `visual-grammar.md` 112-130 makes VPW
  author the clause into every crowd prompt. **Change:** move the CROWD-RIG blockquote into `style-bible.md` under a
  `## 2d. CROWD-RIG clause` heading (the suffix section is renumbered; grammar/bible/IG references to "§2d" follow);
  grammar 127-130 becomes "forge appends §2d from `figures`"; the rig-hold descriptor's cross-reference (bible 96)
  stays true. Zero forge code change; one new test asserting `Kit.prompt_for(..., figures={"crowd": True})` contains
  the clause bytes and a seedless-crowd call still refuses. Every "authored by VPW" assertion in grammar, IG, lint
  messages and tests is deleted or replaced in the same patch.
- Criterion at `visual-grammar.md` 147 (crowd half, with §3.3) restores `30d2b7e8` VPW 68-72 / grammar 128-131: *a
  crowd is written in the primary scene clause as a bounded group inside a named capacity-limiting boundary — behind
  a pane, between rails, through a doorway, along a pavement, on a far bank — with the near zone explicitly empty;
  never a co-planar gathering later called "small" or "rear-zone".* Probe: "small/restrained" → 24–45 bodies; count +
  appended container → 20; count inside bounding geometry + empty near aisle → 14–15 twice. No size threshold
  (F5: largest figures stayed ≈40% even when bounded — judged, not measured).
- `lint_shots.py`: when `figures.crowd` is true, report whether the prompt names a boundary noun with a spatial
  relation and an empty near zone. Diagnostic.

### 3.5 Prompt length — measured answer to Daniel
Authored `still_prompt` median words/shot: liked 73 → fresh 61 → va 46 / vb 39 / vc 59 (reproduced by the reviewer).
Prompts got shorter and more negated (0 → 0.3–0.4 "NO/never/not" per shot) while carrying rig recitation. The
SEED ROLES + RIG-HOLD preamble existed in the liked era. D removes the recitation (§3.4) and spends words on geometry,
field+basis and acting participants. "Prompts do not grow" is checked as a per-shot diff review at acceptance, not a
median quota (F8).

## 4. Procedure — what actually moves pixels (F11)
1. **Doctrine build** on `claude/bricks-variant-vd` per §3 with the plan's old→new matrix; test suites green
   (`py -3 -m pytest` in `visual-prompt-writer/scripts` and `image-generation/scripts`; vb baseline 101 + 166 = 267);
   echo sweep for every deleted phrase across skills/kit/tests; mojibake sweep; `git diff --check`.
2. **Lint fragment scope (F2):** `lint_shots.py` gains a declared fragment scope (the file states its act span) under
   which the two whole-file sizing checks (duration ≥85% runtime, count ≥ runtime/5) are reported as deferred, every
   other rule runs, and `--write` derives `vo_text` for the covered span. This is a scope condition on existing
   checks, not a new rule. The critic then runs on the fragment through its normal path.
3. **VPW A1 under D:** plan lock = partition/cast/place boundaries + per-stage field+basis + the acting participant per
   beat; shots authored; stage decisions after, by §3.1. Pixel levers made explicit: re-stage validated holds (vb
   L05→L06, L08→L09 class; vc L09→L10 class) only where the critic's symmetric test passes; rewrite every stage's
   field+basis into the prose; where a beat's acting participant is a pair, seed it through an existing route or
   surface `needed_assets`; rewrite every crowd as primary bounding geometry with an empty near zone.
   Lint (fragment scope) → independent critic → repair → lint.
4. **Gen L01–L12** exactly as vb (`forge.py batch` → `gen --image-size 1K --force`, kit `the-second-take`, 16:9;
   deltas after their parent is reviewed). Fresh-eyes review, one re-authored retry per failing shot, honest parks.
5. **Board:** add D to `build_variant_board.py` VARIANTS; fresh blind reviewer applies §3.1–3.4 criteria per shot and
   reports distributions (chains, palette recurrence with cause, occupancy buckets, crowd bounding); republish the
   same artifact URL.

## 5. Acceptance (boss-verified, no author-visible targets)
- Doctrine diff: each change sits at the cited home; no new section headers beyond the bible §2d move; superseded
  phrases grep to zero across skills, kit, tests; tests green; forge crowd-expansion byte test passes.
- Fragment: lint fragment scope reports 0 HARD (sizing deferred); critic pass after ≤1 repair round; every chain
  passes the symmetric test; every stage base carries field+basis in `notes`; no crowd prompt without boundary +
  empty near zone; per-shot word-count diff vs vb reviewed (facts replaced, not added).
- Renders: 12/12 attempted; parks honest; the blind reviewer's distributions reported, not targeted.

## 6. Cost and records (F12)
Image rate: vb ledger convention $0.134/call (`genlog.md` 115; provider table lists $0.039 — record both). Ceiling:
12 base calls + ≤12 retries = 24 calls ≈ $3.22; wave cap $5 including any chain-parent re-gen. Ledger row to
`ledgers/cost/` on ops via the existing convention used for the 08-20 variant-trial row; genlog at
`V/scratchpad/vpw-var/genlog-vd.md` with model, calls, cost, parks.

## 7. Risks
- Pairs everywhere (quota by another name) — guarded by "no human when the subject is the mechanism" and the causal-
  subject question; reviewer reports the distribution.
- Chain creep toward 109/26 — guarded by line 366, the critic's forced-hold check calibrated on the 26-no-op corpus.
- Same-board risk: if the four changes do not alter payloads (holds not re-staged, bases without basis, crowds not
  re-geometried), the board will match vb — §4.3 names the levers; the boss checks payload diffs before gen.
- Window under-samples the middle (liked L01–L16 is also 0-or-crowd): if the board is ambiguous, extend D only to
  L01–L18 before judging.

## 8. Open items for Daniel (not blocking)
Crowd exemplar remint (bounded cluster, period-neutral dress — probe A3); style tile A/B; render register.
