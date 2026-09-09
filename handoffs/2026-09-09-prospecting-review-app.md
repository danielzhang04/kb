# Prospecting review app handoff - 2026-09-09

**Topic:** Industry chats and job outreach: brief, qualified leads, evidence-backed drafts,
local review and feedback, separately approved scheduling. Source delivery is complete;
real end-to-end acceptance remains open. This supersedes earlier in-progress checkpoints.

## Delivery and current state

One consolidated draft main PR: https://github.com/danielzhang04/kb/pull/181
Source implementation commit: b7365db578f8cc1aec7f933217dde2b3c41ac6e0.
Branch: codex/prospecting-session-20260909, based on main 39197cf5.
352 reviewed source/development paths; 12 operational paths excluded. No prior operational
history included. Root verified exact committed path set, clean tree and unchanged historical
seven gate manifests. No MANIFEST.sha256 reblessing. PR remains draft, not merged or deployed.
Final PR head: f049aa66 (delivery-status documentation only after the implementation commit).

All 32 owned VM jobs were collected, validated, cleaned and exact directory/mount/unit absence
verified. No active remote job or review-app server. Native Codex workers performed local source
edits/tests; isolated VM workers reviewed source. Actual responding models were unavailable;
requested model/cost uncertainty is recorded, ledger zero placeholders do not mean free.

## What WORKED (with evidence)

- Campaign persistence, scoped local resume, evidence-backed first drafts, immutable edits,
  authentic stored QA, feedback lineage and standalone review UI are implemented. The joined
  synthetic T0 test uses actual CampaignService, personalizer, stored review, synthetic verified
  human approval, CLI activation, enrollment, build_live_service, release and Executor+FakeGmail.
  It creates one draft, retries without duplication and stops follow-up after a reply. No send.
  Lead selection/evidence are seeded fixtures, not live-mining acceptance.
- Facts bind selected current employer and validated signal-linked rows/text; non-first school,
  prior role and path facts are supported. Current/prior facts remain separate. Fill requires a
  fresh strong/medium HTTPS signal per selected row; zero-proof candidates are substituted.
  Per-candidate SAVEPOINT protects evidence/revision/QA writes. No legacy QA backfill.
- UI guards stale campaign loads, preserves unsaved edit/feedback versions, and scopes retries.
  HTTP restricts Host, CSRF, sizes and local sessions. Five tests execute actual bundled JS;
  HTTP/integration tests passed. These do not constitute visual/keyboard browser acceptance.
- Root 220 combined tests passed before final small fixes; 54 contract/execution checks after
  UUID compatibility and 46 guard/fill/joined checks passed. The canonical lowercase UUIDv4
  compatibility is limited to revision_id; ownership/hash/approval checks remain unchanged.
- Final delivery verification: 282 focused legacy-fixture/runtime checks, 50 staging-guard
  checks, 24 deployment checks, 21 adjacent bridge/workflow checks passed. Root independently
  reran the three repaired deployment cases plus four forbidden-cadence-flag regressions:
  7 passed, 22 deselected. Earlier root delivery guard+joined run: 48 passed.
- Full final 352-file staged PII scan passed, whitespace check passed, skill mirror check passed.
  Normal commit hooks ran. Exact fixture validation rejects duplicate JSON keys at every depth;
  independent review accepted the fix and staged negative tests. Runtime VM PII checks unchanged.
- VM lifecycle uses explicit hashed source/skill inputs, private runtime/output, bounded
  resource/deadline/collection leases, local receipts and collect-before-cleanup. All 32 jobs
  cleaned. Latest job 9420afc590c44139a124fccb0fafefb9 report SHA256:
  28ec897b9a5fbedd6f3d296b58926c7ca54a0b435262092564d650644f8ca87e.
  Its duplicate-key finding was repaired natively and independently reviewed READY.

## What did NOT work (and why)

- Real local-copy trial: two selected candidates, zero revisions, two QA failures with
  evidence_identity_source_mismatch, zero external operations. Missing verified current-role
  source bindings must be resolved; name/title/company cooccurrence is not sufficient proof.
  Original store remained unchanged (zero revisions, no review_candidate/P11 context tables).
  Six snapshots were copied locally after integrity checks. No observations were rewritten.
- Browser connection was unavailable; visual/keyboard QA and real source verification could
  not proceed. No Playwright/alternate automation workaround was used. No real draft exists
  yet for user approval. Do not relax provenance to manufacture a successful example.
- Broad inherited 24-path suite initially returned 357 passed, 8 failures. Three were repaired:
  DesktopBridge exact signature omitted three added arguments, and two cadence harnesses
  expected obsolete raw-ask SSH commands. Remaining five cases require human-owned P6 manifest
  refresh, operational STATE for two gate tests and their nested invocation, and optional
  Datasette for the readonly launcher. These are not passing checks; no manifests were blessed.
- No sanctioned T0-to-T1 transition exists. The VM workflow saved-request resolver and independent
  inspector park explicitly as unavailable. New campaigns stay T0. A synthetic pass does not
  authorize live sends, paid providers, wider cadence, deployment or sending graduation.
- Tool-disabled VM coding was unreliable; native Codex file/test tools were used for repairs.
  VM CLI workers do not inherit desktop filesystem, connectors, tools or credentials. Astra
  required a newer VM CLI; no upgrade was made. Existing VM production code/services untouched.
- Earlier combined operational amend+push was rejected by automatic approval review due to
  destination/sensitivity and history-rewrite concerns. It was not retried or bypassed. The
  independently reviewed source-only normal branch push and draft main PR succeeded. Updated
  operational handoff/STATE/card/ledger remain local; existing draft coordination PR180 was
  not refreshed. Do not blindly publish these operational records to the public repository.

## What has NOT been tried yet

- Visual/keyboard acceptance with a connected browser, then source verification for the selected
  real candidates and another local non-sending copy trial; user reviews actual resulting drafts.
- Human evaluation refresh after reviewing changed eval content and running affected suites.
- Trusted deployment of operational STATE/gate results and independent inspector integration.
- Sending/drafting autonomy graduation, paid/live mining, production deployment, and main KB
  dashboard buttons are not accepted or deployed. Another terminal owns the main dashboard.

## Current state of files

- DONE: delivery worktree C:/Users/danie/kb/_private/codex-worktrees/prospecting-session-20260909.
  Runtime, UI, schemas, fixtures, tests, skills and source docs are in PR181; scope inventory:
  C:/Users/danie/kb/_private/prospecting-session-delivery-20260909/scope.json (352 paths).
- DONE: accepted earlier source checkpoint C:/Users/danie/kb/_private/codex-worktrees/
  prospecting-e2e-20260908, branch codex/prospecting-e2e-20260908, clean HEAD5175f408.
  Preserve until delivery is accepted; contains excluded historical operational evidence.
- WIP acceptance: this handoff, orgs/prospecting/STATE.md and assigned queue card
  queue/working/01K4KB00000000000000000002.md on local coordination branch
  codex/boss-remote-context-20260908 in its matching _private/codex-worktrees directory.
- DONE private evidence: _private/prospecting-first-draft-acceptance-20260909 contains local
  trial store/run_trial.py/counts-result.json. Live content stays local; never print or upload.
  The trial app store has no sibling sender anchors; it must be provisioned locally through the
  intended path before app preparation. No fallback to unrelated ambient anchors is permitted.
- DONE private VM receipts: _private/dev-jobs/<job>/receipt.json, reports and hashes. Keep for
  audit/resume. Never dump the receipt files property (base64 contents); read metadata only.
- PRESERVE: main checkout remains claude/boss-2026-09-02; unrelated changes/worktrees untouched.
  Original C:/Users/danie/kb-worktrees/prospecting-p8 retains its three old untracked documents.
- PRESERVE failure evidence: _private/pytest-vm-review-delivery-0909. Completed root test scratch
  directories were cleaned: 14 gate-worker, 10 VM-review-worker and 3 final root directories.
  All three root targets verified absent. Owned keep-awake PID12044 exited; status active=false
  and process absence verified. The helper released its Windows execution-state request.

## Exact next step

Connect a browser in the desktop session, load the delivery worktree and local non-sending trial,
verify the two candidates' current-role source bindings through the supported local evidence path,
then rerun the copy trial without network sends. Review actual draft wording and source links.
Keep the existing block if evidence cannot establish identity. Do not change approval/gate data.

To start the local app from the delivery worktree:
py -3 -m scripts.prospecting.review_app --store <desktop-local-store.sqlite> --port 8765
Use Python313 if the default interpreter lacks tzdata. URL http://127.0.0.1:8765/ is linked from
orgs/prospecting/_index.md. First visit bootstraps within 60 seconds; session lasts eight hours.
No server is left running. Existing project link has not been deployed into VM project files.

For future remote jobs, run preamble and recover the existing receipt ID before relaunching:
python -m scripts.prospecting.dev_vm status|collect|collect-failure|cleanup <receipt>
There is no prepare CLI action; prepare is a Python function. Collect/hash before cleanup and
verify exact owned directory, mount and three units absent. Detached recovery is bounded by the
lease, not unlimited offline retention or reboot/lid guarantees. System/provider logging cannot
be guaranteed absent; only owned artifacts are controlled.

## Load list

- CLAUDE.md, BOSS.md, governance/agent-rules.md, _index.md, MEMORY.md, memory/codex-worker.md
- orgs/prospecting/contract.md, _index.md, STATE.md, deployment.md, dev-vm.md, runbook-p8.md
- docs/superpowers/plans/2026-09-08-prospecting-end-to-end.md
- docs/superpowers/specs/2026-09-08-prospecting-review-flow.md
- scripts/prospecting/review_service.py, review_app.py, run_workflow.py, campaigner/wiring.py
- queue/working/01K4KB00000000000000000002.md and this handoff
- handoffs/2026-09-08-kb-boss-remote-execution.md (historical VM context)
- PR181 and exact private scope/receipts/trial counts as needed
