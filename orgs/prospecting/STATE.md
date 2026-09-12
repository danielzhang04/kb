# Prospecting current state

Updated 2026-09-12T01:10:37.103235+00:00

Reviewed source7c1b2ab4 is published to draft PR181. The saved pilot now completes approved
qualification (3/3 items), deterministic ranking (one selection, five-person shortfall),
canonical format setup and selected-draft materialization/replay through public services.
Targeting, qualification and ranking hashes are unchanged. Backup/replay and authority audit
were verified: one draft binding; zero source attestations, approvals, exec requests or sends.
Actual native calls prove desktop authentication works.

Independent Opus148/150 accepted format/hash boundaries. Sonnet149 fixed optional SQLite
status isolation. Opus151/153/154 reviewed and repaired bounded HTTP refusal handling and
long numeric headers; Sonnet155/155b strengthened regression proof. Final HTTP42passed in
19.469s parsedJUnit; removing draining makes the strengthened regression fail. Four framing
cases verify zero read attempts. Format40 actual-HTML JS checks and7 focused backend checks
passed. Earlier185 affected tests had184passes and one intermittent HTTP failure, which
prompted the repair. Final merge simulation against main is clean (24behind/46ahead).

Original full suite2087:2082pass5fail,0errors/skips,1245.491s. Two failures passed focused
reruns; three human-owned P1/P6 records remain unresolved. The full suite was not rerun after
these focused changes and is not claimed green. Runtime bundle remains
 e07ade2e36d078cd83fecb2e4244a0c33322563969308da912a18205e0ca7814.
Four actual native adapters/public prepare and synthetic editorial previously passed.

All requested publication/runtime approvals are resolved, including explicit source/HTTP
publication approval. PR180 carries the coordination handoff; PR181 remains draft. Verified
Claude Opus5/Sonnet5 source-only workers returned to the existing vCPU after00:30UTC. No active
worker or pytest session remains. Source tracked files are clean; retained private evidence
and pre-existing scratch roots remain. No merge, deployment or release is claimed.

Remaining acceptance: supported browser initialization reports no browser available, so
visible private UI is unverified; human record refresh/release review also remain. Resume
with those gates, not another qualification call or full-suite rerun without a new reason.
Canonical handoff: handoffs/2026-09-11-prospecting-infrastructure.md.
