# prod-archive-run.ps1 - archive ONE dead/terminal run on prod (or rehearsal), audited.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod\prod-archive-run.ps1 `
#     -Run run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5 -Reason "dead canary test run, cap-blocked"
#
#   # forcing through open human requests on a fail-closed/tagged run needs a signed approval. Argument
#   # ORDER IS PINNED (hook rule C17): -Run -Reason [-Actor] [-URL] [-Approval] -Force, exactly as below.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod\prod-archive-run.ps1 `
#     -Run run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5 -Reason "abandoning, superseded" `
#     -Approval C:\Users\danie\kb-backups\approvals\archive-run-cc508ddb.json -Force
#
# OPEN CLASS without -Force (scripts/hooks/prod_window_guard.js rule A4o, shape O4): no prod window
# needed - same posture as prod-respond.ps1's plain (no -Approval) shape. The daemon's
# POST /api/control/runs/:runRef/archive is an OPEN route (dashboard/server/authority/policy.ts),
# so the daemon is the real authority; this script's own pre-check exists so a mistaken run ref
# fails fast, in plain language, before it ever reaches the daemon.
#
# WITH -Force (WINDOWED CLASS, hook rule C17): D1 (adversarial review of claude/c2-cadence-gates,
# 2026-09-23 boss ruling) - the daemon's archive route now escalates exactly like the iteration-gate
# and human-request respond routes (`escalate: 'workflow-tag'`, policy.ts) whenever `force: true` is
# sent: a fail-closed (publish/spend-tagged, or legacy-untagged) run requires a signed approval bound
# to this exact route + runRef before it force-resolves any open human request; an untagged run still
# proceeds unsigned. -Approval names a JSON file holding that signed approval (the same
# `{payload, signature}` shape prod-sign-approval.ps1's -Out writes and prod-respond.ps1 embeds) -
# read, parsed, and forwarded verbatim as the POST body's `approval` field. The hook (C17) requires an
# open prod window for -Force regardless of whether -Approval is present; this script does not gate
# the window itself, exactly like every other windowed script here. ANY -Approval token alongside
# this script's name (with or without -Force) is refused as OPEN class by the hook's
# PROD_ARCHIVE_APPROVAL_GUARD -- it must match C17's exact windowed shape or nothing.
#
# Refuses (exit 1) BEFORE calling archive unless the run's lifecycle is one `archive` can legally
# reach in one hop. The real vocabulary lives in dashboard/server/control/runLifecycle.ts's
# RUN_LIFECYCLE_SEMANTICS: every kind whose `transitions` set contains 'archived' -
#   succeeded / failed / stopped / interrupted  - unconditionally (each is terminal or, for
#     interrupted, quarantine:true with 'archived' in its own transitions set)
#   waiting-human                                - ONLY when it carries zero OPEN human requests
#     as of THIS script's own read (Step A).
#
# FIXED 2026-09-22 (review finding B-2): as of this date the daemon's archiveRun
# (dashboard/server/control/store.ts) REFUSES (409 run-archive-open-requests, listing the open
# requestRefs) to archive any run that still has an open human request, unless the request body
# carries `force: true` - which this script deliberately never sends. So the residual race this
# comment used to describe (a request opening between Step A's read and the Step C POST, silently
# force-resolved with no real decision made) is now closed SERVER-SIDE, not just narrowed
# client-side: if that race is ever hit, Step C's POST now gets a 409 and this script aborts with
# the daemon's own refusal body printed, rather than silently closing a live gate.
#
# This script's own pre-check (Step A/B) and pre-POST re-read (Step B.1) are KEPT anyway - they are
# still real value on their own: a fast, plain-language local refusal is cheaper than a round trip
# to find out the daemon will refuse too, and they still narrow the window in which a human
# discovers the race (this script fails immediately; a bare POST would only fail with a raw 409
# body). Before this date, this comment said the opposite - that the daemon force-resolved with no
# server-side backstop at all; that was accurate then and is not anymore.
# 'archived' itself has an EMPTY transitions set (nothing re-archives an archived run), and every
# other kind (planned/recovering/running/stopping/paused-for-deploy) has no 'archived' transition
# at all, so this script refuses those too.
#
# -Actor is recorded on the audit trail (the X-KB-Actor header) exactly like prod-respond.ps1's; it
# is never trusted for authority (spec 4.3 - same non-authority property everywhere else in kb).
#
# -Force sends force:true in the POST body (D1: the daemon now escalates this exactly like a gate
# resolution on a fail-closed run - see the header note above). -Approval names a JSON file holding a
# signed approval; its content is forwarded verbatim as the POST body's `approval` field. -Approval
# without -Force is accepted (the daemon simply ignores an unused field) but pointless; -Force without
# -Approval is fine for an untagged run and will come back 403 approval-required otherwise, same as
# any other escalated route.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Run,
  [Parameter(Mandatory = $true)][string]$Reason,
  [string]$Actor = 'boss',
  [string]$URL = 'https://kb.tail82dd4f.ts.net',
  [string[]]$CurlHeader = @(),
  [switch]$Force,
  [string]$Approval = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path 'C:\Users\danie\kb-rehearsal\tooling\drain-v2' '_drain-common.ps1')
function Fail($m) { Write-Host ''; Write-Host "ABORT: $m" -ForegroundColor Red; exit 1 }
function Step($n, $m) { Write-Host ''; Write-Host "[$n] $m" -ForegroundColor Cyan }

if ($Reason.Trim().Length -lt 1 -or $Reason.Length -gt 300) { Fail '-Reason must be 1..300 characters' }
if ($Actor -notmatch '^(daniel|boss|worker:[a-z0-9][a-z0-9._-]{0,63})$') { Fail "-Actor '$Actor' is not a valid X-KB-Actor value" }

$approvalObj = $null
if ($Approval) {
  if (-not (Test-Path -LiteralPath $Approval -PathType Leaf)) { Fail "-Approval file not found: $Approval" }
  try { $approvalObj = Get-Content -LiteralPath $Approval -Raw | ConvertFrom-Json } catch { Fail "-Approval file was not valid JSON: $Approval" }
  if (-not $approvalObj.payload -or -not $approvalObj.signature) { Fail "-Approval file must contain payload and signature fields: $Approval" }
}

Step 'A' "reading $Run"
$detailRaw = Invoke-Curl $CurlHeader @('-s', '--max-time', '30', "$URL/api/control/runs/$Run")
if ($LASTEXITCODE -ne 0) { Fail "could not reach $URL - is the tailnet up?" }
try { $detail = $detailRaw | ConvertFrom-Json } catch { Fail "run detail was not JSON: $detailRaw" }
if (-not $detail.run -and $detail.value) { $detail = $detail.value }
if (-not $detail.run) { Fail "run $Run not found (or the response had no run object): $detailRaw" }
$state = [string]$detail.run.state
$openRequests = @($detail.humanRequests | Where-Object { $_.state -eq 'open' })
Write-Host "state=$state  openHumanRequests=$($openRequests.Count)"

$ARCHIVABLE_UNCONDITIONAL = @('succeeded', 'failed', 'stopped', 'interrupted')
if ($ARCHIVABLE_UNCONDITIONAL -contains $state) {
  Step 'B' "state '$state' is archivable unconditionally"
} elseif ($state -eq 'waiting-human') {
  if ($openRequests.Count -ne 0 -and -not $Force) {
    Fail "run $Run is waiting-human with $($openRequests.Count) open human request(s) - resolve or abandon them (prod-respond.ps1), or pass -Force (with -Approval if the run requires a signature) to override, before archiving"
  }
  if ($openRequests.Count -ne 0) {
    Step 'B' "state is waiting-human with $($openRequests.Count) open human request(s) - forcing through (-Force)"
  } else {
    Step 'B' 'state is waiting-human with zero open human requests - archivable'
  }
} elseif ($state -eq 'archived') {
  Fail "run $Run is already archived"
} else {
  Fail "run $Run is '$state', not a state this script archives from (need one of succeeded/failed/stopped/interrupted, or waiting-human with zero open requests)"
}

if ($state -eq 'waiting-human') {
  Step 'B.1' 're-reading immediately before the POST (a fast local check ahead of the daemon''s own refusal)'
  $reReadRaw = Invoke-Curl $CurlHeader @('-s', '--max-time', '30', "$URL/api/control/runs/$Run")
  if ($LASTEXITCODE -ne 0) { Fail "could not reach $URL for the pre-POST re-read - is the tailnet up?" }
  try { $reRead = $reReadRaw | ConvertFrom-Json } catch { Fail "pre-POST re-read was not JSON: $reReadRaw" }
  if (-not $reRead.run -and $reRead.value) { $reRead = $reRead.value }
  if (-not $reRead.run) { Fail "run $Run not found on the pre-POST re-read: $reReadRaw" }
  $reOpenRequests = @($reRead.humanRequests | Where-Object { $_.state -eq 'open' })
  if ($reOpenRequests.Count -ne 0 -and -not $Force) {
    Fail "run $Run picked up $($reOpenRequests.Count) new open human request(s) between the read and the archive POST - resolve or abandon them (prod-respond.ps1), or pass -Force, before archiving. The daemon would also now refuse this server-side (409 run-archive-open-requests); this script fails first, in plain language."
  }
  if ($reOpenRequests.Count -ne 0) {
    Write-Host "run $Run picked up $($reOpenRequests.Count) new open human request(s) since the first read - forcing through (-Force)" -ForegroundColor Yellow
  }
}

Step 'C' "archiving as $Actor : $Reason$(if ($Force) { ' (FORCE)' })"
# D1: `force`/`approval` are only added to the body when actually requested - a plain archive's wire
# shape is byte-identical to before this change.
$bodyFields = [ordered]@{ idempotencyKey = [guid]::NewGuid().ToString(); reason = $Reason }
if ($Force) { $bodyFields.force = $true }
if ($approvalObj) { $bodyFields.approval = $approvalObj }
$body = $bodyFields | ConvertTo-Json -Compress -Depth 10
$tmp = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($tmp, $body)
try {
  $raw = Invoke-Curl $CurlHeader @('-s', '-w', "`nHTTP %{http_code}", '-X', 'POST', '--max-time', '60',
    '-H', 'content-type: application/json', '-H', "x-kb-actor: $Actor",
    '--data-binary', "@$tmp", "$URL/api/control/runs/$Run/archive")
} finally { Remove-Item -Force -ErrorAction SilentlyContinue $tmp }
$text = ($raw -join "`n")
Write-Host $text
if ($text -notmatch 'HTTP 200') { Fail 'archive did not return 200 - read the body above' }

Step 'D' 'run state after archive'
$after = Invoke-Curl $CurlHeader @('-s', '--max-time', '30', "$URL/api/control/runs/$Run")
try {
  $a = $after | ConvertFrom-Json; if (-not $a.run -and $a.value) { $a = $a.value }
  Write-Host "state=$($a.run.state)"
} catch { Write-Host 'could not re-read the run' -ForegroundColor Yellow }
Write-Host ''
Write-Host 'DONE.' -ForegroundColor Green
