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
handoff and bounded recovery continuation are in draft ops PR #175. The initial live
tester startup failed safely and was terminated; the single corrected attempt completed
under the original experiment ceiling. See `2026-09-08-live-tester.md` for the measured
operational evidence. Technical foundation review is complete; checkpoint quality remains
unproven. No merge, deployment, or publication occurred.

The corrected tester receipt records all five jobs succeeded, finished at
`2026-09-08T07:19:23Z` after `4371.929s`, and was terminated with absence verified.
Cost estimate using the observed READY hourly rate was `$1.323723`; together with the first attempt's `$0.001087`,
the two-attempt harness estimate is `$1.324810`, with resulting current arc total
`$37.015061`; these are harness estimates, not invoice charges. Independent
parent verification recorded both pod IDs absent and zero active pods at
`2026-09-08 07:20:47.868959 UTC`. The five original-resolution PNGs were visually
inspected by the parent Codex agent (`codex-worker`) as unambiguously adult and fully
clothed, with no quarantine.
The diagnostic produced no operator QA stamp, checkpoint ruling, promotion, held-out
control scoring, or driver-bound lineage. The parent's qualitative judgment was weak
intended-character resemblance across all five; later steps appeared closer in hair and
lips qualitatively, but that is not a proven improvement. The latest wiring review found
no concrete trigger, LoRA-strength, or
checkpoint-step error; raw-to-turbo template parity is intentional and is not proven to
explain the quality result.

The operator then reviewed the five-image board qualitatively: “(1) For the most part,
these images look semi-real. (2) These images (a) don't read like the same person or like
the same person compared to the references and (b) read like mid-30s women not 21 year
olds.” This feedback is about realism, identity consistency, and apparent age; it is
distinct from the parent agent's adult/clothing QA. No candidate was selected and no
promotion was approved.

The existing persona contract says `age_stage: early twenties, about twenty-one`
(`persona.yaml:11`), and `identity-spec.md:12` says apparent age is about 21. The
frozen diagnostic manifest's prompt instead says “an adult woman in her mid twenties”
(`creator-001-existing1250-tester.yaml:94`). This is a pre-existing specification versus
tester-prompt mismatch, not a newly changed requirement. It is not established as the
sole cause of the apparent mid-30s reading or the identity failure. Future test prompts
must derive the age language from `persona.yaml`.

Next step: use the received feedback to define a driver-bound held-out comparison that
measures realism, within-batch identity consistency, reference identity, and apparent
adult age targeted at 21 independently before any further paid run or promotion. Use the
retry evidence to optimize and measure the transfer path before considering another run;
do not auto-rerun.
