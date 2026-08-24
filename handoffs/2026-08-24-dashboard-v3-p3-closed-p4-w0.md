# Dashboard v3 — P3 CLOSED, P4 W0 next — handoff 2026-08-24

**Topic:** P3 (real PTY: Windows host + Linux broker + registry/persistence + Terminal/Run route
cutover + closure hardening) built end-to-end on `claude/dashboard-v3`, review-fixed twice (W6.7 whole-
phase, W6.8 honest-browser), and gated clean. Supersedes `2026-08-23-dashboard-v3-p2-closed-p3-w0.md`.
Terminal task list: P0 ✅ · P1 ✅ · P2 ✅ · **P3 ✅** · P4 plan ✅/build next · P5 plan ✅ · P6 plan ✅ · P7.

## Branch state
`claude/dashboard-v3` @ **`43b93ba8`** (final: `8dbfed71` W6.8 + `5d19fa9e` conflict-marker fix in
p3ActualBrowserRunner.test.ts + `43b93ba8` compat-wall allowlist for the P3 fixture's state-root
assignment). Commit chain from P2 close `9a72bbf8`:
`cc27de2e` W0 contracts (server/pty/contracts.ts, shared/ptyProtocol.ts, 24 compile-negatives) →
`542c4047` W0b amendments (principal on SessionHostRequest, AttemptOperationRecord+CAS) → fan-out
`e6373982` W4 (Terminal view models + strict browser decoder), `35f26d26` W1 (Windows node-pty host,
16/8 reservations), `d1f85a9b` W3 (composite-principal registry/persistence, browser-session-ref
cookie), `6e2093c6` W5 (two-phase Run attempt adapter, write-ahead operations), `ddeaaa57` W2 (Linux
broker over WSL oracle, fd-3 Unix listener) → `f67464c8` W1d (Windows host fails closed off win32) →
`631442d5` W6.1 (public capability cutover, pty:false literal) → `89f7d2a0` W6.2 (broker build/package/
systemd units/bootstrap installer) → `027dce12` W6.3 (persistence+auth integration, no route cutover
yet) → `a9abea82` W6.4 (Terminal/PTY route + client cutover, v1 host/routes deleted) → `d29e85f7` W6.5
(real Run attempt/control cutover, byRun, scoped replay) → `b8323de0` W6.6 (closure: attack manifest,
assertP3GateResults, deletion closure, param-property conversion) → `bc208682` W6.7 (whole-phase review:
per-principal cap to registry, 90112 raw ceiling, runtime-policy reconcile) → `8dbfed71` W6.8 (honest
SPKI-pinned browser evidence + Terminal listing-row UI fixes). Plans: P4 SHIP `2c043ee0` · P5 SHIP
`b380b6fa` (r6) · P6 SHIP `a2e37af6` (r6). Full narrative: scratchpad `dv3-p3-carried-deltas.md`.

## Gate evidence (final tip `43b93ba8`; code identical to `5d19fa9e` — the last commit is tests/*.py only)
- Windows full gate @5d19fa9e: typecheck 0 · build 0 · **focused gate + asserter CLEAN: 1464 tests /
  67 files / 0 failed / 0 skipped-pending-todo / 25 attacks owned** · full vitest 3560 pass, 17 timeout
  reds under full parallel load — 12/13 files green rerun alone, the 13th (CommandPalette) green alone
  AND paired (transient worker interference; portal mount verified untouched since P1) · full pytest
  **1561 passed, 14 skipped, 5 deselected** after the compat-wall allowlist (`43b93ba8`).
- WSL full gate (w67 @8dbfed71): **3538 pass / 17 known platform skips**; only reds = the committed
  conflict-marker file (fixed `5d19fa9e`, then 45/45 + typecheck clean on WSL at that sha) and the
  capabilitiesSource scanner load flake (9/9 in 1.0 s alone); typecheck + build clean, EXIT 0.
- M4 two-platform per-suite count-exact comparison (plan §12 item 12): scratchpad
  `dv3-p3-m4-count-table.md` — 67 suites compared, **3 diffs, all explained** (the load-flake file, the
  two declared Windows-only `skipIf` gates, the conflict file at the older Linux sha).
- Prior checkpoint on `b8323de0` (WSL w66): 3537 pass / 1 red = capabilitiesSource scanner 5 s timeout
  under 302-file load (load flake, 9/9 clean alone), 17 pre-existing platform skips, typecheck+build clean.

### Browser evidence — HONEST, 32/32
W6.6f found the first matrix pass vacuous (all 32 cells were Chrome's cert-authority interstitial, never
the app). W6.6f/g/h rebuilt the runner: SPKI-pinned trust (never blanket `--ignore-certificate-errors`),
refuses a cell without the `div#root > div.app-shell` marker or containing interstitial text, per-scenario
nav map with one real recorded click for the Run view (no `run:` URL entity exists), 43-char
browser-session-ref fixture refs. Result: **32/32 cells reach the app, 4/4 distinct scenario signatures,
0 console errors.** Artifacts: scratchpad `p3-browser-artifacts-v2/` — **outside git, session-scratchpad
lifetime; look before it's cleaned.**

### What WORKED
- Read-budget + detached-dispatch fix from the P2 handoff held for all of P3 — no repeat of the 6a89aa42
  stall; per-vertical opus build → opus/sol review FIX-THEN-SHIP → Sonnet verify → WSL gate pipeline ran
  clean through W0–W6.8 (ledger lines 27–43).
- Staggering Windows/WSL gates (P2 lesson) avoided load-timeout false reds this phase; remaining flakes
  are all reproducibly green alone (see load-flake ledger below).
- The honest-evidence catch itself: a scoped Sonnet verifier caught a vacuous 32/32 "pass" that hid a cert
  interstitial on every cell — recorded as this phase's sharpest lesson (ledger line 39).

### What did NOT work (and why)
- First browser matrix (post-W6.6) was silently vacuous: CDP runner never trusted the pinned fixture
  cert, so all 32 "PASS" cells were the browser's own error page (8 recycled screenshot hashes). Fixed by
  W6.6f (SPKI pin + app-marker + distinctness guards).
- W6.6g found the fixture's browser-session-ref was a 36-char placeholder against the 43-char base64url
  contract — cookie silently dropped, listings rendered empty. Guard test added.
- Terminal workspace never rendered existing-session rows from the REST listing (W6.6h fix); unavailable
  panel dropped its bounded diagnostic reason (W6.8 fix).
- Twice, the export-and-commit chain forgot to `cd` back to the main checkout before commit — worktree
  pre-commit hooks blocked on `kit/.rendered` (ledger line 42, now a standing lesson).

## Open items
- **M4 count table**: DONE — `dv3-p3-m4-count-table.md` (scratchpad); count-exact parity except the
  three explained rows above. Copy it somewhere durable before scratchpad cleanup if wanted.
- **Pre-existing platform skipIfs** enumerated in plan §12 deviation 4 (`docs/plans/2026-08-22-dv3-p3-
  plan.md:671`): `server/write/cardRespondRoute.test.ts` (2 Windows-only `schtasks` cases),
  `server/control/canonicalResultIntegrator.test.ts` (1 case needing OS symlink privilege). P3 added
  neither; `p3AttackManifest.test.ts` enforces count-exact so a third omission fails.
- **Load-flake ledger** (re-run isolated before trusting a red): `activation.boot` (5 s timeout, 5/5
  alone), `index.test.ts` readiness under full load, `execution.test.ts` vs store/launch sharing
  `tmpdir()/kb-auto-worktrees` (needs per-suite tmp-root isolation), `capabilitiesSource` scanner 5 s
  timeout under 302-file load (811 ms / 9-9 alone).
- Deletion tally: 25 inventoried paths, 19 actually removed (15 planned + 4 beyond-plan
  `persistentSessions`/`transcripts`), 6 absent at P3 base — proved by `p3DeletionClosure.test.ts`
  (plan §12 final tally, lines 675–677).

## Carried to P7 — Daniel's hands-on batch
1. **Passkey registration on the VM RP** (real-server checks, carried unchanged from P2).
2. **WSL sudo / native oracle password**: `tests/test_pty_linux_oracle.py` needs `sudo env -i` with a
   password; root-only selectors (uid switch, 02770 policy, mount namespaces) can't run unattended.
   Needs a sudoers NOPASSWD rule scoped to the exact command, or Daniel runs it once and pastes the
   summary (plan §12 PRQ-5).
3. **Elevated deletes of the ACL-locked codex worktrees** — see ledger `dv3-p3-carried-deltas.md` and
   memory `dashboard-v3-arc.md:116-117` for the running list (`6a89ef0c-8edb1e46`, `6a89f6aa-6ea0cd5f`
   plus the P2 five); consolidate to one pass rather than deleting piecemeal.
4. **Machine-ACL security finding (W6.6c)**: `MSI\CodexSandboxUsers` + orphan sandbox SIDs hold
   `(OI)(CI)(M)` on `%USERPROFILE%` incl. `~/.local/bin/claude.exe`, `%APPDATA%\npm`, repo root, and temp
   — a sandboxed codex worker can rewrite the Claude binary. Strip the ACEs machine-wide. Until then,
   real-PTY capability on this host is honestly shell-only (the probe now refuses what it can't pin).
5. **`/run/kb-shell` gid+mode check on the VM** (PRQ-3): `stat -c '%U:%G:%a' /run/kb-shell` must read
   `kb-shell:kb-dashboard:750`; confirm the socket unit's RuntimeDirectory inherits that unit's User/Group.
6. **`kb-shell` one-time provider sign-ins** (PRQ-2): Claude and Codex CLI sign-in performed directly as
   `kb-shell`, against the now-writable `/var/lib/kb-shell/home/.claude` and `.codex` (plan §12 item 17,
   carved into ReadWritePaths — a missing target makes systemd refuse to start the unit).
7. **Cross-host determinism**: build the broker twice in two directories, diff the tarball (WSL/VM gate
   item from the W6.2 ruling set, ledger line 10 item 4).
8. **CI workflow broker build step**: `.github/workflows/kb-platform-release.yml` must run
   `cd dashboard && npm ci && npm run build:pty-broker` before `scripts/build_platform_release.py` — the
   packer now refuses to pack a release without the broker archive (ledger line 13).
9. **VM real-tailnet passes** for the P6 node-proxy shim, once P6 is built (EV rows depend on it).

Also still open from P2, unchanged: IA/colour scan, banner-chrome/Health-`Source:`/escalation-title
rulings, full-document-reload collapse persistence (bfcache caveat), upstream `run-ref`/`stop-event` on
wake-me cards (owned by P4).

## Exact next step — P4 W0
1. Dispatch `scratchpad/dv3-p4-w0-brief.md` (READ BUDGET block, detached + Monitor + pid-only lease, per
   the P2 fix). Then Sonnet SHAPE audit vs P4 plan `2c043ee0` §3 → fix round → gate checkpoint → commit.
2. Build order per ledger line 24: P4 waves → P5 build → P6 build → P7 presented (hands-on batch above).
3. P4 plan carries its own W2 wall-cell staging rule and learning-record-retire ownership (W6.2) — read
   before dispatch.

## Load list
- `docs/plans/2026-08-22-dv3-p3-plan.md` §12 (closure/deviations/tally) · `docs/plans/2026-08-23-dv3-p4-
  plan.md` (SHIP `2c043ee0`) · `docs/plans/2026-08-23-dv3-p5-plan.md` (SHIP `b380b6fa`) ·
  `docs/plans/2026-08-23-dv3-p6-plan.md` (SHIP `a2e37af6`)
- scratchpad `dv3-p3-carried-deltas.md` (full P3 event log, authoritative) · `p3-browser-artifacts-v2/`
  (before cleanup) · `dv3-p4-w0-brief.md` (staged dispatch)
- `memory/claude-boss.md` (P3 blocks) · auto-memory `dashboard-v3-arc.md` · `BOSS.md` git hygiene ·
  skill `dispatch-codex`
