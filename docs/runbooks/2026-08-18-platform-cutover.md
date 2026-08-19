# Platform cutover — desktop → VM (2026-08-18)

**Replaces** `docs/runbooks/2026-08-06-wave3-cutover.md` in full. That runbook targets the legacy
Wave-1 pilot stack (user unit on `:5317`, `~/kb-dashboard-ops`, `~/kb-mirror.git`), which is being
decommissioned rather than cut over to. Its §1 drain shape and §2 push-sweep intent survive here in
corrected form; its §3–§5 are deleted.

**End state, decisions and rationale:** `docs/specs/2026-08-18-cutover-end-state.md`. Read it first.
This file is the procedure only.

**Operators:** Daniel and the boss session, together at the keyboard, one scheduled quiescent
window. Sections run in order: **preconditions → drain → push sweep → state migration → release
deploy → acceptance → (rollback if needed)**.

Marks: `[HUMAN — Daniel]`, `[HUMAN — boss]`, `[AGENT]`. Facts that could not be established without
running the cutover are marked `UNVERIFIED:` inline. Never print a secret value; env **names** only.

---

## 0. Preconditions and session variables

**[HUMAN — boss]** Do not open the window until all of these are true:

- [ ] Steps 1–4 of `handoffs/2026-08-18-boss-plan-remaining.md` are complete (PR #129 merged,
      workflow-platform merged, closure sweep done).
- [ ] The Linux port has been **re-derived onto `main`** — *not* merged — and a green release build
      exists for the resulting commit. `claude/cloud-migration` is 18 ahead / 90 behind `main` and
      predates `dashboard/server/runtime/` entirely; `git merge-tree` reports **30 conflicts**,
      including an **add/add on `deploy/systemd/kb-dashboard.service` whose branch side is the
      LEGACY user unit** — resolving that one wrong replaces the certified platform system unit with
      the decommissioned Wave-1 one. So: **cherry-pick only the Linux port commits — `506af813`,
      `fb9f501f`, `0ccd0531`, `4fa62cc3`, `d18711f1`, `87bb6a98`, `9ee705a6` — onto `main`, rebased
      onto `main`'s `runtime/` doctrine** (`resolvePython`, `platform/noReparseFiles.*`), and
      **explicitly DROP** the PTY-deletion, keep-awake-deletion, pm2-deletion and legacy-unit
      commits. This is a **multi-day build task with its own Linux vitest run**, sequenced entirely
      before the window opens (end-state D-8).
- [ ] **The tailnet-auth wave has shipped** (end-state **D-2**, §4): the daemon supports
      `DASHBOARD_AUTH_MODE=tailnet`, where a request through the `tailscale serve` proxy is the
      operator, proxy identity headers are audited, and **execution plus the queue bridge are armed
      at boot**. WebAuthn/session/unlock remain only as the win32-desktop mode. The window does not
      open on the unlock-latch build: this runbook's acceptance has no passkey step and no re-arm
      step, and running it against the old build would leave the platform locked with nothing to
      unlock it.
- [ ] **`promote_vm_outbox.py` carries the three co-writer changes** (end-state **D-9**, ruled
      Model B): rebase onto current `origin/ops`, empty-spool exit-0 no-op, and a pull-only downward
      sync mode. §4.6 and §5.2 assume all three. Without them the desktop's own `ops` pushes strand
      the spool, which is precisely how the Gate-1 bundle got stranded.
- [ ] Daniel has answered the remaining end-state decisions **D-1 (drain cadence)**,
      **D-3 (atlas)**, **D-4 (`naming.json`)**, **D-5 (composer)**.
- [ ] The **stranded Gate-1 outbox bundle** `a0e6777b…` has been reconciled pre-window per end-state
      §3.2 (hand-promote the `ledgers/audit/dashboard-audit.ndjson` delta + reset
      `/var/lib/kb/ops` to `origin/ops` + `git update-ref refs/kb-outbox/spooled`, **or** a frozen
      desktop-`ops` promotion). The shipped promoter hard-fails on that bundle — `origin/ops` is 108
      commits past its parent — and even the rebase-capable version should not meet a 108-commit
      divergence for the first time inside the window.
- [ ] Quiescent = kb-only: no other kb terminals mid-work, no codex dispatches in flight,
      daemon/cadences idle. Non-kb desktop activity is irrelevant. An uncommitted bricks tree may
      sit; it just cannot run.

**[AGENT]** Set the session variables once, in the watched PowerShell session.

```powershell
$LocalRepo       = 'C:\Users\danie\kb'
$OpsWorktree     = 'C:\Users\danie\kb-worktrees\dashboard-ops'
$ProdWorktree    = 'C:\Users\danie\kb-worktrees\dashboard-prod'
$WorktreeRoot    = 'C:\Users\danie\kb-worktrees'
$LocalDashState  = Join-Path $env:LOCALAPPDATA 'kb-dashboard'
$LocalDispState  = Join-Path $env:LOCALAPPDATA 'kb-codex-dispatch'
$VM              = 'kb@100.89.73.118'          # tailnet address; not public
$PlatformUrl     = 'https://kb.tail82dd4f.ts.net'
$CutoverRoot     = 'C:\Users\danie\kb-backups\cutover-2026-08-18'
$Stage           = Join-Path $CutoverRoot 'state'
New-Item -ItemType Directory -Force -Path $CutoverRoot | Out-Null
Set-Location $LocalRepo
```

**[AGENT]** Confirm the VM is reachable, healthy and on the expected release before touching
anything.

```powershell
ssh $VM 'systemctl is-active kb-dashboard.service; cat /opt/kb-releases/current/VERSION; curl -sS --max-time 10 http://127.0.0.1:4317/readyz; echo; tailscale serve status'
```

Expected: `active`, a 40-hex VERSION, `{"ok":true,"quiescent":true,"blockers":[]}`, and
`https://kb.tail82dd4f.ts.net (tailnet only) |-- / proxy http://127.0.0.1:4317`.
A `quiescent:false` or non-empty `blockers` **stops the window** — see §6.4 (outbox
`DirtyIndexError` recovery) before continuing.

**[AGENT]** Assert the VM's runtime version floors. The release is built against them, and the
`--experimental-strip-types` entrypoint fails in ways that read as application bugs when the node
under the unit is not the one the build assumed. The floors are `node >= 24.18` and
`python3 >= 3.12`, and the node the **unit** invokes must resolve into the fnm-managed toolchain —
not a distro node that a package update dropped in front of it.

```powershell
ssh $VM @'
fail=0
NODE_BIN=$(systemctl show kb-dashboard.service -p ExecStart --value | sed -n "s/.*path=\([^ ;]*\).*/\1/p" | head -1)
[ -n "$NODE_BIN" ] || NODE_BIN=/usr/bin/node
NODE_REAL=$(readlink -f "$NODE_BIN")
NODE_V=$("$NODE_BIN" --version | tr -d v)
PY_V=$(python3 -c "import sys; print('%d.%d.%d' % sys.version_info[:3])")
echo "unit node: $NODE_BIN -> $NODE_REAL (v$NODE_V);  python3 $PY_V"
printf "24.18.0\n%s\n" "$NODE_V" | sort -V -C || { echo "FAIL: node $NODE_V is below the 24.18 floor"; fail=1; }
printf "3.12.0\n%s\n"  "$PY_V"   | sort -V -C || { echo "FAIL: python3 $PY_V is below the 3.12 floor"; fail=1; }
case "$NODE_REAL" in
  *fnm*) echo "ok: the unit node resolves into the fnm-managed toolchain" ;;
  *)     echo "FAIL: the unit node resolves to $NODE_REAL, which is not the fnm-managed node"; fail=1 ;;
esac
exit $fail
'@
if ($LASTEXITCODE -ne 0) { throw 'VM runtime version floor failed. Fix the toolchain before opening the window — do not deploy onto a runtime the release was not built for.' }
```

---

## 1. Drain

### 1.1 Freeze cadences — with `queue/paused/`, never with `STOP`

**[AGENT]** The fleet preamble (`scripts/preamble.py`, binding per `CLAUDE.md`) asserts the `STOP`
file is **absent** and halts every agent when it is present — including the agents running this
cutover. `STOP` is therefore the wrong instrument here. The right one is the per-cadence,
presence-only sentinel `queue/paused/<name>` that `scripts/dispatch.py#due()` checks
(`dispatch.py:483-490`).

```powershell
if (Test-Path (Join-Path $LocalRepo 'STOP')) { throw 'STOP file present: the fleet is frozen. Resolve the freeze; do NOT proceed and do NOT delete STOP to make this pass.' }

$PausedDir = Join-Path $OpsWorktree 'queue\paused'
New-Item -ItemType Directory -Force -Path $PausedDir | Out-Null
'nightly-review','weekly-audit','grades-reconcile','daemon-dirs-sync' | ForEach-Object {
  New-Item -ItemType File -Force -Path (Join-Path $PausedDir $_) | Out-Null
}
Get-ChildItem $PausedDir | Select-Object Name
```

These sentinels are local, presence-only, and uncommitted. **Remove them at §5.8**, not before.

**[AGENT]** Assert the Windows schedulers are already off (they were observed `Disabled`; this is an
assertion, not a change).

```powershell
$Tasks = schtasks /query /fo csv /nh | Where-Object { $_ -match 'kb-codex-runner|kb-desktop-dispatcher' }
$Tasks
if ($Tasks | Where-Object { $_ -notmatch '"Disabled"' }) { throw 'A kb scheduled task is not Disabled: disable it before draining.' }
```

### 1.2 Prove nothing is executing (not "nothing is open")

**[AGENT]** The predicate is **no live attempt or session**, not "no non-terminal run". Runs parked
at human gates are supposed to migrate intact.

```powershell
$ControlPlane = Join-Path $LocalDashState 'control\control-plane.json'
$Control = Get-Content -Raw $ControlPlane | ConvertFrom-Json
$LiveAttempts = @($Control.attempts | Where-Object { $_.state -in 'starting','running' })
$LiveSessions = @($Control.sessions | Where-Object { $_.state -in 'starting','running','waiting' })
$LiveAttempts | Select-Object attemptRef,state
$LiveSessions | Select-Object sessionRef,state
if ($LiveAttempts.Count -ne 0 -or $LiveSessions.Count -ne 0) { throw 'Live attempts/sessions remain: let them finish or Stop them in Dashboard before cutover.' }

# Informational: what will migrate as parked work.
@($Control.runs        | Where-Object { $_.state -notin 'succeeded','failed','stopped','interrupted','archived' }) | Select-Object runRef,state,title
@($Control.humanRequests | Where-Object { $_.state -eq 'open' }).Count
```

At the time of writing this is expected to report **0 live**, and to list **7 `waiting-human` runs
with 7 open human requests** — all of which migrate.

### 1.3 Codex dispatcher quiet

**[AGENT]** No dispatch in flight. Do not delete marker files to make this pass.

```powershell
$Pending = Join-Path $LocalDispState 'pending'
$PendingDispatches = @(Get-ChildItem -Force $Pending -Filter *.json -ErrorAction SilentlyContinue)
$PendingDispatches | Select-Object Name,LastWriteTime
if ($PendingDispatches.Count -ne 0) { throw 'Codex dispatches remain pending: wait for completion or stop them in their watched session.' }
```

### 1.4 Stop the desktop control plane

**[HUMAN — Daniel]** Stop it, then `pm2 save` so the dump records it **as stopped** and
logon-resurrection brings it back stopped rather than online. This is a stop, not a `pm2 delete` —
the process entry, `dashboard-prod` and the desktop state all stay for the two-week rollback window
(`pm2 delete` happens at §6.5, day 14).

```powershell
pm2 stop kb-dashboard
pm2 save                                   # persist the STOPPED state into the dump
$PmBefore = Join-Path $CutoverRoot 'pm2-before.json'
pm2 jlist | Out-File -Encoding utf8 $PmBefore

# Assert from the raw text. Do NOT ConvertFrom-Json: pm2 jlist emits duplicate keys and the PS 5.1
# JSON parser throws on them.
$PmText = (Get-Content -Raw $PmBefore) -replace '\s',''
$KbStatus = [regex]::Match($PmText, '"name":"kb-dashboard".*?"status":"(?<s>[a-z\-]+)"')
if (-not $KbStatus.Success) { throw 'kb-dashboard is absent from the pm2 dump — the rollback image lost its pm2 registration. Stop and investigate before continuing.' }
if ($KbStatus.Groups['s'].Value -ne 'stopped') { throw "pm2 reports kb-dashboard as '$($KbStatus.Groups['s'].Value)', not 'stopped'. Do not continue with a live desktop control plane." }
"pm2 kb-dashboard status: $($KbStatus.Groups['s'].Value)"
```

**[AGENT]** Verify nothing still owns `5317`.

```powershell
$Listener = Get-NetTCPConnection -State Listen -LocalPort 5317 -ErrorAction SilentlyContinue
$Listener
if ($Listener) { throw 'Port 5317 is still held: identify and stop the owning process before continuing.' }
```

**[HUMAN — Daniel]** `atlas-worker` — per end-state **D-3**, default is **leave it running**. Only
if Daniel rules otherwise:

```powershell
pm2 stop atlas-worker; pm2 save
```

Record the ruling in the cutover log either way.

### 1.5 Declare desktop quiescent

**[HUMAN — boss]** Only after 1.1–1.4 all pass. From here to acceptance, no local dashboard,
dispatcher or cadence is started.

---

## 2. Push sweep — triaged

The old runbook's `git add -A` + `git push --all origin` loop is removed. `add -A` sweeps unrelated
working-tree state into a nondescript commit; `push --all` publishes junk and backup branches. This
section commits deliberately, pushes selectively, and audits fail-closed with an explicit exemption
list.

### 2.1 Build the checkout inventory

**[AGENT]**

```powershell
$Exempt = @(
  $OpsWorktree,                                        # permanently checked-out ops
  $ProdWorktree,                                       # rollback image — do not touch
  'C:\Users\danie\kb-worktrees\boss-2026-08-11c'       # SDD ledger worktree (kept by ruling)
)
# Directory scan (named worktree roots) …
$ScannedCheckouts = @($LocalRepo) + @(
  Get-ChildItem -Directory $WorktreeRoot | Where-Object { Test-Path (Join-Path $_.FullName '.git') } |
    Select-Object -ExpandProperty FullName
) + @(
  Get-ChildItem -Directory 'C:\Users\danie\kb\_private\codex-worktrees' -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
)

# … plus git's own registry, which is the only complete source. A directory scan misses worktrees
# created outside $WorktreeRoot (there are three detached ones under %TEMP% today).
$Registered = @(git -C $LocalRepo worktree list --porcelain |
  Where-Object { $_ -like 'worktree *' } |
  ForEach-Object { $_.Substring(9) })

$Checkouts = @($ScannedCheckouts + $Registered) | Select-Object -Unique |
  Where-Object { $_ -and (Test-Path $_) } |
  Where-Object { $_ -notin $Exempt } |
  Where-Object { $_ -notlike "$env:LOCALAPPDATA\kb-dashboard\control\*" }
$Checkouts
```

Local refs Daniel is expected to keep unpushed are acknowledged **by pattern**, not hand-listed —
the audit flags roughly two dozen branches otherwise and a hand list rots between windows.

```powershell
$AcknowledgedPatterns = @(
  'codex/managed-*',              # control-plane reconciler-owned; never pushed, by design
  'backup/*',                     # local backup refs
  'claude/boss-2026-08-11c',      # SDD ledger branch, kept local by ruling
  'claude/dashboard-prod-pin'     # rollback image pin — deliberately NOT advanced this window
)
function Test-Acknowledged([string]$Ref) {
  foreach ($P in $AcknowledgedPatterns) { if ($Ref -like $P) { return $true } }
  return $false
}
```

**Never enumerated, never swept:** everything under
`%LOCALAPPDATA%\kb-dashboard\control\worktrees\` and `…\control\integration\` — these are the
control plane's managed worktrees (`git worktree list` shows four `codex/managed-*` branches and
three detached HEADs there). Its reconciler owns them, which is why the `$Checkouts` filter above
drops them even though `worktree list` reports them.

### 2.2 Inspect and capture, one checkout at a time

**[HUMAN — Daniel]** Walk the list. Review each diff *before* committing. A credential file
appearing in `status` is a stop condition: remove it from the checkout without revealing its
contents, then re-inspect.

```powershell
foreach ($Checkout in $Checkouts) {
  Write-Host "=== $Checkout ($(git -C $Checkout branch --show-current)) ==="
  git -C $Checkout status --short
  git -C $Checkout diff --stat
}
```

For each checkout with real work, commit **scoped** — name the paths, never `add -A`:

```powershell
# per checkout, with Daniel's eyes on the diff:
git -C <checkout> add <explicit paths>
git -C <checkout> commit -m 'cutover: capture <what this actually is>'
```

Deliberately-uncommitted trees (e.g. the bricks scratch tree) may stay dirty — record them in the
cutover log as knowingly not captured.

### 2.3 Detached-HEAD triage

**[AGENT]** A detached HEAD outside the exempt control-plane paths holds commits reachable from no
branch; a `push --all` would miss them silently. Drive this from git's registry, not from the
directory scan — the detached worktrees live under `%TEMP%`, which no directory scan reaches.

```powershell
$Porcelain = git -C $LocalRepo worktree list --porcelain
$Detached = @()
$Current  = $null
foreach ($Line in $Porcelain) {
  if     ($Line -like 'worktree *') { $Current = $Line.Substring(9) }
  elseif ($Line -eq 'detached')     { $Detached += $Current }
}
$Detached = $Detached | Where-Object { $_ -notin $Exempt } |
  Where-Object { $_ -notlike "$env:LOCALAPPDATA\kb-dashboard\control\*" }

foreach ($Checkout in $Detached) {
  if (-not (Test-Path $Checkout)) { Write-Host "DETACHED (missing dir, prune candidate): $Checkout"; continue }
  Write-Host "DETACHED: $Checkout @ $(git -C $Checkout rev-parse --short HEAD)"
  git -C $Checkout log --oneline -5
  # Commits here that exist on no remote at all:
  git -C $Checkout log --oneline HEAD --not --remotes
}
```

**[HUMAN — Daniel]** For each detached checkout: either `git -C <checkout> switch -c <name>` and
push it, or declare it disposable in the cutover log. Do not proceed with an untriaged detached HEAD.

### 2.4 Push selectively

**[HUMAN — Daniel]** Push branches that have an upstream and are ahead, plus any branch Daniel
explicitly nominates. Nothing else.

```powershell
git -C $LocalRepo fetch --all --prune

# Branches with an upstream that are ahead of it:
git -C $LocalRepo for-each-ref --format='%(refname:short) %(upstream:short) %(upstream:track)' refs/heads |
  Where-Object { $_ -match '\[ahead' }

# Branches with NO upstream (Daniel decides each: push -u, or leave local):
git -C $LocalRepo for-each-ref --format='%(refname:short)|%(upstream:short)' refs/heads |
  Where-Object { $_ -match '\|$' }
```

Then, per nominated branch:

```powershell
git -C <checkout> push -u origin <branch>
```

Leave `backup/*`, `[gone]`-upstream branches whose work is already merged, and anything Daniel
declares dead. `claude/dashboard-prod-pin` is **not** advanced during this window (rollback image).

**[AGENT]** Tags are refs too, and the old runbook's `push --tags` is the only reason they ever
reached GitHub. Enumerate local tags that are absent from `origin`.

```powershell
$RemoteTags = @(git -C $LocalRepo ls-remote --tags origin |
  ForEach-Object { ($_ -split "`t")[1] } |
  Where-Object { $_ -and $_ -notlike '*^{}' } |
  ForEach-Object { $_ -replace '^refs/tags/','' })
$UnpushedTags = @(git -C $LocalRepo tag | Where-Object { $_ -notin $RemoteTags })
$UnpushedTags
```

**[HUMAN — Daniel]** Per tag: `git -C $LocalRepo push origin <tag>`, or record it in the cutover log
as deliberately local. Do not blanket `push --tags`.

### 2.5 Fail-closed audit

**[AGENT]** After the pushes, every non-exempt checkout must report nothing — or only refs matching
`$AcknowledgedPatterns` from 2.1, plus whatever Daniel added by name in 2.4. The pattern list is
what keeps this audit honest: the raw form flags ~24 branches, most of them `codex/managed-*` refs
the reconciler owns and must never push, and a screen of expected noise is how a real unpushed
branch gets waved through.

```powershell
# Names Daniel additionally nominated as deliberately-local during 2.4:
$AcknowledgedExtra = @()

foreach ($Checkout in $Checkouts) {
  git -C $Checkout fetch --all --prune | Out-Null
  $Rows = git -C $Checkout log --branches --not --remotes --oneline
  if ($Rows) { Write-Host "--- $Checkout ---"; $Rows }
}

$Residual = @(git -C $LocalRepo for-each-ref --format='%(refname:short)' refs/heads |
  Where-Object { -not (Test-Acknowledged $_) } |
  Where-Object { $_ -notin $AcknowledgedExtra } |
  Where-Object { (git -C $LocalRepo log --oneline "origin/$_..$_" 2>$null) -or -not (git -C $LocalRepo rev-parse --verify --quiet "origin/$_") })
if ($Residual.Count -gt 0) { $Residual; throw "Unpushed refs remain outside the acknowledged patterns. Push or acknowledge each, then re-run this audit." }

if ($UnpushedTags.Count -gt 0) { $UnpushedTags; Write-Host 'Tags above are local-only — confirm each was recorded in the cutover log at 2.4.' }
```

**A commit that reached only `/var/lib/kb/ops`, only `~/kb-mirror.git`, or only a local branch is
NOT pushed.** Only `origin` on GitHub counts.

---

## 3. State migration to the platform's real paths

Destination is `DASHBOARD_STATE_ROOT=/var/lib/kb/state`, owned by the `kb-dashboard` service
account. The `kb` login account cannot write it directly, so the copy stages through
`/var/tmp` and lands with `sudo`.

### 3.1 Snapshot both sides before touching anything

**[HUMAN — Daniel]** Tier-0 snapshot of the VM state as it stands (this is the "undo the import"
point), plus a local copy of the desktop state.

```powershell
python scripts/backup_tier0.py backup --host $VM --output (Join-Path $CutoverRoot 'vm-pre-import.json')
Get-Content (Join-Path $CutoverRoot 'vm-pre-import.json')
robocopy $LocalDashState (Join-Path $CutoverRoot 'desktop-state-backup') /E /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy backup failed with exit code $LASTEXITCODE" }
```

### 3.2 Build the staging copy with exclusions enforced by the copy itself

**[AGENT]** Do not rely on remembering to skip directories at `scp` time — exclude them here, then
assert.

```powershell
Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
robocopy $LocalDashState $Stage /E /XD worktrees integration pty pty-priming /XF *.mutex.sqlite /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy staging failed with exit code $LASTEXITCODE" }

# Fail closed on anything that must never cross.
foreach ($Bad in 'control\worktrees','control\integration','pty','pty-priming') {
  if (Test-Path (Join-Path $Stage $Bad)) { throw "Excluded path leaked into the staging copy: $Bad" }
}
if (Get-ChildItem -Recurse -Force $Stage -Filter *.mutex.sqlite) { throw 'A mutex sqlite file leaked into the staging copy.' }
# No -Directory: a linked worktree's `.git` is a FILE, and that is exactly the case this must catch.
if (Get-ChildItem -Recurse -Force $Stage -Filter '.git') { throw 'Git metadata leaked into the staging copy.' }

# Inventory of what WILL migrate — read it out loud before proceeding.
Get-ChildItem -Recurse -Force $Stage | Select-Object FullName,Length,LastWriteTime
```

**[AGENT]** Assert the expected artifacts are all present. The old five-file list dropped most of
these.

```powershell
$Required = @(
  'control\control-plane.json',
  'control\canonical-integration.json',
  'control\execution-accounting',
  'control\agent-session-chains',
  'control\attempt-io',
  'control\.disabled-hooks',
  'workflows\assignment-amendments',
  'naming.json',
  'composer\workspaces.json'
)
$Missing = $Required | Where-Object { -not (Test-Path (Join-Path $Stage $_)) }
$Missing
if ($Missing) { throw "Expected state artifacts are absent from staging: $($Missing -join ', '). Decide per artifact before continuing — do not silently drop one." }
```

`UNVERIFIED:` `control\execution-results.json`, `control\paid-actions.json` and
`control\spend-grants.json` were not present on the desktop at authoring time. If any exists at
cutover, it is a real artifact (`adapters.ts:767`, `paidActionService.ts:666`, `spendGrant.ts:160`)
and must migrate with the rest.

**Deliberately NOT migrated** (and why): `control\worktrees\`, `control\integration\` (host-specific
git worktrees; the reconciler rebuilds them); `pty\`, `pty-priming\` (`pty:false` on Linux);
`%LOCALAPPDATA%\kb-codex-dispatch\**` (a Windows CLI tool's state — nothing under
`dashboard/server` reads it); `ledgers/` and every other coordination path (git-tracked — §3.5).

### 3.3 `naming.json` collision

**[HUMAN — Daniel]** Per end-state **D-4**. Preserve the VM's copy under a new name before
overwriting; never let the copy silently decide.

```powershell
ssh $VM 'sudo cp -a /var/lib/kb/state/naming.json /var/lib/kb/state/naming.json.vm-preexisting-20260818 && sudo ls -la /var/lib/kb/state/naming.json*'
```

If Daniel rules the VM copy wins, remove `naming.json` from `$Stage` before the transfer.

### 3.4 Stop, transfer, install, guarded start

**[HUMAN — Daniel]** Stop the platform cleanly first. Stopping while the daemon re-stages audit
writes is what produces the outbox `DirtyIndexError` class.

```powershell
ssh $VM 'sudo systemctl stop kb-dashboard.service && systemctl is-active kb-dashboard.service || true'
ssh $VM 'systemctl is-active kb-dashboard.service' | ForEach-Object { if ($_ -eq 'active') { throw 'kb-dashboard did not stop.' } }
```

**[HUMAN — Daniel]** Transfer to a private staging dir owned by `kb`, then install as root.

Every remote call below is checked. A transfer that half-lands and is not noticed is the worst
outcome available in this section — it produces a control plane that parses but is missing rows.

```powershell
ssh $VM 'rm -rf /var/tmp/kb-cutover-state && install -d -m 700 /var/tmp/kb-cutover-state'
if ($LASTEXITCODE -ne 0) { throw "Could not prepare the VM staging dir (exit $LASTEXITCODE)." }

scp -r "$Stage\*" "${VM}:/var/tmp/kb-cutover-state/"
if ($LASTEXITCODE -ne 0) { throw "scp of the staging tree failed (exit $LASTEXITCODE). Do not continue: the install step would copy a partial tree over live state." }

ssh $VM 'find /var/tmp/kb-cutover-state -maxdepth 2 | sort'
if ($LASTEXITCODE -ne 0) { throw "Could not list the VM staging dir (exit $LASTEXITCODE)." }
```

**[AGENT]** Re-assert the **same `$Required` manifest** from 3.2 against the VM staging dir. The
`find` above is an eyeball aid; this is the assertion.

```powershell
$RequiredPosix = $Required | ForEach-Object { $_ -replace '\\','/' }
$RemoteManifestCheck = 'S=/var/tmp/kb-cutover-state; miss=0; for p in ' + ($RequiredPosix -join ' ') +
  '; do [ -e "$S/$p" ] || { echo "MISSING: $p"; miss=1; }; done; exit $miss'
ssh $VM $RemoteManifestCheck
if ($LASTEXITCODE -ne 0) { throw 'The $Required manifest is not intact in the VM staging dir — the transfer was partial. Re-transfer; do NOT run the install step.' }
```

**[HUMAN — Daniel]** Install as root. The script deliberately does **not** use `set -e`: with
`set -e`, a legitimately-false `test -f` on an optional file aborts before the ownership fixups, and
a state tree left owned by `kb` is unreadable to the service account (`User=kb-dashboard`) — which
then surfaces as a mysterious boot failure rather than a copy failure. Ownership and modes are
therefore normalised in an `EXIT` trap that runs on every path.

```powershell
ssh $VM @'
S=/var/tmp/kb-cutover-state
D=/var/lib/kb/state
rc=0

finish() {
  sudo chown -R kb-dashboard:kb-dashboard "$D"
  sudo chmod 0700 "$D/control" "$D/composer"
  sudo find "$D/control" "$D/composer" -type d -exec chmod 0700 {} +
  sudo find "$D/control" "$D/composer" -type f -exec chmod 0600 {} +
  sudo ls -la "$D" "$D/control"
  exit $rc
}
trap finish EXIT

if [ -e "$S/control/worktrees" ] || [ -e "$S/control/integration" ]; then
  echo "FATAL: host-specific worktree state reached the VM staging dir"; rc=1; exit 1
fi

sudo install -d -o kb-dashboard -g kb-dashboard -m 0700 "$D/control"   || rc=1
sudo install -d -o kb-dashboard -g kb-dashboard -m 0700 "$D/composer"  || rc=1
sudo install -d -o kb-dashboard -g kb-dashboard -m 0755 "$D/workflows" || rc=1

sudo cp -a "$S/control/."   "$D/control/"   || rc=1
sudo cp -a "$S/workflows/." "$D/workflows/" || rc=1

# Conditionals, not `test … && …`: these two files are legitimately optional (D-4 may drop
# naming.json from staging, D-5 may skip the composer), and their absence must not be fatal.
if [ -f "$S/composer/workspaces.json" ]; then
  sudo cp -a "$S/composer/workspaces.json" "$D/composer/workspaces.json" || rc=1
else
  echo "note: composer/workspaces.json absent from staging (expected only if D-5 said skip)"
fi
if [ -f "$S/naming.json" ]; then
  sudo cp -a "$S/naming.json" "$D/naming.json" || rc=1
else
  echo "note: naming.json absent from staging (expected only if D-4 said the VM copy wins)"
fi
'@
if ($LASTEXITCODE -ne 0) { throw "State install failed (exit $LASTEXITCODE). Ownership and modes were still normalised by the trap; read the output above, fix the cause, and re-run — do not start the unit." }
ssh $VM 'rm -rf /var/tmp/kb-cutover-state'
```

**[AGENT]** Verify the import landed and parses, without printing state contents.

```powershell
ssh $VM 'sudo python3 -c "
import json
d=json.load(open(\"/var/lib/kb/state/control/control-plane.json\"))
print({k:(len(v) if isinstance(v,list) else v) for k,v in d.items()})
"'
```

Expect the desktop's row counts (10 runs / 16 stages / 19 attempts / 32 sessions / 43 events /
14 human requests as of authoring), **not** the 234-byte empty seed.

**[AGENT] GUARD — run before every armed boot.** Under `DASHBOARD_AUTH_MODE=tailnet` the daemon comes
up **armed**: engine, broker and queue bridge are live within a tick of start. There is no unlock
gate left to hold work back, so the next command is the moment migrated work can begin. Two
assertions stand in for the gate that used to exist.

```powershell
# a) Queued attempts that came across in the import. Expect exactly 7 (end-state §2.1).
$QueuedAttempts = (ssh $VM 'sudo python3 -c "
import json
d=json.load(open(\"/var/lib/kb/state/control/control-plane.json\"))
print(sum(1 for a in d.get(\"attempts\",[]) if a.get(\"state\")==\"queued\"))
"').Trim()
"queued attempts: $QueuedAttempts"
if ([int]$QueuedAttempts -ne 7) { throw "Expected 7 queued attempts after the import, got $QueuedAttempts. Reconcile the difference before an armed boot — each of these is claimable the instant the daemon starts." }

# b) Claimable cards in the VM's ops queue. Must be ZERO.
ssh $VM 'set -- $(grep -l -E "^status:[[:space:]]*(open|ready|queued|assigned)" /var/lib/kb/ops/queue/*.md 2>/dev/null); if [ $# -gt 0 ]; then echo "CLAIMABLE CARDS:"; printf "%s\n" "$@"; exit 1; fi; echo "0 claimable cards"'
if ($LASTEXITCODE -ne 0) { throw 'Claimable cards are present in the VM ops queue. Armed-at-boot means the bridge claims them within one tick. Pause or resolve each card before starting the daemon.' }
```

**[HUMAN — Daniel]** Both assertions green? Then start the platform and confirm it comes up clean —
and **armed**.

```powershell
ssh $VM 'sudo systemctl start kb-dashboard.service && sleep 5 && systemctl is-active kb-dashboard.service && curl -sS --max-time 10 http://127.0.0.1:4317/readyz; echo'
```

`{"ok":true,"quiescent":true,"blockers":[]}` is required. Anything else → §6.4.

**WARNING — carry this for the rest of the window.** The seven migrated open human requests are
**live triggers**, not a notification backlog. Answering one in the dashboard starts real work
immediately; there is no second confirmation and no locked posture to fall back to. Do not clear
them "to tidy up" — answer only the ones you intend to run, and only when you want them to run.

### 3.5 Ledgers and coordination reach the VM by git only

**[AGENT]** No file copy. The daemon's repoRoot is a sparse `ops` clone; it converges through the
outbox/reconciliation path. Assert the shape rather than copying into it.

```powershell
ssh $VM 'sudo -u kb-dashboard git -c safe.directory=/var/lib/kb/ops -C /var/lib/kb/ops remote -v; sudo -u kb-dashboard git -c safe.directory=/var/lib/kb/ops -C /var/lib/kb/ops rev-parse --abbrev-ref HEAD; sudo -u kb-dashboard git -c safe.directory=/var/lib/kb/ops -C /var/lib/kb/ops status --short | head -20'
```

`origin` **must** read `disabled://desktop-promotion-only` on both fetch and push. If it does not,
stop: something has given the VM a GitHub path, which violates the 2026-08-11 locked ruling.

---

## 4. Release deploy — post-merge `main`

### 4.1 Take the CI artifact

**[HUMAN — Daniel]** Releases are built by `.github/workflows/kb-platform-release.yml` on every push
to `main`. Do not build locally.

```powershell
$Sha = git -C $LocalRepo rev-parse origin/main
$Sha
gh run list --workflow kb-platform-release --branch main --limit 5
gh run download <run-id> --dir (Join-Path $CutoverRoot 'release')
Get-ChildItem (Join-Path $CutoverRoot 'release') -Recurse | Select-Object FullName,Length
```

The artifact pair is `kb-platform-<sha>.tar.gz` + `kb-platform-<sha>.attestation.json`.

### 4.2 Sign and activate

**[HUMAN — Daniel]** Only Daniel touches the signing key; its path is supplied on the command line
and never recorded here.

```powershell
python scripts/deploy_platform_release.py `
  (Join-Path $CutoverRoot "release\kb-platform-$Sha.tar.gz") `
  (Join-Path $CutoverRoot "release\kb-platform-$Sha.attestation.json") `
  --signing-key <path to the release signing key> `
  --host $VM
```

Expected terminal line: `activated <sha>`. The tool verifies the attestation is closed/canonical,
re-hashes the archive, ssh-signs the attestation under namespace `kb-release`, uploads to a
`0700` dir under `/var/tmp/kb-release-upload/`, and calls
`sudo /usr/local/lib/kb/activate_release.py activate --upload-dir …`.

**[AGENT]** Confirm the flip.

```powershell
ssh $VM 'cat /opt/kb-releases/current/VERSION; ls -la /opt/kb-releases/ | grep -E "current|previous"; systemctl is-active kb-dashboard.service; curl -sS --max-time 10 http://127.0.0.1:4317/readyz; echo'
```

`current/VERSION` must equal `$Sha`, and `previous` must point at the release that was current
before this deploy.

### 4.3 MANDATORY helper refresh (platform gap)

**[HUMAN — Daniel]** `activate_release` does **not** refresh `/usr/local/lib/kb/*`. A merged fix to
`validate_vm_runtime.py`, `activate_release.py`, `export_tier0.py` or `apply_ops_reconciliation.py`
reaches the VM only by hand. VERIFIED at authoring: `apply_ops_reconciliation.py` on the VM **is**
current with `main` (hash-verified, despite its bootstrap-era mtime); the one that has drifted is
`validate_vm_runtime.py`, behind `main` by exactly `validate_ops_git_identity()` — 16 lines.

**This step is a trust boundary, not a chore.** The release path is signed end to end: the
attestation is ssh-signed under namespace `kb-release` and verified against the pinned
`release_signing_public.py` before anything activates. This helper path is **unsigned** — four
Python files `scp`'d from whatever the operator's checkout happens to contain, installed root-owned
`0555`, and then executed by `ExecStartPre` and by every `sudo` helper call. Treat each changed byte
the way you would treat a release: know what changed, and be able to put it back (end-state D-7).

**[AGENT]** Record what is on the VM now — hashes plus a byte-exact backup pulled into the cutover
record — before anything is overwritten.

```powershell
$HelperNames = 'activate_release.py','validate_vm_runtime.py','export_tier0.py','apply_ops_reconciliation.py'
$HelperList  = $HelperNames -join ' '

ssh $VM "cd /usr/local/lib/kb && sudo sha256sum $HelperList" |
  Tee-Object -FilePath (Join-Path $CutoverRoot 'helpers-vm-before.sha256')
if ($LASTEXITCODE -ne 0) { throw "Could not hash the VM helpers (exit $LASTEXITCODE)." }

ssh $VM "sudo tar -C /usr/local/lib/kb -cf /var/tmp/kb-helpers-before.tar $HelperList && sudo chown kb: /var/tmp/kb-helpers-before.tar"
if ($LASTEXITCODE -ne 0) { throw "Could not archive the current VM helpers (exit $LASTEXITCODE)." }
scp "${VM}:/var/tmp/kb-helpers-before.tar" (Join-Path $CutoverRoot 'helpers-vm-before.tar')
if ($LASTEXITCODE -ne 0) { throw 'Could not retrieve the helper backup. Do NOT overwrite root-owned helpers without a backup in the cutover record.' }
ssh $VM 'rm -f /var/tmp/kb-helpers-before.tar'
```

**[AGENT]** Diff current-vs-new, so the install is a known change rather than a blind overwrite.

```powershell
$VmHashes = @{}
Get-Content (Join-Path $CutoverRoot 'helpers-vm-before.sha256') | ForEach-Object {
  $Parts = ($_ -split '\s+') | Where-Object { $_ }
  if ($Parts.Count -ge 2) { $VmHashes[($Parts[1] -replace '^\*','')] = $Parts[0].ToLower() }
}
$HelperDiff = $HelperNames | ForEach-Object {
  $Repo = (Get-FileHash (Join-Path $LocalRepo "deploy\$_") -Algorithm SHA256).Hash.ToLower()
  [pscustomobject]@{ helper = $_; vm = $VmHashes[$_]; repo = $Repo; changes = ($VmHashes[$_] -ne $Repo) }
}
$HelperDiff | Format-Table -AutoSize
$HelperDiff | Format-Table -AutoSize | Out-File -Encoding utf8 (Join-Path $CutoverRoot 'helpers-diff.txt')
```

**[HUMAN — Daniel]** For every row with `changes = True`, read `git -C $LocalRepo log --oneline -5 --
deploy/<helper>` and the diff before installing. Expect exactly one changed helper at authoring
(`validate_vm_runtime.py`); a second unexplained change is a stop condition.

```powershell
ssh $VM 'rm -rf /var/tmp/kb-helpers && install -d -m 700 /var/tmp/kb-helpers'
scp (Join-Path $LocalRepo 'deploy\activate_release.py') (Join-Path $LocalRepo 'deploy\validate_vm_runtime.py') `
    (Join-Path $LocalRepo 'deploy\export_tier0.py') (Join-Path $LocalRepo 'deploy\apply_ops_reconciliation.py') `
    "${VM}:/var/tmp/kb-helpers/"
if ($LASTEXITCODE -ne 0) { throw "scp of the helpers failed (exit $LASTEXITCODE). Do not install a partial helper set." }
ssh $VM 'sudo install -o root -g root -m 0555 /var/tmp/kb-helpers/*.py /usr/local/lib/kb/ && rm -rf /var/tmp/kb-helpers && ls -la /usr/local/lib/kb/'
if ($LASTEXITCODE -ne 0) { throw "Helper install failed (exit $LASTEXITCODE). Restore from helpers-vm-before.tar before restarting the unit." }
ssh $VM "cd /usr/local/lib/kb && sudo sha256sum $HelperList" |
  Tee-Object -FilePath (Join-Path $CutoverRoot 'helpers-vm-after.sha256')
```

Every row of `helpers-vm-after.sha256` must equal the `repo` column of the diff above.

**Do not touch `/usr/local/lib/kb/release_signing_public.py`** — it is `0444`, holds the pinned
release trust anchor, and is provisioned only by bootstrap.

**[HUMAN — Daniel]** Restart so `ExecStartPre` re-runs against the refreshed validator.

```powershell
ssh $VM 'sudo systemctl restart kb-dashboard.service && sleep 3 && systemctl is-active kb-dashboard.service && curl -sS --max-time 10 http://127.0.0.1:4317/readyz; echo'
```

### 4.4 Env assertion — never a rewrite

**[AGENT]** The old runbook's `sed -i "/^DASHBOARD_.../d"` shape would overwrite already-correct
configuration. Assert instead; a mismatch is a stop, not something to patch inline.

```powershell
ssh $VM 'systemctl show kb-dashboard.service -p Environment | tr " " "\n" | grep -E "^(DASHBOARD_REPO_ROOT|DASHBOARD_STATE_ROOT|DASHBOARD_AUTH_MODE|DASHBOARD_EXECUTION_ACTIVATED|KB_COORDINATION_PUBLICATION|KB_VM_RUNTIME)="'
```

Required exactly:

```
DASHBOARD_REPO_ROOT=/var/lib/kb/ops
DASHBOARD_STATE_ROOT=/var/lib/kb/state
DASHBOARD_AUTH_MODE=tailnet
DASHBOARD_EXECUTION_ACTIVATED=1
KB_COORDINATION_PUBLICATION=outbox
KB_VM_RUNTIME=1
```

`DASHBOARD_AUTH_MODE=tailnet` with `DASHBOARD_EXECUTION_ACTIVATED=1` **is** the armed-at-boot posture
(end-state §4). Seeing `AUTH_MODE` absent, or `ACTIVATED=0`, means the tailnet-auth wave's unit was
not deployed — stop, because this runbook's acceptance has no unlock step to compensate.

**[AGENT]** And assert the retired channels are gone.

```powershell
ssh $VM 'systemctl show kb-dashboard.service -p UnsetEnvironment; systemctl show kb-dashboard.service -p Environment | grep -c DASHBOARD_SESSION_SECRET; systemctl show kb-dashboard.service -p Environment | grep -cE "DASHBOARD_WEBAUTHN_CREDENTIALS|DASHBOARD_RP_ORIGIN"'
```

`DASHBOARD_SESSION_SECRET` must appear in `UnsetEnvironment` and **must not** appear in
`Environment` (count `0`). It is in `validate_vm_runtime.FORBIDDEN_ENV`; the desktop secret is
never carried over, and no step in this runbook asks for it. `DASHBOARD_WEBAUTHN_CREDENTIALS` and
`DASHBOARD_RP_ORIGIN` must also count `0` — the tailnet-auth wave removes them, and their removal is
what closes the repo-unit drift hazard (end-state D-10).

### 4.5 Capture the live unit into the cutover record

**[AGENT]** The live unit is the only place some of this configuration has ever existed. Capture it
now, with the credential value redacted, so a future re-install has something to diff against.

```powershell
$UnitCapture = Join-Path $CutoverRoot 'kb-dashboard.service.captured'
ssh $VM 'systemctl cat kb-dashboard.service' |
  ForEach-Object { $_ -replace '(DASHBOARD_WEBAUTHN_CREDENTIALS=)\S+', '$1<REDACTED>' } |
  Tee-Object -FilePath $UnitCapture
if ($LASTEXITCODE -ne 0) { throw "Could not capture the unit (exit $LASTEXITCODE)." }
```

Post-wave the redaction should have nothing to do — the entry is expected to be absent (§4.4). If it
is still there, the old unit is installed and §4.4 has already stopped the window. Either way the
capture goes into the cutover record: it is the reference for committing the tailnet-mode unit shape
back to `deploy/` (end-state D-10).

### 4.6 Refresh the VM's ops checkout

**[AGENT]** `/var/lib/kb/ops` has `origin` set to `disabled://desktop-promotion-only`, so **nothing
refreshes it on its own** — in the shipped design the only downward path is the reconciliation bundle
applied at the tail of a *successful* promotion, and no promotion has ever succeeded. It is
**108 commits behind `origin/ops`** today. Acceptance run against a checkout that stale proves
nothing about the platform's view of coordination state.

The mechanism is the **pull-only downward sync mode** of `promote_vm_outbox.py` (end-state D-9
prerequisite 3, ruled Model B; it is a §0 precondition that this ships). Run it from the desktop,
which is the only machine with a GitHub credential.

**[HUMAN — Daniel]** Do this with the unit **stopped**: the refresh lands 108 commits of queue and
ledger state, and an armed daemon would begin claiming from it mid-write.

```powershell
ssh $VM 'sudo systemctl stop kb-dashboard.service'
# Downward sync (pull-only mode) — see the tool's own --help for the flag name it ships with.
python scripts/promote_vm_outbox.py --sync-down `
  --repo      $LocalRepo `
  --work-root (Join-Path $CutoverRoot 'outbox-work') `
  --vm-host   $VM
if ($LASTEXITCODE -ne 0) { throw "Downward ops sync failed (exit $LASTEXITCODE). Do not proceed to acceptance against a stale checkout." }
```

**[AGENT]** Assert convergence. This is the assertion that matters — not the tool's exit code.

```powershell
$OpsTip = (git -C $OpsWorktree fetch origin ops | Out-Null; git -C $OpsWorktree rev-parse origin/ops)
$VmOpsHead = (ssh $VM 'sudo -u kb-dashboard git -c safe.directory=/var/lib/kb/ops -C /var/lib/kb/ops rev-parse HEAD').Trim()
"origin/ops tip : $OpsTip"
"VM ops HEAD    : $VmOpsHead"
if ($VmOpsHead -ne $OpsTip) { throw "The VM ops checkout is not at the origin/ops tip. Acceptance would run against stale coordination state." }
```

**[AGENT]** Re-run the §3.4 **GUARD** before restarting — the refresh may have brought claimable
cards into the VM's queue, and the daemon comes back armed.

```powershell
ssh $VM 'set -- $(grep -l -E "^status:[[:space:]]*(open|ready|queued|assigned)" /var/lib/kb/ops/queue/*.md 2>/dev/null); if [ $# -gt 0 ]; then echo "CLAIMABLE CARDS:"; printf "%s\n" "$@"; exit 1; fi; echo "0 claimable cards"'
if ($LASTEXITCODE -ne 0) { throw 'The ops refresh brought claimable cards onto the VM. Pause or resolve each before restarting an armed daemon.' }
ssh $VM 'sudo systemctl start kb-dashboard.service && sleep 5 && systemctl is-active kb-dashboard.service && curl -sS --max-time 10 http://127.0.0.1:4317/readyz; echo'
```

---

## 5. Acceptance over 443

All browser work happens at **`https://kb.tail82dd4f.ts.net`** directly over the tailnet.
**No SSH tunnel, ever.** Under `DASHBOARD_AUTH_MODE=tailnet` the operator's identity *is* the
`tailscale serve` proxy's identity headers; a tunnel bypasses the proxy, so a tunnelled request is
not an operator request — and it is the one shape that could make an unaudited action look audited.

### 5.1 Direct tailnet access, and the platform is already armed

**[HUMAN — Daniel]** In his own browser, over the tailnet:

1. Open `https://kb.tail82dd4f.ts.net`. It must render the dashboard directly — no sign-in view, no
   passkey prompt, no unlock control. That absence *is* the tailnet mode working.
2. Confirm the migrated control plane is visible — the parked runs from §1.2 and their open human
   requests are present. **Do not answer any of them yet** (§3.4 warning: they are live triggers).
3. Confirm the execution posture reads **armed**, without anyone having armed it.

**[AGENT]** Confirm from the outside: armed at boot, identity audited, bridge actually ticking.

```powershell
ssh $VM 'sudo journalctl -u kb-dashboard.service -b --no-pager | tail -120'
```

Expect, in order: the daemon constructing execution wiring at startup rather than on request; an
audit record carrying the **tailnet proxy identity headers** for Daniel's first browser action; and
no crash/restart. Then prove the queue bridge is live rather than merely constructed.

```powershell
$BootIso = (ssh $VM 'systemctl show kb-dashboard.service -p ActiveEnterTimestamp --value').Trim()
$BootIso
ssh $VM 'sudo journalctl -u kb-dashboard.service -b --no-pager | grep -iE "queue.bridge|bridge tick|bridge poll" | head -20'
ssh $VM 'systemctl show kb-dashboard.service -p NRestarts'
```

Acceptance for this step: **a queue-bridge tick recorded within 60 s of `ActiveEnterTimestamp`**, and
`NRestarts` unchanged. A daemon that is armed but whose bridge never ticks is the failure this
assertion exists to catch — it looks healthy and does no work.

### 5.2 Ops write-back proof — drain the outbox

The first armed boot and Daniel's first audited action produced coordination commits in
`/var/lib/kb/ops`, which the outbox spooled. The **pre-existing Gate-1 bundle**
`a0e6777b9f503b29546986798f16ccfb0a227c04` was reconciled pre-window (§0), so what is in `ready/`
here is fresh — and this drain is the first end-to-end exercise of the write-back path.

Under the ruled co-writer model (end-state D-9) the promoter **rebases pending bundles onto the
current `origin/ops`**, so a desktop push between the spool and the drain is no longer fatal. That
tolerance is a precondition of the window, not something to discover here.

**[AGENT]** See what is spooled.

```powershell
ssh $VM 'ls -la /var/lib/kb/state/outbox/ready /var/lib/kb/state/outbox/receipts /var/lib/kb/state/outbox/incoming'
```

**[HUMAN — Daniel]** Drain it from the desktop — the only machine with a GitHub credential.

```powershell
$TrustedOpsHead = git -C $OpsWorktree rev-parse origin/ops
python scripts/promote_vm_outbox.py `
  --spool     (Join-Path $CutoverRoot 'outbox-snapshots') `
  --repo      $LocalRepo `
  --work-root (Join-Path $CutoverRoot 'outbox-work') `
  --vm-host   $VM `
  --trusted-ops-head $TrustedOpsHead
```

The Gate-1 bundle was VERIFIED ledger-only (a single `ledgers/audit/dashboard-audit.ndjson` delta) —
but the bundles spooled *here* are new, and an acceptance run that touches `queue/` will produce
instruction-shaped ones. If it does, the tool writes an instruction-approval request and refuses
until Daniel ssh-signs it as principal `kb-ops-approver` under namespace `kb-ops-instructions`;
re-run with `--approval`, `--approval-signature` and `--approval-allowed-signers`. Read the tool's
own output for the exact file paths it wants. That signature is Daniel's, at the keyboard — a
cadence never holds it (end-state D-1).

**[AGENT]** Prove the commits reached **GitHub**, and that receipts + reconciliation returned.

```powershell
git -C $OpsWorktree fetch origin ops
git -C $OpsWorktree log --oneline origin/ops -5
ssh $VM 'ls -la /var/lib/kb/state/outbox/ready /var/lib/kb/state/outbox/receipts'
```

Acceptance for this step: **every bundle in `ready/` has a matching receipt in `receipts/`**,
`receipts/` is non-empty, and the boot/first-action audit commits are visible on `origin/ops`. Note
the predicate: *not* "`ready/` is empty". An armed daemon spools continuously, so `ready/` refills
while you look at it; matching receipts is the honest statement of "everything spooled has been
promoted". A commit sitting only in `/var/lib/kb/ops` is **not** written back.

```powershell
ssh $VM 'cd /var/lib/kb/state/outbox && miss=0; for b in ready/*.bundle; do [ -e "$b" ] || continue; s=$(basename "$b" .bundle); [ -e "receipts/$s.json" ] || { echo "NO RECEIPT: $s"; miss=1; }; done; [ $miss -eq 0 ] && echo "every spooled bundle has a receipt"; exit $miss'
if ($LASTEXITCODE -ne 0) { throw 'A spooled bundle has no receipt. The write-back path did not complete — do not treat this acceptance item as passed.' }
```

### 5.3 Governed workflow with a human gate, no spend

**[HUMAN — Daniel]** Launch the pre-approved, non-spending, multi-stage acceptance workflow from the
dashboard. It must contain at least one human approval gate and no real-money action. Do not launch
an ordinary production workflow to test the cutover. Record the `runRef` immediately.

**[AGENT]** Watch the chain: canonical card published → queue bridge claimed it → stages appeared →
the human request entered `open`.

```powershell
ssh $VM 'sudo journalctl -u kb-dashboard.service --since "20 minutes ago" --no-pager | tail -120'
```

**[HUMAN — Daniel]** Answer the gate in the dashboard. Record the request reference, decision and
response text. Confirm the graph advances and the run reaches a terminal state.

**[AGENT]** Verify the record on the VM, then that it reached GitHub after a drain.

```powershell
$RunRef = Read-Host 'runRef from step 5.3'
if ([string]::IsNullOrWhiteSpace($RunRef)) { throw 'A runRef is required.' }
ssh $VM "sudo grep -R --line-number --fixed-strings '$RunRef' /var/lib/kb/ops/ledgers /var/lib/kb/ops/queue 2>/dev/null | head -20"
```

Then re-run the §5.2 drain and confirm the run's ledger row — `billing=subscription`, `usd=0.0` —
is on `origin/ops`.

### 5.4 Full-flow observation (W1–W7 streamed panel)

**[HUMAN — boss]** During 5.3, watch the live run graph end to end in the browser: launch → stages
materialise → attempt output streams → human gate opens → gate answered → terminal state, with the
panel updating without a manual refresh (the hub's control-plane watcher drives it from
`stateRoot/control/control-plane.json`).

`UNVERIFIED:` "W7" is referenced in the cloud-migration design only as the last of the W1–W7
streamed-panel waves, not as a named acceptance test. Treat this step as the streamed-panel
full-flow observation above, and have Daniel confirm that matches what he means by W7 before the
window closes.

### 5.5 Codex-runtime attempt — OUT OF SCOPE for this cutover

**This is not an acceptance item and must not be attempted during the window.** It cannot pass, for
three independent reasons, all VERIFIED:

- `runtimeCapabilities.runnerTrigger` is `win32`-gated on `main`
  (`dashboard/server/runtime/capabilities.ts`), so the trigger is `false` on Linux;
- the Windows mechanism was the `DASHBOARD_CODEX_RUNNER_TASK=kb-codex-runner` scheduled task, which
  has no Linux successor on `main`;
- `scripts/agent_runner.sh` exists only on `claude/cloud-migration`, and there it is driven by a
  `kb-codex-runner` **user** unit — incompatible with the certified system-unit platform, and among
  the commits the D-8 re-derivation explicitly drops.

There is no invocation design in either branch. The platform therefore ships **without a codex
runtime**, and the gap is carried as a named follow-up: **"codex-runtime invocation path for the
platform: design + merge"** (end-state D-11). Record it as OUT OF SCOPE in the cutover record — not
as DEFERRED, which would imply someone might reasonably try it here.

When that follow-up lands, its own preconditions will include `~/.codex/auth.json` present and `0600`
on the VM (Daniel's 2026-08-06 file-backed fallback ruling) and `governance/model-routing.yaml`
listing the codex tier the attempt uses.

### 5.6 Reboot — prove always-on survives unattended

**[HUMAN — Daniel]** Under the tailnet arming model there is nothing to re-arm, so this no longer
measures a human's re-arm cost. It proves the opposite property: the platform comes back **armed and
working with nobody at the keyboard** (end-state **D-2**).

**Do not touch the browser until the assertions below have run.** The whole point is that the
recovery is unattended; opening the dashboard first would mask a failure to self-start.

```powershell
$RebootAt = Get-Date
ssh $VM 'sudo systemctl reboot' ; Start-Sleep -Seconds 90
ssh $VM 'systemctl is-active kb-dashboard.service; cat /opt/kb-releases/current/VERSION; curl -sS --max-time 10 http://127.0.0.1:4317/readyz; echo; tailscale serve status'
if ($LASTEXITCODE -ne 0) { throw 'The platform did not come back on its own after reboot.' }
```

**[AGENT]** Assert armed-and-ticking, unattended, from the journal of the current boot.

```powershell
$BootIso = (ssh $VM 'systemctl show kb-dashboard.service -p ActiveEnterTimestamp --value').Trim()
"service active since: $BootIso"
ssh $VM 'sudo journalctl -u kb-dashboard.service -b --no-pager | grep -iE "queue.bridge|bridge tick|bridge poll" | head -20'
"wall clock reboot -> responsive: $([int]((Get-Date) - $RebootAt).TotalSeconds)s"
```

Required: execution armed without any human action, and a **queue-bridge tick within 60 s of
`ActiveEnterTimestamp`**. Record the reboot→responsive wall clock as an operational number (recovery
time), not as a cost of ceremony — there is no ceremony left.

Then confirm in the browser that `https://kb.tail82dd4f.ts.net` is reachable and the posture reads
armed. Also confirm `tailscale serve` came back on its own; if it did not, that is a finding, not a
footnote — and under tailnet auth it is a **total loss of operator access**, not an inconvenience.

### 5.7 Capture the cutover record

**[HUMAN — Daniel]** Into the cutover log: `$Sha` deployed; the helper diff (`helpers-diff.txt`) and
the before/after helper hashes; the captured unit (`kb-dashboard.service.captured`, §4.5); the VM ops
refresh evidence (§4.6 — `origin/ops` tip and the matching VM `HEAD`); run graph screenshot showing
all stages and terminal state; the gate reference, decision and response; the completed canonical
card and its `## Result`; the matching subscription ledger row on `origin/ops`
(`billing=subscription`, `usd=0.0`); the outbox drain evidence (bundle ids promoted, receipt ids, and
the every-bundle-has-a-receipt assertion); the reboot→responsive time and the bridge-tick-within-60 s
evidence (§5.6); codex-runtime recorded **OUT OF SCOPE** (§5.5); and the D-3/D-4/D-5 rulings as
executed.

### 5.8 Unfreeze

**[AGENT]** Only after every acceptance item above has passed or been explicitly recorded as
DEFERRED.

```powershell
'nightly-review','weekly-audit','grades-reconcile','daemon-dirs-sync' | ForEach-Object {
  Remove-Item -Force (Join-Path $OpsWorktree "queue\paused\$_") -ErrorAction SilentlyContinue
}
Get-ChildItem (Join-Path $OpsWorktree 'queue\paused') -ErrorAction SilentlyContinue
```

**[HUMAN — Daniel]** Per D-1, either schedule the outbox drain cadence now or file the card that
tracks it. Leaving the spool undrained with no owner is the failure mode this whole section exists
to prevent.

### 5.9 Final audit

**[AGENT]**

```powershell
git -C $OpsWorktree fetch --all --prune
git -C $OpsWorktree log --branches --not --remotes --oneline

# Outbox predicate: every bundle present has a matching receipt. NOT "ready/ is empty".
ssh $VM 'ls -la /var/lib/kb/state/outbox/ready /var/lib/kb/state/outbox/receipts'
ssh $VM 'cd /var/lib/kb/state/outbox && miss=0; for b in ready/*.bundle; do [ -e "$b" ] || continue; s=$(basename "$b" .bundle); [ -e "receipts/$s.json" ] || { echo "NO RECEIPT: $s"; miss=1; }; done; [ $miss -eq 0 ] && echo "every spooled bundle has a receipt"; exit $miss'
if ($LASTEXITCODE -ne 0) { throw 'A spooled bundle has no receipt at final audit. Drain again; do not close the window on an unpromoted bundle.' }
```

The git audit must be empty. The outbox audit is **not** "`ready/` is empty" — an armed daemon spools
continuously, and §5.6's reboot provably spools a fresh auth/audit bundle *after* the last drain, so
demanding an empty `ready/` would fail the window for working correctly. The honest predicate is the
receipt match above. The VM's ops checkout is deliberately unpushable, so it is never audited with
`log --branches --not --remotes`; the receipt match is its equivalent.

---

## 6. Rollback

### 6.1 Release only (code is bad, state is fine)

**[HUMAN — Daniel]**

```powershell
ssh $VM 'sudo /usr/local/lib/kb/activate_release.py rollback && cat /opt/kb-releases/current/VERSION && systemctl is-active kb-dashboard.service && curl -sS --max-time 10 http://127.0.0.1:4317/readyz; echo'
```

### 6.2 State only (import is bad, platform is fine)

**[HUMAN — Daniel]** Stop the unit, restore from the §3.1 pre-import tier-0 snapshot, restart.

```powershell
ssh $VM 'sudo systemctl stop kb-dashboard.service'
python scripts/backup_tier0.py restore --target <restore dir> --report (Join-Path $CutoverRoot 'restore-report.json')
# then place the restored state per the report and:
ssh $VM 'sudo systemctl start kb-dashboard.service && curl -sS --max-time 10 http://127.0.0.1:4317/readyz; echo'
```

### 6.3 Full rollback to the desktop (within the two-week window)

**[HUMAN — Daniel]** Order matters. **Never run both daemons against one control plane.**

```powershell
# 1. Stop the platform FIRST, so it cannot spool anything after the final drain.
#    (It is armed at boot; a running daemon keeps producing coordination commits.)
ssh $VM 'sudo systemctl stop kb-dashboard.service; systemctl is-active kb-dashboard.service || true'

# 2. Drain — otherwise VM-side coordination is stranded forever.
python scripts/promote_vm_outbox.py --spool (Join-Path $CutoverRoot 'outbox-snapshots') --repo $LocalRepo `
  --work-root (Join-Path $CutoverRoot 'outbox-work') --vm-host $VM `
  --trusted-ops-head (git -C $OpsWorktree rev-parse origin/ops)
ssh $VM 'cd /var/lib/kb/state/outbox && miss=0; for b in ready/*.bundle; do [ -e "$b" ] || continue; s=$(basename "$b" .bundle); [ -e "receipts/$s.json" ] || { echo "NO RECEIPT: $s"; miss=1; }; done; exit $miss'
if ($LASTEXITCODE -ne 0) { throw 'Undrained bundles remain. Do not roll back yet — this state is lost once the desktop takes over.' }

# 3. Bring the desktop's ops checkout up to date with everything the VM produced.
git -C $OpsWorktree pull --rebase origin ops

# 4. Copy the VM control state back over the desktop state root.
#    Build the tar ON THE VM and fetch it with scp. Never pipe `ssh … tar -cf -` into a PowerShell
#    redirect: `>` is Out-File in PS 5.1, which re-encodes the byte stream as text (and adds a BOM),
#    corrupting the archive.
ssh $VM 'sudo tar -C /var/lib/kb/state -cf /var/tmp/vm-state-return.tar control composer workflows naming.json && sudo chown kb: /var/tmp/vm-state-return.tar'
if ($LASTEXITCODE -ne 0) { throw 'Could not build the state return archive on the VM.' }
scp "${VM}:/var/tmp/vm-state-return.tar" (Join-Path $CutoverRoot 'vm-state-return.tar')
if ($LASTEXITCODE -ne 0) { throw 'Could not retrieve the state return archive.' }
ssh $VM 'rm -f /var/tmp/vm-state-return.tar'
# expand into %LOCALAPPDATA%\kb-dashboard, reviewing each path — do NOT recreate worktrees/ or integration/

# 5. Restart the desktop daemon from the preserved rollback image.
Set-Location (Join-Path $ProdWorktree 'dashboard')
pm2 start pm2.config.cjs --only kb-dashboard
pm2 status kb-dashboard
Set-Location $LocalRepo
```

Preserved for exactly this: `C:\Users\danie\kb-worktrees\dashboard-prod`, its branch
`claude/dashboard-prod-pin`, and the untouched original `%LOCALAPPDATA%\kb-dashboard\**`. Do not
sweep the worktree, do not advance the pin branch, and do not delete the desktop state until the
window closes.

### 6.4 Known failure: outbox `DirtyIndexError` / non-quiescent boot

Symptom: `/readyz` reports `quiescent:false`, deploys refuse, the ops checkout shows
`MM ledgers/audit/dashboard-audit.ndjsonl`. Cause: a restart interrupted a staged-but-uncommitted
audit write; recovery fail-closes rather than guessing.

```powershell
ssh $VM 'sudo systemctl stop kb-dashboard.service'
ssh $VM 'sudo -u kb-dashboard git -c safe.directory=/var/lib/kb/ops -C /var/lib/kb/ops reset'
ssh $VM 'sudo systemctl start kb-dashboard.service && curl -sS --max-time 10 http://127.0.0.1:4317/readyz; echo'
```

Stop the service **first** — resetting while the daemon is live races its re-staging.

### 6.5 Post-cutover decommission (day 14, not during the window)

**[HUMAN — Daniel]** Only after the rollback window closes and the platform has carried real work:

```powershell
ssh $VM 'systemctl --user is-active kb-dashboard.service; systemctl --user disable --now kb-dashboard.service kb-codex-runner.service 2>/dev/null || true'
ssh $VM 'rm -f ~/.config/systemd/user/kb-dashboard.service ~/.config/systemd/user/kb-codex-runner.service; systemctl --user daemon-reload'
ssh $VM 'rm -rf ~/kb ~/kb-dashboard-ops ~/kb-mirror.git ~/.config/kb /var/tmp/gate1-run.sh'
```

Then on the desktop: `pm2 delete kb-dashboard; pm2 save`, advance `claude/dashboard-prod-pin` to
`main`, remove the `dashboard-prod` worktree, and run the standard session-close sweep
(`git fetch --prune`, delete 0-unmerged local branches, `git worktree prune`). Keep exempt:
`dashboard-ops`, `boss-2026-08-11c`, and everything under
`%LOCALAPPDATA%\kb-dashboard\control\` that the control plane's reconciler owns.
