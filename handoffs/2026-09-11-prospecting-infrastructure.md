# Prospecting infrastructure handoff ? 2026-09-11

Updated 2026-09-12T02:57:23.429424+00:00. Published pipeline source and visible browser acceptance verified; fixture proof and record-gate audit active.

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

Published source HEAD1644aa00 is on draft PR181: browser fixture/verification follows canonical
format c8643caf and HTTP repair7c1b2ab4. Only the unreviewed refresh_gate_inventory.py proposal
and pre-existing .tmp/temp-pc-a83b4c21 are untracked in DELIVERY.
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

Original full-suite123:2087tests,2082pass5fail,0errors/skips,1245.491s. Three historical
P1/P6 declaration/result failures remain under active repair: test_deployment::test_p6_manifest_is_numeric_and_complete,
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
the timer assertion also did not prove shutdown. Corrective Sonnet159b is running.
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

Sonnet161 proposed refresh_gate_inventory.py but omitted the explicitly required DRAFT and
has write/validation/timeout gaps. It is applied untracked for review, NOT RUN; manifests are
unchanged. Opus162 is reviewing/completing it and adding bounded proof. Last verified live
handle exec33944, job gate-inventory-review-162; receipt/result/JSONL are under ORCH.

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

Poll exec33944 / inspect ORCH/gate-inventory-review-162 receipt/result. Do not restart a
quiet live job. Verify actual assistant model and exact input hashes, review its allowed
DRAFT/updater/tests patch, then run focused tests. Compare dry-run P6 inventory to the root's
904-node metadata and preserve all unrelated criteria/artifact/fixture paths before --write.
P1 worktree DRAFT restoration is explicitly required by the original P1 plan, separate from
ops STATE. Obtain a genuine fresh independent inspector grade before any passing --record;
never self-supply a score. Re-run final relevant regression after these actual gate repairs.
No pytest task is live. Original private pilot/native/browser acceptance need no repeat.

## Operating constraints and remaining gates

New workers use ORCH/run_vm_proposal.py on existing source-only Claude vCPU after00:30UTC;
Opus5/Sonnet5 were verified from actual assistant JSONL. Codex quota fallback jobs finished.
Private pilot data never goes to vCPU. Native product runtime stays existing desktop Codex.
No credentials as objects, paid fallback, capability/cap increases, sends or manifest blessing.

Coordination changes use the existing PR180 branch, preserving published normal merge
ancestry. Plain rebase previously replayed duplicateae3573e3 and was aborted. Fetch origin/ops
and verify ancestry before writes; no force push/direct ops/main/merge/deploy. One bounded source-only Claude job162 is active; no pytest run is active. Keepawake PID17176 has an existing bounded lease
until about07:16UTC; preserve unrelated worktrees and retained private artifacts. Card remains working for fixture regression and declared gate inventory repair; visible UI is now verified.

## Load list

- MAIN/CLAUDE.md, governance/agent-rules.md, BOSS.md; DELIVERY/orgs/prospecting/contract.md.
- COORD/orgs/prospecting/STATE.md, queue/working/01K4KB00000000000000000002.md, memory/codex-worker.md.
- DELIVERY/docs/superpowers/plans/2026-09-09-prospecting-startup-pilot.md.
- DELIVERY/docs/superpowers/reviews/2026-09-11-prospecting-final-verification.md and 2026-09-11-prospecting-selected-native-acceptance.md.
- ORCH/real-format-draft-evidence.json, task134/real-pilot-evidence.json and public probes.
- ORCH/ui156-*.json, ui157-*.json, ui158-readonly-refusal.json and ui-fixture-proof-159c / record-gate-audit-160 / gate-inventory-review-162 receipts/results.
- ORCH/format-security-148, format-isolation-149, format-boundaries-150, http-boundary-151b, http-repair-153, http-review-154, http-proof-155/155b receipt/result/JSONL files.

Publication history: the first c8643caf push was auto-review rejected because PR181's
destination was considered unverified. Read-only metadata established the existing
user-owned repository/branch, satisfying re-review; the user then explicitly approved
c8643caf and the subsequent repair. Both source commits are published. No rejection is pending.
