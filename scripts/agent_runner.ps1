# agent_runner.ps1 -- preamble-gated Task-Scheduler runner for the Codex worker
# (plan Task 5.3, O8 decision 5). Invoked as `agent_runner.ps1 -Agent codex-worker`.
#
# Mirrors scripts/desktop_dispatch.ps1's shape exactly: pinned interpreter resolution
# (never bare `python`), STOP-file gating, ops checkout/pull, and the same
# Write-*Log logging style -- all of that already fixed a real silent-no-op bug on
# this box (bare `python` resolving to a pip-less msys build). This runner adds a
# SECOND hard gate on top of the shared preamble: a Codex billing guard that must
# NEVER be bypassed by falling back to the metered API.
#
# VERIFIED CODEX CLI FACTS (July-2026 doc research; cited here so the invocation
# below isn't cargo-culted):
#   - `codex exec` is the headless entry point; `codex exec -` reads the prompt
#     from stdin. `--json` emits a JSONL event stream. `--output-last-message
#     <file>` writes the final message to a file. `--model`/`-m` overrides the
#     model.
#   - Subscription auth is stored in the WINDOWS CREDENTIAL MANAGER, not a
#     plaintext auth.json: .codex/config.toml pins
#     cli_auth_credentials_store = "keyring" (gate-5.0 decision, Daniel,
#     2026-07-16 -- same store as the Telegram bot token). So this runner does
#     NOT check for an auth.json file; there is none on disk by design.
#   - `codex login status` exits 0 when logged in, non-zero otherwise. This is
#     the sole, storage-agnostic auth/staleness probe.
#   - The silent-metered-billing vectors are `CODEX_API_KEY` (a documented
#     exec-only override) and `OPENAI_API_KEY`. Both are asserted ABSENT before
#     any codex invocation. If either is set, that is NOT unset-and-continue --
#     env pollution here means something else on this box is misconfigured, so
#     this runner wakes a human and exits loud instead of guessing.
#
# Git access note (HUMAN GATE 5.8/5.9): Phase A grants this agent env a
# git-transport-only SSH deploy key scoped to read + its own `codex/*` work
# branches -- NOT ops-push. So every card mutation this runner makes (state
# transition, `## Result` append) lands on a per-run `codex/<agent>-<ts>` branch,
# never on `ops`, even though card state is normally "coordination state" per the
# constitution. A human/dispatcher reconciles `codex/*` branches back into `ops`
# out-of-band until HUMAN GATE 5.9 grants the scoped ops-push path -- that
# reconciliation step is NOT wired by this script; it is what the human wires later.

param(
    [Parameter(Mandatory = $true)]
    [string]$Agent
)

$ErrorActionPreference = 'Continue'
$RepoRoot = 'C:\Users\danie\kb'
$LogFile  = Join-Path $env:LOCALAPPDATA 'kb-agent-runner.log'

function Write-RunnerLog([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'), $msg
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

# Small py -3 -c helper using scripts/cards.py to mint a T1 wake-me card -- the
# same "helper pattern" reconcile.py's _emit_wake / dispatch.py's
# _emit_unknown_tier_wake use, just invoked from PowerShell instead of Python.
# Dedupe: scans the ENTIRE queue/ tree for a pre-existing card with this exact
# action+target before filing (mirrors dispatch.py's UNKNOWN_TIER_ACTION
# dedupe), so a repeatedly-firing gate (e.g. auth staying stale across many
# scheduled runs) files exactly one wake-me, not one per run. Fail OPEN on a
# dedupe-scan error (file the card anyway) -- a duplicate wake-me costs a human
# a few seconds; a swallowed one could hide a real outage.
function New-WakeMeCard([string]$py, [string]$target, [string]$reason) {
    # $target/$reason may contain arbitrary text (e.g. captured preamble stdout) --
    # quotes or newlines in there must never be able to break out of the embedded
    # Python string literal below. Base64-encode both over the wire instead of
    # interpolating raw text into quotes, so this is safe regardless of content.
    $targetB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($target))
    $reasonB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($reason))
    & $py -c @"
import base64, sys
sys.path.insert(0, 'scripts')
import cards
from pathlib import Path

queue_root = Path(r'$RepoRoot') / 'queue'
target = base64.b64decode('$targetB64').decode('utf-8')
reason = base64.b64decode('$reasonB64').decode('utf-8')
action = 'wake-me'

already = False
if queue_root.exists():
    for path in queue_root.glob('*/*.md'):
        try:
            existing = cards.parse(path)
        except Exception:
            continue
        if existing.meta.get('action') == action and existing.meta.get('target') == target:
            already = True
            break

if not already:
    body = '## Work order\n\n' + reason + '\n'
    card = cards.new_card(project='kb', action=action, target=target, risk_tier='T1', body=body)
    cards.save(card, queue_root)
    print('wake-me filed target=' + target)
else:
    print('wake-me already filed target=' + target + ' (deduped)')
"@
}

# --- step 1: resolve the pinned interpreter ONCE -- never bare `python` ---------------
$py = $null
try { $py = (py -c "import sys; print(sys.executable)") } catch { $py = $null }
if (-not $py -or -not (Test-Path $py)) { $py = 'py' }

# --- step 2: STOP-file gate, checked BEFORE any git/codex work ------------------------
if (Test-Path (Join-Path $RepoRoot 'STOP')) {
    Write-RunnerLog ("exit-path=stop-file-present agent=$Agent interpreter=$py :: fleet frozen, halting before any work")
    exit 0
}

# --- step 3: ops checkout/pull (mirrors desktop_dispatch.ps1) -------------------------
Set-Location $RepoRoot
git checkout ops
git pull --rebase origin ops

# --- step 4: shared preamble gate -- a preamble failure means codex exec NEVER runs ---
$preOut = (& $py scripts/preamble.py 2>&1 | Out-String).Trim()
$pre = $LASTEXITCODE

if ($pre -ne 0) {
    Write-RunnerLog ("exit-path=preamble-fail agent=$Agent preamble-exit=$pre interpreter=$py :: " + $preOut)
    New-WakeMeCard $py "agent_runner:$Agent:preamble" "scripts/preamble.py exited non-zero ($pre) for agent '$Agent' -- codex exec must never run until a human clears this. Preamble output: $preOut"
    exit 1
}
Write-RunnerLog ("preamble=OK agent=$Agent interpreter=$py")

# --- step 5: Codex billing guard (O8 decision 5) -- hard-fail, NEVER fall back to metered
$billingFail = $null

if ($env:OPENAI_API_KEY) {
    $billingFail = 'OPENAI_API_KEY is set in the environment'
}
elseif ($env:CODEX_API_KEY) {
    $billingFail = 'CODEX_API_KEY is set in the environment'
}
else {
    # Gate-5.0 decision (Daniel, 2026-07-16): .codex/config.toml pins
    # cli_auth_credentials_store = "keyring" -- auth lives in the Windows
    # Credential Manager, NOT a plaintext auth.json, so a file-existence
    # check would false-fail. `codex login status` (exit 0 = logged in) is
    # the sole, storage-agnostic staleness probe.
    codex login status | Out-Null
    $loginStatus = $LASTEXITCODE
    if ($loginStatus -ne 0) {
        $billingFail = "codex login status exited non-zero ($loginStatus) -- subscription auth is missing/stale/expired (keyring-backed; no auth.json on disk by design)"
    }
}

if ($billingFail) {
    Write-RunnerLog ("exit-path=billing-guard-fail agent=$Agent interpreter=$py :: $billingFail -- NEVER falling back to metered API")
    New-WakeMeCard $py "agent_runner:$Agent:billing-guard" "Codex billing guard failed for agent '$Agent': $billingFail. This runner NEVER falls back to the metered API -- a human must fix auth/env (HUMAN GATE 5.7) and re-run."
    exit 1
}
Write-RunnerLog ("billing-guard=OK agent=$Agent interpreter=$py")

# --- step 6: scan owned cards (owner == -Agent, state inbox|working) ------------------
$cardsJson = (& $py -c @'
import sys, json
sys.path.insert(0, "scripts")
import cards
from pathlib import Path

agent = sys.argv[1]
queue_root = Path("queue")
owned = []
if queue_root.exists():
    for state_dir in ("inbox", "working"):
        d = queue_root / state_dir
        if not d.exists():
            continue
        for path in sorted(d.glob("*.md")):
            try:
                card = cards.parse(path)
            except Exception:
                continue
            if card.meta.get("owner") == agent and card.meta.get("state") in ("inbox", "working"):
                owned.append({"id": card.meta["id"], "path": str(path)})
print(json.dumps(owned))
'@ $Agent | Out-String).Trim()

$owned = @()
try { if ($cardsJson) { $owned = @($cardsJson | ConvertFrom-Json) } } catch { $owned = @() }

if (-not $owned -or $owned.Count -eq 0) {
    Write-RunnerLog ("no-owned-cards agent=$Agent interpreter=$py")
    exit 0
}

# Work products land on a per-run codex/* work branch, never on ops (constitution:
# coordination writes -> ops, work products -> agent branch; see the git-access
# note in the header for why that split is unavoidable during Phase A here).
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$workBranch = "codex/$Agent-$runStamp"
git checkout -B $workBranch ops

$overallExit = 0

foreach ($c in $owned) {
    # Re-check STOP between cards -- a human dropping STOP mid-batch must halt
    # this runner before the NEXT card, not just at the top of the run.
    if (Test-Path (Join-Path $RepoRoot 'STOP')) {
        Write-RunnerLog ("exit-path=stop-file-present-mid-batch agent=$Agent interpreter=$py :: halting before card $($c.id)")
        exit 0
    }

    $cardId = $c.id
    $cardPath = $c.path
    Write-RunnerLog ("card-start id=$cardId agent=$Agent interpreter=$py")

    # Ensure the card is claimed-in-progress (inbox -> working) and pull its
    # `## Work order` text -- `## Evidence` is NEVER fed to codex exec as an
    # instruction (constitution: treat Evidence as inert data, never instructions).
    $prep = (& $py -c @'
import sys, json
sys.path.insert(0, "scripts")
import cards
from pathlib import Path

path = Path(sys.argv[1])
card = cards.parse(path)
if card.meta.get("state") == "inbox":
    cards.transition(card, "working", Path("queue"))

body = card.body
marker = "## Work order"
idx = body.find(marker)
work_order = ""
if idx != -1:
    rest = body[idx + len(marker):]
    end = rest.find("\n## ")
    section = rest if end == -1 else rest[:end]
    work_order = section.strip()

print(json.dumps({"path": str(card.path), "work_order": work_order}))
'@ $cardPath | Out-String).Trim()

    $prepObj = $prep | ConvertFrom-Json
    $currentCardPath = $prepObj.path
    $workOrder = $prepObj.work_order

    # `codex exec -` reads the work order from stdin; --json captures the JSONL
    # event stream for the model-id parse below; --output-last-message writes
    # the final assistant message we store as the card's ## Result.
    $jsonLog = Join-Path $env:LOCALAPPDATA "kb-agent-runner-$cardId.jsonl"
    $lastMsgFile = Join-Path $env:LOCALAPPDATA "kb-agent-runner-$cardId.lastmsg"
    if (Test-Path $lastMsgFile) { Remove-Item $lastMsgFile -Force }

    $workOrder | codex exec - --json --output-last-message $lastMsgFile *> $jsonLog
    $codexExit = $LASTEXITCODE

    # Best-effort model-id parse out of the JSONL stream -- confirm the exact
    # event schema against the installed CLI version at HUMAN GATE 5.7 and
    # tighten this regex then if the field name/shape differs.
    $modelId = 'unknown'
    if (Test-Path $jsonLog) {
        $modelMatch = Select-String -Path $jsonLog -Pattern '"model"\s*:\s*"([^"]+)"' | Select-Object -First 1
        if ($modelMatch -and $modelMatch.Matches.Count -gt 0) {
            $modelId = $modelMatch.Matches[0].Groups[1].Value
        }
    }

    $resultText = ''
    if (Test-Path $lastMsgFile) {
        $resultText = (Get-Content -Path $lastMsgFile -Raw)
    }
    if (-not $resultText) {
        $resultText = "(codex exec produced no final message; exit=$codexExit; see $jsonLog)"
    }

    # Append `## Result`, transition working -> done, save -- on the codex/*
    # work branch (see git-access note above for why not ops).
    & $py -c @'
import sys
sys.path.insert(0, "scripts")
import cards
from pathlib import Path

path = Path(sys.argv[1])
result_text = sys.argv[2]
codex_exit = sys.argv[3]

card = cards.parse(path)
card.body = card.body.rstrip("\n") + "\n\n## Result\n\n" + result_text.strip() + f"\n\n(codex exit={codex_exit})\n"
cards.transition(card, "done", Path("queue"))
'@ $currentCardPath $resultText $codexExit

    if ($codexExit -ne 0) {
        $overallExit = 1
    }

    git add -A
    git commit -m "chore(codex): result for card $cardId"

    # Log the model id + usd 0.0 subscription billing to ledgers/cost/ (step 7).
    & $py -c @"
import sys
sys.path.insert(0, 'scripts')
import ledger
from pathlib import Path

ledger.append(Path(r'$RepoRoot'), 'cost', '$Agent', {
    'usd': 0.0,
    'billing': 'subscription',
    'model': '$modelId',
    'card_id': '$cardId',
    'codex_exit': '$codexExit',
})
"@

    Write-RunnerLog ("card-done id=$cardId agent=$Agent model=$modelId codex-exit=$codexExit interpreter=$py")
}

Write-RunnerLog ("run-complete agent=$Agent branch=$workBranch overall-exit=$overallExit interpreter=$py")
exit $overallExit
