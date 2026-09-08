# Figment foundation implementation

The operator approved starting the architecture recommendation on September 8.
This package is complete when a portable checkout can enforce current review,
promote an explicitly accepted produced checkpoint, and reconcile an interrupted
pod attempt without duplicating spend or acting on another attempt's pod.

The implementation branch is `codex/figment-foundation-20260908`, starting from
analysis commit `3b48d911`. The coordination card is
`queue/working/01K9FIGMENT0800000000000002.md` in the ops proposal, PR #175.

| Work | Worker | Acceptance |
| --- | --- | --- |
| Portable inputs | luna | Fresh checkout contains only synthetic creator-002 anchors; reference hashes survive LF/CRLF defaults |
| Approval lineage | sol | Changed assets/config invalidate cached decisions; explicit checkpoint selection reaches gen; train-first requires reviewed dataset lineage; anchor and dataset pause |
| Pod recovery | terra | Intent predates creation; acquisition persists; narrowly owned attempt can be reconciled independently; foreign or ambiguous pods refused; absence verified |
| Integration | orchestrator and independent reviewer | Adversarial cases checked, relevant suites pass, differences reviewed, limitations recorded |

This is one bounded build/review task, not a new recurring agent loop. Workers
implement; a separate reviewer checks trust boundaries and acceptance. Tests
exercise rejected states as well as the supported path. Two failed independent
verification rounds on the same item wake the operator. The implementation cannot
weaken identity/safety metrics or confer approval on old artifacts automatically.

Paid compute is authorized, but a live evaluation still needs authenticated
provider access, reconciled historical cost records, a fixed hypothesis/control and
held-out slate, and a manifest with time/dollar bounds. The configured Python 3.13
client connected successfully after the earlier standard-library probe returned
HTTP 403. Zero current pods and absence of both interrupted tester IDs are verified;
the five local historical cost shards agree, with conservative orphan estimates retained.
No repeat training is needed before evaluating the
existing 1,250-step candidate with its corrected trigger. A journal and local
recovery command alone do not provide an always-running external watchdog.

After this package: evaluate that candidate, obtain an operator checkpoint ruling,
prove a second fictional adult persona with the same machinery, and expose the
Creators, Generate, and QA views. Merging/deploying/publishing remain human gates.

Verification results and the concrete continuation point will be recorded in the
canonical dated `handoffs/` document and the implementation report at completion.

## Implemented result

Portable inputs (`10448378` plus the LF followup) passed independent fresh-checkout
verification. Approval/checkpoint lineage (`23ce226d`) passed independent code and
security review with 111 focused tests. Parent frozen non-recovery integration
returned 700 passes and 13 failures reproduced unchanged on the baseline. Recovery
fixes (`66be5887`) have 24 focused plus 287 existing pod tests passing in builder
checks. The authorized final independent recheck subsequently passed all 311 tests;
the live attempt then exposed a provider timestamp format missing from fixtures.
That narrow correction is independently accepted at `88a1da1a` with 319 tests.

Draft code PR: https://github.com/danielzhang04/kb/pull/178. The active canonical
handoff and bounded recovery continuation are in draft ops PR #175. The initial live tester startup failed safely and was terminated; a single
corrected attempt is running under the original experiment ceiling. See
`2026-09-08-live-tester.md` for current operational evidence. Technical foundation
review is complete; checkpoint quality remains unproven. No merge, deployment, or
publication occurred.
