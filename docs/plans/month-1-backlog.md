# Month-1 Backlog (from M1 final review + session decisions)

Carry-forwards ordered by the final whole-branch review's triage. Source of truth for the next planning cycle.

## Harden the approval boundary (do FIRST, before any non-Claude agent gets ops push access)
- **I1:** approvals rely on local git author strings; `ops` (where approvals live) is unprotected. Verify humans via GitHub verified-identity API, or approvals-via-PR into a protected ref, or signed commits. Reconsider `enforce_admins` once agents stop using the owner's ambient credential.
- **I3:** fold `action` + `target` frontmatter into the approval content hash (today only `## Work order` prose is bound) — required before real T3 actions (merges, publishes, deploys).
- **T10 carry-forwards:** two-branch (main→ops merge) topology test for the `-S` binding; assert approval was set as a frontmatter *field* at the candidate commit (`git show <commit>:<path>` parse) to close the pickaxe count-preservation edge.
- Approval UX: one-tap approvals (pre-staged approval PRs or Omnara taps). Lesson from live run: humans will not type 64-char hashes on phones.

## Cloud execution leg (close M1's one open proof)
- **I4:** fix routine environment→repo binding at claude.ai (user UI action), then demonstrate one full cloud-only cycle: dispatch → standing-auth execution → dashboards → push, no desktop involvement.

## Fleet expansion (the original month-1 plan)
- Omnara (or Happy) wiring for phone launch/steer of the desktop tier.
- Codex CLI (device-auth) + Gemini CLI + skill adapters in the sync step; per-agent git identities + scoped tokens (prereq: approval-boundary hardening above).
- Grader identity + weekly reconciliation; ledger-driven promotions begin.
- Scout→Manager→Worker→Inspector across ≥3 projects; tiered heartbeats per project; first real faceless-youtube cadence.
- Telegram digest bot (alerts decision: month-1 item), per-workflow channels if traffic warrants.

## Deferred minors that stay deferred (revisit only if they bite)
- cards.py role-enum/state-bucket validation; non-ULID ids.
- preamble edge cases (malformed budget.yaml exits 1 not 2; empty-string API key passes; per-step model-id assertion is prose-only, unenforced — do not trust it until wired).
- scan_skill TEXT_EXT breadth, OS-native separators, per-line heuristic gaps (by design; human read-through is the other half).
- new_project trailing/double hyphens; no rollback on partial scaffold.

## Standing notes
- Desktop fallback is healthy: pinned-interpreter wrapper `scripts/desktop_dispatch.ps1`, rehearsed with real-interpreter log evidence; task `kb-desktop-dispatcher` registered, Disabled.
- Governance: standing authorization decided 2026-07-15 (human-authored HEARTBEAT cadences pre-approved at declared tier; agent-generated tasks supervised until grades promote).
- humans.yaml carries both identities ("Daniel Zhang" desktop, "danielzhang04" GitHub web).
