# Built-in train-first v2 plan independent review — 2026-09-09

Verdict: **READY for the bounded train stage.** The tester stage is structurally ready but
must undergo its normal fresh budget check after training; it cannot be assumed to fit the
same-day daily ceiling if training consumes its full reservation.

Reviewed packet:

- Plan: `MAIN/_private/figment-builtin-train-first-20260909-v2/plan.json`, SHA-256
  `920125ce7e543c95b62d3d808675ebbc5b419fcb2da4e55d6f853518b8343ec3`.
- Generator: `figment_train.py` SHA-256
  `43f21a2f3bfe32565eb6b9fe094f20ae44d5e4e410c67a28a715eb4165a8d736`.
- Train manifest: SHA-256
  `5cfa3b28e7d7cd54a821cf3fd540358049fa25ebca3eb6c556ffe7c796128d36`.
- Tester manifest: SHA-256
  `bbf9137e6724d469fd7a89d5da5ac64eb1f510e37adf1a58a604de0b467fc478`.
- Tensor pins: SHA-256
  `2084be7d5220097db1d6682a0a7c5cd25c8501009e3252f5b4f1fd1149393c6c`.

The v1-to-v2 semantic diff is limited to the fresh generation timestamp, current generator
hash, v2 absolute manifest/output paths, the resulting train-manifest hash, and
`avoid_machine_hosts: [wx25nhzztsdt]` on the train manifest. The tester manifest is
byte-identical to v1. Persona hash, accepted dataset path, dataset approval SHA
`96b2c5b470aab05af35dbc189cf8db666e9e205f24bb757816991c20b71a2505`, model revisions and
hashes, training configuration, 1,250 DOP steps, 250-step save interval, five-checkpoint
ladder, one-L40S placement, and ledger/cap binding are unchanged.

The copied v1 and v2 dataset trees contain the same 89 files with identical bytes. The train
manifest selects exactly 42 uploads totaling 42,036,431 bytes: 20 PNGs, 20 captions,
`training.json`, and the zero-byte `_dataset.ready` completion marker. No provenance or
held-out evaluation file is selected for upload.

Both manifests passed the Python 3.13 harness dry run from an isolated short private copy.
The copied manifest hashes matched the source packet, and the source plan hash was unchanged
before and after the exercise. Train dry-run evidence contains all five fake checkpoint
artifacts; tester evidence contains one verified fake image for each of the five checkpoints.
Both recovery journals end at `state: terminated` with `absence_verified: true`. The retained
evidence is `MAIN/_private/qv2d-ff9f2d4e/review.json` plus the two isolated dry-run receipts.

The canonical ledger read through the existing harness reports arc spend `$39.826760` of
`$50.00` and September 9 spend `$2.026375` of `$10.00`. The train estimate is `$7.6050`
(`$7.61` ceiling) for 351 minutes, so its maximum fits both limits. The tester estimate is
`$2.491667` (`$2.50` ceiling) for 115 minutes. Train plus tester still fits the arc cap, but
their combined maximum would exceed the September 9 daily limit. The existing harness must
therefore re-read actual spend before tester creation and refuse it when the daily remainder
is insufficient.

No provider request, real upload, pod creation, source-plan mutation, approval write, Codex
call, or g01 transfer occurred in this review.
