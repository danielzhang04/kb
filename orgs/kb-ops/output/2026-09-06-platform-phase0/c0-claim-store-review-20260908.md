# DRAFT — C0 claim-store review, 2026-09-08

**Technical verdict: READY for the isolated C0 port.** This independent review
covers only `agentSessionChains.ts` and `agentSessionChains.test.ts`. It finds
no concrete correctness or security blocker in the frozen pair. It does not
accept the later C1 adapter/PTY integration or Phase 0 as a whole.

## Review findings

- The v2 document and claim decoders require exact keys. The v1 decoder is
  separate and upgrades only inside a locked mutation. Duplicate legacy text
  receives distinct deterministic references, one migration timestamp, and
  stable ordered rows.
- Claim creation atomically moves selected rows, including an empty set, to an
  operation-keyed durable claim. Only its successful creator receives a random
  handle; the store persists its SHA-256 hash, and observed/public results omit
  both the hash and raw authority.
- Transitions compare the handle hash, claim reference, operation key, agent,
  declaration fingerprint, prompt fingerprint where bound, expected revision,
  and allowed state. `acknowledged` and `released` retain operation/message
  identities while clearing message text, so later rows cannot be acquired by
  an old claim. Release and write-intent compete on the same revision.
- The implementation persists one per-run global message ordinal. That is
  stronger than the work order's per-agent monotonic ordering for restoring
  independently claimed rows. The tradeoff is noncontiguous ordinal values for
  an individual agent; no required behavior depends on contiguity.
- The focused fault wrapper delegates to the real `AtomicJsonDocument`, then
  throws `undefined` after its mutation completes. The new create and release
  tests prove an ambiguous landed mutation gives no creator authority or second
  restoration. They do not rely on a filesystem spy or alter the persistence
  primitive.

## Deliberate staged boundary

`drainMessages` remains only because the current activation/attempt adapter
still consumes it. C1 must remove that delivery route and use this claim state
machine through acknowledgement or release before the package meets the
end-to-end no-silent-loss obligation. C1 also maps raw operation keys to the
established SHA-256 host key before this store's 128-character map-key bound.
Those integration tasks are recorded in
`c1-attempt-persistence-preflight-20260908.md`; they are not a C0 port defect.

## Verification and scope

- Root independently verified the final bytes: `npm.cmd run typecheck` passed.
- Root then ran `npm.cmd test -- --configLoader native --no-cache --maxWorkers=1
  --no-file-parallelism server/control/agentSessionChains.test.ts`; it passed
  **18/18** in one file, 1.18 s total (923 ms test time), including the two
  after-landed falsey failure regressions.
- The final explicit ordinal cast follows the existing `Number.isSafeInteger`
  guard. It resolves TypeScript's `unknown` narrowing error without changing
  the runtime contract.
- Reviewer ran `git diff --check -- dashboard/server/control/agentSessionChains.ts
  dashboard/server/control/agentSessionChains.test.ts`; it passed, with only
  Git's existing Windows line-ending warnings.
- I did not run a competing test command or typecheck while root ran those
  verification commands.
- Excluded: C1 adapter/PTY/surface work, activation/routes/lifetime wiring,
  D ledger work, frozen Slice 1A files, and production actions.
