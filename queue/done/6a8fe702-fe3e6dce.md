---
schema-version: 1
id: 6a8fe702-fe3e6dce
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\AppData\Local\kb-codex-dispatch\worktrees\6a8fe55d-35c3fd41
risk-tier: T1
owner: codex-worker
claim-token: e0f770195dea3b13
state: done
approval: null
workflow: 01a04218-2ce6-7790-8ed6-3607672bb14f
depends-on: []
variant-group: null
role: work
session-id: 6a8fe55d-35c3fd41
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: bbb475b7a5a82f55a37fd2db83c738bb05976349
---

## Work order

\# Codex build brief — U10: vertical spacing + agent-brief redesign + Details-tab shows directly

Repo: kb. Base `claude/dashboard-v3` (tip bbb475b7). `--worktree`; do NOT commit. Client `dashboard/src/` only. NO node_modules in the worktree — do NOT run tsc/vitest/build or install; self-review + `git diff --check`; the orchestrator verifies. Presentation only.

Three tight fixes (Daniel round-3). Line numbers are from recon; locate by content if shifted.

\## 1. Vertical spacing (two zero-CSS offenders)
- `.entity-detail__close` (`src/styles/views/entity.css:451`) has NO gap below it, so the drawer Close button hugs the header. Add `margin-bottom: var(--space-4)` (match `.v-tasks__back` in `tasks.css:204`). This is the shared agent+workflow drawer (`src/entity/EntityDetail.tsx:290-298`).
- `.page-header` + `.page-eyebrow` (used at `src/views/Agents.tsx:122` `<header class="page-header"><div><p class="page-eyebrow">Fleet</p><h2>Agents</h2></div></header>`, same at `Workflows.tsx:116`) have **ZERO CSS anywhere** → they render with browser-default `<p>`/`<h2>` margins (inconsistent, sometimes too tight/loose). Add real rules (in `app.css` near the other view chrome, or a shared views css): `.page-header { margin: 0 0 var(--space-4); }`, `.page-eyebrow { margin: 0 0 var(--space-1); color: var(--fg-dim); font: var(--type-meta); text-transform: uppercase; letter-spacing: .04em; }`, and `.page-header h2 { margin: 0; }` — mirror the `entity-detail__eyebrow`/`__title` token pattern (`entity.css:72-79`). Result: consistent breathing room above/below the eyebrow+title on every view that uses `.page-header`.

\## 2. Agent brief redesign (the "stacked stuff, hard to read")
The brief renders in `src/views/AgentDetail.tsx:12-24` (`surface==='brief'`) AND identically in `src/views/WorkflowDetail.tsx:28-43` — a copy-pasted `<div class="entity-brief">` with four bare `<p>` (purpose / doingNow / `autonomyTier`+pending-gates / schedule), then `<h3>Recent runs</h3><ul>…</ul>`, `<h3>Recent outputs</h3><ul>…</ul>`. `.entity-brief` has **ZERO CSS** → four equal-weight unstyled paragraphs.
- **Extract a shared `EntityBrief` component** into `src/entity/EntityBrief.tsx` (it does not exist) taking the same `detail.brief` shape, and call it from BOTH AgentDetail and WorkflowDetail (they are byte-structurally identical). Keep every field/datum — presentation only.
- Redesign the layout for readability: give **purpose** prominence (lead paragraph, normal prose); render the other facts (doing-now, autonomy tier + pending gates, schedule) as **labeled fact rows** (a small definition-list / key–value treatment with muted labels — reuse the `entity-kv`/`entity-fact` tokens at `entity.css:166-203` if they fit, else add tight `.entity-brief` rules), not four look-alike paragraphs. Style "Recent runs"/"Recent outputs" as clean lists (no raw disc bullets / 40px indent) with the run's timestamp muted. Group with the `--space-*` scale; clear hierarchy.

\## 3. Details tab shows directly (double-click bug)
`src/entity/EntityDetail.tsx:122-124`: the synthesized `id:'details'` section wraps `detailsContent` in a native `<details><summary>Details</summary>{detailsContent ?? '…'}</details>` — collapsed by default. So clicking the **Details tab** shows a *second* collapsed disclosure needing another click.
- Render `detailsContent` DIRECTLY (a plain `<div>`/fragment, keep the `data-testid` if a test reads it) — no nested `<details>`. One change fixes agents + workflows (both fall through to this synthesized section). The tab itself is the disclosure; its content must be immediately visible.

\## Norms
- Strip-only TS floor: NO enum/namespace/constructor param-properties; no raw NUL. `git diff --check` clean.
- If a test asserts the old `.entity-brief` bare-`<p>` structure or the nested `entity-detail-disclosure` `<details>`, UPDATE it to the new contract (content shown directly) and say so — do NOT weaken coverage. Do NOT touch `dashboard/server/`, the U2 font tokens, or Inbox/Tasks (another unit owns those).

\## Deliverable
Files+lines changed; the `.page-header`/`.page-eyebrow`/`.entity-detail__close` rules added; whether you extracted `EntityBrief` + how you restructured it; the EntityDetail Details-tab change; any test updated + why; `git diff --check` clean. Orchestrator verifies tsc/tests/build + screenshots.

## Result

Implemented all three U10 fixes without committing.

- Added shared page heading styles in [app.css](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe55d-35c3fd41/dashboard/src/styles/app.css:769) and Close-button spacing in [entity.css](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe55d-35c3fd41/dashboard/src/styles/views/entity.css:482).
- Extracted [EntityBrief.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe55d-35c3fd41/dashboard/src/entity/EntityBrief.tsx:10), with prominent purpose text, labeled facts, clean lists, and muted run timestamps. Both [AgentDetail.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe55d-35c3fd41/dashboard/src/views/AgentDetail.tsx:14) and [WorkflowDetail.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe55d-35c3fd41/dashboard/src/views/WorkflowDetail.tsx:31) now use it.
- The synthesized Details tab now renders content directly in [EntityDetail.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe55d-35c3fd41/dashboard/src/entity/EntityDetail.tsx:123).
- Updated [EntityDetail.test.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe55d-35c3fd41/dashboard/src/entity/EntityDetail.test.tsx:51) for direct Details rendering and [AgentDetail.test.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fe55d-35c3fd41/dashboard/src/views/AgentDetail.test.tsx:27) for the new labeled brief/timestamp contract.

`git diff --check`, whitespace, raw-NUL, and strip-only syntax checks are clean. Per the brief, I did not run Node tests, typecheck, or build.
