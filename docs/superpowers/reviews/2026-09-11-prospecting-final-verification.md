# Prospecting final verification status

Source reviewed: `5da4d36a`. This record assesses the current reviewable PR scope,
from versioned intake and capture through P17/P18 import, P19 qualification, P20
ranking, P21 restart, and P22/P24 selected-source review. It does not authorize
outreach, source attestation, approval, or release.

The accepted focused evidence remains in place: 320 selected/native tests, 36
real-HTML UI state checks, 168 acquisition checks, 170 combined
qualification/native checks, 36 post-pin adapter checks, and the accepted reviewed
runtime bundle. The retained export verifier passed 37 focused checks in 21.33
seconds and independent review. Independent reviews 115 and 122 accepted the
source-binding runtime and verifier repairs. An unpublished PII scan reported zero
findings. Merge simulation against main was clean; the source branch was 24 commits
behind and 42 ahead at review.

Before Task149's fix, 40 real-HTML/JS tests passed, the public-create synthetic
regression's 7 focused tests passed with 0 failures (the entire public-create
workflow is one of those 7 tests, not 7 separate public-create tests), and the
broader affected-test run passed 184 of 185 (the remaining case failed only with
a host `ConnectionAbortedError`/WinError 10053 and passed in isolation; 2 related
snapshot tests passed). After Task149's fix, the HTTP suite passed 29 of 30 (the
remaining failure was the same WinError 10053 at a missing-CSRF POST case); that
case plus a new sentinel regression together passed 2 of 2 on rerun. Opus148
closed the low optional-status SQLite error-isolation gap (Task149, tested).
Opus150 closed the exec_request indirect-shape concern through the existing
revision/approval guards, and root closed a missing-imports issue by reading
affinity/templates_v2.py's load_campaign_render_context selection of
campaign.ask_minutes and p2_store's compile/hash exclusion of copy_profile.
Task151's source review found the early refusal that closes the connection with
an unread body to be a credible reset race, not a definitive environment-only or
final-acceptance conclusion; Task153's Opus implementation is in progress and
untested.

Root independently parsed `ORCH/full-suite-123.xml`: 2,087 tests, 2,082 passed, 5
failed, 0 errors, 0 skips, in 1,245.491 seconds. The result is not a green full
suite. Three failures remain human-owned record checks:

- `test_deployment::test_p6_manifest_is_numeric_and_complete`
- `test_p2_prerequisite::test_p2_00_p1_record_verifies`
- `test_p4_p1_contract::test_p4_00_p1_record_verifies`

The other two failures did not reproduce in the focused two-test rerun, which passed
in 2.33 seconds with the private-worktree base temp: the person-scope test refused
an ordinary temp store with `store_private_root_required`, and the review-app control
test saw host `ConnectionAbortedError` (`WinError 10053`). They are treated as
environment-specific until reproduced. No product regression was demonstrated by
the parsed result.

Remaining acceptance limits are explicit. Supported browser surfaces are empty, so
there is no visible browser acceptance; a subsequent real browser check returned
"no browser is available" and did not substitute an unapproved acquisition
transport. The bounded real P19 batch has since completed: 3 of 3 items reached
machine_reviewed across 4 cumulative attempts (one historic qualification_output_invalid
refusal plus three successes) with 3 artifacts, and P20 ranking/replay was verified
as an exact match. Selected-draft format configuration (Task138/139) is now
implemented and independently reviewed; the real public configure call succeeded
with a backup created, a read-only replay was a no-op, target/P19/P20 hashes were
verified unchanged, and real selected-draft materialization succeeded with an
exact-replay match on binding and revision. The recorded P6 manifest and historical
release gates remain human-owned.

Current source state: published baseline `35ac5517`; local HEAD `5518114a` plus
the present uncommitted format-configuration and HTTP-repair diff are further
along and not yet published, committed upstream, or handed off; this is
in-progress source work, not a documentation-only change.
