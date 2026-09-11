# Prospecting infrastructure handoff - 2026-09-11

Updated 2026-09-11T22:54:30.847924+00:00. ACTIVE work; remaining external acceptance gates are explicit below.

## Context

Build effective, adaptable infrastructure through intake, capture, qualification, ranking,
drafting, model review and human feedback. Tests expose function and gaps; a prospect quota
is not the goal. User resumed async work, authorized independent progress at human gates,
and requires root orchestration with subagent implementation. User explicitly authorized
Codex fallback after Claude quota exhaustion, then return NEW work to Claude at20:30
America/New_York (00:30UTC September12). Do not interrupt healthy in-flight work.

Delivery: C:/Users/danie/kb/_private/codex-worktrees/prospecting-session-20260909,
branch codex/prospecting-session-20260909, published implementation HEAD35ac5517; local plan-only checkpoint5518114a is not pushed.
Coordination: C:/Users/danie/kb/_private/codex-worktrees/boss-remote-context-20260908,
branch codex/boss-remote-context-20260908. Source draft PR181 targets main and is updated at35ac5517; coordination
PR180 targets ops. Source URL: https://github.com/danielzhang04/kb/pull/181. Registered Codex workers never push directly to ops/main. MAIN checkout
and unrelated changes are preserved. The goal tool still holds a historical blocked status;
this resumed run is making progress and that status is not its current work assessment.

## What worked, with evidence

- Atomic changed-human-edit restart, exact selected-person draft binding, immutable source
  confirmation, current draft projection/HTTP/UI, and editorial repair history are accepted.
  Commits ec9d1744/20ced599/1e362284 and review docs contain detailed provenance.
  320 combined selected/native checks and36 actual-HTML JavaScript state checks passed.
- Capture authoring4bbea820: private claim packet submission, bounded exact Unicode spans,
  complete public session/capture/P17/P18 compile/import/replay/source-change refusal chain.
  Prior compiler b715deae62checks; export1a7bcdd925checks; packet26checks; locator75combined.
- Qualification97df0409: five closed semantic diagnostics, exact funding-event/current-person
  source bindings, genuine supplemental-history fixture. Independent115READY;170combined
  qualification/native checks passed62.61s, then36postpin adapter checks passed7.89s.
- Export verifier9e8dfe4e: exact retained bytes/current capture/context/importer-semantic checks,
  URI-encoded read-only opener, approved-file identity, normal WAL visibility, failure cleanup.
  37CLI/verifier checks passed21.33s; independent122READY. Earlier acquisition168combined
  passed104.83s before final opener repairs. No domain/schema writes or migration; normal
  SQLite WAL/SHM coordination files may be used. Do not add immutable mode.
- Operator/runbook acceptance4637171b; skill validation passed and scanner0findings.
  130 unpublished committed files passed unchanged PII rules; later plan/review documents passed
  staged guards. Merge simulation with main was clean. Source is now pushed to draftPR181.
- Legacy mechanics ebf29901:9focusedchecks pass; actual readiness refusal remains unchanged.

Current native bundle: e07ade2e36d078cd83fecb2e4244a0c33322563969308da912a18205e0ca7814.
Binary: be96b992178b1e467c225800da0d65f2c86d5eba1ef0b14632f65db381cbdfde, CLI0.154.0.
Requestedgpt-6-astra; responding model identity unverified. Actual trials:

1. Rich synthetic P19 run9f9b3d139d3641f1b423a147b31e8501 at22:20:36-22:21:11UTC:
   1attempt1artifact machine_reviewed; companyunknown and2peopleunknown. Current-person2,
   potential_conflict1 plus fundingidentity/event/coverage1each. No predecessor-relation
   actual proof in this fixture. This proves runtime/bindings, not positive source support.
2. Editorial16f17d9de7e74fd4ba2a61c5d9a0db49 at22:21:36-22:22:38UTC:
   3calls3artifacts0repair human_review, no human decision.
3. Public prepare118 at22:24:37UTC returned4adapters in10,198ms. All trials invalidated
   capabilities and deleted runtime roots. Evidence: ORCH/public-prepare-118-evidence.json.

ORCH is C:/Users/danie/kb/_private/prospecting-orchestration-20260911. Synthetic native DBs
are under MAIN/_private/p19-native/<run>/store.sqlite and
MAIN/_private/prospecting-native-stage-acceptance-20260911/<run>/store.sqlite. Retain evidence.

## Final whole-project verification

The single full run finished:2,087tests,2,082passed,5failed,0errors,0skips in1,245.491seconds.
ORCH/full-suite-123.xml is the retained JUnit evidence. Root independently parsed its totals.
Two environment-sensitive failures passed focused reruns together in2.33seconds. The command
used Python313 -B -m pytest -q -p no:cacheprovider on exactly the two nodes below, with
--basetemp ORCH/pc-123-rerun and PYTHONDONTWRITEBYTECODE=1 / KB_PROSPECTING_NO_NETWORK=1.
No focused JUnit was retained; the full JUnit is retained. Failed nodes:
- test_pipeline_cli::test_person_scope_translates_stale_source_without_private_projection
  refused an ordinary TEMP store with store_private_root_required; proper private basetemp passed.
- test_review_app::test_control_status_and_process_are_scoped_typed_and_csrf_guarded saw
  ConnectionAbortedError/WinError10053; focused rerun passed.
Three unresolved tests are human-owned recorded evidence: test_p6_manifest_is_numeric_and_complete,
test_p2_00_p1_record_verifies andtest_p4_00_p1_record_verifies. Do not claim a green full suite.
No product regression was demonstrated. No tests/manifests were changed to erase these failures.

## What did not work and why

- First real qualification used one attempt and failed qualification_output_invalid after
  native JSON schema acceptance. Dynamic source binding was stricter than the old prompt.
  Rejected raw payload was intentionally not retained. Do not recover or print model prose.
- The proposed retry was REJECTED BEFORE EXECUTION by automatic approval review: sending
  private pilot prospect/source context to the native runtime needs explicit transfer approval.
  User question pending: approve saved context transfer to the existing native Codex runtime
  for bounded nonsending qualification. No attempt was consumed. Do not retry indirectly,
  switch destination, call another real item, or treat silence as approval. Continue independent work.
- Supported computer-use inventory is apps[]/browsers[]. No actual visible UI acceptance or
  fresh browser capture is claimed. Do not use alternate CDP, headless, raw HTTP scraping,
  browser installs or new permissions to bypass this boundary.
- Read-only verifier initially used migrating open_store; later URI interpolation misread#paths;
  then conditionalimmutable ignored concurrent WAL. All three are repaired and independently
  checked. Keep normal mode=ro/query_only locking and exact URI/file identity.
- Historical P6 numeric manifest and recorded P1/P2/P4 gate evidence are human-owned and stale.
  Do not edit or bless MANIFEST.sha256, recorded gate outputs or evaluator manifests.
- Claude hit session quota;99/100returned synthetic limit sentinels with no model work, not
  model-identity mismatches. Reset advertised00:10UTC; wait for requested00:30 routing switch.
  Native Codex collaboration exposes requested models but not verified responding identity.
- Full-suite slowness is not a demonstrated hang: nested gate subprocesses completed and outer
  CPU advanced. An initial worker suspected unbounded accept based on stale no-child evidence;
  this diagnosis was rejected after actual child processes were observed. Do not change tests
  or kill a healthy run based only on a waiting parent.

## Publication and metadata approval

SourcePR181 is OPEN/DRAFT at35ac5517 with its updated title/body. Coordination branchb88dfcd8
was published normally after preserving duplicate remote history; no force push was used.
Automatic approval review then REJECTED the PR180 title/body edit before execution, stating
that publishing the prepared internal handoff/verification/project-state summary to GitHub needs
explicit payload/destination approval. A separate asynchronous approval question is pending.
Do not retry that summary or publish its rejected content indirectly while approval is absent.
Current PR180 description is unchanged; the branch commits are already there. Latest local
handoff/status updates and source plan5518114a are held locally, not pushed after this rejection.
Prepared summary: ORCH/pr180-body.md andpr180-title.txt. User may approve it or retain old text.

The remote coordination commitae3573e3 was patch-equivalent to a local earlier commit. Independent
130 confirmed current handoff/cost/memory files contain its full text plus later append-only
material; normal merge retained those complete versions without duplicating cost rows. A later
plain pull--rebase tried to replay that same duplicate; it was aborted, restoringb88dfcd8.
Fresh origin/ops was verified as an ancestor. Preserve published merge ancestry on future sync;
do not force-push or repeat an unnecessary history rewrite to refresh metadata.

## Real private pilot exact state

Store: MAIN/_private/prospecting-startup-pilot-20260909/store.sqlite. Backed up before
normal migrations throughP24 at snapshots/operational-validation/
1113f94b77ae4569a842472b3006e4b8.sqlite. No source-confirmation, approval, execution or send rows.
Runprun_3aa69faabfd556a49f8db1534604b26c; campaigncamp_cc3b012c99074255.
Intake473e96d90c376752fe4a04f38ccd27c372f9640edfbe73d51d0db0febd49559d.
Qualification batchpqba_c9a7805e2b3d5e9db76cf6ea9cfcc0ce,
hash7de1407868b8272e49c6dc66d7bf1962c636705ba81a515843b7986b2353b494.
Items: pqit_5bde1251b64050cfb05ac2aa0f6071e7 (2candidates,1of2attemptsused),
pqit_69151cb72aae5df797e3a53f615cb4d9 (3candidates,unattempted),
pqit_a108c11d3b8f59cf9db6614508570236 (0candidates,unattempted).
First failed attemptpqat_c33f500a6a78467ea5c5c983d237c9ab at21:59:16-21:59:53UTC,0artifacts.
Rejected retry requestd69e6f57-abf9-4e69-83cc-89315f93dc22 is UNUSED.
Use public --qualification-project/--qualification-scope for fresh opaque batch pins.
After explicit transfer approval, attempt each pending item once sequentially; no cap increase.
Only after batch machine_reviewed may --rank-scope/--rank-start/--rank-project proceed.
Zero-selection ranking is valid. One selected draft may be materialized only if actual ranking
selects it, using exact opaque P20 pins. Do not GET private review projections into logs or
invent confirmation/readiness/send authority. Actual visible UI proof still needs supported UI.

## Current files and active work

DONE: implementation, independent reviews, focused/full synthetic verification, exact actual
runtime acceptance, operator docs and source publication. Source HEAD35ac5517 is on draftPR181.
No source implementation remains under review and all worker test processes finished normally.
Private .tmp artifacts are untracked and not source changes. Real transfer and visible UI remain gated.

Task123 completed; PID39720 and its nested children exited. Do not restart this expensive whole
suite without a source change or new failure. Full suite classification is above. Task121/128
PR text is ORCH/pr181-body.md/pr181-title.txt and was published. Coordination branch b88dfcd8 is published and contains the canonical handoff. PR180 title/body
update was rejected before execution; its prior description remains. No main/ops merge or deployment
was performed. Latest local metadata checkpoints are intentionally not republished pending approval.
KeepawakePID17176 has a bounded lease endingabout07:16UTC September12. Do not stop it while
owned work remains. Preserve prior .tmp/pilot-flow-audit* and unknownprospecting-pytest roots;
currentfailedtemp .tmp/pc-7d91a4e2 andpc-80b4d2c1 may be cleaned only after verified unused.
Do not sweep unrelated worktrees. Delivery is unmerged and must remain leased.

## Claude routing on resume

After00:30UTC, prefer the existing source-only helper ORCH/run_vm_proposal.py to dispatch
bounded code-only proposals on the helper's existing vCPU destination. Existing CLI2.1.257 lives at
/var/lib/kb-shell/home/.local/bin/claude under uidkb-shell. Use existing source-only/systemd
resource bounds and no tools; never send desktop private data. Opus/sonnet returned verified
claude-opus-5/claude-sonnet-5 in assistant model fields before the limit. Verify actual model
from returned logs, local input hashes and allowed outputs before applying any proposed patch.
Do not reconfigure global auth/security or copy credential objects. Native Codex fallback is
allowed while quota remains; its requested model identity is recorded as respondingunverified.

## Exact next step

If explicit private-data-transfer approval arrives, confirm the exact current public P19 scope,
then resume the first item's one remaining attempt using the reviewed public CLI/new accepted
bundle; continue the other two items once each. Keep all authority/send gates unchanged. If
approval is absent, do not make any real-data model call. Supported browser availability is a
separate requirement for visible UI acceptance; do not invent an alternate acquisition path.

Source work and independently available verification are complete. A PR180 summary edit also
awaits explicit approval; leaving its current description does not block source review. Human review must refresh
recorded P1/P6 evidence and consider draftPR181/coordinationPR180; no agent manifest blessing or
main/ops direct push. Preserve this handoff until the outstanding real/UI acceptance is resumed.

## Load list

- CLAUDE.md, governance/agent-rules.md and BOSS.md.
- orgs/prospecting/contract.md and _index.md in DELIVERY; STATE.md in COORD.
- queue/working/01K4KB00000000000000000002.md in COORD (ownercodex-worker).
- docs/superpowers/plans/2026-09-09-prospecting-startup-pilot.md in DELIVERY.
- docs/superpowers/reviews/2026-09-11-prospecting-selected-native-acceptance.md.
- docs/superpowers/reviews/2026-09-11-prospecting-capture-authoring.md.
- orgs/prospecting/runbook-acquisition.md and memory/codex-worker.md.
- Skills: .agents/skills/code-review/SKILL.md, security-review/SKILL.md, save-session/SKILL.md.
