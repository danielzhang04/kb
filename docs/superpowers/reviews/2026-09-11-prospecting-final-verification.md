# Prospecting final verification status

This record covers the recoverable evidence-to-review pipeline, canonical draft-format
configuration, and bounded HTTP refusal repair. It grants no source attestation, send
approval or release authority.

## Accepted behavior and current verification

Canonical format configuration resolves copy_profile_missing without P8 fit approval or
repeating completed research. The public operation validates saved campaign integrity,
uses an owned transaction and full-policy precondition, refuses existing copy-dependent
work or missing guard tables, and preserves the targeting hash. Existing canonical format
is a read-only no-op. The authenticated status endpoint and CSRF-protected action expose
fixed errors; a failed optional format lookup does not hide the rest of the review screen.
Independent Opus148/150 reviews and root inspection accepted these boundaries. The renderer
uses campaign.ask_minutes; targeting excludes copy_profile and revision context includes it.

The approved real pilot completed all three qualification items (three artifacts, four
cumulative attempts including one historical refusal), ranked one selected person with a
five-person shortfall, and materialized a selected-person draft. Public format setup created
a backup; setup and draft replay were verified. Targeting, qualification and ranking hashes
are unchanged. The metadata audit found one binding and zero source attestations, approvals,
execution requests or sends. Actual native calls prove desktop authentication works. Root
re-verified this original store remains unchanged at1 selected_draft_binding and0
attestation/approval/exec/send rows, and checked the AST runbook CLI flags: all match, with
three CLI modules disabling --help by design.

HTTP refusals previously closed while declared body bytes could remain unread. The repair
flushes the refusal first, then discards eligible unread bytes under the existing byte cap
and one 250 ms deadline. Ambiguous, oversized and Expect framing is not drained; consumed
bodies are not read twice. Opus154 found an arbitrary-digit Content-Length conversion could
append a second response or expose an interpreter diagnostic; both conversion sites now
bound digit length before int(). Auth/CSRF ordering and no-mutation refusals are preserved.
Pre-authentication refusals retain the ordinary 72 KiB cap, including large upload routes;
this bounded mitigation does not promise graceful closure for every unsupported or late body.

Final HTTP suite: **42 passed, 0 failed/errors/skips**, 19.469 seconds in parsed JUnit
(test155-final-http.xml; CLI wall time19.52s). Root disabled draining in a separate process:
the strengthened real-HTTP regression failed, then passed with the repair. It measures
actual discarded bytes. Four framing cases assert zero attempted reads, and a deterministic
helper test detects coalesced second responses. Earlier shape-only tests passed without the
fix and were not treated as proof. No retry was added to the HTTP test helper.

Format evidence:40 actual-HTML JS checks;7 focused backend checks including one complete
public-create P15?P22 workflow; affected185 had184passes and one connection abort, whose
isolated rerun passed. Two snapshot checks passed. Post-isolation HTTP30 had29passes and
one connection abort; its focused case plus the new sentinel regression passed2/2. Those
intermittent aborts prompted the HTTP investigation rather than being dismissed as host noise.

Prior accepted evidence:320 selected/native checks,168 acquisition checks,37 retained-export
verifier checks,170 qualification/native checks and36 post-pin checks. Four actual model
adapters and public prepare passed on bundle
`e07ade2e36d078cd83fecb2e4244a0c33322563969308da912a18205e0ca7814` (unchanged by this repair).
Synthetic editorial reached human_review in3calls/3artifacts/0repairs. Requested model was
gpt-6-astra; actual responding identity is unverified. Claude development workers resumed on
the existing source-only vCPU; responding Opus5/Sonnet5 identities were verified from JSONL.

## Full-suite history and remaining acceptance

Full-suite run171 completed:2147tests,2143passed,4failed,0errors/skips,908.982seconds
parsed from JUnit full-suite-171.xml (911.108s process wall time). That run171 result is not
green and is preserved as repaired history, not a current failure. The earlier full-suite123
JUnit remains as history and records2087tests:
2082passed,5failed,0errors/skips,1245.491seconds. Two of the four run171 failures are the
historical gate-inventory nodes below, which required the then-absent P1 record, now
generated and published as67218ba5. Three historical failures concern gate
inventories/results:
- test_deployment::test_p6_manifest_is_numeric_and_complete
- test_p2_prerequisite::test_p2_00_p1_record_verifies
- test_p4_p1_contract::test_p4_00_p1_record_verifies

The other two run171 failures were test-side, not production-side:
test_capture_import_cli::test_store_selection_is_validated_before_the_store_is_opened and
test_research_capture_cli::test_store_selection_is_bounded_and_each_invocation_releases_the_store.
Both expected a path outside the approved roots, but the run's basetemp lay under the actual
shared private area, which made the constructed path legitimately approved. The same two
unmodified tests passed in1.05s under a non-private basetemp; an initial baseline attempt
produced2 setup errors from a missing parent directory and was corrected.

Sonnet175b repaired only the two test files: a controlled synthetic checkout with a real
.git/private and the module `__file__`. Production guards are unchanged. A failing
open_store sentinel proves refusal happens before the store is opened, with a byte-unchanged
check and a positive case after the patch context. All50tests in both affected modules now
pass in32.08s CLI under a private basetemp, and the same two target checks pass in1.74s
under a non-private basetemp (capture-private-final-175c.xml,
capture-nonprivate-final-175c.xml). Full-suite179 ran after this repair and after the real P1
record67218ba5: root's authoritative verification of ORCH/full-suite-179-result.json shows
returncode0, elapsed741.130seconds. The parsed full-suite-179.xml records2,147tests, all
2,147passed,0failures/errors/skips,738.964seconds JUnit time, on the supported Python3.13.
Run171's2,143pass/4fail result is preserved as repaired history, not a current failure. The
current full suite is green. Root completed the current-state requirement audit in
2026-09-12-prospecting-completion-audit.md and reconciled coordination artifacts; final
publication is verified before the thread goal is marked complete.

Two other failures passed focused reruns: the person-scope temp-root case and an HTTP
connection abort. The latter now has a source repair and focused acceptance above.
Agents have not modified or blessed the recorded evaluation manifests.

Actual Chrome DevTools CLI1.9.0 attached to the user's existing Chrome and brought forward
Prospecting Review. Earlier CUA initialization failure was specific to that control surface;
it did not establish that Chrome DevTools was unavailable. Root just reverified the actual
existing Chrome DevTools tab3 as ready/complete and visible within this same existing
session, with no new profile created.

Browser acceptance now verifies the real pilot review copy has one exact selected draft and
source excerpt, disabled source confirmation/readiness, preserved unsaved input across views,
and an unchanged-context refusal with unchanged domain/authority counts. Actual DevTools
keyboard input exercised the editor. On a separate synthetic store, nine deterministic stage
calls genuinely exhausted the repair budget; the real browser saved a changed draft and
created one atomic reset. The old item remained parked at cycle2, the new item began at
humanizer/cycle0, and zero source attestations/approvals/exec requests/sends were created.
A changed source snapshot removed the excerpt and attestation control without legacy fallback;
restoring the exact bytes restored the source projection. These checks used the real DOM,
HTTP handlers and SQLite services; synthetic adapters prove orchestration, not model quality.
Metadata-only evidence is retained under ORCH/ui156-*.json and ORCH/ui157-*.json.

The reusable synthetic fixture now passes26 focused tests in12.63s (ORCH/test159c.xml).
Opus158 reviewed its read-only identity check before mutating store open; subsequent tests
prove exact special-character URI identity/read-only mode, malformed metadata refusals,
public edit/restart, Windows link guards and bounded timer wiring. The first corrected test
run159b had11pass1fail;159c repaired the Row/tuple error and strengthened weak URI/metadata
checks. No production pipeline behavior changed for these browser checks. Source PR181 and coordination PR180 remain drafts;
no merge, deployment or release is claimed. P1/P6 inventory and direct-run evidence is recorded
in the section below; independent P1 inspection and an actual passing gate record now exist as detailed below.
The broad regression and requirement audit are complete. Exact
publication heads and private receipt paths are in the canonical coordination handoff.

## P1/P6 inventories and direct P1 gate run

Separate P1 and P6 inventories contain122 and904 tests respectively; both validate and match
their source hashes. A plan-required worktree DRAFT STATE file that was missing was restored,
without reverting the worktree. Three stale P1 nodeids were corrected and descriptive IDs were
added for11 P6 parameter cases; payloads and assertions are unchanged. The refreshed
declaration covers P1 hashes only and, for P6, the test inventory and minimum within the
existing file closure plus hashes; all other criteria are unchanged.

A direct P1 gate.run_tests/evaluate_run collected122 and passed122, with0 failures, skips,
xfails, warnings, external calls and unguarded children; all measured test criteria were met
in61.158seconds parsed from JUnit ORCH/p1-direct-168.xml and its .json, on Python3.13.7,
SQLite3.50.4 and Datasette0.65.1. This direct run preceded the independent grade and formal gate record;
the new DRAFT was not tracked at that verification time. Source commit c220266c now tracks
all P1 artifacts; the post-commit tracking, manifest and file checks pass.

Earlier run166 had120passed,2failed and9warnings from
path escaping, xunit2 record_property warnings and launcher cleanup sandboxing; the corrected
invocation passed2 focused tests in14.85s. A Sonnet167 test-counter local subclass isolates an
intentional refusal; the boss preserved the prior counters0and7 and the production guard is
unchanged. Opus166 supplied a collector scratch fix, and Sonnet169 focused tests passed14 in
3.451seconds (JUnit inventory-final-169.xml), including P6 completeness. The fixture run
passed26 in18.868seconds (JUnit on313).

A fresh, separate Opus174 inspector requested C1-C15 checks through a desktop tool relay,
then resumed its own source-only session to evaluate raw results and additional named source.
All29 initially inspected source hashes were unchanged. Its fresh P1 run passed122 in exact
manifest order with all measured criteria met. The verified responding model was claude-opus-5.
It graded bounded card01M29VGYQJ9KSTR8S7D37YKG01 at95/100, PASS for T2: correctness96,
scope95, evidence92, safety98. The grade covers commitc220266c, not the parent infrastructure
goal. grade.record_grade wrote the paired rows; commit33754a51 on PR180 credits the actual
inspector role as author and the Codex tool relay as committer. The writer used actual UTC,
replacing a future timestamp supplied in the report without changing any judgment field.

The general PII scanner flagged the required inspector role address in those coordination
rows. A sequencing error allowed the grade commit to run after that check failed. The rows
were independently parsed and verified to contain only mandated role metadata; no prospect
identity was present. That scan is recorded as failed, not passed (ORCH/inspector-role-guard-178.json).

The actual gate command --phase P1 --inspector-score 95 --record then passed all122 tests
and generated orgs/prospecting/gate-results/P1.json. It is published as67218ba5. Recorded
hashes cover exactly all current P1 artifacts; --verify-recorded reports matched:true.
The36 P2/P4/P5 prerequisite and record-contract checks pass (p1-prerequisites-178.xml).
The gate ran without --strict-allowlist:137 paths remain unlisted,135 pre-existing plus the
two new refresher files. The inspector classified the new files' missing declaration as a
minor residual gap and the wider strict-allowlist mismatch as pre-existing. These limitations
remain visible. A strict-allowlist pass is not claimed; parent-scope completion is assessed
separately in the requirement-by-requirement completion audit.
