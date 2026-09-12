# prospecting — STATE (work-product DRAFT)

_Updated: 2026-09-12_

## What this file is
Work-product DRAFT that lives only in the work tree. The boss creates the ops copy at
gate close; the gate checks that this DRAFT exists and passes the PII guard and never
reads an ops ref. This DRAFT records no gate result, no inspector grade, and no
authority of its own.

## Project scope
A desktop-local, typed prospecting foundation: a constrained SQLite store, a
deterministic executor boundary, PII controls, read-only local inspection, and
one-way export. PII and credentials stay on the desktop; VM-facing surfaces exchange
only opaque IDs, typed policy, counts, and result codes.

## Acceptance contract
Acceptance is decided only by the sole phase gate command
`py -3 -m scripts.prospecting.gate --phase <phase>` reading that phase's manifest:
the exact artifact allowlist and artifact hashes, the exact fixture set, the
enumerated test inventory, zero failures/skips/xfails/warnings/external-network calls
and zero unguarded child processes, and every numeric criterion. The inspector score
and the human gate are supplied by the boss outside this file.

## Source vs ops
- Work tree: the source of truth for code, schema, fixtures, and declared manifests.
- Generated gate records (`orgs/prospecting/gate-results/Pn.json`) come only from a
  passing run of the sole gate command with a genuine, independent inspector grade;
  they are produced in the owning checkout, not asserted here.
- The canonical coordination STATE is a separate boss-owned ops record. This DRAFT is
  not that record and asserts no gate result, hash, or inspector grade of its own.

## Now
P1-P6 scaffold and source are present in the work tree. Declared inventories are
maintained by review; acceptance awaits a boss-run gate.

## Next
Run the sole gate command per phase under boss control; the boss records the result
and creates the ops copy at gate close.

## Blocked
None identified. Acceptance is still pending independent gate execution, genuine
inspector grading, and boss-side recording; nothing here should be read as
acceptance-complete.
