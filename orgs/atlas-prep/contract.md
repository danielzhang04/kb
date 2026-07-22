# atlas-prep — contract (autonomy policy)

Conservative default: EVERYTHING queues-for-me until grades earn wider lists (governance/risk-tiers.md).

## acts-alone
- update STATE.md and wiki/ in this project
- write DRAFT research findings into output/ marked DRAFT
- read-only research fetches (repo reads, web fetch/search) needed to produce that draft

## queues-for-me
- everything else, explicitly including: merges to main, external publishing,
  any diff > 400 lines, anything touching other projects
- the `research-draft-gate` HEARTBEAT cadence — it is AGENT-GENERATED (authored on a work
  branch this session, NOT by a human on protected `main`), so per governance/risk-tiers.md
  ("AGENT-GENERATED task types start supervised regardless of tier") it starts supervised
  and earns wider autonomy only via the grade ledger. It gains standing authorization only
  if a human authors and commits it to a HEARTBEAT.md on protected `main`.
- ANY use of a research draft beyond sitting in output/ as DRAFT — no send, no publish, no
  downstream automation consumes it until a human reviews the gate card (project law:
  research findings are Stage 0 — human approves every use beyond the draft)
- any new cadence, or any change widening a cadence's scope outside orgs/atlas-prep/**

## wakes-me-up
- verification fails twice on the same item
- daily budget breached
- any request to handle a secret as an object
- governance rule violated

## voice-staging (V2a, human-directed)
* Atlas may move a card `inbox → approvals` **only** on Daniel's live spoken direction, **only**
  after a full readback and a verb+target echo-confirm captured as a distinct post-TTS human turn,
  **only** for `risk-tier: T3` targets, and **only** from a live engaged voice turn (never
  proactive/ambient/timer). Every such move strips `assurance_class`, is stamped `staged-by:
  atlas-voice` + a session-transcript reference, and is auditable. This is the *sole* card-state
  transition Atlas may perform; it stages only and **never commits** an approval — the WebAuthn
  passkey commit is unchanged and human-only.
