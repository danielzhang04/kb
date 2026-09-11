# Capture authoring acceptance

The private capture workflow now accepts an exported claim packet as the source of its
task and lease identifiers, and can locate exact text spans in a verified captured page.
Operators retain the choice among ambiguous matches. Neither operation imports evidence,
confirms browser observation, grants approval, or sends a message.

Claude Opus 5 proposal95 supplied the locator. Root approved its separate test module,
reviewed exact changes and input hashes, and applied it. The locator reuses capture scope,
receipt, content hash, expiry and owned-file checks. It reports every literal Unicode
codepoint match, including overlaps, subject to fixed needle and match limits; overflow
refuses before export. Existing compile and export behavior remains intact.

Claude Opus 5 proposal96 supplied packet submission. Independent Claude Opus 5 review98
was READY and identified a packet-as-page copy mistake. Codex fallback worker102 repaired
that case; root review required leading-dot and Windows case aliases to be covered against
an actual exported packet. The final guard runs before opening the store. The existing
controller still decides lease currency, replay, expiry and captured-body validity.

Verification: 75 combined locator/compiler/export tests passed in35.60s. Independent
Codex review100b was READY and ran6 locator tests successfully in4.46s. The final packet
suite passed26 tests in13.97s. Codex worker101 added and ran one genuine public-main chain
test in1.47s: session, task, claim, packet submission, funding compile/import/replay,
person scope, people compile/import/replay, source mutation refusal and no delivery authority.
Root reviewed that test and its clock-only service substitutions.

The follow-up verifier review found that `--verify-export` had been using the
ordinary migrating store opener. The accepted repair uses an existing SQLite
`mode=ro` connection with query-only enforcement for verification only; it performs
no domain/schema writes or migrations and allows only SQLite's normal WAL/SHM
coordination files. Worker120 ran37 tests over21.33s, including ordinary SQLite
URI/read-only behavior, `#` and WAL race cases, and older/missing-schema refusals;
independent review122 was READY. These checks cover the verifier path; they are
not a claim of the full repository suite.

Claude identities were verified from assistant log fields. Codex fallback requested
gpt-5.6-luna, gpt-5.6-sol and gpt-5.6-terra as appropriate; the native collaboration API
does not independently expose responding model identity. No invented model verification.

Private artifacts are retained. They are integrity/consistency evidence, not browser proof
or cryptographic attestations of human observation. Supported browser access remains
unavailable, so these results are synthetic infrastructure verification.
