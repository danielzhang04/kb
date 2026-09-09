# Prospecting end-to-end handoff ? 2026-09-08

## Context
User assigned this boss to finish prospecting: outreach ask -> qualified leads -> cleaning/fit ->
polished local UI -> evidence-backed drafts -> reviewed campaigns/scheduling/results. All NEW workers
are Codex with model depth chosen by assignment; adversarial reviews and tests throughout. Main changes consolidate into one
session-end PR. Remote work must be isolated, monitored, recoverable and cleaned after collection.

## Current state / what worked
Own source branch codex/prospecting-e2e-20260908 at P8 52067386; isolated worktree under
_private/codex-worktrees/prospecting-e2e-20260908. Original P8 worktree preserved.
Plan: docs/superpowers/plans/2026-09-08-prospecting-end-to-end.md.
Evidence: orgs/prospecting/output/2026-09-08-baseline-review.md.
All seven historical gate record artifact sets (285 hashes) match original source. No fresh full suite.
Read-only live counts: 42 companies, 96 people, three campaigns, 95 affinity rows; zero revisions,
enrollments, deliveries and inbound. Sender input files exist; not read or modified here.
Remote Opus narrow review completed in 18.73 seconds; actual streamed model claude-opus-5.
Session 86c2f920-7b12-49be-bfc8-8131d5dc5213; session persistence disabled, exact-session scan empty.
Receipts on desktop root _private/prospecting-prerequisite-review-20260908. Auxiliary Haiku usage
reported by CLI; not a deliberately dispatched worker. No remote task directory or installs made.
Real desktop Python 3.13.7 probe: P1 verify-recorded passes; workflow verifier rejects that exact
contract with P1_recorded_gate_required. Independent review confirms old marker/record assumptions.
Two synthetic asks reuse fixed campaign/profile IDs. Existing scheduler emits four touches while
P8 approval specifies two. UI directory absent; old P7-UI design predates P8.

## What did not work
Broad tool-disabled review hit its 100-second deadline with no accepted result; narrowed review
succeeded. Do not treat the broad attempt as reviewed. Sandbox Python 3.12 lacks tzdata; use the
existing user Python313 runtime for small desktop-specific checks. Sparse checkout initially missed
.githooks/pre-commit; materializing the tracked file restored recorded-gate verification.

## Confirmed scope / exact next step
All six questions answered: industry chats and jobs; draft review/feedback first with separate
explicit drafting/sending graduation; agents on VM and records local; standalone small polished
prospecting app linked from kb project; use prior Recruiting.xlsx and VC List.xlsx as examples;
keep desktop awake all session, reconnect to existing jobs after network recovery. Temporary
source-only recovery state is allowed until collection and cleanup. No PII on VM.
Read-only workbook category/header synthesis lives root _private/prospecting-reference-synthesis-20260908;
originals unchanged. These are historical examples, not current campaign preferences. Google Sheets
not inspected. Desktop keep-awake PID12044, root _private/prospecting-awake-20260908.json and
matching .stop sentinel, 12-hour bounded lease; renew if needed and stop only our helper at close.
VM Codex0.152.0 authenticated ChatGPT; native binary under kb-shell .local/lib/node_modules/@openai/
codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex.
Final pre-steering Claude builder timed out220s with no accepted code. Do not relaunch Claude.
Native Codex bootstrap agents: gate_repair Sol, remote_protocol Sol, vm_runner Astra. Model override
is requested model; actual response id unavailable from native tool so do not fabricate verification.
Nested Codex sandbox failed namespace creation inside working outer bwrap; do not change global
VM security. Prove tool-disabled runtime and synthetic lifecycle first, then enable only verified
capabilities. Current plan is authoritative; agents may have uncommitted changes in own source tree.

## Boundaries and untried work
Existing prospecting contract forbids all real PII and message content in VM sinks. Live SQLite,
Chrome, Gmail/vendor operations stay desktop-local; remote builders use source + synthetic fixtures.
No live sends, external messages, paid vendor calls, production changes or migrations performed.
No detached worker setup, offline recovery, tool-capability parity, or cleanup lifecycle accepted yet.
Remote systemd-run and bwrap exist. Literal zero system/provider logs cannot be guaranteed.
No new PR; existing orientation ops draft #180 predates the clarified no-small-PR preference.
Coordination changes staged on its own codex branch; no direct ops/main push.

## Latest checkpoint (23:50 UTC)

Synthetic remote lifecycle passed: job51194c542db64d0a81a2e39e4c7e1f82 ran23:45:49-23:46:09UTC
after launchSSH exited; freshSSH observedsuccess+emptycgroup; two collections returned identical
hash. Cleanup and independentabsencecheck verified exactroot, mount andall3transientunits absent.
Receipt root_private/dev-jobs/synthetic-recovery-20260908/receipt.json records cleaned state.
Source evidence: orgs/prospecting/output/2026-09-08-remote-worker-proof.md. No currentownedVMjob.
This was syntheticnoauth/nonetwork, not actualCodex, forcednetworkloss orVMrebootproof.

Application gate repair is independently READY:29focused+12adjacent tests andrealP1-P4prerequisites
pass. P4 initialmismatch was two sparseomitted skills/imported directories; materialized original
trackedbytes, no manifestchanges. Files p5_contracts.py/test_p5_contracts.py uncommitted inownsource.
Historical P5/P6/P8 gate hashes now stale bydesign; noagent reblessing allowed.

New files dev_jobs.py/dev_vm.py andtests are notyetaccepted. Independentreviews found sensitive.env
pathfiltering/rootancestor gaps invalidator and runnerpreamble/status/staging/receipt/stateissues.
Active nativeCodex work split (allshareownsourcebranch):
- gate_repair (Sol): campaigncreation/resume service, new schema_p9.sql only, synthetic tests;
  report CLIintegrationchoices before changingcompiler/wiring; previousgaterepair independentlyreviewed.
- remote_protocol (Sol): fix2validatorfindings then5VMrunnerfindings. Own dev_jobs+dev_vm tests/docs.
- vm_review (Sol): credentialfreeCLItoolinventoryprobe harness atroot_private/prospecting-codex-capability-probe.py;
  noSSH fromworker. It independentlyreviewedrunner andwillrereviewfixes. PriorAstra vm_runner thread
  completed; cannotreopen whilethreadlimitfull, soSol tookoverboundedrepairs.

Root has revisedproductdesign docs/superpowers/specs/2026-09-08-prospecting-review-flow.md:
Campaigns/People/Drafts/Schedule/Activity; sharedtypeddesktopservice, distinctcampaigns, localfeedback,
immutablerevisions, editorialready distinctfromsendapproval. Designneedsindependentreview beforeUIbuild.
Next: reviewprobeharness, runcredentialfreeCLIinventory, repair/verifyrunner thenactualtool-disabled
Codex job; timeout/descendant/forceddisconnect andcleanup. Continuecampaignservice+UIverticalslices.
VMsystemPython3.14.4 has nopytest; noboundedstandardvenvfound. Tempdependenciesfortestsnotyetstaged.

## September 9 resume and publishing restriction

The session resumed at 04:01 UTC. The preamble passed and our keep-awake helper remained active.
There were no owned VM jobs to recover or relaunch; the synthetic proof was already cleaned.
Workers continued their existing assignments. Source commit `dc7f8bcd` records the independently
reviewed prerequisite repair, revised product design and synthetic VM evidence.

Automatic approval review rejected a combined local amend and coordination push. It cited an
unverified external GitHub destination and history rewriting. That command did not execute.
Read-only verification then established that `danielzhang04/kb` is PUBLIC, and draft PR #180 is
open from `codex/boss-remote-context-20260908` into `ops`. Do not silently publish the new operational
handoff/ledger content or bypass the rejection. Keep these changes local; prepare an exact outgoing
diff for any required publication approval. New local commits remain permitted; do not amend history.

Campaign service implementation preserves the existing persisted `camp_<16hex>` ID contract,
using UUID randomness and an internal compiler UUID. Literal briefs, fit text and request metadata
stay in local SQLite; no live data has been opened by workers. The credential-free tool-inventory
harness exists at root `_private/prospecting-codex-capability-probe.py`, pending root execution.
It uses an empty runtime home, fake loopback provider and isolated network, never ambient auth.

## Capability checkpoint (September 9, 04:15 UTC)

Root executed the credential-free harness. With the restrictive `:root=deny` internal profile,
Codex failed during AGENTS.md loading because its nested sandbox cannot create a namespace.
With `permissions.job.filesystem={":root"="read","/output"="write"}` inside the SAME narrow
outer bwrap, the actual installed Codex 0.152.0 contacted the fake loopback Responses provider.
The captured outgoing request had `tools=[]`, count zero, and no configuration warnings.
Exit code 1 is intentional: the fake provider returns HTTP 400 after inspecting the request.
This is a tool-inventory proof, not a successful model response. Both probes had no auth mount,
no external network and no persistent VM task directory; their temporary files lived in tmpfs.

Independent reviewer vm_review accepted the root-read profile within this exact outer filesystem
boundary. The trusted CLI can read its ambient auth bind; no model tool can read it. Keep all
shell, unified execution, patch, apps, snapshots, MCP and web tools disabled, fresh runtime homes,
and no global config/skills/plugins mounts. The probe did not exercise the real auth/default
provider or output-schema flags. Actual Codex execution remains pending runner re-review.

Active assignments remain:
- gate_repair: finish campaign creation/resume service and new P9 migration with synthetic tests;
  propose safe explicit CLI inputs before wiring. Preserve persisted camp_<16hex> IDs.
- remote_protocol: validator fixes plus the five independent runner findings; tests and docs.
  Freeze scope and finish verification. Runner has grown substantially; avoid new framework work.
- vm_review: independently re-review repaired runner once stable, using the capability evidence.

Exact next action: collect each worker's ready report, run independent re-review, then create a
new local receipt for one small authenticated tool-disabled Codex job. Do not reuse the old
cleaned synthetic receipt as a new job. Collect status/output/evidence, record observable model
identity honestly, clean exact resources and verify absence. Then prove timeout/descendant and
forced-disconnect recovery, stage temporary test dependencies, and continue product/UI slices.
There is no main PR yet and no owned VM job remains running. Operational publishing is still
held by the automatic-review rejection; only local commits were made after the rejection.

## Files and Load list
- CLAUDE.md; BOSS.md; governance/agent-rules.md; orgs/prospecting/contract.md
- Source worktree docs/superpowers/plans/2026-09-08-prospecting-end-to-end.md
- Source worktree orgs/prospecting/output/2026-09-08-baseline-review.md
- orgs/prospecting/runbook-p8.md; doctrine.md; deployment.md
- scripts/prospecting/run_workflow.py; manager/p5_contracts.py; manager/desktop_stage.py
- Original boss checkout docs/superpowers/specs/2026-09-04-prospecting-p7ui-amendment.md
- Root _private/prospecting-prerequisite-review-20260908/stdout.json
- Skills: code-review, security-review, loop-design-check, save-session
Old 2026-09-07 prospecting handoff was consumed by this pickup; Git history retains it.


## Execution checkpoint (September 9, 04:32 UTC)

Independent reviews closed all five runner and both validator findings; focused checks reached
59 tests plus 14 subtests after the startup-cap correction. Real Codex exposed two runtime cases.
First authenticated job 09bd8603332c4bc9997729435f35bafa exited 153 with empty events/stderr.
Failure evidence was collected; cleanup and independent absence verification passed. Controlled
credential-free probes proved the 1 MiB process file limit causes SIGXFSZ before a request;
128 MiB reaches the fake provider with tools=[] and no warnings. The finite 128 MiB process cap
was independently reviewed; output tmpfs and proposal caps remain 16 MiB / 1 MiB per file / 8 MiB.
Diagnostic files larger than 1 MiB still refuse collection; this residual is documented.

Second Codex job 0703893fb4cc4101bfe597fdbf697c79 ran from 04:29:55 to 04:30:01 UTC and exited
successfully. Its systemd active/exited status has an empty ControlGroup, which is normal after
completion. Current ownership validation incorrectly rejects that terminal tuple and status
changed local receipt to start-failed, blocking normal collection. remote_protocol is fixing this
narrow case plus preserving terminal collected states. DO NOT rerun or manually edit the receipt.
After review, inspect_status should recover the existing job, then collect and clean. Receipt:
root _private/dev-jobs/codex-proof-cap128-20260909/receipt.json. One-hour collection lease is active.

Campaign create/resume service is ready for independent review: 100 focused checks on desktop
Python 3.13 passed across campaigns/compiler/fit/P3/schedule/guards. P9 is additive. Literal briefs
must enter CLI through --ask-file (and optional --fit-file), never message bodies in argv. Gate
worker is wiring explicit create/resume/dry-run file options. vm_review is reviewing campaign
service then building loopback HTTP/UI; remote_protocol will build typed review projections,
immutable edit lineage and local feedback in review_service.py with additive schema_p10.sql.
The reviewed UI has five tabs and only real service actions; send approval remains separate.
No live DB mutation, outreach, provider-vendor call, or main PR has occurred. All progress remains
local because operational publishing remains held by the earlier automatic-review rejection.


## Product checkpoint (September 9, 04:53 UTC)

VM acceptance milestone completed and committed locally: 07a89391 runner/protocol/docs and
08726aba regression file (separate commit because sparse checkout initially omitted root tests).
Final focused61 tests+16 subtests. Successful Codex0703893f output exactly matched, 18 bytes,
hash c444a439170d94a4cbca68db93f29a81dbf504b8eab4f53ad587dd4e891056e3. CLI usage8677 input,
31 output, no responding-model field. Recovered via status after terminal-cgroup correction,
collected and cleaned with independent absence verification. Timeout43a571d8 expired after10s;
child42b6ca57 was contained by PID namespace immediately (not a deadline test). Forced SSH loss
be8ff799 completed the same job on reconnect, collected twice identical; all exact resources
absent. Proof document has full IDs/times, scope and limits. No claims of desktop connector parity.

VM cadence review59ecdc91 ran78s, returned advisory file, collected/cleaned/absence verified.
Root accepted scheduler/step/revision findings and rejected its send-trigger finding as outside
complete evidence (actual store/executor has stronger approval checks not staged to reviewer).
Advisory stays root _private/dev-jobs/cadence-review-20260909/output/. Two current VM jobs:
- cadence-build-20260909/receipt.json: baa114492a344fcaaca63f0b3aa3823b, started04:44:30UTC,
  deadline600s+collection3600s. Full-file proposals for schedule/release/compiler and their tests;
  saved two-touch cadence, distinct per-step revisions; no applied migration or approval edits.
- workflow-cli-review-20260909/receipt.json:609235685f7648ddb55eaf16a241ab9f, started04:49:26UTC,
  deadline300s+collection3600s. Independent review of changed run_workflow/tests with staged context.
Monitor these receipts; collect/validate locally before cleanup, verify local base before applying.

Campaign service independently READY after fixing mutable projection/hash drift and unknown
policy-key leakage; committed9b22fd34 (campaigns.py/P9/test_campaigns).27 adversarial focusedpass.
CLI integration run_workflow/test_run_workflow is uncommitted, builder gate_repair reports ready:
explicit local file inputs, saved IDs, dryrun read-only DB clone/memory migrations, no literalsargv.
Independent VM review active. Gate now analyzes fill->qualification->draft preparation gap.
Read-only local count check:96people,3legacy draft campaigns,6evidence,0eligibility/0revision,
222fill_person,11872source_observation. No liveDB changes; raw contents never printed/staged.

remote_protocol owns new review_service.py/P10/tests. Edits must preserve failed/pending candidates;
never inherit/fabricate passing QA. Parent revision lacks original slot-source bindings, so actual
runtime QA availability must be honest; injected synthetic adapters are not live proof. No generic
framework expansion. vm_review owns review_app.py/review_app.html/test_review_app.py, polished local
five-tabUI, guided fields and automatic hidden idempotency keys, bounded HTTP reads/CSRF/Host.
Raw IDs and implementation jargon must not dominate UI. Other kb dashboard remains untouched.

Tasklist:1baseline and3design checked,2remote lifecycle checked;4product,5integrated acceptance,
6one main PR/handoff/cleanup remain open. Publishing still held by automatic-review rejection.
Local keep-awake remains active with original12-hourlease; stop only our helper at actual close.


## Browser-acceptance checkpoint (September 9, 05:05 UTC)

Latest source HEAD9b22fd34. Owned source worktree unchanged; native workers editing distinctfiles.
Cadence build baa11449 completed04:50:17; workflow review60923568 completed04:50:45. Both were
collected, cleaned and independently absence-verified. No code was executed from model output.
Root rejected cadence worker's test replacements: they deleted32 existing test functions, including
PII/cap/race/transaction coverage. Original test files remain authoritative. After output validation
and verify_local_base, root applied only schedule.py/release.py proposals; compiler got only the
selected two-touch default hunk, preserving original formatting. These three production diffs are
WIP, NOT accepted/committed. schedule requires saved one-based cadence, per-step revision map,
and release verifies campaign/person/step scope. Root found offset lacks finite bound; correction
job must fix <=60businessdays and reject naive due datetime before writes.

ONE active VM job: root _private/dev-jobs/cadence-tests-repair-20260909/receipt.json,
ID0a6acb59355d4ddaa78264b98541b906. Started04:57:54UTC, deadline600s+collection3600s. Last status
05:04UTC active/running~77MiB,21threads,2.5CPU seconds. Exact outputallowlist schedule.py plus
three original cadence/release/compiler testfiles. Explicit instruction preserve every original
function name/parameterization/record_property, adaptfixtures to real constraints, appendtests.
Collect upon terminalsuccess, compare original testnames, validateoutput/localbase before applying,
then run all original focusedtests on actual Python313; no manifest reblessing. Cleanup and verify.

Independent VM workflow review found two accepted HIGHs: CLI CampaignService uses --store but
DesktopBridge strips LOCALAPPDATA/KB_PROSPECTING_STORE, hardcodescwdC:/kb, and stages jobs outside
desktop_stage's allowedroot; thus realstages fail/selectwrongstore. SSH compiler registration lacks
operations and isn't --job-consuming; no valid savedrequest resolver/profilebinding exists. Root
assigned gate_repair bounded bridge/desktop_stage/run_workflow repair and realchildboundary tests.
SSH may explicitly preflightblock until configured rather than fabricateIDs. Dryrun outboxwrite
finding was originallyintentionalpreviewartifact; worker may simplify to memory-only preview.
Existing desktop_stage._inspect's grade100foranyperson and wrongqa['score'] are not valid independent
inspection; root directed explicit inspector_unavailable rather than fabricatedgrade. Do not claim
liveworkflowacceptance from mockedbridge tests.

Current native work:
- gate_repair: above CLI/bridge store/cwd/jobdir/opaqueSSH repairs+tests; afterready propose smallest
  P8fill->P2qualification->P3draft-preparation integration. No implementation of that gap yet.
  Futureproposal should persist actual P3 binding_map/QaPolicy for NEW revisions in additiveP11,
  because liveDB has0revisions and this enables authentic human-edit QA; no legacyguessing.
- remote_protocol: review_service.py/P10/test_review_service. It preserves pending/failed human
  edits and only uses build_revision after real deterministicQA. Runtime hasqa_adapter=None until
  bindingsowner is wired; never inheritpassingQA. Root found permanentcandidate_pending prevents
  correcting a secondedit: implement append-only replacementcandidate with optimistic
  expected_candidate_id, coordinateUI, no newtables. P10 brieflyhad duplicateimmutabletrigger,
  owner repairing; waitfrozen beforefreshDB. Existing tests use authenticQA knownfixturebindings.
- vm_review: review_app.py/review_app.html/test_review_app. Six isolatedHTTPtests pass; combined
  tests pendingP10. One-usebootstrap60s/session15min, exactHost, CSRF,72KiBJSON,5sreadtimeout.
  Root required guidedpurpose/industry/role/location/count/fitfields, auto hiddenUUID requestIDs,
  savedmailboxchoices, modeladvanced, human-readablelabels, no implementationjargon/rawIDheadings.
  Provide safe synthetic launch harness fromfixturehelpers afterfreeze; root hasn't openedbrowser.

UI testfixtures initially use campaign-a/person-a; HTTP requiresproductioncamp_<hex> IDs. Synthetic
browseracceptance must seed productionIDs throughCampaignService or adaptnamedhelpers withvalidIDs,
not claimmockedprojectionsproveintegration. No liveDB migration or realdraftgeneration yet.
Root read-only grammarcheck established3/3live sender_profile IDs arecanonicalUUID. Native sender
profiles can supportcreate; legacy campaigns lackP9briefmetadata andP3draftsettings.

Computer-useSKILL read plus guidance/confirmations. NativeWindows APIs disabled inthisruntime;
use exposed CUA browser entrypoint/documentation forbrowseracceptance. No CUA initialization yet.
KeepawakePID12044 stillactive, expiry1788952318.889; do notstopuntilactualsessionclose.
SourceHTTPapp notrunning yet. No mainPR or newpublicpush; earlierauto-reviewrestriction remains.
