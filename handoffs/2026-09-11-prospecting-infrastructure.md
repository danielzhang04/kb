# Prospecting infrastructure handoff ? 2026-09-11

Updated 2026-09-12T03:37:41.639468+00:00. Source ed929a16 published; direct P1 and inventory checks pass; full suite171 live, independent grading/record pending.

## Goal and roots

Build effective, adaptable infrastructure from saved intake through capture, qualification,
ranking, drafting and human review. Tests identify infrastructure gaps; a prospect quota is
not the deliverable. Root orchestrates, reviews, applies and verifies; workers implement.

- MAIN: `C:/Users/danie/kb`.
- DELIVERY: `C:/Users/danie/kb/_private/codex-worktrees/prospecting-session-20260909`, branch `codex/prospecting-session-20260909`.
- COORD: `C:/Users/danie/kb/_private/codex-worktrees/boss-remote-context-20260908`, branch `codex/boss-remote-context-20260908`.
- ORCH: `C:/Users/danie/kb/_private/prospecting-orchestration-20260911`.
- PILOT: `C:/Users/danie/kb/_private/prospecting-startup-pilot-20260909/store.sqlite`.

## What worked

Published source ed929a16 (docs) and c220266c (gate repair) are on draft PR181, following
browser fixture1644aa00, canonical formatc8643caf and HTTP repair7c1b2ab4. Reviewed source
is committed; only pre-existing .tmp/temp-pc-a83b4c21 remain untracked in DELIVERY.
Final merge simulation against origin/main was clean (24behind/46ahead). PR180's summary and
handoff26eb2d61 were explicitly approved and published; this refreshed coordination record
follows them on the same branch. Runtime transfer and source/HTTP publication were also
explicitly approved. No approval question remains pending.

Approved real P19 completed all three items: three artifacts, four cumulative attempts (one
historical qualification_output_invalid failure then three successes). One source-supported
company and one current-role-supported person. P20 selected one person, shortfall five;
exact replay and public projection matched. `ORCH/task134/real-pilot-evidence.json` retains
metadata. Product desktop authentication works, proved by actual calls. No repeat needed.

Real P22 initially refused copy_profile_missing. Public canonical format configuration now
succeeded, created a backup, and replayed as a read-only no-op. P19/P20 and targeting hashes
are unchanged. Public draft materialization succeeded; exact replay returned the same
binding and revision. `ORCH/real-format-draft-evidence.json` retains opaque metadata.
Authority audit: one selected_draft_binding, zero selected_source_attestation, approval,
exec_request and t1_send_attempt rows. No human attestation/readiness/approval or sends.

Tasks138/142 implemented format configuration and explicit UI; creation behavior is unchanged.
Opus148/150 independently reviewed format locks and hash boundaries. Canonical-only setup
updates policy_json inside an owned transaction, validates saved campaign integrity, refuses
missing guard tables or existing render/review/authority work, and preserves target identity.
Existing canonical profile is a monotonic no-op. Acquisition finder/snapshot work does not
bind copy semantics; indirect mail requests already require locked revision/approval rows.
Root closed missing-import questions: affinity/templates_v2 selects campaign.ask_minutes,
and p2_store targeting hash excludes copy_profile. Low optional SQLite status-isolation gap
was fixed by Sonnet149 and tested. Only closed error codes reach the review snapshot.

Accepted checks:40 real-HTML JS tests;7 focused backend tests including a complete public-create
P15?P22 workflow. Affected185:184pass1WinError10053; isolated case passed;2 snapshot checks
passed. After149, HTTP30:29pass1WinError10053; the failing CSRF case and new sentinel case
passed2/2. Retained XMLs: ORCH/temp-pc-5df4a821/task138-affected.xml, ORCH/test149-final-http.xml and ORCH/test149-rerun.xml.

Original full-suite123:2087tests,2082pass5fail,0errors/skips,1245.491s. Historical
P1/P6 declaration/result failures were: test_deployment::test_p6_manifest_is_numeric_and_complete,
test_p2_prerequisite::test_p2_00_p1_record_verifies,
test_p4_p1_contract::test_p4_00_p1_record_verifies. Two other failures passed focused reruns.
Do not claim the full suite green or fabricate recorded gate/inspector outcomes. Prior focused acceptance:320 selected/native,
168 acquisition,37 export-verifier,170 qualification/native,36 post-pin adapter checks.

Runtime bundle remains e07ade2e36d078cd83fecb2e4244a0c33322563969308da912a18205e0ca7814,
CLI0.154.0, requested gpt-6-astra, responding identity unverified. Four actual adapters and
public prepare passed; synthetic editorial reached human_review in3calls/3artifacts/0repairs.
Prior synthetic cleanup was verified; real P19 has zero exit codes but no durable cleanup receipt.

## What did not work and current repair

Repeated HTTP connection aborts were initially called environment-sensitive after isolated
passes. Opus151/153 found an unread-body/connection-close race and proposed a post-refusal
discard under byte and one250ms total-time bound. Independent Opus154 found long numeric
Content-Length could raise after a response or expose an interpreter diagnostic. Both
conversion sites now cap digit length before int(); auth/CSRF and fixed errors are preserved.
Pre-auth refusals keep the ordinary72KiB cap; unsupported/late bodies can still close abruptly.

Tasks155/155b tightened tests after root's A/B checks showed shape-only regressions still
passed with draining disabled. The final proof measures actual discarded bytes, four framing
cases assert zero read attempts, and the helper detects coalesced extra responses. Disabling
draining failed the strengthened regression; enabling it passed. Final HTTP suite42passed,
0fail/errors/skips in19.469s parsedJUnit (wall19.52s). Evidence: ORCH/test155-final-http.xml,
test155-ab.xml (intentional failing mutant), test155-positive.xml. No test retries were added.

Task135/137 coordination proposals and Task152 stale appended addenda were rejected.
Task152b replaced stale source status in place and corrected the format lock docstring.
Worker diffs may contain wrong hunk counts or mixed newlines: root verified input hashes,
allowed paths and unique exact normalized contexts before applying. No patch auto-applies.

Actual Chrome DevTools CLI1.9.0 successfully attaches to the existing user Chrome through
session9e9063aa-56ea-44d8-a68c-777d790b77ad. The old CUA getBrowser failure was specific to
that surface, not proof that Chrome DevTools was unavailable. User explicitly rejected
native/Sky desktop control and new browser profiles: use DevTools on existing Chrome only.
Installed CLI: AppData/Local/npm-cache/_npx/15c61037b1978c83/node_modules/chrome-devtools-mcp/
build/src/bin/chrome-devtools.js, via installed Node. Use --sessionId and --output-format=json;
CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1 and CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1.
Do not start/status/stop before each command. list_pages returns pages directly; filter to
local Prospecting URLs before output. Private snapshots/text never go to stdout or workers.

Existing Chrome page3 is http://127.0.0.1:8765/ and displays Drafts. Owned review server32400
serves PILOT sibling review-preview-f882f089297d411dbc08a540f9585394.sqlite, a SQLite backup;
original PILOT/store.sqlite is unchanged. Revalidate live handles before use. The connector
is attached with autoConnect and restricted file paths; no private screenshots were captured.

Browser acceptance: one exact selected draft/source, source checkbox unticked, confirmation
and readiness disabled, native keyboard input sets dirty state, edits survive view switches.
Unchanged-context refresh gives the expected refusal and changes no watched domain/authority
counts. ORCH/ui156-initial-state.json, ui156-draft-navigation.json, ui156-native-input.json,
ui156-no-change-verified.json record only booleans/counts/opaque metadata.

Sonnet157 built a reusable synthetic fixture. Nine synthetic adapter calls through run_next
parked a genuine item at cycle2; no prewritten edit/reset. In existing Chrome's synthetic tab6,
real Save edit produced a QA-passed child and exactly one restart action. Enter on that action
created one reset/new cycle0 item; old item stayed parked2. Source-file drift removed the
excerpt/attestation, retained selected scope and disabled readiness without legacy fallback;
restoring exact bytes restored the source. Zero attestations/approvals/exec/send records.
Evidence: ORCH/ui157-saved-edit.json, ui157-restart-verified.json, ui157-source-drift.json.
Synthetic tab6 was closed and owned server48812 stopped after these checks; root retained
ORCH/ui157-synthetic-acceptance and returned Chrome to page3. Native model quality is separate.

Opus158 found fixture identity checks followed mutating open_store. Accepted repair validates
through ordinary mode=ro first; root proved unrelated-store refusal leaves bytes unchanged and
creates no WAL/SHM (ORCH/ui158-readonly-refusal.json), and post-restart identity still validates.
Sonnet159 source refinements use Path.as_uri and reject Windows junctions. Its test proposal
was rejected: _saved_human_edit is a direct-lineage fixture, not the public edit service;
the timer assertion also did not prove shutdown. Corrective Sonnet159b was subsequently repaired by159c as recorded below.
Sonnet156 audit was partly useful, but its selector for regenerate was in the wrong panel and
its accept/reject-to-exhaust recommendation was rejected. Real exhaustion uses critic repair.

Opus160 corrected the inherited gate classification. Source gate_manifest*.json are phase-owned
inventory declarations, distinct from human MANIFEST.sha256 and generated gate-results/Pn.json.
P1 verify-recorded fails because P1.json is absent. A passing generated record requires a real
independent inspector score (minimum90), never a self-chosen score. P6 inventory drift is
repairable on the work branch: root current collector found741 old entries versus904 required,
10 stale and173 missing. P1 manifest validation found one missing artifact, worktree STATE.md,
and10 changed source hashes. The original P1 plan explicitly requires that work-product DRAFT
(lines21/42/84), separate from ops STATE. Sonnet161 is restoring it and implementing a draft-only
inventory refresh; it may not change outcomes, inspector grades, MANIFEST.sha256, or gate records.

Sonnet159b corrected the public-edit test, but pytest found11pass1fail in68.73s (SQLite Row
compared to tuple); its URI/metadata checks were weak. Opus159c corrected the actual failure,
proved exact special-character file identity/read-only mode and malformed metadata refusals,
and reduced redundant preparation. Final fixture26passed in12.63s (ORCH/test159c.xml), including
real public edit/restart and bounded timer wiring. This fixture and browser verification docs
were staged-PII/diff checked, committed and published as1644aa00 on PR181. The authority proof
is the explicit browser/SQLite four-table check; a broad table-name tripwire in the test is
not treated as authority proof. No new full-suite pass is claimed.

Sonnet161's proposal was completed by Opus162 and passed12 focused tests. It restored the
plan-required DRAFT and validates declarations before writing, without modifying generated
results or human MANIFEST.sha256. P6 write initially refused8 PII-like parameter IDs. Sonnet164
added descriptive labels to11 cases;164b corrected two labels. Payloads/assertions stayed
unchanged. Sonnet165 corrected3 stale P1 parameter IDs. Final inventories122/904 validate,
hash-match and replay as no-ops; all other criteria and file lists are preserved.

First P1 direct run166:120pass2fail9warnings. PYTEST_ADDOPTS used backslashes parsed as escapes,
creating malformed relative output paths and WinError206 in nested tests. Use forward-slash
short paths, e.g. --basetemp=C:/Users/danie/kb/_private/t168, and -o junit_family=legacy when
record_property and JUnit coexist. Restricted taskkill caused a launcher cleanup timeout;
correctly scoped elevated verification passed both failed tests in14.85s. Retained malformed
artifacts were moved by exact verified paths to ORCH, not deleted. One broad process cleanup
attempt also matched its own command and exited-1; never repeat broad command-line matching.

A genuine test50 isolation bug reset and leaked the production external-call counter.
Verified Sonnet167 moved the intentional refusal onto a local subclass. Root checked both
prior counter0 and7 survive, with production guard/criteria unchanged. P1 direct run168 on
exact Python3.13.7/SQLite3.50.4/Datasette0.65.1 passed all122 with0 failures/skips/xfails/
warnings/network calls/unguarded children and evaluate_run errors[]. JUnit61.158s;
ORCH/p1-direct-168.json/.xml. Measurements: PII class/sink126, blocked commits3, audit
rejections2, WAL writers2, Datasette reads20/write refusals10, shared-policy campaigns2,
raw agent capabilities0. All artifacts are now tracked after source commitc220266c.

Independent Opus166 reviewed declaration/result semantics and confined collector basetemp
to the existing TemporaryDirectory, with zoneinfo as a sibling. Sonnet169 added live argv/env,
sentinel and timeout/success cleanup proof. Final inventory14pass,0other,3.451s JUnit
(ORCH/inventory-final-169.xml), including P6 completeness. Fixture26pass on313 in18.868s
JUnit (test163-supported.xml). Both refresher dry runs are now no-ops.

Sonnet170/170b documentation proposals were rejected for misreporting evidence. Opus172's
replacement was reviewed, measured-test wording clarified, and published ased929a16.
No inspector grade or generated gate pass was fabricated. Opus166 is a source reviewer,
not a formal fresh promotion inspector. The existing broad card remains working.

## Working checklist

- [x] Native/real nonsending and existing-Chrome acceptance.
- [x] Restore and validate P1/P6 declarations; track all P1 artifacts.
- [x] P1 direct122 and inventory14 checks; publish reviewed repair and evidence.
- [ ] Finish full-suite171 and repair actual remaining regressions.
- [ ] Genuine fresh independent inspection, then actual P1 --record and verification.
- [ ] Final requirement-by-requirement completion audit and current handoff.

## Exact private pins

Run `prun_3aa69faabfd556a49f8db1534604b26c`; campaign `camp_cc3b012c99074255`.
Qualification `pqba_c9a7805e2b3d5e9db76cf6ea9cfcc0ce`, hash `7de1407868b8272e49c6dc66d7bf1962c636705ba81a515843b7986b2353b494`.
Ranking `prrb_699e9dc9ff6a5d0c9ced805e66f14277`, hash `c55b224d6b94239fb7623dfd56feabb5a13c79811faa46ecb4efd4dacda215d1`.
Selected person rank `prrp_3180e6770a7756848d7256687ab5adcc`.
Target hash `17fb0dadfd035c8ed2fce837b99e3e9fa7ac0f0aea2c75e6675b0f722f5de6ad`.
Configured policy state hash `c88284b5b873c0c1afa7f8146c0def158bb4baddaf456048079dc8e93f1ddf61`.
Binding `sdb_e6d14ab02f7241c9b62a8af59c2224af`, revision `d592a64b-3e68-4996-8d93-075edc2469ad`.
Revision hash `9bb4e05dbf9810f75fb6bd0f85be91c73404c17f8bcdbf1e4aa4ddbc898d5a8a`.

PILOT/snapshots/operational-validation contains pre-migration backup1113f94b77ae4569a842472b3006e4b8.sqlite,
post-qualification pre-format backup before-format-200e2e4d746941d6aa30298d698acd0d.sqlite,
rank-start-6ce8d110.json and selected-draft-78b0c679.json. Both requests have been used and
replay verified. Qualification retry d69e6f57-abf9-4e69-83cc-89315f93dc22 WAS USED successfully.
Public probe scripts are in ORCH; do not print private review projections or message bodies.

## Exact next step

Poll exec session53303 (full-suite171, child PID520 at launch). The handle was confirmed live
this turn. Read ORCH/full-suite-171-result.json/.xml once terminal; never restart solely from
an observation timeout or quiet log. Exact command is in full-suite-171-process.json; supported
Python313, project test directory, no-network marker1, private short basetempt171, legacyJUnit.
No model worker is live. Repair new failures through verified Claude workers. Two tests are
expected to require the absent P1 record, but inspect actual evidence rather than assuming.

Then arrange genuine fresh independent inspection of the relevant completed P1 work and
named artifacts; root cannot grade itself, and source reviewers166/172 cannot become fresh
inspectors after advising. No grade has been emitted. Only a real score may be supplied to
gate --phase P1 --inspector-score <real> --record. All122 direct tests and declaration/tracking
checks now pass; do not rerun native pilot/browser acceptance. The original full-goal card
must remain working until its entire scope is met. P1 record must bind current full artifact
hashes; verify_recorded alone checks only recorded keys, while p5_contracts verifies coverage.

## Operating constraints and remaining gates

New workers use ORCH/run_vm_proposal.py on existing source-only Claude vCPU after00:30UTC;
Opus5/Sonnet5 were verified from actual assistant JSONL. Codex quota fallback jobs finished.
Private pilot data never goes to vCPU. Native product runtime stays existing desktop Codex.
No credentials as objects, paid fallback, capability/cap increases, sends or manifest blessing.

Coordination changes use the existing PR180 branch, preserving published normal merge
ancestry. Plain rebase previously replayed duplicateae3573e3 and was aborted. Fetch origin/ops
and verify ancestry before writes; no force push/direct ops/main/merge/deploy. Full-suite171 is active; all model jobs are returned. Keepawake PID17176 historically had a bounded lease until about07:16UTC; verify a live process before relying on it. Preserve unrelated worktrees and retained private artifacts. The card remains working for full regression, independent grading and actual gate recording.

## Load list

- MAIN/CLAUDE.md, governance/agent-rules.md, BOSS.md; DELIVERY/orgs/prospecting/contract.md.
- COORD/orgs/prospecting/STATE.md, queue/working/01K4KB00000000000000000002.md, memory/codex-worker.md.
- DELIVERY/docs/superpowers/plans/2026-09-09-prospecting-startup-pilot.md.
- DELIVERY/docs/superpowers/reviews/2026-09-11-prospecting-final-verification.md and 2026-09-11-prospecting-selected-native-acceptance.md.
- ORCH/real-format-draft-evidence.json, task134/real-pilot-evidence.json and public probes.
- ORCH/p1-direct-168.json/.xml, inventory-final-169.xml, full-suite-171-process.json/.txt/.xml and eventual -result.json.
- ORCH/gate-record-review-166, gate-counter-isolation-167, inventory-scratch-proof-169 and gate-verification-doc-172 receipts/results/JSONL.
- ORCH/ui156-*.json, ui157-*.json, ui158-readonly-refusal.json and ui-fixture-proof-159c / record-gate-audit-160 / gate-inventory-review-162 receipts/results.
- ORCH/format-security-148, format-isolation-149, format-boundaries-150, http-boundary-151b, http-repair-153, http-review-154, http-proof-155/155b receipt/result/JSONL files.

Publication history: the first c8643caf push was auto-review rejected because PR181's
destination was considered unverified. Read-only metadata established the existing
user-owned repository/branch, satisfying re-review; the user then explicitly approved
c8643caf and the subsequent repair. Both source commits are published. No rejection is pending.
