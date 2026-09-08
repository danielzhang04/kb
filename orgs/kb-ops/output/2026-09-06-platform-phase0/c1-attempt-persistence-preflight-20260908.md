# DRAFT — C1 attempt persistence preflight amendment, 2026-09-08

This is a scope amendment for the next C implementation wave, not an
implementation authorization or acceptance verdict.

## Required C1 ownership addition

Add `dashboard/server/pty/sessionMigration.ts` and
`sessionMigration.test.ts` to C's sole files. Add
`dashboard/server/http/surface.test.ts` only for the existing real boot
migration regression; keep `http/surface.ts` read-only unless a later concrete
requirement appears. C already owns `pty/contracts.ts`, `sessionPersistence.ts`,
`sessionRecord.ts`, `attemptSessionAdapter.ts`, and their named tests. No B
activation, route, or browser DTO file is added.

The reason is a real boot path: `http/surface.ts:263-266` calls
`migratePtySessionStateRoot` before the real persistence can be read. The
migration's v3 branch currently calls the same strict
`assertPtySessionsDocumentV3` at `sessionMigration.ts:260-267`; its v2 mapping
at lines 168-175 spreads the document and immediately calls that validator.
Once C adds the non-optional `AttemptOperationRecord.messageClaim`, both an old
v3 document and a v2 document with attempt rows fail before the persistence
compatibility decoder can normalize them. The daemon degrades boot rather than
reaching the claim port.

## Fixed migration contract

1. Separate the **strict new-write** v3 validator from exact legacy v3 and v2
   decoders. The new validator requires `messageClaim` on every attempt
   operation. The legacy decoders accept only their prior exact key sets and
   never accept extra keys or a partially shaped claim. Export/use them only at
   the existing migration boundary; ordinary persistence `read`/`mutate` stays
   strict-current and does not become a second compatibility authority.
2. Normalize accepted legacy v3/v2 attempt operations by cloning each row and
   adding `messageClaim: null`; preserve every other validated field. Do not
   use a spread-plus-new-schema assertion as the decoder. V1 maps through an
   empty current document and therefore remains strict.
3. In `migratePtySessionDocument`, a strict current v3 replays unchanged. An
   exact legacy v3 is a real migration: make a byte-identical `.v3.bak`, write
   the normalized current v3 through the existing temp/fsync/rename/parent-fsync
   flow, and retain the same ambiguity/restore behavior as v1/v2. An invalid
   v3 that is not the exact legacy shape refuses with its source byte-identical.
   V2 follows the same existing `.v2.bak` path after the explicit map.
4. The normal persistence reader/writer validates only the current strict v3
   shape and every new write emits `messageClaim` (normally `null` until a C1
   claim binding exists). Production constructs this persistence through
   `http/surface.ts`, whose existing `registerWriteSurface` boot hook already
   awaits migration before the registry/auth/session-run readers can touch it.
   Direct unit fixtures may continue to construct current empty documents. The
   migration is the one compatibility boundary; no reader infers or recreates a
   claim.

## Focused acceptance additions

- Migration tests cover exact legacy v3 with an attempt operation, byte-exact
  `.v3.bak`, normalized `messageClaim: null`, replay of already-current v3,
  and malformed/extra-key v3 refusal without a source change.
- V2-with-operation migration proves the explicit null mapping, not a spread
  pass-through. Persistence tests cover strict current v3 rejection when the
  field is absent and clone/read/write retention when it is present.
- The real `http/surface.ts` boot test writes an old v3 file, calls
  `registerWriteSurface`/`ready`, and proves migration completed before the
  registry reads. Its existing v2 fixture literals are updated only where the
  strict current expected document now requires `messageClaim: null`.
- C1 then updates every `AttemptOperationRecord` constructor in its assigned
  adapter/PTY tests and runs only its focused migration, persistence, session,
  and attempt tests. No source implementation has begun from this amendment.
