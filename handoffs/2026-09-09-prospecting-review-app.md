# Prospecting review app handoff ? 2026-09-09

Active work; this replaces the September 8 end-to-end handoff. Do not restart the baseline.

## Goal and user decisions

Finish a slim flow from industry-chat/job-outreach brief to qualified leads, personalized draft
review, feedback and an explicit sending plan. Records and PII stay on desktop; VM agents get
source or opaque work. The small prospecting app is separate from the main kb dashboard, which
another terminal owns. Later link the project to the local app. Review first; drafting and sending
autonomy graduate separately and never automatically. No live sending or paid vendor scope.

All NEW subagents are Codex, chosen by difficulty. Native Codex workers are bootstrap workers;
VM CLI execution is now proved. Do not launch Claude. Keep awake throughout this session, recover
existing jobs by receipt after disconnect, collect locally before removing exact owned VM resources.
One consolidated main PR toward session end; no small per-task PRs.

## Binding rules and publishing hold

Read CLAUDE.md, BOSS.md, governance/agent-rules.md and prospecting contract; run preamble before tasks.
Identity codex-worker / codex-worker@agents.local. Work products on codex/*; coordination reaches ops
only through its protected PR path. No governance/applied migration/MANIFEST.sha256 edits or reblessing.
Names, contacts, source excerpts, message bodies and feedback stay in local SQLite/snapshot/browser;
never Git, argv, stdout, logs or VM. Only deterministic local executor uses Gmail/vendor credentials.
Agents never read/copy credential stores. Existing Codex runtime may consume its ambient read-only auth.

Automatic approval review rejected an earlier amend+push before it executed. Read-only verification
established origin https://github.com/danielzhang04/kb.git is PUBLIC. Existing draft PR #180 targets ops
from our coordination branch. Do not bypass the rejection or publish newer operational handoff/ledger
content. Keep local; prepare the exact outgoing diff before any final publication approval request.
New local commits are permitted; do not amend. Final must disclose any remaining automatic-review block
in a short separate paragraph. There is no main PR yet.

## Worktrees and commits

- Main C:/Users/danie/kb remains claude/boss-2026-09-02 with unrelated files; never switch or clean it.
- Authoritative source: C:/Users/danie/kb/_private/codex-worktrees/prospecting-e2e-20260908,
  branch codex/prospecting-e2e-20260908, latest accepted HEAD9b22fd34.
- Coordination: C:/Users/danie/kb/_private/codex-worktrees/boss-remote-context-20260908,
  branch codex/boss-remote-context-20260908, latest prior checkpoint a31a5156; no recent pushes.
- Original P8 C:/Users/danie/kb-worktrees/prospecting-p8, claude/prospecting-p8 at52067386,
  tracked clean with three pre-existing untracked plans/reviews. Preserve.

Accepted source commits: dc7f8bcd prerequisite consumer repair;07a89391 transient VM runner/protocol;
08726aba VM regression file (needed git add --sparse because root tests lies outside cone);
9b22fd34 campaign creation/resume + additiveP9. Worktree remains sparse, hooks and imported P4 skill
files have been materialized. Run normal hooks; do not bypass them.

## What worked, with evidence

- Prerequisite repair: 29 focused +12 adjacent tests; real P1-P4 verifier passed at that checkpoint.
  Handles actual gate JSON, manifest bytes, criteria/counters and exact test count. Later cadence edits
  make historical P4/P5/P6/P8 receipts stale by design; a human must refresh affected manifests.
- VM runner: 61 tests +16 subtests, independent reviews closed five runner and two validator findings.
  Source-only allowlists, hashed receipts/output, local-base checks, fixed staging output, bounded
  systemd/bwrap jobs, cleanup leases, safe collection/failure collection; no automatic source apply.
- Actual VM Codex: job0703893fb4cc4101bfe597fdbf697c79 ran04:29:55?04:30:01UTC, exit0, exact18-byte
  output. Hash c444a439170d94a4cbca68db93f29a81dbf504b8eab4f53ad587dd4e891056e3. CLI reported8677input
  and31output tokens, no responding-model field. Requested Sol; actual identity unavailable.
- Synthetic timeout, PID-namespace child containment, forced monitoring-SSH loss, reconnect and
  duplicate collection passed. Every completed proof was cleaned and independently checked for absent
  directory/mount/service/lease units. This is not laptop-lid, packet-routing or VM-reboot proof.
- Campaign service: distinct camp_<16hex> IDs, UUID request replay/conflict, existing sender profile,
  mailbox binding, P2 target hash plus explicit P3/P4 policy fields, optional DraftingSettings. Review
  caught mutable projection/hash drift and unknown policy-field leakage; fixed, independently READY,
 27 adversarial focused tests. Earlier combined campaign/compiler/P3/schedule/guards100 passed.
- New P10 review service is READY/FROZEN per author:15 focused and78 combined tests, real QA fixture,
  append-only edit candidates/lineage/feedback/editorial state, campaign-scoped read projections.
  Independent review still required. Details below.
- Corrected real local bridge is READY per author:18 bridge/workflow +38 adjacent tests. A non-injected
  Python313 test proves store/environment/jobdir/repo-cwd consistency despite hostile ambient vars.
  Independent VM re-review is currently active.

## What failed and why

- Root-deny Codex permissions cause nested namespace failure on this VM. Do not alter global security.
  Root-read is accepted only inside the narrow outer bwrap. Fake provider observed tools=[] and no
  warnings. No shell, apps, MCP, web, global config or inherited skills; skills staged explicitly.
- Process LimitFSIZE1MiB killed Codex startup with SIGXFSZ before logs. Credential-free controlled
  probes established128MiB succeeds. Process cap now128MiB, outputtmpfs16MiB, proposal1MiB/file8MiBtotal.
  Diagnostics over1MiB still refuse collection; documented residual. No unbounded logs claimed.
- systemd active/exited can have empty ControlGroup. Fixed terminal predicate and state recovery;
  do not manually edit receipts or relaunch an already completed job.
- VM cadence builder returned useful production code but deleted32 original test functions in its
  test replacements. Root rejected those tests. Correction job0a6acb59355d4ddaa78264b98541b906 timed out
  at05:07:54UTC after600s; failure evidence collected, cleaned, independent absence verified. No output
  applied from that correction. Existing native gate_repair is finishing targeted test edits.
- Earlier workflow CLI used selected DB for creation but stripped local context/hardcoded wrong cwd
  and jobroot for stages. SSH compiler registration was incompatible and fabricated bindings. Worker
  repaired local binding and now blocks unconfigured SSH before side effects. Source review pending.
- P10 briefly had a duplicate immutable trigger; author removed it and full new-store tests pass.
- Review edits cannot inherit passing QA. Legacy revision rows lack original slot-to-source bindings;
  runtime default stores pending QA. A separate P11 metadata/adapter proposal is being prepared.

## Current VM job: recover first

Root private receipt: _private/dev-jobs/workflow-bridge-rereview-20260909/receipt.json
ID8ad64e84ccf74f3eb8893f937aa5a25a; started05:09:57UTC; deadline300s+collection3600s.
Source-only independent Codex review of five frozen CLI/bridge files, with explicit review skills.

From the source worktree, run python -m scripts.prospecting.dev_vm status <absolute-receipt> using
escalated SSH access. On exact success collect; otherwise terminal failure collect-failure. Then
cleanup and independently verify exact path/mount/three units absent. Never blindly relaunch.
No other owned VM job remains. Full prior receipts live under root _private/dev-jobs/.

VM access: ssh -o BatchMode=yes -o ConnectTimeout=10 kb@100.89.73.118. Existing runtime user kb-shell;
Codex0.152.0 has ambient ChatGPT login. Native binary and auth path are in dev_vm.py; do not inspect
credential contents. Production /var/lib/kb/ops, /opt/kb-releases/current and kb-shell-broker remain
untouched. System/provider bookkeeping cannot be erased; cleanup guarantee covers owned resources.
VM Python3.14 lacks pytest; no persistent install performed. Remote test-dependency staging is deferred.

## Active native workers and file ownership

All requested gpt-5.6-sol high, actual model metadata unavailable; no official inspector grades.
Do not create more threads: root+three agents fill slots. Old vm_runner thread is retired.

- gate_repair: now finishing cadence test integration in campaigner/schedule.py and original
  test_campaigner_schedule.py/test_campaigner_release.py/test_compile_ask.py. Preserve all original
  tests/parameterizations/metrics; add real-schema checks and per-step revision cases. Bound saved
  offset<=60businessdays and reject naive due time before writes. Production schedule/release and
  compiler two-touch hunk were selectively applied after root validation, still WIP/uncommitted.
  Five CLI files remain frozen: run_workflow.py, manager/bridge.py, manager/desktop_stage.py,
  test_run_workflow.py, test_bridge.py. Later analyze P8 selected records->P2 qualification->P3prepare.
- remote_protocol: P10 files READY/FROZEN: review_service.py, schema_p10.sql, test_review_service.py.
  913-line typed service; no new framework. Pending/failed edits can be corrected with append-only
  candidates using expected_candidate_id; stale tokens rejected. Only real injected QA creates a
  canonical revision; no default QA yet. One feedback request records pending, no generated message.
  Selection/schedule/activity are read-only. Currently ANALYSIS ONLY proposal for one immutable P11
  binding metadata table, P3 persistence, separate review_qa.py adapter and propagation to edited
  child revisions. Root must accept exact scope before implementation; avoid duplicate gate work.
- vm_review: UI builder owns review_app.py/review_app.html/test_review_app.py. Six isolated HTTP tests
  passed; combined tests now possible with frozen P10. Finish guided fields, automatic hidden request
  UUIDs, saved mailbox choices, useful user wording, no raw-ID headings or implementation jargon.
 5s read timeout, exactHost/CSRF/framing checks, boundedJSON, no logs/externalassets. Root requested
  bounded work-session cookie lifetime (e.g8h) instead of permanently unusable15min session; retain
  one-use60s bootstrap, test expiry, no refresh-token framework. Provide safe synthetic browser harness.

## Product limitations and next acceptance

No live DB mutation or draft generation yet. Read-only counts:3legacy draft campaigns,96people,
6evidence,0eligibility decisions,0revisions,222fill_person,11872source_observation. All3sender IDs are
canonicalUUID. Legacy campaign policies are target-only; one has P8 fit metadata; no P9 brief rows.
This establishes a real fill-to-qualification/drafting integration gap, not a ready outreach flow.

Root must independently review P10 and HTTP code, then launch a synthetic DB with production-shaped
camp_<hex>/UUID IDs. Some service test helpers use campaign-a/person-a, which HTTP correctly rejects;
do not confuse mocked views with integration. Create two campaigns, inspect scoped people/drafts,
edit twice, record feedback, test restart/conflict, inspect truthful scheduling/blocked states.
No sending controls or fabricated independent inspector grade. Source desktop_stage now parks when
independent inspector is absent. Dry-run deliberately writes plan artifacts but never source DB.

After synthetic UI acceptance, add the small qualification/preparation and authentic QA metadata
slices, review/test them, then trial a chosen real local brief on a local copy before source DB changes.
Complete one consolidated main change set, human-owned gate refresh/publishing approval where needed,
update STATE/card/memory, and clean only owned resources. Do not claim the goal complete now.

## Local tools, handoffs and keep-awake

Actual desktop interpreter: C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe,
Python3.13.7 with tzdata/pytest. Sandbox Python3.12 lacks tzdata. Use workspace-local pytest --basetemp.
Native Windows computer APIs disabled. Computer-use skill/guidance read; use exposed CUA browser
entrypoint and its returned documentation for browser testing. No browser or review server started yet.

Keep-awake helper root _private/prospecting-awake-20260908.py, status .json, stop .stop; PID12044.
Heartbeat active; expiry1788952318.889 (12h from start). No global power changes; does not guarantee
lid-close behavior. Stop only this helper at actual session end. Never touch parallel dashboard helpers.

Historical Downloads workbooks Recruiting.xlsx and VC List.xlsx were read locally without emitting
PII. Sanitized structure summaries in root _private/prospecting-reference-synthesis-20260908/.
They inform diverse industry/role/geography/previous-career cases, not current inferred preferences.

Other active orientation handoff: handoffs/2026-09-08-kb-boss-remote-execution.md. Consumed older P8
handoff is in Git history. Cost ledger codex-worker-2026-09-09.tsv records requested/actual unavailable,
subscription cost unknown (usd0 placeholder is not a claim of free usage); add subsequent model steps.

## Load list

1. CLAUDE.md; BOSS.md; governance/agent-rules.md; prospecting contract.
2. This handoff and queue/working/01K4KB00000000000000000002.md (owner codex-worker).
3. Source docs/superpowers/plans/2026-09-08-prospecting-end-to-end.md and specs/2026-09-08-prospecting-review-flow.md.
4. Source orgs/prospecting/output/2026-09-08-baseline-review.md and 2026-09-08-remote-worker-proof.md.
5. Current worker-owned files and the one active VM receipt. Do not replay broad baseline searches.
6. Skills code-review/security-review/save-session/strategic-compact as needed.
