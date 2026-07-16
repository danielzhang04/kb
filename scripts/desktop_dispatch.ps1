# desktop_dispatch.ps1 — pinned-interpreter wrapper for the desktop dispatch fallback.
#
# Owns the Task Scheduler task `kb-desktop-dispatcher`. Fixes the silent no-op: on this box
# bare `python` resolves to a pip-less msys build (C:\msys64\ucrt64\bin\python.exe) with no
# PyYAML, so the preamble crashed (exit 1), the guarded dispatch was skipped, yet the task
# still reported success (LastTaskResult=0). This script resolves the REAL py-launcher
# interpreter ONCE and drives the whole flow through it, propagating failures loudly.

$ErrorActionPreference = 'Continue'
$RepoRoot = 'C:\Users\danie\kb'
$LogFile  = Join-Path $env:LOCALAPPDATA 'kb-desktop-dispatch.log'

function Write-DispatchLog([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'), $msg
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

# Resolve the pinned interpreter ONCE — never bare `python`.
$py = $null
try { $py = (py -c "import sys; print(sys.executable)") } catch { $py = $null }
if (-not $py -or -not (Test-Path $py)) { $py = 'py' }

Set-Location $RepoRoot
git checkout ops
git pull --rebase origin ops

# Preamble decides the flow. Capture stdout for log evidence; keep its exit code.
$preOut = (& $py scripts/preamble.py 2>&1 | Out-String).Trim()
$pre = $LASTEXITCODE

if ($pre -eq 2) {
    Write-DispatchLog ("exit-path=clean-stop preamble=2 (STOP/budget) interpreter=$py :: " + $preOut)
    exit 0
}
elseif ($pre -eq 0) {
    $dispOut = (& $py scripts/dispatch.py --tier desktop --agent dispatcher-desktop 2>&1 | Out-String).Trim()
    $disp = $LASTEXITCODE
    if ($disp -ne 0) {
        Write-DispatchLog ("exit-path=dispatch-fail preamble=OK dispatch-exit=$disp interpreter=$py :: " + $dispOut)
        exit $disp
    }
    $dispatchedLine = ($dispOut -split "`r?`n" | Where-Object { $_ -match 'dispatched' } | Select-Object -First 1)
    $changed = git status --porcelain queue ledgers
    if ($changed) {
        git add queue ledgers
        git commit -m "chore: desktop dispatch"
        git push origin ops
        $push = $LASTEXITCODE
        if ($push -ne 0) {
            Write-DispatchLog ("exit-path=push-fail preamble=OK dispatch='$dispatchedLine' push-exit=$push interpreter=$py")
            exit $push
        }
        Write-DispatchLog ("exit-path=dispatched+pushed preamble=OK dispatch='$dispatchedLine' interpreter=$py")
    }
    else {
        Write-DispatchLog ("exit-path=dispatched-nochange preamble=OK dispatch='$dispatchedLine' interpreter=$py")
    }
    exit 0
}
else {
    Write-DispatchLog ("exit-path=preamble-crash preamble-exit=$pre (LOUD) interpreter=$py :: " + $preOut)
    exit 1
}
