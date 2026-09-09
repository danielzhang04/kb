# Prospecting review app handoff - 2026-09-09

Active session; user directed the remainder to run asynchronously through the full plan.
This file is the current checkpoint. Earlier commits and private receipts preserve history.

## Goal and boundaries

Industry chats and jobs: outreach brief -> qualified leads and evidence -> personalized draft
review and feedback -> separately approved scheduling. Small standalone local app; the other
terminal owns the main KB dashboard. Local records and draft content stay on desktop. No live
sends, paid vendor calls, automatic approval or T0-to-T1 graduation. Source-only VM workers do
not inherit desktop files, tools or connectors. No production VM changes or credential copying.

Read CLAUDE.md, BOSS.md, governance/agent-rules.md and project contract; preamble before tasks.
Identity codex-worker / codex-worker@agents.local. All new workers Codex. Coordination only via
protected PR path, never direct ops/main push. No governance, applied migration or MANIFEST.sha256
edits/reblessing. PII never enters Git, argv, stdout, logs, cards, ledgers or VM sinks.

## Next steps and exact ownership

1. vm_review ACTIVE: exact synthetic fixture migration and focused PII guard regression. One new
   allowlisted JSON file, existing validation unchanged. No blanket test exemption or VM detector
   weakening. Full staged files must pass; inherited guard self-tests may need fixture reconciliation.
2. remote_protocol ACTIVE READ-ONLY: clean consolidated source delivery audit against origin/main,
   exclude inherited memory/coordination and inspect full-main-diff guard/dependency implications.
   Also verify final VM review's wrong-handler finding against actual campaigner wiring.
3. gate_repair ACTIVE DOCS ONLY: update source plan and acceptance report. Producer/count source
   frozen. Count(DISTINCT selected.person_id) fix plus duplicate-contact regression:17passed.
4. Root accept final small deltas, run affected checks, commit source through normal hooks and an
   explicit branch PII staging check. Prepare one consolidated main PR with exact reviewed source
   scope. Finish coordination/handoff and stop session keep-awake only when actually ending.

No VM jobs are active. All31owned jobs collected/cleaned and exact absence verified.
Root exec51118 completed54tests; no test session awaiting collection at this checkpoint.

## Worktrees

- Main C:/Users/danie/kb remains claude/boss-2026-09-02; preserve unrelated work, never switch/clean.
- Source C:/Users/danie/kb/_private/codex-worktrees/prospecting-e2e-20260908,
  branch codex/prospecting-e2e-20260908, HEAD44865973. Sparse checkout.
- Coordination C:/Users/danie/kb/_private/codex-worktrees/boss-remote-context-20260908,
  branch codex/boss-remote-context-20260908. Pull/rebase origin ops immediately before writes.
- Original C:/Users/danie/kb-worktrees/prospecting-p8, branch claude/prospecting-p8 at52067386;
  tracked clean plus3old untracked documents; preserve.

Accepted source commits include prerequisites dc7f8bcd, VM protocol07a89391/08726aba,
campaigns/P9 9b22fd34, workflow/cadence3ebcd431, runbook5bd88306, P11 QAefa5f9e2,
access docs44865973. Uncommitted accepted source: provenance/fill/templates plus tests,
campaign form compatibility, app HTML/Python, ReviewService/P10, UUID validator and joined test.
Runbook uncommitted correction: app prints root URL, first visit redirects /bootstrap within60s;
NO URL token. Session lasts8h. Current fixture/doc changes still active; wait for freezes.

## Accepted implementation and verification

- P8 facts bind selected current company, normalized signal-linked rows and actual observed text.
  Non-first school/prior/path facts supported; current/prior assertions separated. Required slots
  only; board/portfolio followup signals included; token-bound names avoid substring matches.
  Fill rows need at least one fresh validated strong/medium HTTPS signal; stale IDs do not count.
  Zero-proof candidates substituted and evidence_unresolved shortfalls reported. Weak fact gates
  remain intact. Per-candidate SAVEPOINT protects revisions/evidence/P11; no legacy QA backfill.
- ReviewService/HTTP: authentic stored QA, immutable edits/lineage/feedback, exact approval and
  schedule projections, historical access, custom-store scoped anchors, typed step0 preparation.
- UI: campaign request generations guard stale loads/create responses, scoped refresh, immediate
  empty/newcampaign clearing, unsaved edit/feedback version preservation and payload-aware retries.
  Root5tests execute actual bundled JS using DOM/fetch doubles; worker13HTTP/integration passed.
  These are not visual/browser QA. No browser connection available, no server currently active.
- Root220combined producer/fill/service/QA/campaign/HTTP passed74.63s before tiny final count fix.
  Builder final count suite17passed3.60s. Root54contracts/release/executor passed9.58s after UUID fix.
  Earlier89campaign guard/inbound/reply/approval/T1 safety tests passed; earlier115P11 tests passed.
- Revision builder produces canonical UUIDv4, previous request validator accepted only typedrev.
  Narrow helper now allows canonical lowercase RFC4122UUIDv4 or existing rev_<16hex> only for
  revision_id. Other payload/ownership/hash/approval validation unchanged. Builder32contracts,
  1joinedT0,22adjacentpassed. Store64passed with1environmentfailure:Datasette launcher unavailable.
- Joined T0 test uses actual CampaignService, drafting, stored edit/feedback, synthetic verified
  human approval, CLI activation, enrollment, build_live_service, release and Executor+FakeGmail.
  One draft, retry no duplicate, inbound reply stops/cancels followup, zero gmail_send rows.
  Lead selection/evidence are seeded synthetic inputs for an unconstrained manual brief; this
  does not establish live mining or general P8-to-P2 qualification. No T0-to-T1 owner exists.
- Workflow/outbox/cadence preserve saved two touches, exact local context, no raw ask argv,
  exclusive/reparse-safe recovery. SSH saved-request resolver and inspector unavailable park
  explicitly. No fabricated successful gate or qualification bridge.

## Final VM review adjudication

Latest revision-id-final-review-20260909 id57f1df1bfb3c4d9bb1190253fc54afed ran09:21:57-09:22:57UTC,
requestedSol. Collected report hash a1f0682667f2bbd6e5b30904b2cfdb40aab13266d369ffb896cffa3f80bcb1a4.
Input-validation analysis accepted the helper; finding claims campaign UUID reaches reply_revision
handler. Root source inspection shows campaigner/wiring.py attach_campaigner explicitly replaces
that adapter with campaign revision hash + unique delivery resolution. Actual joined test passed;
remote_protocol confirming real service wiring before root closes context-omission finding.
Job cleaned; exact directory/mount/3units absent. Prior final provenance reviewerdd7baf47 READY,
reportf5a5b37925ddb30497f8ce2edaafc3b115af2c7af25f1040773cfff3adab27f5, also cleaned/absent.

## Real local-copy trial - completed, blocked safely

Private C:/Users/danie/kb/_private/prospecting-first-draft-acceptance-20260909/store.sqlite.
run_trial.py --source-accepted ran only on COPY with network disabled. counts-result.json:
2candidates,0revisions,2qa_failed,evidence_identity_source_mismatch:2,0QAcontexts,0externalops.
Original store read-only verification:0revisions,no review_candidate or P11context tables.
Six cached snapshots were copied only locally after SHA/size/path checks. No observations rewritten.
Current-role source bindings require verification; named/title/company cooccurrence is not proof.
Never relax provenance to manufacture successful drafts. No real messages exist for human review yet.
Harness used original anchors in memory only. Custom app store requires its own sibling anchors;
the trial has none copied, so app preparation would correctly block. No ambient fallback.

## VM lifecycle and recovery

Private receipts: C:/Users/danie/kb/_private/dev-jobs/<job>/receipt.json. From source use
python -m scripts.prospecting.dev_vm status|collect|collect-failure|cleanup <receipt>.
Recover existing ID; never blind relaunch. Collect/hash local outputs before exact cleanup, then
verify /var/tmp/kb-prospecting-ID, output mount and service/lease.timer/lease.service absent.
Existing Codex0.152/systemd/bwrap, RO explicit source, tmpfs output/private HOME,2GB/200percent CPU,
bounded deadline and collection lease. Tool-disabled VM coding was unreliable; native Codex workers
performed local source edits/tests while VM workers reviewed source. No desktop inference claim.
Astra required newer CLI; no upgrade. Actual response model unavailable, subscription cost unknown;
ledger0 placeholders do not mean free. No guarantee of zero system/provider logs, reboot recovery,
unlimited offline retention or laptop-lid behavior. Production services/files unchanged.

## Publication and PII staging

PUBLIC origin https://github.com/danielzhang04/kb.git. Earlier combined amend+push rejected before
execution by automatic approval review for unverified sensitive destination/history rewrite.
No subsequent push/amend. Do not bypass. Prepare exact source-only diff before a normal publication
attempt; report any remaining auto-review block explicitly. Draft coordination PR180 targets ops;
no main PR yet. No operational context should be blindly included in public source delivery.

origin/main...sourceHEAD has350committed paths including inherited P1-P8 and memory/claude-boss.md.
Private delivery scope/pr-body drafts under _private/prospecting-session-delivery-20260909 need
refresh;349source paths proposed excluding memory. Prefer a clean source tree delta without
inherited operational history; dependency/staging audit active. Private scan metadata under
_private/prospecting-outgoing-scan-20260909.json:192candidate lines42files, mainly reserved.test
fixtures, intentional guard cases and hash/date/SSH falsepositives. Never print candidate PII.
Current24file stage guard and entiremain diff are separate checks. Actual hooksPath points to main
.githooks without branch PII call; explicitly run branch guard rather than rely on hook mismatch.

## Keep awake / runtime

Owned helperPID12044, root_private/prospecting-awake-20260908.py/.json,12h lease expires
1788952318.889 (~11:11UTC). Fresh heartbeat and low CPU. Stop via exact .stop file at session end.
No other terminal helpers/power settings touched. Python313 executable:
C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe (pytest/tzdata available).
Default312 lacks tzdata. No installs. Test temporary directories are private, owned cleanup only.

## Load list

- CLAUDE.md, BOSS.md, governance/agent-rules.md, _index.md, MEMORY.md, memory/codex-worker.md
- orgs/prospecting/{contract.md,_index.md,STATE.md,runbook-p8.md,deployment.md}
- docs/superpowers/plans/2026-09-08-prospecting-end-to-end.md
- docs/superpowers/specs/2026-09-08-prospecting-review-flow.md
- queue/working/01K4KB00000000000000000002.md
- this handoff, handoffs/2026-09-08-kb-boss-remote-execution.md and exact private receipts as needed
