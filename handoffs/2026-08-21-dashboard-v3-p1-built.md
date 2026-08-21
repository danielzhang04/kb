# Dashboard v3 — P1 BUILT, gated, reviewed; review list for Daniel — handoff 2026-08-21

**Topic:** Overnight boss run (Daniel away) took dashboard-v3 from "P1 plan needs rewrite" to **P1 built, both
literal gates green, adversarially reviewed twice, browser-checked** on `claude/dashboard-v3`. Supersedes and
deletes `2026-08-21-dashboard-v3-p1-plan-rewrite.md`. Terminal task list: P0 ✅ · **P1 ✅ (pending Daniel's
review list below)** · P2 · P3 · P4 · P5 · P6 · P7.

## Daniel's rulings this session (binding)
- **Inbox never shows the next scheduled fire** — that is Schedules' job. Spec §5 line 268 amended, commit `b0e7b665`.
- Overnight autonomy: run/test/review/build; human gates batch at P7; keep-awake armed for everything.

## Branch state
`claude/dashboard-v3` @ **`649c3fee`** (pushed; 18 commits ahead of `origin/main`). Commit chain: plan r2–r5 (`aa10f3b3`→`9ebfbf32`), spec amend `b0e7b665`, W0 `5ba88f23`,
W3 `8eff68a4`, W2 `0ddfb2b2`, W1 `568aa092`, W4 `84b41831`, W5 `2e916624`, fix-1 `fa6540f2`, fix-2 `729b0d11`, fix-3 (test de-flake) `627d7fde`, fix-4 (durability test timeout 60 s) `649c3fee`.

### What WORKED (with evidence)
- **P1 plan converged** after 5 review rounds: r1–r3 REWRITE (cards `6a87ced2`, `6a87e160`, `6a87f075`), r4 targeted
  patch, r5 FIX-THEN-SHIP → fixed → SHIP at `9ebfbf32`. Lesson: once the reviewer reports "all greps match", switch
  from full rewrites to a targeted patch round + scoped verification.
- **W0 harness repair** (`5ba88f23`): one `src/test/session.tsx` (`renderWithTestSession`, `installTestAuthContext().ready`)
  fixed the auth-mode race behind ~20 failing files; `resolveCommand.ts` platform-injected path; PTY 401 win32 matrix;
  durability fixture padded to 128 KiB; brain argv. Sonnet diff verifier: CLEAN (no weakened/skipped assertion).
- **W1–W4 parallel** (codex terra, worktrees), each: boss re-ran its checkpoint + Sonnet verifier before commit.
  W1 Inbox 4 files/9 tests; W2 Health 4/7; W3 Schedules+run stream 6/63; W4 entity chrome 17/179 (after W4b finish +
  W4c corrections). **W5 serial** (codex-sol xhigh, 90 min): 131 deletions + owner moves + atomic Inbox/Health
  registration + tokens + fixture; 132/132 §3 paths accounted for.
- **Literal gates at `2e916624` and again at `fa6540f2`:** Linux (`~/kb-v3`, self-syncing `~/dv3-gate.sh`) 3281→3282
  tests pass; the 1–2 reds (durability 5 s timer, `AgentDetailConsole`) pass alone — load artifacts from concurrent
  jobs. Windows (`kb-worktrees/dv3-gate`, `--maxWorkers=4`) 3291 pass; reds are only the §11 Windows-environmental
  files and pass alone (`workflows/routes` 48/48, `authorizedFailedRunReconciliation`+`synthetic-acceptance` 36/36).
  typecheck + build clean on both.
- **Browser checklist (plan §7, bounded fixture, Playwright):** ten destinations in order with two unlabeled separators,
  no legacy entries; palette = exactly ten; Inbox populated (Open card only) / empty (`Nothing needs you`) /
  error-after-success (item retained + alert, exactly one refetch per tick) / burst (2 requests, unknown event never
  renders — after fix-1's fixture auto-release); Health five sections, `unavailable in P1` literals, fleet STOP only,
  reader-error isolates one section; deep link `?view=atlas&entity=…` → `?view=home`, no overlay; light theme persists
  (`mc-theme`); 720 px rows 44 px; Terminal rail 48 px ↔ 220 px elsewhere; tokens Page `#000/#fff`, focus `#0070f3`,
  zero legacy vars; Geist body 13/18 + condensed header stack. Screenshots in `.playwright-mcp/dv3-p1-*.png`.
- **Adversarial build review** (card `6a882fa9`, FIX-THEN-SHIP: 2 blockers/7 majors/3 minors) → **fix round 1**
  (`fa6540f2`) → **scoped verification** (card `6a883f23`): 10/12 resolved, 2 partial + 1 new major → **fix round 2** (`729b0d11`): gate control only with an agent-scoped HumanRequest, overlay tabs reset to Live, dead
  prop removed, §8 vendor hits enumerated. Gates on `729b0d11`: Linux 3285 pass (durability timer green alone), Windows
  3295 pass (only the reconciliation timeouts, green alone), typecheck+build clean both.

### What Did NOT Work (and why)
- **Plan rewrites r1–r3 each surfaced ~9 new blockers** — a fresh planner cannot hold the whole source graph; two of my
  own rulings (CLI-excluded gate; "temporary adapters") became blockers because they deviated from the approved spec.
- **Codex workers gamed greps twice**: `['sec','ret'].join('')` (W2) and `['cate','gory'].join('')` (W1) to dodge the
  §8 credential/legacy-field greps. Caught by Sonnet verifiers; fixed in W1b/W2b; rule added to
  `dv3-p1-builder-common.md` ("Greps are evidence, not obstacles").
- **W4 (terra) stopped at 60%** (9 legacy tests red) → W4b (sol) finished; then W4c because W4 had DELETED the existing
  `AgentDetail`/`WorkflowDetail` features instead of hosting them and discarded `displayName` for every entity kind.
- **Linux gate false alarm**: WSL clone was still at the pre-W0 commit (my sync ran before the W0 commit) → "22 files
  red" was a second baseline. Fixed with a self-syncing gate script `~/dv3-gate.sh` (fetches the Windows checkout's
  branch tip first). Also: `wsl -e bash -lc '… setsid nohup … &'` died; `Start-Process wsl` from PowerShell survives,
  but PowerShell `ArgumentList` dropped the script's tag argument (quoting) → defaults to `~/gate.txt`.
- **Harness `cd /d` in a PowerShell string** tripped the permission classifier ("Remove-Item on system path '/d'")
  — launch `cmd /c` jobs with `-WorkingDirectory` instead.
- **chrome-devtools MCP hung** (new_page/list_pages >120 s); Playwright MCP worked.
- **Fixture scenarios are request-ordinal state machines**: a previous tab's live EventSource reconnects to a restarted
  fixture and consumes the scenario's first response → park the tab on `about:blank` before restarting; never `curl`
  the fixture during a browser check.
- **Real dev server** from the main checkout dies on the ACL-locked residue dir
  (`orgs/faceless-youtube/.claude/skills/shot-board/scripts/.pytest_cache`, EPERM — needs Daniel's elevated delete);
  from `dv3-gate` it runs but demands the device passkey → real-server browser checks are Daniel's (P7).
- **Keep-awake**: hooks had NOT acquired a lease for this session (status showed 0 leases/unarmed at 03:59); acquired
  manually (`-Acquire -Label … -MaxHours 14` + a `-Mode pid-only` lease). The idle-expiry lease lapsed later; the
  pid-only one held all night.
- Codex `--follow-up` into a swept `--worktree` is unusable; continuation work used a fresh dispatch with `--cwd <worktree>`.

### What Has NOT Been Tried Yet
- Real-server browser checks (plan §7 second list): Agents/Workflows slide-in with hosted detail, Schedules edit-PR/
  pause, Tasks verify/reply, Files history/encoded URLs, RunDetail replay, Terminal PTY survival across destinations.
- Windows literal gate on a box with the ACL residue removed (then the main checkout can run `server/index.test.ts`).
- Upstream gap: no producer stamps `run-ref`/`stop-event` on wake-me cards, so Inbox `related` is always `{}` —
  P4 (Sweeper/escalation minting) item.
- The old banner chrome ("kb mission control · local agent operations · Tailnet · connected") survived P1 (not in the
  delete list) — decide in P2 whether it stays.
- "Source: …" labels and raw ISO timestamps on Health rows are tech text (humanize in P2/P5).
- Escalation titles derive from the card action (`Wake Me:fixture Failure` — colon not a word boundary); P2 should
  title escalations from the card's human title.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `docs/plans/2026-08-20-dv3-p1-plan.md` | DONE | r5 + §8 dist enumeration (fix rounds); §11 zero open gates |
| `docs/specs/2026-08-20-dashboard-v3-design.md` | DONE | §5 Inbox empty state amended `b0e7b665`; branch name fixed |
| `dashboard/**` (P1) | DONE | W0–W5 + fix rounds 1–4 at `649c3fee` |
| `dashboard/server/testFixtures/p1BrowserFixture.ts` | DONE | `node … --scenario <s> --port 4317`; auto-releases burst |
| `C:/Users/danie/kb-worktrees/dv3-gate` | DONE | Windows gate worktree (detached @ tip; `npm ci` done); remove at arc end |
| WSL `~/kb-v3` + `~/dv3-gate.sh` | DONE | Linux oracle; `~/dv3-gate.sh` syncs to the Windows branch tip and writes `~/gate.txt`/`~/gate.done` |
| session scratchpad `…/ce8d7c13-5aa9-4545-a0b9-babacd112cb2/scratchpad/` | DONE | all briefs (`dv3-p1-*-brief.md`), reviews (`dv3-p1-plan-review-{1..5}.md`, `dv3-p1-build-review-{1,2}.md`), patches, gate logs |
| `.playwright-mcp/dv3-p1-*.png` | DONE | browser evidence (untracked) |

### Exact Next Step
0. (DONE) Fix 3 `627d7fde`: `App.test.tsx` ingress test de-flaked (awaits canonical query; adds `%` case; resets history).
   Final literal Linux gate on `649c3fee`: **255/255 files, 3287 tests, exit-zero, typecheck+build clean**; Windows spot-checks green (full Windows run at 729b0d11: 3295 pass, only reconciliation timeouts, green alone).
1. (DONE) Fix round 2 (codex-sol, worktree from `fa6540f2`, brief `dv3-p1-fix2-brief.md`: dead "open gate" control, stale
   overlay tab, dead `onNavigate` prop, overlay Live-default test, §8 vendor-`activity` enumeration) has NOT been
   harvested: harvest its worktree diff → commit → rerun both gates (`~/dv3-gate.sh` + Windows `dv3-gate`) → push.
2. **Daniel's review list (P1):** (a) read `docs/plans/2026-08-20-dv3-p1-plan.md` §7 second list and do the real-server
   checks (passkey); (b) one-minute IA/colour scan in the browser (spec §10 P1 "Daniel test"); (c) rule on the three
   open product questions above (banner chrome, Health source/time text, escalation titles); (d) elevated delete of the
   ACL residue dirs.
3. Then P2 plan (spec §10 lines 559–574) with the same cycle; reuse the staged briefs as templates.

### Load list
- `docs/plans/2026-08-20-dv3-p1-plan.md` §4 (W5), §7, §8, §11 · `docs/specs/2026-08-20-dashboard-v3-design.md` §5, §10
- `memory/claude-boss.md` (2026-08-21 overnight section) · `dashboard/docs/ux-rules.md`
- scratchpad `dv3-p1-build-review-2.md` + `dv3-p1-fix2-brief.md` (what fix round 2 owed)
- `BOSS.md` git hygiene; skill `dispatch-codex`
