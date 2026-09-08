# DRAFT - B integration preflight independent review, 2026-09-08

Reviewer: codex-worker (root coordinator, independent of Terra plan author).

**TECHNICALLY READY - plan only.** Root traced activation construction and
runAutomatic, latch retirement/drain, all five route/launch consumers, the
SurfaceContext type, and existing terminal-cost projection. The author closed
the review's concrete missing terminal-snapshot rule: waiting-human/unknown or
empty-cost boundaries issue no D operation. One current terminal RunDetail is
projected through existing collectTerminalStageCosts/readUsageMicros, prepared
once, registered before begin, and never re-derived for recovery. Add the
waiting-human -> Resume -> terminal single-final-snapshot test as specified.

The seven-file B window remains activation.ts/test, http/context.ts,
control/routes.ts/test, and control/launch.ts/test. Root additionally releases
only the existing fake activated execution helper in http/surface.test.ts for
its required generation/lifetime + empty map and internal settlement result.
The fixture is used by actual latch Lock tests; a new required generation makes
that runtime fixture change necessary. No http/surface.ts production edit,
new route/DTO/controller, or durable failed-cleanup state is authorized.

The plan preserves exact-generation ownership from pre-engine construction
through Lock, synchronous revoke before drain/unbinding, exact native promise
tracking and falsey observation, per-key identity-safe ledger recovery only via
existing Lock, and synchronous Unlock barriers. It replaces the legacy ledger
seam rather than leaving two writers. Detached fulfillment with withdrawal is
inert; actual rejection retains existing reporting. Pre-ack withdrawal returns
the existing202 DTO with starting:false and does not fail activation receipts.

B production still waits for accepted A1 and D1. C delivery is accepted at
1f0084ef with root103/typecheck/diffcheck and independent early-exit red/green
proof. An additional managed cancellation-controller seam review is underway
because real close refusal must not be reported as cleanup success; its exact
scope and independent evidence will be recorded separately before B composes it.

No tests ran for this plan review. Final acceptance requires real held-seam
latch/route tests, two-key/out-of-order ledger recovery, repeated-Lock and
identity guards, focused suites, full typecheck, and independent code review.
No formal inspector grade, merge, production deployment or Phase0 completion.
