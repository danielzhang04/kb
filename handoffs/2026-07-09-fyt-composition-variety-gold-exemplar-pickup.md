# PICKUP — composition-variety retest RAN; gold exemplar NOT yet locked (tabled 2026-07-10)

**Created 2026-07-09; updated 2026-07-10 after the retest session. Delete once the gold exemplar is
minted + locked AND the deferred VPW-logic changes below are decided.**

The image-gen *logic* changes are all committed and audited-clean (see "What's DONE" below). This
session **ran the retest** on the `_chain-test` slice — re-authored → generated → reviewed with the
user over two rounds — but the user **tabled it before final approval**, so the gold exemplar is
**still not locked**. Resume state is in "Where it stands now" + "Resume here".

## What's DONE (committed on master, synced across files) — the logic behind the retest

Three image-gen workstreams landed, in order:
1. **Checking slimmed to ONE batched review** — 3 concurrent agents (identity/fidelity/style),
   retry-2-then-flag. Spec/plan `…2026-07-09-image-gen-checking-slim*`.
2. **All generation on pro; flash removed** — `forge.py` single engine (`gemini-3-pro-image`).
   `decisions.md` 2026-07-09. (~$15–30 per full 8–15 min video all-pro.)
3. **Shot composition variety — make the class DRIVE composition** — the monotony fix. Spec/plan
   `docs/superpowers/specs|plans/2026-07-09-shot-composition-variety*`. `VPW SKILL` Step 2.5 (class
   realizes its composition; framing/scale + expression are stated facts), `visual-grammar.md §2`
   (payload-driven composition guidance), `image-generation`+`style-bible §5/§8` (image-gen executes
   VPW's framing, stops re-composing), `style-bible §6` (diegetic art flat-cel).

## Where it stands now (2026-07-10 — the retest session, all on disk, UNTRACKED scratch)

Ran on `channels/the-second-take/videos/_chain-test/` (the 56s Poyais slice):

1. **Fresh, agenda-blind VPW re-author** (a subagent that only knew "author the shot plan", not "prove
   the fix") → a new **19-shot** `shots.json` (was 18), lint-clean, its Step-8 critic caught 3 real
   defects (all fixed). This is the honest test of the *skill*, uncontaminated.
2. **v1 generation** (all-pro, reused the existing `assets/library/` characters, Pass-1 skipped) → 19
   scenes → **before/after board** vs the old-logic set: https://claude.ai/code/artifact/5508659e-3c09-481c-9c93-c39a69bdd02e
3. **User notes** → directed edits to 10 shots (in `shots.json`, lint-clean) → **v2 regen** of just
   those 10 → **current full board (v2):** https://claude.ai/code/artifact/76cc981b-e1c4-4d00-a2c0-f1d96243aa50
   The 10 changed: L02/L03 (real-ish Europe+Americas outlines, ships step across), L04 (brochure only —
   MacGregor removed to protect the reveal), L09 (re-based as a **generic** prince, not MacGregor), L10
   (FICTION stamp restored), L12 (empty spotlight), L13 (MacGregor steps in; identity re-held), L17
   (**real forearm-clasp interaction**, fixes the copy-pasted Bolívar), L18/L19 (round heads + 4-digit
   enforcement; L19 deed shows a Central-America outline; L19 took 1 retry for a nose/costume drift).

**On-disk artifacts (all untracked scratch, do NOT commit):**
- `shots.json` — 19 shots, lint-clean, `vo_text`/`shot_counts` derived. `shots.old-logic-2026-07-09.json`
  = the pre-edit baseline backup.
- `assets/scenes/` — the **current (v2)** 19 frames + 3 thumbnails + `manifest.json`.
- `assets/_before-composition-fix/` (21) = old-logic set; `assets/_v1-newlogic/` (22) = the v1 board's
  set. Three sets preserved for any before→v1→v2 look.
- `assets/scenes/_handcrops/L1{3,7,8,9}-crop*.png` (12) = zoomed hand+head crops for a **human**
  finger/head count (image-gen did NOT self-certify these — finger count is a human gate).
- Board build recipe: `ffmpeg -vf scale=1100:-1 -q:v 4` → JPEG → base64 data-URIs in one self-contained
  HTML (<16MB), 2-col grid + lightbox. Scripts in this session's scratchpad (gone next session — rebuild
  from `assets/scenes/` if needed).

## What the retest actually bought — the findings that matter more than the frames

The frames improved, but the real deliverable is **three gate gaps the run exposed** (these are the
deferred VPW-logic work the user explicitly parked "for the planning pass"):

1. **No reveal-integrity check.** ✅ **BUILT 2026-07-11** as the **"disclosure order"** 7th authoring law +
   Step-8 critic plan-level check (`SKILL.md` + `critics.md`); see decisions.md 2026-07-11 +
   `…2026-07-11-disclosure-order-critic{-design,}.md`. Original defect: the fresh VPW run showed MacGregor as
   the salesman (L04) and the enthroned prince (L09) *before* his spotlight reveal (L12–13) — spoiling the
   mystery. Fix = the narrow disclosure-order law (re-author the shot with the withheld entity absent).
2. **`staged-interaction` bar too soft.** L17 (Bolívar "alongside") came out as two figures parked /
   copy-pasted side-by-side — the exact pattern the composition spec named. The class needs a harder
   "must be a REAL interaction (shared ground plane + eye-line + engagement)" bar in the pre-gen critic
   AND image-gen must integrate co-present characters, not paste. (Directed-fixed on this slice, but the
   *skill* still self-grades it.)
3. **Identity review under-catches rig drift.** The batched identity review waved through noses (L18),
   5-finger hands (L19), and horizontally-stretched heads across the first run. This is the "separate
   follow-up" from before, now with hard evidence: harden the identity agent on round-head + 4-digit +
   no-nose/ears — but keep the **human finger/head crop gate** (LLM vision isn't reliable here).

## Resume here

1. **Gold exemplar NOT locked** — the user tabled before approving. To finish the original pickup:
   get the user to approve the good v2 frames (and/or a re-run), then LOCK them as the exemplar (home:
   likely a `visual-grammar §0` exemplar section pointing at the approved PNGs + their `still_prompt`s,
   mirroring `storytelling-grammar §0`; flip `style-bible §10` "pending" → locked; reference from VPW).
2. **Decide the 2 REMAINING deferred VPW-logic changes above** (#1 reveal-integrity ✅ BUILT 2026-07-11 as
   "disclosure order"): **staged-interaction bar**; **identity-review hardening** (lives in image-gen, not
   VPW) — the user wanted these planned, not hacked in. NOTE: coordinate on the VPW `SKILL.md` — parallel
   terminals edit it (re-read before editing).
3. The `_chain-test` fixture stays untracked scratch; keep the three comparison sets until the exemplar
   is locked, then the user's call whether to keep or delete the fixture.

## Warnings for the next terminal

- **Parallel terminals active** (Remotion/motion + VPW-doc edits). Stage **explicit paths only**, never
  `git add -A`; the whole `_chain-test/` tree is untracked by design — do not commit it.
- Anti-trap discipline (user-directed, hard): fix generation via **exemplar + guidance**, never new
  prohibitions; each concept keeps ONE home; no cross-file redundancy or stale content. See
  `[[fix-generation-not-prohibitions]]` + `[[keep-docs-structured]]`.
