# Wave 3 — quiescent cutover to the VM

**Operators:** Daniel and the boss, together at the keyboard. This is a scheduled,
single quiescent window. Do not reorder these sections: **drain → push-all → copy
state → recreate on VM → acceptance**. Do not copy any Git worktree metadata.

All PowerShell commands below run on Daniel's desktop unless marked `VM shell`.
Set these values once in the same elevated, watched PowerShell session. `VM_HOST` is
the already verified Tailscale DNS name or `100.x` address of the VM; it is not a
public address.

```powershell
$LocalRepo = 'C:\Users\danie\kb'
$OpsWorktree = 'C:\Users\danie\kb-worktrees\dashboard-ops'
$WorktreeRoot = 'C:\Users\danie\kb-worktrees'
$LocalDashboardState = Join-Path $env:LOCALAPPDATA 'kb-dashboard'
$LocalDispatchState = Join-Path $env:LOCALAPPDATA 'kb-codex-dispatch'
$VM_HOST = Read-Host 'Enter the VM Tailscale DNS name or 100.x address'
$VM_HOST = $VM_HOST.Trim()
if ([string]::IsNullOrWhiteSpace($VM_HOST)) { throw 'A VM Tailscale address is required.' }
$VM = "kb@$VM_HOST"
$CutoverBranch = 'claude/cloud-migration'
Set-Location $LocalRepo
```

Every later command uses `$VM`. The secret itself is never placed in this runbook,
a command history, Git, a chat, or copied by an agent.

## 1. Drain

1. **[HUMAN — boss]** Announce the cutover window and stop filing, launching, or
   approving new work. Keep the desktop dashboard open only for inspection.

2. **[AGENT]** Read the local control plane and list every run that is not terminal.
   This is a read-only check; it must return no rows before proceeding.

   ```powershell
   $ControlPlane = Join-Path $LocalDashboardState 'control\control-plane.json'
   $Control = Get-Content -Raw $ControlPlane | ConvertFrom-Json
   $TerminalStates = 'succeeded','failed','stopped','interrupted','archived'
   $LiveRuns = @($Control.runs | Where-Object { $_.state -notin $TerminalStates })
   $LiveRuns | Select-Object runRef,state,title
   if ($LiveRuns.Count -ne 0) { throw 'Live control-plane runs remain: finish or park each run in Dashboard before cutover.' }
   ```

3. **[HUMAN — Daniel]** For each row reported in step 2, use its Dashboard RunDetail
   control to finish it or use **Stop** to park it. Re-run step 2 until it reports no
   live rows. A parked/interrupted record is expected to remain in the copied state.

4. **[AGENT]** Check the Codex dispatcher’s pending markers. An empty directory is
   the only passing result.

   ```powershell
   $Pending = Join-Path $LocalDispatchState 'pending'
   $PendingDispatches = @(Get-ChildItem -Force $Pending -Filter *.json -ErrorAction SilentlyContinue)
   $PendingDispatches | Select-Object Name,LastWriteTime,Length
   if ($PendingDispatches.Count -ne 0) { throw 'Codex dispatches remain pending: wait for completion or have Daniel stop them.' }
   ```

5. **[HUMAN — Daniel]** Wait for each pending Codex dispatch to complete, or stop it
   through the watched dispatcher/worker session, then repeat step 4. Do not delete
   pending marker files to make this check pass.

6. **[HUMAN — Daniel]** Stop the old local dashboard from the old local code. This
   is a stop, not a Phase-4 removal, so rollback remains possible.

   ```powershell
   Set-Location (Join-Path $LocalRepo 'dashboard')
   pm2 stop kb-dashboard
   pm2 status kb-dashboard
   if ((pm2 jlist | ConvertFrom-Json | Where-Object name -eq 'kb-dashboard').pm2_env.status -ne 'stopped') { throw 'Local kb-dashboard did not stop.' }
   Set-Location $LocalRepo
   ```

7. **[AGENT]** Verify that the fleet is not frozen. A `STOP` file is a stop signal,
   not permission to continue; it must be absent.

   ```powershell
   if (Test-Path (Join-Path $LocalRepo 'STOP')) { throw 'STOP file present; resolve the freeze before cutover.' }
   ```

8. **[HUMAN — boss]** Declare the desktop side quiescent only after steps 2, 4, 6,
   and 7 pass. From this point until acceptance, no local dashboard or dispatcher is
   started.

## 2. Push all local work

This sweep covers the main checkout, the canonical `dashboard-ops` checkout, and
every immediate checkout under `C:\Users\danie\kb-worktrees`. It captures dirty and
untracked work individually, pushes every local branch, and then proves that no
local branch is ahead of any remote. It deliberately does not copy `.git/worktrees`:
that metadata is host-specific.

1. **[AGENT]** Build the explicit checkout list and display it for Daniel.

   ```powershell
   $Checkouts = @($LocalRepo, $OpsWorktree) + @(
     Get-ChildItem -Directory $WorktreeRoot |
       Where-Object { Test-Path (Join-Path $_.FullName '.git') } |
       Select-Object -ExpandProperty FullName
   ) | Select-Object -Unique
   $Checkouts
   ```

2. **[HUMAN — Daniel]** In each displayed checkout, inspect, capture, and push its
   own changes. Run this loop exactly once; review the displayed diff before the
   commit. Do not add any credential file. A credential file found in `status` is a
   stop condition: remove it from the checkout without revealing its contents, then
   repeat the inspection.

   ```powershell
   foreach ($Checkout in $Checkouts) {
     Write-Host "--- $Checkout ---"
     git -C $Checkout status --short
     git -C $Checkout diff --stat
     if (git -C $Checkout status --porcelain) {
       git -C $Checkout add -A
       git -C $Checkout commit -m 'cutover: capture local worktree state'
     }
     git -C $Checkout fetch --all --prune
     git -C $Checkout push --all origin
     git -C $Checkout push --tags origin
     git -C $Checkout log --branches --not --remotes --oneline
     if (git -C $Checkout log --branches --not --remotes --oneline) { throw "Unpushed refs remain in $Checkout" }
   }
   ```

3. **[AGENT]** Run the same unpushed-reference audit against all three checkout
   classes after the loop. It must produce no output for every checkout.

   ```powershell
   foreach ($Checkout in $Checkouts) {
     Write-Host "--- audit $Checkout ---"
     git -C $Checkout log --branches --not --remotes --oneline
   }
   ```

4. **[HUMAN — boss]** If any audit line appears, identify its checkout, push that
   branch, and restart this section. Do not begin the state copy with an unpushed ref.

## 3. Copy state while both daemons are stopped

1. **[HUMAN — Daniel]** Stop the VM units before the copy. This command must report
   both units inactive; it is safe if the optional runner unit was never started.

   ```powershell
   ssh $VM 'systemctl --user stop kb-dashboard.service kb-codex-runner.service; ! systemctl --user is-active --quiet kb-dashboard.service; ! systemctl --user is-active --quiet kb-codex-runner.service'
   ```

2. **[HUMAN — Daniel]** Create only the destination state directories, with private
   permissions, over Tailscale SSH.

   ```powershell
   ssh $VM 'install -d -m 700 ~/.local/state/kb-dashboard/control ~/.local/state/kb-dashboard/composer ~/.local/state/kb-codex-dispatch/logs ~/.local/state/kb-cutover ~/.config/kb'
   ```

3. **[AGENT]** Verify the four local state artifacts to be copied. This is
   read-only and gives paths only, never file contents.

   ```powershell
   $ControlPlane = Join-Path $LocalDashboardState 'control\control-plane.json'
   $ComposerWorkspaces = Join-Path $LocalDashboardState 'composer\workspaces.json'
   $Threads = Join-Path $LocalDispatchState 'threads.json'
   $DispatchLogs = Join-Path $LocalDispatchState 'logs'
   $Required = @($ControlPlane, $ComposerWorkspaces, $Threads, $DispatchLogs, (Join-Path $LocalRepo 'ledgers'))
   $Required | ForEach-Object { if (-not (Test-Path $_)) { throw "Required cutover artifact is absent: $_" } else { Get-Item $_ | Select-Object FullName,Length,LastWriteTime } }
   ```

4. **[HUMAN — Daniel]** Transfer the post-drain state over the Tailscale SSH route.
   The first form uses Windows OpenSSH `scp`; the second is the equivalent `rsync`
   shape when invoked from a Linux shell that can see the same source paths. Do not
   transfer `pending/`, worktree directories, or `.git/worktrees` metadata.

   ```powershell
   scp $ControlPlane "${VM}:~/.local/state/kb-dashboard/control/control-plane.json"
   scp -r (Join-Path $LocalRepo 'ledgers') "${VM}:~/.local/state/kb-cutover/"
   scp -r $DispatchLogs "${VM}:~/.local/state/kb-codex-dispatch/"
   scp $Threads "${VM}:~/.local/state/kb-codex-dispatch/threads.json"
   scp $ComposerWorkspaces "${VM}:~/.local/state/kb-dashboard/composer/workspaces.json"
   ```

   ```sh
   rsync -a --protect-args /mnt/c/Users/danie/AppData/Local/kb-dashboard/control/control-plane.json kb@"$VM_HOST":~/.local/state/kb-dashboard/control/
   rsync -a --protect-args /mnt/c/Users/danie/kb/ledgers/ kb@"$VM_HOST":~/.local/state/kb-cutover/ledgers/
   rsync -a --protect-args /mnt/c/Users/danie/AppData/Local/kb-codex-dispatch/logs/ kb@"$VM_HOST":~/.local/state/kb-codex-dispatch/logs/
   rsync -a --protect-args /mnt/c/Users/danie/AppData/Local/kb-codex-dispatch/threads.json kb@"$VM_HOST":~/.local/state/kb-codex-dispatch/
   rsync -a --protect-args /mnt/c/Users/danie/AppData/Local/kb-dashboard/composer/workspaces.json kb@"$VM_HOST":~/.local/state/kb-dashboard/composer/
   ```

5. **[HUMAN — Daniel]** Before the VM dashboard is started, provision the **same
   existing** `DASHBOARD_SESSION_SECRET` in the VM’s private environment file. Daniel
   enters it directly in the remote editor; neither the boss nor an agent sees,
   copies, or logs it. Retain the already-provisioned Claude OAuth entry and the VM
   path settings; set `DASHBOARD_REPO_ROOT=/home/kb-dashboard-ops` and
   `DASHBOARD_DURABLE_REPO_ROOT=/home/kb` in that same `0600` file.

   ```powershell
   ssh -t $VM 'umask 077; install -d -m 700 ~/.config/kb; touch ~/.config/kb/env; chmod 600 ~/.config/kb/env; read -r -s -p "DASHBOARD_SESSION_SECRET: " secret; printf "\n"; sed -i "/^DASHBOARD_SESSION_SECRET=/d;/^DASHBOARD_REPO_ROOT=/d;/^DASHBOARD_DURABLE_REPO_ROOT=/d" ~/.config/kb/env; printf "DASHBOARD_SESSION_SECRET=%s\nDASHBOARD_REPO_ROOT=/home/kb-dashboard-ops\nDASHBOARD_DURABLE_REPO_ROOT=/home/kb\n" "$secret" >> ~/.config/kb/env; unset secret; chmod 600 ~/.config/kb/env'
   ```

   The workspace JSON must not be used with a different secret. If Daniel cannot
   provide the existing exact secret, stop the cutover before starting the VM.

6. **[AGENT]** Verify file presence and modes on the VM without reading secret
   values or state contents.

   ```powershell
   ssh $VM 'test -f ~/.local/state/kb-dashboard/control/control-plane.json; test -f ~/.local/state/kb-dashboard/composer/workspaces.json; test -f ~/.local/state/kb-codex-dispatch/threads.json; test -d ~/.local/state/kb-codex-dispatch/logs; test -d ~/.local/state/kb-cutover/ledgers; test "$(stat -c %a ~/.config/kb/env)" = 600'
   ```

## 4. Recreate checkouts and services on the VM

1. **[HUMAN — Daniel]** Get the already-pushed origin URL from the main local checkout
   and fresh-clone the exact cutover branch on the VM. The clone is new; do not copy
   a desktop checkout or any Git administration directory.

   ```powershell
   $Origin = git -C $LocalRepo remote get-url origin
   ssh $VM "test ! -e ~/kb && test ! -e ~/kb-dashboard-ops && git clone --branch $CutoverBranch --origin origin '$Origin' ~/kb && cd ~/kb && git fetch origin --prune && git worktree add --track -b ops ~/kb-dashboard-ops origin/ops"
   ```

2. **[HUMAN — Daniel]** Restore the copied ledger directory into the fresh clone if
   the clone step replaced its destination. This does not create a new worktree.

   ```powershell
   ssh $VM 'rsync -a ~/.local/state/kb-cutover/ledgers/ ~/kb/ledgers/'
   ```

3. **[HUMAN — Daniel]** Build the dashboard and enable the user unit exactly as the
   landed `deploy/systemd/README.md` specifies.

   ```powershell
   ssh $VM 'cd ~/kb/dashboard && npm ci && npm run build && mkdir -p ~/.config/systemd/user && install -m 644 ~/kb/deploy/systemd/kb-dashboard.service ~/.config/systemd/user/ && install -m 644 ~/kb/deploy/systemd/kb-codex-runner.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now kb-dashboard.service && systemctl --user status kb-dashboard.service --no-pager'
   ```

   The unit uses `/usr/bin/env node` with a PATH beginning at `%h/.local/share/fnm/aliases/default/bin`; during cutover, confirm it resolves the intended fnm-managed node rather than `/usr/bin/node`.

4. **[AGENT]** Confirm the VM's `kb` user is lingering and the service owns the
   loopback listener before any browser acceptance.

   ```powershell
   ssh $VM 'test "$(loginctl show-user kb -p Linger --value)" = yes; systemctl --user is-active --quiet kb-dashboard.service; ss -ltn | grep -Eq "(:|])5317$"'
   ```

5. **[HUMAN — Daniel]** Leave all control-plane managed worktrees absent. They are
   derived state; the reconciler rebuilds them when it resumes. Never reproduce the
   desktop `.git/worktrees` directory on the VM.

## 5. Acceptance from the desktop browser

1. **[HUMAN — Daniel]** Start the desktop-only tunnel in a watched PowerShell window
   and keep it running for the acceptance.

   ```powershell
   ssh.exe -N -L localhost:5317:127.0.0.1:5317 $VM
   ```

2. **[HUMAN — boss]** Open `http://localhost:5317`, authenticate with the existing
   passkey, and confirm the displayed origin remains `localhost:5317`. The page must
   be served by the VM through the tunnel, not by a local PM2 process.

3. **[HUMAN — boss]** Launch the pre-approved, non-spending, multi-stage cutover
   acceptance workflow from Dashboard. The workflow must include one human approval
   gate and no real-money action. Record the newly displayed `runRef` immediately.
   Do not launch an ordinary production workflow merely to test cutover.

4. **[AGENT]** Watch the VM dashboard journal and the RunDetail graph for the exact
   sequence: canonical card published, queue bridge claimed it, multiple stages
   appeared, and the human request entered `open`.

   ```powershell
   ssh $VM 'journalctl --user -u kb-dashboard.service -n 200 --no-pager'
   ```

5. **[HUMAN — boss]** In the desktop browser’s RunDetail/Approvals view, inspect the
   open request and answer its approval gate. Record the request reference, the
   decision, and the response text used. Confirm the graph advances after the answer
   and the run reaches its terminal completion state.

6. **[AGENT]** Verify the run and evidence on the VM. The agent receives the recorded
   `$RunRef` from the boss only; this command reads status and never receives a
   browser bearer token.

   ```powershell
   $RunRef = Read-Host 'Enter the runRef recorded in step 3'
   if ([string]::IsNullOrWhiteSpace($RunRef)) { throw 'A runRef is required.' }
   ssh $VM 'journalctl --user -u kb-dashboard.service --since "30 minutes ago" --no-pager'
   ssh $VM "grep -R --line-number --fixed-strings '$RunRef' ~/kb/ledgers ~/.local/state/kb-dashboard/control 2>/dev/null"
   ```

7. **[HUMAN — Daniel]** Capture the acceptance evidence in the cutover record:
   `runRef`; a RunDetail graph screenshot showing all stages and terminal state; the
   gate request reference, decision, and response; the completed canonical card and
   its `## Result`; and the matching subscription ledger row on `ops` (including
   `billing=subscription` and `usd=0.0`). Push the resulting coordination evidence
   on `ops`, then perform the final unpushed-refs audit from section 2 on both the
   desktop and VM clones.

   ```powershell
   git -C $OpsWorktree fetch --all --prune
   git -C $OpsWorktree log --branches --not --remotes --oneline
   ssh $VM 'cd ~/kb && git fetch --all --prune && git log --branches --not --remotes --oneline; cd ~/kb-dashboard-ops && git fetch --all --prune && git log --branches --not --remotes --oneline'
   ```

The acceptance is complete only when the full governed path ran on the VM, the
desktop observed it at `http://localhost:5317`, the gate was answered, the ledger
row is present on `ops`, and every final audit prints no unpushed refs.

## Rollback

**[HUMAN — Daniel]** Within the two-week inert-local rollback window, stop VM units,
then restore the local state only through the same drained, quiescent copy sequence
in reverse before restarting the old local PM2 daemon. Do not run both daemons
against one copied control plane.

```powershell
ssh $VM 'systemctl --user stop kb-dashboard.service kb-codex-runner.service'
# Re-run section 3 in reverse direction for control-plane.json, ledgers/, dispatcher
# logs + threads.json, and composer/workspaces.json only after both sides are stopped
# and Daniel has confirmed the same DASHBOARD_SESSION_SECRET.
Set-Location (Join-Path $LocalRepo 'dashboard')
pm2 start pm2.config.cjs --only kb-dashboard
pm2 status kb-dashboard
```
