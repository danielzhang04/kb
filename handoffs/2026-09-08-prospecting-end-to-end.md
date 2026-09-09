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
