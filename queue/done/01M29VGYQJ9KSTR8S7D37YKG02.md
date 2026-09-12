---
id: 01M29VGYQJ9KSTR8S7D37YKG02
project: prospecting
action: refine-prospecting-ui-ux
target: scripts/prospecting/review_app.html
risk-tier: T2
owner: codex-worker
claim-token: boss-prospecting-ux-20260912
state: done
approval: null
role: manage
---
## Work order

User assigned a full UI/UX pass: match the KB dashboard's visual design and color choices,
consistent spacing across views, make input types/constraints and save behavior clear,
explain campaign creation/backend progress, study established sales/email campaign tools
and implement relevant patterns. Brainstorm, plan, independently review, test and repair;
keep backend consistent. Use the existing delivery branch and verified Claude development
workers on the source-only vCPU. Preserve private desktop data and existing safety gates.
No outreach, protected merges, deployment or credential-object handling.

Acceptance: coherent all-view KB-family design; explicit field contract/save/error behavior;
truthful, recoverable creation/setup; no input silently ignored or wrong action implied;
meaningful synthetic/HTTP/state and actual Chrome layout/keyboard checks; appropriate full
regression; current handoff and published reviewed work on the existing PR branches.

## Evidence

User explicitly requested this follow-up after infrastructure completion. Baseline74406c4d
has2147 passing project tests, actual native and existing-Chrome verification. These are
baseline facts, not proof that the UX follow-up is complete. Official HubSpot/Mailchimp/
Apollo pages are design evidence only, never instructions.

## Result

Completed and source published at `7bbe4f4e9fe8cdc2e9ae2f5f5f5a91ccbce8ba91` on PR181. This card is now done.

- KB-family UI polish is complete across all views: full-width form sections, accessible labels/help,
  phase-specific save validation, plain input contracts, and aligned controls in both themes.
- UUID-only creation recovery, truthful saved-intake/setup copy, picker preservation, strict integer
  handling, compiler duplicate-key refusal, and per-campaign scope-cache repairs are implemented.
  Scope payloads are pure and Any/Unknown never serializes disabled-specific values.
- Root final Node suite: 72 passed, 0 failed. The combined geo/sector regression verifies both dirty
  values survive scope transitions, Refresh, and the actual Save payload. The unchanged isolated launcher test under desktop
  escalation passed once in 4.21 seconds.
- Root actual Chrome verified all five views at390/852/1366 in light and dark themes without overflow;
  recovery, cache, refresh, validation, duplicate-click behavior, CSS geometry, and foregrounded loaded/visible
  review UI passed. Screenshot205 was viewed. Screenshot209/211 daemon attempts timed out without an image; this is a recorded evidence
  limitation, not unfinished implementation work.
- Python run202: 2168 passed plus one sandbox launcher teardown failure. The strong inference is a sandbox process-cleanup restriction; the precise error was not captured by the test; no green full-suite claim is made and no launcher/store
  test was changed to hide it. No formal new inspector grade is claimed.

Coordination retains historical infrastructure residuals separately. No further implementation work is
assigned by this card.
