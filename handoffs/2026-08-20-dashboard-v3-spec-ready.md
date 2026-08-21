# Dashboard v3 — spec READY, P1 next — handoff 2026-08-20

**Topic:** Daniel's dashboard UX/IA overhaul ("operating should be easier and cleaner"). One
brainstorm session produced FINAL product decisions, an inspiration board, a grounded umbrella spec
+ binding UX rules (codex-deep authored, codex-deep adversarially reviewed, fixed), a task list
P0–P7, and branch `claude/dashboard-v3`. Next terminal picks up at **P0 gate → P1 plan**.

## Where things are
- Branch `claude/dashboard-v3` (cut from `main` 64fb3d02): `9e391633` — spec, rules, research.
- Spec: `docs/specs/2026-08-20-dashboard-v3-design.md` (~600 lines; §10 = phases with plan/scope/
  routes/deletions/verify/adversarial/risks each). Rules: `dashboard/docs/ux-rules.md` (13 rules).
  Research: `docs/research/2026-08-20-dashboard-v3-inspiration.md`. Board (screens + palette
  mocks): https://claude.ai/code/artifact/6600adcc-7971-49e6-9cad-339a448aed02
- Task list (boss terminal): P0 spec (in progress — Daniel has NOT yet read the final spec) → P1
  Shell+IA → P2 Agents/Workflows/Schedules/Home → P3 Terminal → P4 Learnings+Inbox → P5 Inbox
  Deploy+Health → P6 Placement+/api/v1 → P7 review/merge/deploy. EVERY phase = plan (codex-deep
  writes `docs/plans/<date>-dv3-p<N>-plan.md`) → build (codex, `--worktree`) → test (codex suites +
  boss native-WSL oracle + browser) → adversarial review (codex-deep, fix loop) → Daniel's test.
  Workers never commit; boss commits on the branch; Daniel merges and deploys.

## Decisions — FINAL, do not re-ask Daniel (he closed the loop after four rounds)
Nav = Operate (Home · Inbox · Schedules · Terminal) / Build (Agents · Workflows · Tasks · Projects ·
Files) / System (Health). Two nouns Agent + Workflow; "loop" = schedule on either; System agents
grouped last, collapsed. Card = name (Title Case) · status pill · model · last/next · host; gate
count badge. Entity = slide-in over list; tabs Live (default) / Brief (the one-minute read: purpose,
doing now, last 5 one-liners, outputs, gates, schedule, tier) / Details (single CLOSED disclosure
holding all technical payload). Run view = live CLI stream (reattach semantics) + inspector (plan,
milestones, outputs, gate prompt resolved THERE). Gate counts: sidebar entry → card → Live tab;
never in Inbox. Schedules page = existing schedules + New schedule only (EST, no tz UI); store-first
(control store is live authority; `HEARTBEAT.md` = seeds imported once; a sweeper-cadence agent
mirrors store → repo via PR, bookkeeping not gate); cadences arm only once their entry is on
protected `main` (Daniel's merge = authorization). Inbox = PRs / deploys / escalations pinned to
subjects, auto-removed on resolve, sweeper fallback; no read/snooze/cap; no run gates. No Learnings
page (miners → Learnings Implementer agent → PR → Inbox; history on disk only). No Brain page
(agent capability; keep `/api/brain/*`). No Deploys page (Home version chip + Inbox Deploy item).
No Atlas page (Atlas = separate desktop app over `/api/v1`; `/api/v1` does not exist yet — P6).
Terminal = real PTY on Linux too, full viewport, Shell/Claude/Codex launchers, persistent named
sessions; runs as dedicated uid `kb-shell` rooted at `/var/lib/kb/ops`, state/releases denied;
Daniel logs the CLIs in once as that uid. Palette A Geist neutral (#000/#111/#1a1a1a/#333/#888/#fff,
#0070f3 focus only). Placement = agents run where their tools live; no "needs" field; desktop daemon
reports to VM over `/api/v1`. Engineering: change logic in place, delete replaced code same phase,
no flags, no dead exports, green on Windows + native WSL.

## Spec review outcome (codex-deep, 17 findings: 4 blockers / 10 majors / 3 minors — all applied)
Blockers were: T3 gates respondable over plain tailnet → gate-kind-aware service, T3 refused without
the ceremony; "boss merges/deploys" → Daniel does both; PTY rooted at `/var/lib/kb` → `kb-shell` uid
+ `/var/lib/kb/ops` root; seeded-armed cadences → arm only from `main`. Majors worth knowing for
P1/P2: `/api/approvals/verify` is still used by Tasks (keep the verifier), `useFleetData` still
fetches `/api/registry` (delete flyout or repoint), runs need an immutable owning `RunnableRef` +
host + `RunOutcome` persisted at launch (P2), `/api/dag` dies in P2, group order must come from a
named source (not `buildRoster`). Full list: the fix-pass brief in the boss scratchpad
`…/e08593bd…/scratchpad/dv3/spec-fix-brief.md` and the spec's §11.

## Next actions (in order)
1. **P0 gate:** hand Daniel the spec to read (he asked for "a final spec, this one should be good").
   Any change he asks for → edit spec → commit. Then mark P0 done.
2. **P1 plan:** dispatch codex-deep (`--effort xhigh`, ~45 min) to write
   `docs/plans/2026-08-2x-dv3-p1-plan.md` from spec §10 P1 + §2 fate table: exact files in/out,
   deletion inventory with import proofs, failing tests first, browser checklist. Review, commit.
3. **P1 build:** codex terra `--worktree`, brief = the plan; then test → adversarial → Daniel.
4. Repeat per phase. P3 needs Daniel to log in `claude` + `codex` on the VM as `kb-shell` (after the
   uid exists). P5 is blocked until the movement helper prerequisites are installed on the desk.

## Gotchas learned this session
- `--sandbox read-only` blocks the scratchpad too; read-only reviewers must deliver in their final
  message (`.output` / card Result), never a file.
- Daniel's redlines ≠ approval: re-present, get an explicit yes before tasks/branches/specs.
- The spec author session is codex thread `01a0216b-f3cc-7260-9132-9c276a0b97b9` (follow-up-able);
  reviewer thread `01a0218b-ff18-7bd1-ba86-1e29d3ecffd7`.

## Load list
- `docs/specs/2026-08-20-dashboard-v3-design.md` (all), `dashboard/docs/ux-rules.md`
- `docs/specs/2026-08-20-desk-vm-movement-design.md` §3–§6 (absorbed by P5/P6; §4 superseded for run gates)
- `docs/research/2026-08-20-dashboard-v3-inspiration.md`
- `dashboard/src/nav/config.ts`, `dashboard/src/App.tsx`, `dashboard/server/runtime/capabilities.ts`
- `handoffs/2026-08-20-kb-agent-platform-vm-movement-deployed.md` (what is live on the VM)
- `memory/codex-boss.md` (2026-08-20 lessons)
