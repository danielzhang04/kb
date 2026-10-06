# Runtime authority contract: signed scope, one-shot execution and reviewed result

Status: design recommendation for independent review, 2026-10-06. Based on checkpoint `1719729a` and the completed inspection-only slice. This plan changes no production permission, verifier, approval store, dashboard, spend path or live guard. Its proposed next code slice is a pure, synthetic binding/transition analyzer, not an approval adapter or launcher.

## Decision recommended

Use the existing **signed-card channel** for the first Figment integration, with two separately authenticated purposes: one exact bounded smoke launch, then one fresh human-reviewed compatibility result. Do not use the possession channel for the first adapter because its upstream minting trust must otherwise be imported into this new consumer. Do not call the stateful WebAuthn verifier to check historical freshness or re-use its nonce store as a Figment launch ledger. These are bounded implementation choices, not changes to the repository's T2 policy or a claim that another channel is generally invalid.

A future trusted controller must consume the signed launch payload once, collect and seal the exact run evidence, and require the separate signed result before any runtime-compatibility admission. A signed result authorizes an operator-reviewed compatibility claim under stated capture assumptions; it does not cryptographically attest remote GPU execution. Runtime compatibility never authorizes a later paid run, approves an identity, or replaces a human output gate.

Keep current production guards closed until the controller, consumption durability, capture integrity and freshness policy have been implemented and independently reviewed. Hash-consistent local JSON cannot stand in for those mechanisms. The existing `figment/tensor-runtime-inspection@1` report remains permanently non-authoritative.

## Actual source findings

Read for this design, without invoking any verifier:

- `scripts/approvals.py::approval_payload` authenticates action, target and the first Work order section. Arbitrary frontmatter such as owner, risk tier and expiry is outside that I3 payload commitment; the signed introducing commit still authenticates the entire pinned card. `verify_signed_approval` verifies the introducing web-flow merge and returns the pinned committed card/payload. It has a24-hour age limit; signed expiry is optional in the primitive, while possession requires it. A new contract must put its consequential expiry/owner/tier inside the signed Work order and cross-check card metadata.
- `_resolve_approvals_ref` accepts a caller override and otherwise falls back from remote-tracking approvals to a local branch and HEAD. The future adapter must supply a code/config-owned protected ref and reject fallback. A ref name alone does not establish freshness or remote protection.
- The signed verifier uses local Git/GPG, a scratch GNUPGHOME, pinned fingerprints and a local human allow-list. It has no explicit HTTP/fetch operation. This does not prove current remote revocation or enforced network isolation under arbitrary Git/GPG configuration. No verifier, keyring, nonce or credential store was opened/executed during this task.
- `scripts/webauthn_verify.py::verify_webauthn_approval` checks pinned configuration and committed content, then atomically consumes a nonce with `O_EXCL` and advances a counter. Counter failure after nonce consumption is fail-closed. This is an authentication replay defense, not a transactional record of Figment pod creation or result capture.
- `dashboard/server/approvals/cardVerifier.ts::driveVerify` returns a pinned card for signed/possession channels; its immediate execute callback is WebAuthn-only. There is no existing signed-channel Figment execution/capture transaction to invoke.
- `pod/recovery.py::acquire_run_directory_lock` excludes concurrent use of one receipt directory and refuses old receipts/journals. `create_intent` persists a manifest/limits/name-bound intent immediately before provider create; state is intent/acquired/uncertain/terminated. Atomic JSON replacement flushes the file and attempts directory flushing; its Windows durability limitation is documented. This does not consume one approval across two different output directories or two controllers.
- `pod/runpod_run.py` owns bounded placement attempts, cost checks, create intent, acquisition, watchdog, lease and verified teardown. A single invocation may create more than one placement when its manifest permits it. Do not equate one approval with one pod without binding that policy. The recommended first smoke manifest uses exactly one placement attempt and one job; the existing harness still owns failure cleanup.
- The current driver blocks live tensor video pending admission; native review reconstructs current input/media lineage and cannot grant nonfixture acceptance without admission. The inspection module reads declared bounded JSON/current-code metadata, has no verifier/capture path, and always reports authority unavailable.

Repository preamble passed. This task performs read-only source inspection and writes only this new plan. No network, provider calls, models, tests, approvals, secrets or coordination-store writes are part of it.

## Trust model and missing mechanisms

The intended trust root is the existing human-authenticated signed-card mechanism plus an explicitly deployed controller whose executable/configuration and consumption/capture store cannot be rewritten by the ordinary evidence producer. Evidence files and worker-produced manifests are untrusted until bound to that authenticated scope. Neither a Git author string nor a worker-generated signature creates this separation.

Missing today:

1. A Figment consumer that obtains the pinned verified card and checks this contract without exposing verifier/ref/key/clock overrides to input.
2. An authenticated, freshness-bounded protected-ref snapshot/revocation feed owned by the controller. A locally cached Git ref is not sufficient on its own.
3. A durable, globally unique approval-consumption transaction shared by all allowed controllers, rather than per-output-directory locks. Its access control and crash/durability behavior are not supplied by `recovery.py`.
4. A trusted collector/sealer for installed inventories, object-info, prompt/history, actual media and final termination/ledger records from the same bounded attempt. Existing local JSON and media metadata do not authenticate their producer.
5. The reviewed result adapter tying a fresh signed human decision to the sealed evidence and exact compatibility scope.

No proposed pure validator can make any of these five mechanisms real. Implementation review must verify their deployment/access-control assumptions; if a worker can rewrite the controller, trust configuration and all store records, the mechanism detects accidental drift at best. OS-enforced confinement and service separation are later design/implementation work, not claims about current component-wise path checks.

## Gate A: exact authenticated bindings

Propose one fenced JSON object as the complete Work order body, with no additional executable instructions. The future adapter parses exactly that object from the verifier-returned pinned payload, using the existing Work order extractor; it never rereads a mutable card or executes command strings from it. Names below are new contract schemas, not existing authority records.

`figment/runtime-smoke-authority-contract@1` has exactly:

- `schema`, `purpose="tensor-video-runtime-smoke"`, `creator`, `recipe_profile="tensor"`, `stage="video"`, `fixture=false`;
- `card_id`, `owner`, `risk_tier="T2"`, `action="figment-runtime-smoke"`, `target` (canonical manifest SHA256), `not_before`, `expires_at` (UTC);
- `manifest_sha256`, `scope_sha256`, `input_authority_sha256`, `controller_build_sha256`, `capture_policy_sha256`;
- `bounds={job_count:1, max_placement_attempts:1, max_usd_micros, max_minutes, arc_cap_usd_micros:75000000, arc_start:"2026-09-29", arc_snapshot_sha256}`;
- `attempt_policy={max_invocations:1, retries:"new-approval-required"}`.

Canonical Work order bytes for this new contract format are exactly a `json` fenced block containing one compact, sorted-key, ASCII-escaped JSON object, with LF separators and no surrounding prose. Reconstruct that representation and require byte equality to the extracted pinned Work order; do not normalize a differently formatted signed body and silently hash a replacement. The I3 payload remains the existing `action:<JSON>\ntarget:<JSON>\nwork-order:\n<exact extracted body>` encoding. Test independent fixtures against `approval_payload`; the pure module must not change the fleet format.

The action/target must agree with the signed envelope; card ID/owner/tier must agree with the pinned card metadata. Duplicating them inside the authenticated Work order binds consequential metadata into the I3 payload as well as the signed commit. The contract's own expiry is mandatory even though the primitive permits signed cards without expiry. Accept only within the intersection of primitive age/expiry, contract validity and trusted-ref freshness. No naive local timestamp supplied in evidence can determine the validation clock.

The scope digest covers exact runtime/container/model/custom-node pins, source/API export and effective graph, relevant code/capture implementation, installed-schema requirements, output contract and native-media policy. Bind the actual input authority chain separately through existing canonical passport/edit/frame0 adapters. Initially no template-wide compatibility inference: one exact graph/input scope is conservative. Any broader prompt/input substitution policy needs its own reviewed schema, not an implicit wildcard. No source-stage runtime is promoted by a video result.

Money uses bounded integer microdollars, time bounded integer minutes, no floats/Booleans. Bounds are ceilings, not permission to bypass existing lower caps. The authenticated arc snapshot documents what was approved; the controller must recompute the current ledger/billing basis before invocation. Increased current spend cannot be ignored because an old snapshot was signed. Existing spend enforcement remains authoritative and unchanged.

Recommended future trust-ref policy: a controller-owned authenticated refresh before reservation and again immediately before provider dispatch; refuse if unavailable, rolled back, divergent or older than a reviewed maximum (recommend five minutes for the first adapter). Trust source URLs/ref names/fingerprints/human allow-list hashes are fixed by reviewed configuration, never request arguments. Require an authenticated monotonic trust epoch and revocation state. This feed/epoch mechanism does not currently exist; the five-minute proposal is a conservative validity window, not a claim of a current service. Revocation racing after the last check has an unavoidable interval; checks and termination behavior must state that interval honestly rather than promise instantaneous revocation.

For result reuse, recheck fresh trust/revocation state and a currently valid signed result contract. Do not set the verifier clock backward to authenticate an expired historical launch. Historical launch provenance comes from the separately protected consumed-attempt record and sealed evidence; its existence/integrity is currently a missing mechanism. Renewing a result requires a fresh human-signed result decision, not an agent changing a timestamp.

## One-shot consumption and crash contract

Recommend a single controller-owned transactional store with a unique key over the domain-separated signed launch payload digest. A SQLite transaction with uniqueness/CAS can be a small single-host implementation if the store is outside worker-write scope and filesystem/process durability is proven. Multi-host launch must use one serialized authority or a real shared transaction service; syncing SQLite/JSON through Git or a network folder is not sufficient. No store implementation, location, ACL or deployment is approved by this plan.

The launch consumption record binds approval payload digest, signed introducing commit/trust snapshot, immutable contract/scope/manifest, invocation ID, and monotonically increasing revision. Writes require compare-and-swap against the previous revision/hash in the trusted transaction. An append hash chain detects accidental mutation but is not authentication if the whole chain can be replaced.

Recommended states and irreversible effects:

| State | Allowed next state | Meaning and crash behavior |
|---|---|---|
| absent | reserved | Unique approval key is durably consumed before any provider action. Two callers cannot both reserve. |
| reserved | dispatch-intent, abandoned | Exact invocation/manifest frozen. Crash before intent burns the authorization; do not release it automatically. |
| dispatch-intent | acquired, uncertain, failed-terminal | Bind the existing recovery attempt/name/intent before create. Lost create response becomes uncertain, never eligible to create again. |
| acquired | terminal | Bind exact pod ID and existing recovery evidence. Only existing harness/recovery cleanup may operate. |
| uncertain | acquired, terminal | Reconcile the exact existing attempt; no new pod or output directory under the old approval. |
| terminal | sealed | Every placement absent/verified, ledger reconciled, capture complete. Any failure stays failed/unreviewable; termination alone is not success. |
| sealed | result-linked | Link a separately authenticated fresh result contract to the exact sealed digest. No launch entitlement is recreated. |
| abandoned, failed-terminal, result-linked | none | Terminal for launch purposes; rerun needs a new human-approved payload/card. |

An exact repeated request may return the already recorded state, but never repeat its side effect. Same event ID with different bytes is a conflict; same event bytes is an idempotent read/replay. Unknown state/revision, missing record after uncertainty, divergent history, clock rollback or storage failure blocks dispatch and surfaces recovery work. No TTL unlock or automatic lock deletion. A controller crash after reservation but before calling the provider may waste approval; that is preferable to duplicate spend. A crash after provider success but before acquisition persistence must use the existing durable recovery intent, not infer absence.

There is no atomic transaction spanning SQLite and provider create. The at-most-once rule is therefore **persist dispatch intent, then never repeat create for that invocation after uncertainty**. Availability is deliberately sacrificed: recovery can terminate/reconcile the existing attempt, but cannot silently recreate it. First smoke uses one placement; later multi-placement support would require explicit signed bounds and a reviewed per-placement extension.

Do not claim the current harness is integrated with this store. Its recovery intent is produced inside the create loop, so binding the controller's dispatch intent to that exact journal needs a separately scoped capture/handoff seam before provider create. No wrapper should invent a second pod name, lease or teardown path. If that seam cannot persist the complete binding before create, gate B remains blocked.

## Result authority and smoke bootstrap (gate B)

A completed smoke is evidence, not a result authorization. The controller must seal a canonical index over: consumed launch contract/attempt chain; runtime/container/installed-file inventory; actual object-info schema; exact submitted graph and returned prompt/history; native MP4 and embedded API prompt; decoder/frame checks; all placements/recovery journals/verified absence; ledger reconciliation; relevant executable/config digests. No raw credentials/environment capture. Models/media are handled only by the future already-authorized runtime/capture scope, never by the next pure analyzer.

Proposed `figment/runtime-result-authority-contract@1` contains exactly schema, purpose="tensor-video-runtime-compatibility-result", card_id, owner, risk_tier, action, target, not_before, expires_at, creator, fixture=false, stage, recipe_profile, launch_payload_sha256, invocation_id, sealed_evidence_sha256, scope_sha256, controller_build_sha256, capture_policy_sha256, limitations_sha256 and decision="accept-compatibility". Action/target identify the sealed evidence digest and agree with the authenticated envelope. It contains no new launch bounds or publish permission. A rejected/incomplete result cannot be represented by changing a local Boolean; it simply lacks an accepted authenticated result.

Use a fresh signed-card verification for that result at admission time. The human is authorizing the exact reviewed evidence/compatibility claim, not attesting facts through the mere act of signing an arbitrary agent-authored bundle. The report must disclose the trusted collector assumptions and any unresolved execution provenance. If actual capture integrity is unavailable, no accepted compatibility adapter should be enabled even with a matching local bundle hash. Do not describe native metadata, a signed manifest, or a human result card as hardware attestation.

Bootstrap recommendation: a future dedicated **smoke-only** controller action consumes the exact launch contract and uses the unchanged harness with the canonical input checks, source parity, pin/licence checks and existing budget/teardown. It is allowed to collect evidence without prior compatibility admission, but cannot create a production approval, deliverable or reusable admission by itself. This explicit action is separate from ordinary `run`, not a skip flag or Boolean injected into the driver. Its action registry/dispatcher integration is absent and separately gated. Existing ordinary live video launch and acceptance remain refused until the reviewed result adapter exists.

The result's expiry/revocation may stale a compatibility projection; current input/graph/pin/capture-code drift always does. Eye-gate acceptance and delivery must reconstruct that current projection through canonical adapters. Historical eye approvals cannot make an expired/revoked compatibility contract current. No result authorizes a subsequent funded invocation; that needs its own T2 card and consumption key.

## Smallest useful next code slice

Recommend one new `pipeline/runtime_authority_contract.py` and one focused test file. No CLI integration initially, no persistence, no verifier imports/callbacks, no clock/network/filesystem/model/subprocess access, and no changes to `tensor_runtime_admission.py`, driver or guards. The public API accepts already supplied inert values and labels them **untrusted contract claims**, never verified authority:

1. `parse_contract(value)` validates the exact launch/result schemas, lengths, dates, digests, integer bounds and closed nested fields; returns a canonical immutable value or structured bounded error.
2. `compare_bindings(contract, envelope_claim, scope_claim, now_utc)` compares pure inputs and emits named mismatches. `now_utc` is a test/data argument, not a production trust clock. The envelope claim has exactly card_id/action/target/owner/risk_tier/payload_sha256; it is not accepted as a verifier result. Require a matching canonical Work order payload digest using the existing documented encoding, with independent parity fixtures; do not import or invoke the verifier.
3. `analyze_attempt_trace(contract, events)` checks the state-machine model, exact event identity/revision/previous hash and scope/attempt binding. It returns structural trace state and conflicts, never a dispatch instruction or consumable capability. Caller input cannot prove a store transaction occurred.

Proposed trace event closed shape: `schema="figment/runtime-attempt-event-claim@1"`, `event_id`, `revision`, `previous_event_sha256` (null only at revision0), `approval_payload_sha256`, `invocation_id`, `contract_sha256`, `scope_sha256`, `from_state`, `to_state`, `occurred_at`, and `evidence_sha256` (null only for initial reservation). The pure analyzer requires canonical hashes, no gaps, exact contract/invocation agreement and allowed transitions; evidence digests are untrusted claims and never proof that a provider/store action occurred. State names and nullable positions are closed. A transition to sealed/result-linked cannot be inferred from a Boolean; the pure model can only check declared supporting bindings and must label their authenticity unavailable.

Every successful analysis envelope is `figment/runtime-authority-analysis@1` with `structurally_consistent`, `authority_status="unavailable"`, `runtime_admitted=false`, `production_ready=false`, `dispatch_permitted=false` and explicit missing mechanisms. No `VerifiedApproval` class, injectable success verifier, locally signed token, admission receipt or writable state transition is created. Pure next-state modeling is not enforcement of concurrency or actual one-shot consumption.

Initial bounds for this code proposal: serialized contract64KiB, Work order64KiB, event trace256 records/1MiB total, JSON depth16/10000 items, ID128 chars, text1024 chars, exact lower-case SHA256/40-hex commit fields as applicable, timestamps canonical UTC and finite integer ceilings. Model only signed positive integer values (maximum 2**53-1), with no monetary enforcement constant; budget enforcement is explicitly unimplemented. No paths to model/media/credential files are accepted.

This slice can settle serialization/binding/replay mistakes before implementing any consequential service. It cannot produce an authentic approval, reserve an invocation, establish protected-ref freshness, capture a run or unlock a guard. Root should release only this pure scope after independent plan review.

## Tests, independent review and exits

For pure contracts: reject missing/unknown keys, duplicate/nonfinite JSON if raw parsing is included, Boolean-as-number, noncanonical dates, expired/reversed windows, wrong stage/purpose/fixture, mismatched authenticated-versus-claimed card fields, substituted manifest/scope/input digest, Unicode/type-collision payloads and budget-unit mistakes. Test launch/result contracts cannot be interchanged and a result never implies dispatch.

For traces: exhaustive allowed/disallowed transition pairs, unique approval/invocation binding, same-event exact replay, same-ID changed bytes, skipped revision, wrong previous hash, duplicate reservation, cross-invocation retries and uncertainty followed by fresh create. Opaque evidence digests cannot establish partial termination, capture completeness, successful execution or valid result authorization; those claims remain unchecked even for a structurally valid sealed/result-linked trace. Model two simultaneous reserve proposals from one revision and show only one can be a valid successor in a serialized history; clearly state this does not test a real CAS/store. Model crashes at every write/action boundary and preserve the burned/uncertain state rather than resetting it.

For trust boundaries: arbitrary `verified:true`, `runtime_admitted:true`, private key/ref/verifier selectors and unrecognized authority fields refuse. Assert all successful/failing analysis outputs preserve false/unavailable authority and never return executable actions. Import and all pure API tests trap filesystem, subprocess, socket and verifier imports. Use only synthetic contracts/events; no existing approval is verified or consumed.

Independent reviewers must compare the payload encoding to actual `approvals.py`, review the proposed controller/store assumptions separately from pure code, trace that no production caller or guard consumes analysis output, and challenge replay/crash/cross-contract transitions. Exit is a reviewed pure contract model with exact test evidence and unresolved mechanism inventory. It is not an implemented gate A/B adapter, real smoke authorization or completed phase6.

Later implementation requires separate scoped review of trusted-ref refresh/revocation, controller deployment/access control, transactional consumption, the pre-create harness binding seam, trusted capture/sealing, signed result adapter, and canonical launch/review integration. Governance/dashboard/approval-store/spend changes and all real execution remain outside this plan's release candidate.

## Reviewed pure-slice clarifications (2026-10-06)

`scope_claim` is a closed untrusted object with `purpose` equal to the contract purpose. Launch requires exactly `manifest_sha256`, `scope_sha256`, `input_authority_sha256`, `controller_build_sha256`, `capture_policy_sha256`; result requires exactly `launch_payload_sha256`, `invocation_id`, `sealed_evidence_sha256`, `scope_sha256`, `controller_build_sha256`, `capture_policy_sha256`, `limitations_sha256`. Digests are lowercase 64-hex; invocation IDs follow the bounded ID grammar. Envelope fields are exact typed claims, never verifier objects.

The pure API takes raw UTF-8 JSON bytes for contracts, envelope/scope claims and traces, making pre-parse size limits enforceable without traversing arbitrary caller objects. `parse_contract` returns immutable canonical JSON bytes on success, or the same bounded analysis error envelope as other APIs. No mutable trusted object or success capability is returned. Work-order formatting is generated exactly from canonical contract JSON; supplied envelope payload digest must match the existing I3 encoding including the LF after `work-order:`. Canonical serialization uses sorted keys, ASCII escaping, compact separators and no NaN; parsed finite JSON additionally has depth/item/string bounds.

`analyze_attempt_trace` accepts launch contracts only. Initial reservation and dispatch intent must occur within the inclusive not-before/exclusive expiry window. Later reconciliation, cleanup, sealing and result-link claims may occur after expiry; they never revive dispatch. All unique event timestamps are nondecreasing. Exact canonical event replays (including historical events) are ignored for topology and time progression; reused IDs with changed canonical bytes conflict. Initial event is revision 0 from absent to reserved, previous hash and evidence null. All later events require nonnull evidence digest and previous canonical event hash, consecutive revision, constant invocation/contract/payload/scope bindings. Trace checks topology/hash/time/bindings only; evidence authenticity, termination, capture completeness and result authorization are always unchecked.

Errors have the same analysis schema and invariant false authority/runtime/readiness/dispatch fields as successful analyses, with at most 32 fixed code strings (no reflected attacker text), no stack trace or executable instructions. Contract/claim inputs are at most 64 KiB; traces at most 1 MiB and 256 records; IDs use `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. Timestamps are exactly second-resolution `YYYY-MM-DDTHH:MM:SSZ`; not-before must precede expiry. Current validity is only compared to supplied test time, not asserted as authenticated freshness.

The implemented pure-slice budget values are signed claims only: the proposed $75/September-29 real-policy scope above is NOT enforced by this analyzer. Any positive serialized microdollar value and valid calendar arc-start date can be structurally modeled. Current arc totals, real cap applicability and all spend enforcement remain unchecked and owned by the existing harness.
