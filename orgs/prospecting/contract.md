# prospecting — contract (autonomy policy)

Conservative default: EVERYTHING queues-for-me until grades earn wider lists.

## acts-alone
- read project files and desktop-local typed projections needed for assigned work
- write work products named by an assigned card on its work branch
- run synthetic, local, no-network verification

## queues-for-me
- everything else, explicitly including external publishing, outreach, live adapters, purchases,
  cap increases, human overrides, approvals, merges, and changes outside this project
- every Gmail send; each is kb risk tier T3 and requires the applicable verified human approval
- every new or widened cadence, permission, capability, or network destination

## wakes-me-up
- verification fails twice on the same item
- daily budget is breached
- any request to handle a secret as an object
- any PII would enter git or a VM sink
- any governance rule is at risk

## hard data boundary
Names, emails, phones, profile URLs, person notes, source excerpts, and message bodies may exist
only in desktop-local SQLite, the dedicated Chrome user-data-dir, or the snapshot directory. They
never enter git, process arguments, stdout/stderr, logs, cards, ledgers, exception text, or any VM
sink. Repository fixtures are synthetic and use reserved `.test` domains and synthetic phone ranges.

## executor boundary
Only the deterministic non-agent executor may hold ambient Gmail or vendor credentials. Agents may
create typed `exec_request` rows containing opaque IDs; they have no raw Gmail, vendor, shell, or
credential operation. P1 has no enabled live adapter.
