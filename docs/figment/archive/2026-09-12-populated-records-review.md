# Populated Records visual acceptance

The existing **Runs & review** view is accepted for this bounded populated-record journey, following Stage B source `dcd78f3b` and documentation `3798fa5a`. No production source changed for this verification.

The actual filesystem collector, loopback HTTP routes, existing session middleware and current Workspace rendered five synthetic records: a current machine gate with **Approval unknown**, a stale gate with **Stale / Machine gate stale**, an accepted-checkpoint snapshot with **Approval unknown**, and plan/run records with **Unreviewed**. No record acquired an approved badge. A filename or current machine-gate digest is not current checkpoint or media approval.

Root actually viewed the single 1440x1200 screenshot. All five full relative paths, separated badges and **Copy path** controls were readable, including a realistically long nested path. The complete claim disclaimer and **Refresh status** control were visible; no overlap, major clipping or horizontal viewport overflow was observed. Exact accessible Copy labels were checked, but the clipboard was not invoked.

The browser made two hub GETs and three claim-discovery GETs, all HTTP 200, with zero POSTs or unexpected application requests. The extra claim GET followed one explicit **Refresh status** click. Generic rows stayed byte-for-byte equal as extracted before/after: this button refreshes claim discovery, not the existing hub snapshot. Reload the Workspace to obtain a fresh generic record inventory. Separate setup probes returned 401/401/200 for absent/invalid/valid synthetic credentials on both endpoints; those six probes are additional to the five browser requests.

The claim route returned its real empty available inventory with explicit configuration disabled. This check did not invoke a review reader, play media or approve a claim. Previously accepted configured-claim and review-result checks remain separate evidence; they were not rerun.

## Evidence

Execution on 2026-09-13 at 00:34:47.5825876–00:34:57.0471416 UTC completed with driver native 0, null error and verified cleanup. The wrapper also exited 0. Root and the independent evidence reviewer rehashed all 56 before/after/current source/runtime pins and eight synthetic fixture pins without differences; the reviewer additionally matched all 30 retained artifact hashes. Recorded cleanup left no owned PID, planned-port listener, exact temporary file or error. Services were force-stopped by exact recorded ownership rather than normally exited. Chrome sandbox stayed enabled.

MAIN evidence root: `_private/figment-records-real-visual-verification-20260912-v1`.

- `01-populated-records.png`: `bda555fd31f9640668752fd6dc09d9dda03fe14a2262f55110af57c28d84b351`.
- `visual-result.json`: `f7fe7af71b4382f17d4ddfd7dc22995cd58a8a6bee19b683b9d7efeddc98f10e`.
- `execution-status.json`: `ad47a0adec697214fc408f7b4c866d661a91c0b92e05050db3a750ef4c18a55a`.
- `cleanup.json`: `ce8d934f1ccffb2a5f468cd7ca8951cc7a3b6a066d576e214f6a49d910c10be4`.

This is finite real collector/HTTP/session/rendering evidence from synthetic metadata, not full buildApp/deployed authentication, a newly executed end-to-end operator workflow, current source approval or creator-quality acceptance. It introduces no provider action, media read, input mutation, test-suite repetition or new execution control. See the [operator guide](2026-09-12-input-auth-repairs.md) and [active tasklist](2026-09-11-active-tasklist.md) for remaining work.
