# Dashboard UX overhaul handoff — 2026-08-05

**Topic:** Full 7-phase UX overhaul of kb Mission Control (single unlock, naming layer, Workflows
unification, inbox/home rework, Run-agent, stop relocation + polish, adversarial bloat sweep) —
BUILT ALL THE WAY THROUGH per Daniel's mandate; three human gates remain.

**Branch:** `claude/dashboard-ux-overhaul` at `e816fda`, 21 commits, based on
`claude/headless-roster` @ `ae8a80c` (the thin-slice platform tip, itself UNMERGED to main).
Worktree: `C:/Users/danie/kb-worktrees/boss-dashboard-ux`. Nothing pushed to origin yet.
**Review board (screenshots + swatches + gates):**
https://claude.ai/code/artifact/bcf61842-a475-4e74-b50e-b643ffe31f65

### What WORKED (with evidence)

- **P1 single unlock** — `src/lib/sessionContext.tsx`; six unlock surfaces deleted; one in-flight
  ceremony shared; commit f6e650d (48 files, −161). Live-verified: one Locked chip.
- **P2 naming layer** — `server/naming.ts` per-kind ordinals + `EntityName` (id only in title/copy);
  DTO enrichment at every build site; registry-clobbering defect found+fixed by worker.
- **P3 Workflows unification** — Pipeline/RunCanvas/ManagedRuns/RunCockpit/RunGrid deleted (−3,027
  net); new `RunDetail.tsx`; nav has ONE Workflows entry. Live-verified.
- **P4 inbox/home/archive** — commit 0ca131e: link-only inbox w/ plain asks (`humanRequestAsk.ts`),
  card gates moved to Tasks detail, run archival (`archived` terminal state, T3-audited, resolves
  open requests, idempotent). Live-verified: inbox row → Tasks card gate w/ full work order.
- **P5 Run agent** — commit 3ae809f: `?spawn=agent&agent=<id>` on /api/pty spawns
  `claude --append-system-prompt-file <repo>/agents/<id>.md` behind scanned-declaration allowlist
  (`declaredAgentFilePath`), refused at preValidation (400) AND handler (1008); argv arrays only;
  env allowlist unchanged; toggle=respawn. pty+agents 242/242.
- **P6 stop relocation + tokens** — commit 3365415: stop floor gone from sidebar, StopControls in
  Sentinel "Emergency stop" band; shared type/spacing/status-dot/table/empty-state tokens; two
  latent CSS bugs fixed (undefined `--text-muted`/`--danger`/`--space-5`); `--mc-accent` plumbed
  through 33 sites at neutral default. Live-verified.
- **P7 deletion wave** — commits 89fd766 (manifest) + 0472e37 (execution) + e816fda (docs sync):
  44 files deleted incl. 27-file retired Factor-C pty host cluster, Vibe/Editor/Registry/CodeView,
  launchControls cascade, `/api/vibe` unmounted (RCE-adjacent, zero callers); Control.tsx →
  stopControls.tsx; naming.json root cause fixed (test `stateRoot: REPO_ROOT` → mkdtemp) +
  .gitignore backstop. Net arc: **183 files, +9,785/−17,504 = −7,719 lines** on dashboard/.
- **Verification at final HEAD** — full suite 2,351 passed / 0 new failures (only red =
  pre-existing `write/workflowRun.test.ts:265` + known load-flaky timeouts, each green isolated);
  tsc byte-identical 7-error baseline (paidAction*/pngjs); vite build clean; six-surface Playwright
  walkthrough on the 4620 daemon (screenshots on the review board).
- **Process** — every phase built by a transcript-verified lower-model subagent (opus for build
  legs + adversarial verify, sonnet for scout/docs); boss graded, re-ran verification, committed
  explicit paths.

### What Did NOT Work (and why)

- **P4 round 1 archive tests** — mock returned the archive body for EVERY fetch, so the
  post-archive `loadRun` refetch crashed RunDetail:883 (`detail.humanRequests` undefined): 2
  uncaught exceptions despite green tests. Sent back; fixed route-aware. Lesson: an exit-0 vitest
  run can still carry "Errors n" — grade on the Errors line, not the pass count.
- **`npx vitest run src` piped through PowerShell Select-String** intermittently mangles exit codes
  (a 255 that was actually 0); capture `$LASTEXITCODE` from an unpiped run.
- **Docs leg (sonnet) died mid-stream on an API stall** — resumed via SendMessage; it re-read disk
  state before continuing, no duplication. Resume-with-context works.
- **git commit -m with embedded double quotes via PowerShell** mangles argv → use `git commit -F
  <message-file>` always.

### What Has NOT Been Tried Yet

- The 8 stale waiting-on-human validation runs are NOT yet archived — the archive action needs
  Daniel's passkey (operator one-click w/ reason from RunDetail).
- Accent: nothing landed; A/B/C candidates in `docs/superpowers/plans/2026-08-05-accent-swatches.md`
  (in the worktree branch).
- `ATTEMPT_EDGES['waiting-human']` wedge: parked attempts are left `interrupted` because the
  waiting-human attempt edge would wedge — latent store bug, own fix owed (found in P4 unit A).
- `timeline/stream.ts` (90+68 LOC): KEPT as ambiguous (D0.7 live-tail feed awaiting hub wiring,
  zero callers). Daniel ruling owed: wire it or cut it.
- Composer `agentId` wire param: client-unused but server-validated+tested; kept. Revisit if the
  Composer surface is next touched.
- Empty `dashboard/server/control/__fixtures__/` dir left (git doesn't track it).

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| `kb-worktrees/boss-dashboard-ux` (whole worktree) | DONE | 21 commits on `claude/dashboard-ux-overhaul`, clean tree, unpushed |
| `docs/superpowers/specs/2026-08-04-dashboard-ux-overhaul-design.md` | DONE | binding spec v3 (in branch) |
| `docs/superpowers/plans/2026-08-04-dashboard-ux-overhaul.md` | DONE | 7-phase plan, all executed |
| `docs/superpowers/plans/2026-08-05-deletion-manifest.md` | DONE | adversarially-verified cut plan (evidence record) |
| `docs/superpowers/plans/2026-08-05-accent-swatches.md` | DONE | Daniel's gate 2 |
| 4620 acceptance daemon | RUNNING | boss bg task, launcher `<session-scratchpad>/start-ux-daemon.mjs`, isolated state root `kb-dashboard-phase4`, executor NOT pre-activated |

### Exact Next Step

Present Daniel the review board (link above) and walk gates in order:
1. **Passkey smoke test** on http://localhost:4620 — one ceremony must unlock all governed
   surfaces at once; then archive the 8 stale waiting-on-human runs from RunDetail.
2. **Accent pick** — A slate / B lilac / C parchment / none (one line per theme block to land).
3. **Merge decision** — `claude/headless-roster` must merge first (or together, ux branch stacks
   on it); after merge: delete both branches + worktrees per hygiene, restart prod daemon on new
   code, re-point pm2 if dist path assumptions changed.

### Load list

- `handoffs/2026-08-05-dashboard-ux-overhaul.md` (this file)
- worktree `C:/Users/danie/kb-worktrees/boss-dashboard-ux`: `docs/superpowers/specs/2026-08-04-dashboard-ux-overhaul-design.md`, then `docs/superpowers/plans/2026-08-04-dashboard-ux-overhaul.md`
- `docs/superpowers/plans/2026-08-05-deletion-manifest.md` + `2026-08-05-accent-swatches.md` (same worktree)
- `memory/claude-boss.md` (2026-08-05 lessons section)
- `git log --oneline ae8a80c..e816fda` in the worktree for the commit-by-commit record
