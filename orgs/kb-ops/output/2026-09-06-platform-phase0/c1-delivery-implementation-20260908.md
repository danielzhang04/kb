# DRAFT — C delivery implementation, 2026-09-08

Status: **focused implementation complete; frozen for root-coordinated typecheck
and independent review.**

## Owned changes

Only these implementation files changed:

- dashboard/server/control/attemptSessionAdapter.ts
- dashboard/server/control/attemptSessionAdapter.test.ts
- dashboard/server/control/attemptVertical.integration.test.ts

messageClaims remains optional solely for B's later construction wiring. Its
absence refuses before any claim, PTY, session, write, or legacy-drain effect.
The deprecated drainMessages option remains type-compatible but is never
called.

The successful creator is the only holder of a claim handle. An observed claim
is reconciliation-only, including from a restarted adapter; it cannot start,
write, cancel, release, or adopt a PTY record. Same-instance exact replay
returns the original launch promise.

Every claim-port fulfillment is validated before assignment or another effect:
the created/observed result and every transition require exact public claim
shape, immutable claim/operation/declaration/agent identity, expected state,
prompt fingerprint, PTY record revision, message identity, and one revision
increment. A falsey/malformed fulfillment or any throw poisons the local
creator authority. After PTY bind admission, ambiguous outcomes are close-only:
there is no release, PTY adoption, retry, or record terminalization. A known
prewrite release remains the only restoration route.

The creator prepares the augmented prompt once, hashes exact encoded prompt
bytes with ordered claim refs, binds that fingerprint, admits one PTY record
CAS, marks the matched PTY revision, starts, wins write intent, writes, EOFs
where required, and acknowledges. Opening and later instruction writes fence
admission before and after awaits. A revoked held start, write, or EOF closes
the owned session with no subsequent projection. Logs contain only the
control key, hashed host key, and attempt reference; observer calls do not add
a duplicate report.

After write intent, an opening-frame exit or cancellation poisons the creator
and uses close-only cleanup. The result path therefore cannot turn the bound
PTY record into failed/cancelled or release the claim. A Codex prompt is also
not acknowledged when the host exits before the required EOF has been
accepted.

## Focused coverage

The real C0 chain store now backs normal adapter and vertical fixtures. Tests
cover:

- unbound refusal with a legacy-drain spy at zero effects;
- exact prompt-byte/ref ordering and message-claim PTY binding;
- same-adapter promise reuse and changed-declaration conflict;
- empty claim followed by a later queued message;
- shared-store observer begin/cancel refusal and real-registry restart/collision
  non-adoption;
- matching/mismatching/stale PTY operation conflicts, terminal tombstones, and
  the cancellation-versus-write-intent CAS race;
- each claim create/bind/admit/mark/write-intent/ack transition after a real
  mutation both returning a malformed fulfillment and throwing undefined;
  release has both cases too;
- held start, prompt write, EOF, and later instruction write withdrawal;
- partial/refused writes and EOF as close-only, no-ack paths.
- a Codex exit after its accepted prompt but before required EOF, with zero
  acknowledgement;
- a Claude exit between its two opening frames, retaining write-intent and the
  bound PTY record after result completion.

The first broad adapter run exposed 11 separate legacy expectations (blind
cancel tombstone, PTY prompt counters, post-write terminal status, and
preflight/detail assumptions). The first vertical run exposed three separate
legacy assertions in one test (write-spy status, write ordering, and duplicate
observer logging). They were converted explicitly. No implementation defect
failed twice in the same scenario; no intentional-red label was applied after
the fact.

## Verification

    npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/attemptSessionAdapter.test.ts
    # 95 passed

    npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/attemptVertical.integration.test.ts
    # 8 passed

    npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/attemptSessionAdapter.test.ts server/control/attemptVertical.integration.test.ts
    # 103 passed

    npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/attemptSessionAdapter.review.test.ts -t review:
    # 2 passed, 93 skipped (root-owned temporary review copy; not modified)

Dashboard typecheck is intentionally pending root coordination while other
workers edit non-overlapping files. No activation, C0 claim-store, schema,
grant, engine, B, or D1 file was changed. This draft grants no commit, merge,
or activation authority.
