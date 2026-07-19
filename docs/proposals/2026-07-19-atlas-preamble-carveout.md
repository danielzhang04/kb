# Proposal: Atlas fast-lane API-key carve-out (for Daniel to apply to CLAUDE.md)

**Status:** PROPOSAL — inert until Daniel edits CLAUDE.md himself (constitution is human-edited only).
**Approved in principle:** 2026-07-19 conversation (delta design §4.1); this file is the exact wording.

## The change

In CLAUDE.md, "Shared preamble" section, replace:

> 2. `ANTHROPIC_API_KEY` unset (subscription billing only)

with:

> 2. `ANTHROPIC_API_KEY` unset in fleet agent environments (subscription billing only).
>    Exception (2026-07-19): the Atlas voice worker process may hold a spend-capped key in
>    its OWN process environment only — loaded from outside the repo, never printed,
>    persisted, copied, or exported to any fleet agent; spend ledgered to
>    `ledgers/cost/atlas-*.tsv` under the daily budget guard.

## Why

- Atlas's fast conversational lane (500–800 ms spoken turns) requires the Anthropic API path;
  subscription Claude Code sessions cannot serve sub-second voice turns, and SDK-on-subscription
  is not Anthropic's sanctioned production path (research 2026-07-19).
- The fleet rule's purpose (no accidental API billing by fleet agents) is preserved: the
  preamble check still fails any fleet agent with the key set. Only the standalone worker
  process — which never runs fleet loops — carries it.

## Mechanics already in place

- Key lives in `%USERPROFILE%\.atlas\env` (outside repo, git-ignored by location).
- `orgs/atlas/contract.md` carries the paired ~$50/mo spend authorization (also pending
  Daniel's ratification).
- Mirror the same edit in AGENTS.md / GEMINI.md if their preamble text is a copy.
