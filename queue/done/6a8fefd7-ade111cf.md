---
schema-version: 1
id: 6a8fefd7-ade111cf
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\AppData\Local\kb-codex-dispatch\worktrees\6a8fe559-8e51402d
risk-tier: T1
owner: codex-worker
claim-token: 3871979eb38dc50c
state: done
approval: null
workflow: 01a04218-1f05-7251-b2ba-07abefc9142f
depends-on: []
variant-group: null
role: work
session-id: 6a8fe559-8e51402d
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 50fee25619a9400d43459169fd90661a69e0f12e
---

## Work order

\# Codex build brief — U9: merge Tasks + Inbox into ONE sectioned "needs you" destination

Repo: kb. Base `claude/dashboard-v3` (tip bbb475b7). `--worktree`; do NOT commit. NO node_modules — don't run tsc/vitest/build/install; self-review + `git diff --check`; the orchestrator verifies. This is the biggest unit of the round — touches client views + nav + a small server addition. Preserve ALL existing behavior/actions; this is re-housing + redesign + age labels, not a logic rewrite.

Daniel's decision: Tasks and Inbox as two destinations feels unnecessary. Merge into ONE destination — everything that needs him, in sections — with the card actions inline, age labels, and a real redesign. Remove Tasks from the nav.

\## Current state (from recon — verify)
- `src/views/Inbox.tsx` (flat list; 5 item kinds from `GET /api/inbox`: `pr`, `escalation`, `deployment`, `deployment-escalation`, `asset-pull`; each `InboxItem` carries a validated `createdAt` ISO — `src/lib/inboxClient.ts:19-82` — that the UI currently DROPS). Styles `src/styles/views/inbox.css`.
- `src/views/Tasks.tsx` (two-pane: left card queue grouped by state from `GET /api/index` → `PlaneAIndex.cards`; right `DetailPane` with `CardGate` reply/resolve/verify, `CardRoutingBar` routing, markdown body, an "Advanced details" `<details>` for frontmatter). Styles `src/styles/views/tasks.css`.
- Overlap: Inbox's `escalation` source is projected from the SAME Plane-A card index Tasks reads (`server/inbox/routes.ts:106-111` `projectEscalationSubjects(indexRepo(...))`), and Inbox's escalation row already deep-links INTO Tasks (`Inbox.tsx:205-209`). So the "card that needs you" is shown twice today (a stub in Inbox, the full card in Tasks).
- Nav: `src/App.tsx` `NAV_SECTIONS` lists both Inbox and Tasks; `ViewBody` (`App.tsx:193-204`) routes `inbox`→`<Inbox>` and `tasks`→`<Tasks>`.

\## Target — one unified destination
Keep the nav item **"Inbox"** (its icon + pending badge); **remove "Tasks"** from `NAV_SECTIONS`. The Inbox view becomes the single "needs you" surface with SECTIONS, in this priority order:
1. **Approvals / cards** — the Plane-A cards that need a human (what Tasks showed). Render the card rows here, and clicking one opens its detail WITH the full governed actions moved over from Tasks: `CardGate` (reply/resolve/verify-evidence), `CardRoutingBar` routing, the markdown body, and the frontmatter (shown per U10's "no double-disclosure" rule — directly, or behind ONE clearly-labeled toggle, not a bare collapsed `<details>`). Preserve the U5 click-out behavior (Back / Escape / outside-click / same-row toggle).
2. **Deploys** — `deployment` + `deployment-escalation` items, with their existing governed mutating controls (deploy/confirm/abort/acknowledge/close-ptys) intact.
3. **Pull requests** — `pr` items (Open PR link).
4. **Asset pulls** — `asset-pull` items.

- **Dedupe:** the `escalation` items from `/api/inbox` describe the SAME cards as section 1. Show the card (richer, actionable) ONCE — drop the escalation stub when its subject is already a card row. (Match on the card id / subject.)
- **Data:** the view needs BOTH `/api/index` (cards) and `/api/inbox` (the 4 external/deploy sources). Fetch both client-side and compose the sections; keep both endpoints and their existing decoders. Refresh on the SSE `/events` bump like Inbox does today, and on mount.
- **Age labels:** every row shows recency — "arrived 3d ago" / "3d". Inbox items: derive from `item.createdAt` (already present). Cards: see the server change below.
- **Redesign:** this is the "terrible design" fix. Clean sectioned list with a consistent row vocabulary (lead line = what it is + what it needs, muted secondary = age + source/owner), section headers with counts, the action-needed ones first. Use the `--space-*`/type tokens (consistent with U2). No cramped text, no raw slugs.

\## Server — card age (small, required for section-1 age labels)
Plane-A cards have NO timestamp in frontmatter (`server/planeA/cards.ts` `CardMeta`; `governance/card-schema.md`). Add the card FILE's mtime into the projection: in the indexer / `CardProjection` builder (`server/planeA/cards.ts` + `server/planeA/indexer.ts`), stat the card file and include `updatedAt` (and/or `createdAt`) ISO on `CardProjection`, threaded through `GET /api/index`. Do NOT invent a frontmatter field. Keep it optional/back-compatible; validate it like other times.

\## Nav / routing / tests
- Remove Tasks from `NAV_SECTIONS`; drop the `tasks` case from `ViewBody` (or make `?view=tasks` and the old escalation deep-link resolve to the Inbox card section — pick one and keep deep links alive, don't 404 them).
- The IA is now NINE destinations, not ten. UPDATE the nav test (`src/App.test.tsx` "renders the exact ten destinations…") and any destination-count assertion to nine, deliberately (Daniel approved removing Tasks). Do NOT weaken — assert the exact nine.
- Update/rework `Inbox.test`, and remove or repurpose `Tasks.test` / the Tasks entries in `rowVocabulary.test.ts` (the tasks row moves into Inbox — carry its vocabulary/coverage over rather than deleting it). Any test asserting Tasks-as-a-destination must move to the new contract.
- Keep `Tasks.tsx`'s reusable pieces (`CardGate`, `CardRoutingBar`, the card projection client) — import them into the Inbox surface rather than duplicating. If `Tasks.tsx` becomes empty, delete it and its route wiring.

\## Norms
- Strip-only TS floor: NO enum/namespace/constructor param-properties; no raw NUL. `git diff --check` clean.
- PRESERVE every action's behavior and endpoint (reply/resolve/verify/routing/gate + deploy mutations + PR links). No wire/endpoint/param change beyond the additive card `updatedAt`. Do NOT touch the entity brief / EntityDetail / Agents launch (other units own those); avoid `app.css` beyond what the Inbox surface needs (prefer `inbox.css`).

\## Deliverable
Files+lines changed; the section composition + dedupe rule; how card actions were re-housed (imported, not duplicated); the card `updatedAt` server addition; the nav removal + deep-link handling; every test updated (nav nine-count, Inbox, Tasks/rowVocabulary migration) + why; `git diff --check` clean. Flag anything you had to stub. The orchestrator verifies tsc/full-suite/build + screenshots and will run an opus adversarial review on this unit.

## Result

Implemented U9 with no commit and no stubs.

\### Outcome

- Inbox now fetches `/api/index` and `/api/inbox`, refreshing both on mount and SSE invalidation.
- Fixed section order: Approvals/cards → Deploys → Pull requests → Asset pulls.
- Escalations are removed only when a richer human-actionable card with the same card ID is rendered.
- Card rows show file-mtime recency; external rows use `createdAt`.
- Card detail retains reply/resolve/verify, routing, inert markdown, full metadata, and Back/Escape/outside-click/same-row closing.
- Ordinary card deep links remain reachable without adding those cards to the “needs you” count.
- Tasks was removed from navigation and command palette. Legacy `?view=tasks` links canonicalize to Inbox.
- The exact destination count is now nine.

\### Main files and lines

- Unified composition and actions: [Inbox.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/views/Inbox.tsx:137), [Tasks.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/views/Tasks.tsx:145)
- Redesign: [inbox.css](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/styles/views/inbox.css:51), [tasks.css](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/styles/views/tasks.css:19), [routing.css](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/styles/views/routing.css:121)
- Index decoder and age formatting: [cardIndexClient.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/lib/cardIndexClient.ts:23), [relativeAge.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/lib/relativeAge.ts:6)
- Card mtime projection: [cards.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/server/planeA/cards.ts:45), [indexer.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/server/planeA/indexer.ts:39)
- Navigation/deep links: [App.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/App.tsx:182), [config.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/nav/config.ts:34), [stack.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/nav/stack.ts:52), [entityLinks.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/control/entityLinks.ts:38)
- Re-housed action terminology: [cardProjection.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/server/tasks/cardProjection.ts:1), [cardVerifier.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/server/approvals/cardVerifier.ts:1), [routingClient.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/lib/routingClient.ts:124), [routingControls.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/views/routingControls.tsx:1)

\### Test migration

- Section composition, dedupe, ages, SSE, partial failures, existing deploy/asset/PR actions, and ordinary-card deep links: [Inbox.test.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/views/Inbox.test.tsx:92)
- Human-only rows, action ordering, metadata disclosure, U5 close behavior, governed gate actions, and ordinary-card routing locks: [Tasks.test.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/views/Tasks.test.tsx:48)
- Server/client timestamp validation: [indexer.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/server/planeA/indexer.test.ts:70), [routes.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/server/planeA/routes.test.ts:22), [cardIndexClient.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/lib/cardIndexClient.test.ts:15), [relativeAge.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/lib/relativeAge.test.ts:4)
- Exact-nine IA and legacy routing: [App.test.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/App.test.tsx:102), [config.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/nav/config.test.ts:8), [stack.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/nav/stack.test.ts:29), [entityLinks.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/control/entityLinks.test.ts:84)
- Palette, row vocabulary, and browser-fixture inventory: [paletteModel.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/palette/paletteModel.test.ts:4), [CommandPalette.test.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/palette/CommandPalette.test.tsx:55), [rowVocabulary.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/src/styles/rowVocabulary.test.ts:22), [p5ActualBrowserRunner.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/server/testFixtures/p5ActualBrowserRunner.ts:149), [p5ActualBrowserRunner.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe559-8e51402d/dashboard/server/testFixtures/p5ActualBrowserRunner.test.ts:96)

Verification: `git diff --check` exits 0; trailing-whitespace, raw-NUL, and strip-only syntax scans are clean. TSC, Vitest, build, and install were deliberately not run per the brief.
