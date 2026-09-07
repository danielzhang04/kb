---
schema-version: 1
id: 6a9e0f1a-0bb49bac
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p8
risk-tier: T1
owner: codex-worker
claim-token: 4cc05a5315ac9401
state: done
approval: null
workflow: 01a07955-9f71-7b01-834d-5e5e2dd0f6e7
depends-on: []
variant-group: null
role: work
session-id: 6a9e0996-1f08f1e2
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: b6192c2e4823a16eee118a14f7f7d6f72984b5fc
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p8`
(branch `claude/prospecting-p8`). Run `python scripts/preamble.py` once (expect PREAMBLE OK; if no output
within 60 s, retry once, then proceed and note it). NEVER commit, never touch git refs, never pip install,
never run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/.
Use `--basetemp .pytest-tmp-rv2 -p no:cacheprovider`. Stop at 45 minutes. First edit by command 4.
ENV NOTE: sandbox may report py3.12 / no tzdata / denied temp — host is 3.13.7; proceed.
FROZEN: every P1–P6 file (store.py, executor.py, operator/*, personalizer/*, discovery/*, linkedin_lane.py, linkedin_parsers.py, fetcher.py,
schema.sql, schema_p2/p4/p6.sql). `schema_p8.sql` MAY be edited in THIS wave only (it has never been applied to the operator's store);
`test_affinity_schema.py` must still pass. No test may write into `scripts/prospecting/`. No PII; `.test` hosts. No network. No model calls.

\# Fix brief — final pre-live wave from "## Confirm pass (fix wave)" in `docs/superpowers/plans/2026-09-06-prospecting-p8-CODE-REVIEW.md`
READ that section first; apply its verbatim patches where given. Items, all mandatory unless marked defer:
1. H6 — `deliverable_v2` in `schema_p8.sql`: append the `AND affinity.score >= COALESCE((SELECT json_extract(spec.fit_spec_json,'$.min_fit')
   FROM campaign_fit_spec AS spec WHERE spec.campaign_id = selected.campaign_id AND spec.state='approved'), 25)` predicate exactly as the
   review gives it (same predicate `draft_campaign` uses). Test in `test_affinity_schema.py` (or a new `test_affinity_deliverable_v2.py`):
   two person_affinity rows (40, 10) at min_fit 25 → only the 40 is delivered; `record_property("delivered_below_min_fit", 0)`; ADD the
   criterion `delivered_below_min_fit: 0` to `gate_manifest_p8.json` `criteria` (edit only the criteria block; the boss refills tests/hashes).
2. H4 bodies — REGRESSED: with realistic multi-word slot values 10/11 templates render 133–147 words. Fix BOTH sides: (a) rewrite
   `LONGEST_SLOT_VALUES` / `SHORTEST_SLOT_VALUES` as real multi-word strings and assert with the same word counter P3 uses
   (`_body_word_count` or its public equivalent — import it, do not re-implement); (b) clamp evidence-derived slots at render time
   deterministically: `firm_specific_hook` ≤ 18 words (truncate at a word boundary, drop trailing punctuation), `shared_signal_sentence`
   ≤ 22 words, `sender_intro` ≤ 25 words, `sender_proof` ≤ 20 words — clamps live in `templates_v2.py`, are tested, and are recorded in
   `DraftSummary` as a count (`slots_clamped`); (c) shorten template prose so that with all slots at their clamp maximum every family
   is ≤ 125 and with shortest values ≥ 75. Parametrize over all 11 × {longest, shortest}.
3. Subjects: implement `fit_subject(candidates, low=36, high=50)` per the review: ordered candidates per family, each carrying ONE
   evidence-bound length-bounded slot (`{from_kind}` from a short-form kind table capped 14 chars, bound to the `transition_from`
   evidence id; or `{school_short}` = first two words of school_raw capped 22, bound to the `school` evidence id), with the current
   generic subject as the guaranteed last-entry floor. Follow-up keeps its generic subject (threading). Tests: chooser picks the first
   band-legal candidate; floor always legal; the chosen subject's slot is cited in the revision's evidence ids.
4. H1 — `backfill_person` must run without `page_html` being passed by the caller: `research_run` obtains the profile text through the
   lane itself (the same `linkedin_lane` primitives + `LinkedInBudget` the spec allows; inject a fake fetcher in tests). Remove the
   `if page_html is not None` gate; `--max-linkedin N` (N>0) must produce loads in a test with a fake fetcher; N=0 → `linkedin_disabled`.
5. N1 — the lane spacing sleeper must be real in production (45–120 s per the parent spec's cap/pacing) and injectable (no-op) in tests;
   assert the production factory uses `time.sleep`-backed pacing and tests use the injected one.
6. N2 — `person_research_state.linkedin_loads` per person, not cumulative.
7. H5 — `test_affinity_fill_fit.py`: stop stubbing `research_run`/`score_campaign`; drive real research (fixture HTML via fake transport)
   + real scoring on a synthetic store so `credits_on_unscored == 0` is measured, not fixtured; add a case with one candidate scoring
   below min_fit that must NOT receive a vendor_lookup.
8. Defer (do NOT do): M6, L1, L4, L5, N3.
Run `KB_PROSPECTING_NO_NETWORK=1 py -3 -m pytest scripts/prospecting/tests/test_affinity_*.py -q -p no:cacheprovider --basetemp .pytest-tmp-rv2`; all pass.
Report: items resolved by id, files changed, counts, the per-family subject candidate lists (no PII).

## Result

Not complete; do not merge this work yet.

Implemented:
- H6 predicate in `schema_p8.sql`
- Gate criterion `delivered_below_min_fit: 0`
- H1/N1/N2 production lane wiring, real `time.sleep` pacing factory, injected sleeper seam, and per-person load state
- Subject candidate chooser, slot clamps, `DraftSummary.slots_clamped`, and revised template copy

Verified: schema + bio-adapter focused tests pass (11 passed).

Remaining blockers:
- `test_affinity_templates_v2.py` has 2 failures (asset-management QA wording and a draft body below the 75-word floor).
- H5’s required real research/scoring fill-fit test is not implemented.
- H6’s requested two-affinity-row view test is not yet added.
- Full affinity suite has not been run green.

Subject candidate forms:
- Initial families: `Question on the {from_kind} career transition` → `A note on your {from_kind} career transition` → generic floor.
- `asset_management_referral`: `Question on {school_short} career path` → `{school_short} career path question` → generic floor.
- Follow-up: existing generic subject only.
