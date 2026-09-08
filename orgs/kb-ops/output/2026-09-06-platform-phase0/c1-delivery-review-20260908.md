# Current independent C delivery review - 2026-09-08

**REQUEST CHANGES.** The user renewed the earlier bounded correction in the
2026-09-08 overnight directive. The 101-test builder gate passed, but root's
fresh two-scenario adversarial probe failed 2/2 (93 unrelated cases skipped).
This is the first execution of these exact new probes, not a rerun of the
historical malformed-fulfillment failure. Production bytes were not edited by
the reviewer. The worker is correcting the findings under ongoing authorization.

1. **HIGH: required EOF can be skipped before acknowledgement.** At
   `attemptSessionAdapter.ts:1385`, a Codex process that exits immediately after
   accepting its only prompt skips `endInput`, then reaches `ackClaim` at 1400.
   Root used the existing `MemorySessionHost.finishAfterWrite = 0` with the real
   C0 store. EOF calls were zero but acknowledgement calls were one. This clears
   the queued-message witness although required delivery never completed.
   Require completion of EOF before acknowledgement; skipped EOF is close-only
   with the durable write-intent retained.
2. **HIGH: outer refusal settlement bypasses close-only ambiguity.** A Claude
   process that exits after the first of two opening prompts reaches
   `failAfterStart` from line1361. That helper avoids its own terminal CAS, but
   leaves creator authority intact. The result refusal path at1453 then invokes
   `settleRecord`, whose only ambiguity exclusion at827 is poisoned ownership,
   so the bound operation becomes failed. The root probe observed exactly one
   write and `failed` where `bound` is required. Preserve the uncertain claim and
   PTY receipt across every outer completion path, including cancellation after
   write intent; do not release, retry terminal settlement, or resume delivery.

Command (isolated copy of frozen test harness plus the two appended probes):

    npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/attemptSessionAdapter.review.test.ts -t "review:"

Result: **2 failed / 93 skipped**, one file, 1.02s total. Initial review-copy
creation used the wrong relative directory and found no file/tests; after that
setup correction this was the first product execution. No count is attributed
to that infrastructure failure. Root's temporary review file will be removed
once both probes are preserved in the real suite. Full typecheck remains
pending while A1/D1 production files are actively edited.

---

# DRAFT — C1 claim-delivery interim review, 2026-09-08

Reviewer: `codex-worker` (independent; did not author the implementation)

Current technical verdict: **NOT READY — INTERIM**

This is durable evidence from a partial, unfrozen implementation based on accepted
C1 schema commit `5a480e5cd4b147a283ea0e9abe29202a7fe3fe29`.
The reviewed partial blobs were `b5ed560e` for
`dashboard/server/control/attemptSessionAdapter.ts`, `143ad5f3` for its test,
and `a24c574b` for `attemptVertical.integration.test.ts`. The builder continued
after this review, so all locations and findings below are provisional until a
fresh review of the frozen bytes closes them with code and test evidence.

No tests were run during this interim review. The builder's first reported run
had 25 failures and 69 passes: 19 adapter failures reflected changed legacy
semantics, while the first six vertical failures were caused by the unbound
claim harness. After adding a new real store per adapter, the second vertical
run had three failures and five passes: the remaining failures were distinct old
assertions for `promptsDelivered`, abandoned-incarnation restart adoption, and
collision create/close behavior. These were different causes, not two failed
repairs of the same scenario, so the repository's repeated-failure pause was not
triggered. The builder then changed assertions without rerunning before the
interim freeze.

## Provisional findings

1. **Creator authority was inferred from an in-memory attempt entry.** In the
   reviewed partial `begin` inserted every `ActiveAttempt` before `claimMessages`
   completed, including observers and ambiguous failed claims. `cancel` then used
   `attempts.get(operationKey)` as sufficient ownership and could call
   `durablyCancel` without a creator handle. A second adapter could observe the
   creator's claim, call cancel, and terminalize the creator's PTY operation.
   The minimal correction is an explicit creator-owned versus observer/poisoned
   state, with all non-creators restricted to the named reconciliation refusal.

2. **Post-write-intent ambiguity was converted to a terminal PTY failure.** The
   common `failAfterStart` helper always called `settleRecord`, and partial,
   refused, rejected, post-await-withdrawn, EOF, and acknowledgement failures all
   flowed through it after `recordWriteIntent` succeeded. This erased the
   required ambiguous state and could produce an acknowledged claim paired with
   a failed PTY row after a landed-then-falsey acknowledgement. The implementation
   needs separate cleanup: pre-intent failures may release/settle as specified;
   post-intent failures may close or cancel and observe receipts but must retain
   the claim and PTY binding without retry, release, acknowledgement, or terminal
   projection.

3. **The start admission check did not distinguish a known pre-call withdrawal
   from an ambiguous start throw, and held success lacked an immediate post-await
   check.** The check and `startRunSession` shared one `try`, whose catch only
   returned reconciliation. A pre-call withdrawal had issued no start and should
   attempt the permitted `pty-bound -> released` cleanup. If a held start later
   succeeded after withdrawal, the code continued through reads until the
   write-intent check and then used the terminalizing cleanup from finding 2.
   Split these paths, check immediately after the await, release only while still
   prewrite, and close/cancel a started session once.

4. **Cancellation stopped when it lost the release-versus-write-intent CAS.** A
   failed `releaseOwnedClaim` returned reconciliation before durable cancellation
   or session close. Losing release is the expected result when write-intent wins;
   it must prevent restoration while still allowing cancellation/close cleanup.
   A held write-intent could otherwise leave a live child after cancel returned.

5. **A required Codex EOF could be skipped and the claim still acknowledged.**
   The EOF call was conditional on `!attempt.exited && !attempt.cancelled`, but
   `ackClaim` ran afterward regardless. Cancellation or exit after the last prompt
   write could therefore clear the claimed messages even though `codex exec -`
   never received the EOF needed to begin the turn. Skipped, refused, rejected,
   or withdrawn EOF must retain write-intent and must not acknowledge or restore.

6. **Later instruction writes were outside the generation fence.** `writePrompt`,
   used by `queueRunInstruction` and `queueRunInstructionAtCheckpoint`, called
   `host.write` without `assertForwardAdmission` before or after the await. A
   retired generation could write a later instruction after Lock. These checks
   apply to instruction delivery as well as opening prompts.

7. **Exact prompt preparation still ran once before the claim and again after it.**
   This did not implement the required `claim -> prepare augmented prompts`
   sequence or prove preparation-failure release. The agent id is independently
   derivable; after the raw-authority safety check, the creator should claim first,
   prepare the final prompt bytes once from the claimed messages, and release on a
   pre-admission preparation refusal when its exact CAS wins.

8. **Resolved design question, not an implementation finding.** The work order
   permits every cross-adapter observer, including an acknowledged claim, to
   return the named reconciliation refusal with zero ownership and zero effects.
   Read-only terminal-success adoption is optional. The required terminal
   observation is the same adapter returning/subscribing to its exact memoized
   creator launch promise. Final review must test this minimum, not require
   cross-adapter terminal success.

9. **The added in-memory claim helper could not prove the C0 protocol.** It checked
   only revision and ignored creator handle, run, agent, claim reference,
   immutable fingerprints, allowed states, and restoration; it even permitted a
   `write-intent -> released` transition. The vertical wrapper also created a new
   store per adapter, so restart/collision expectations proved PTY preflight
   behavior rather than shared durable observer behavior. Restart and two-adapter
   tests need one shared real C0 state root/store, with strict recording wrappers
   only for held or landed-then-falsey seams.

10. **The partial test diff did not cover the new protocol.** It added the
    permissive default helper and changed three vertical expectations, but added
    no adversarial delivery tests. High-value required coverage includes:

    - optional unbound claim authority refuses without calling deprecated
      `drainMessages`;
    - exact same-adapter duplicates share one creator launch/promise;
    - two adapters over one real C0 store yield one creator and a zero-effect
      observer, including an empty claim and a message queued later;
    - exact encoded augmented bytes, ordered message references, and the three
      persisted immutable identities agree;
    - preparation and preflight legacy/mismatch release only before admission;
    - landed-then-`undefined` create/bind/admit/PTY-CAS/mark/release transitions
      stop at the ambiguous hop without inferred ownership or later effects;
    - release versus write-intent has exactly one real C0 CAS winner, with
      restoration only for release and at most one write for intent;
    - held start, first/later write, and EOF withdrawal perform only the permitted
      cleanup; partial writes never acknowledge, restore, or resend;
    - instruction and checkpoint delivery obey the same generation fence.

## Staging limits

C can prove the adapter fence through an injected `assertForwardAdmission`
callback. Production Lock-to-fence wiring remains B's responsibility. Frozen C0
already proves that the real atomic store can persist a mutation and then reject
with a falsey value; C may compose that proof with mutate-then-throw-`undefined`
adapter doubles rather than editing the C0 fault seam. D1 remains paused and is
outside this review.

## 2026-09-08 pause confirmation

The later focused run reached a real repeated-scenario pause on the test named
`closes only when a landed falsey write-intent result makes delivery ambiguous`.
Its first failure was a `TypeError` while cleanup dereferenced an undefined
claim. After an optional-chain-only adjustment, the same scenario failed again
because one host write occurred where the assertion expected zero. No C tests
were run by this reviewer.

Read-only inspection confirmed that the test did not inject the fault named in
its title. Its wrapper awaited the real `recordWriteIntent` mutation and then
returned `undefined as never`, which is a malformed fulfillment. It did not
`throw undefined`, so it did not prove the required landed-then-falsey
rejection. The adapter assigned that unchecked fulfillment to its local claim,
passed the admission check, and issued the first host write. The observed write
was therefore a truthful exposure of missing return validation, not evidence
that the required ambiguity case was safe.

The bounded correction proposed at the pause has two separate proof obligations:

- retain the malformed-fulfillment case and validate each claim-port success
  before local assignment or the next effect, including immutable identity,
  fingerprints, exact next state, and the PTY revision where applicable;
- add true mutation-then-`throw undefined` probes for the named durable claim
  transitions, proving stage-appropriate zero next effects and no release after
  an ambiguous mutation.

The affected transition results are `claimMessages` (`created`/`claimed` plus a
creator handle), `bindPromptFingerprint` (`prompt-bound`), `admitPtyBind`
(`pty-bind-admitted`), `markPtyBound` (`pty-bound` plus the exact PTY revision),
`recordWriteIntent` (`write-intent`), `ackClaim`
(`acknowledged` with cleared messages), and `releasePrewrite` (`released` with
cleared messages). The production and tests remained frozen after this
confirmation pending explicit correction authorization.

This DRAFT is not a formal inspector grade and grants no acceptance, commit,
merge, deployment, or Phase 0 authority.
