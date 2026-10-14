---
schema-version: 1
id: 6acffbec-e4181acd
project: kb-ops
action: filesystem-ai-drift-test-build
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 8160bb01ed7daaba
state: done
approval: null
workflow: 01a13c6c-2419-7a11-bdf9-e35129ac4c5e
depends-on: []
variant-group: null
role: work
session-id: 6acffad0-1759cf0e
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Author a SMALL standalone SYNTHETIC drift test as final PowerShell code, READ-ONLY worker. Root will inspect/materialize it as scripts/test-ai-capture-drift.ps1. TaskRoot C:/Users/danie/Projects/Filesystem-Cleanup. Allowed reads: scripts/test-ai-cold-recovery.ps1 hash168824AB8E310FCCD3C5848E287C74AB68ABD80886893FA8D296240CF68B8877, scripts/ai-cold-restore.ps1 hashAA0EE2C2B269C622BD354D5AC24B76F37F1CDA6FCC8E68F91D85ECD2BDEC81F5, reviews/claude-ai-cold-evidence-review.md and reviews/codex-ai-cold-recovery-review.md. RequiredKBgovernance allowed. No actual coursework, credentials, private logs, network, execution, writes or delegation. Output ONE powershell code fence with complete code, then short limitations. Do not edit the frozen scripts.
Close the missing source-addition/modification test before live capture. Reuse pinned reviewed helpers rather than copying100KB. A defensible option is hash-check frozen driver bytes, parseAST, load exactly its setup and function definitions up to the UNIQUE top-level $TestSha assignment (no original test main); explicitly validate extraction boundary and no embedded source path reads. This prefix only sets guards/types/helpers. Do NOT dot-source the full test driver and do NOT expand any write guard to live paths. Explain extraction/pinning trust. Create one fresh original-format fixtures/ai-cold-GUID after guards; only synthetic files inside, retain everything, no deletions or original access. No descriptor report read is required: use a synthetic protected parent with current-user FA and ordered inherited children; all source+recovery artifacts undertheRun.
Need three separate cases: stable capture (S0, New-Generation, S1, exactcompare); addition after S0/beforecopy (copy ignores addedfile but S0/S1 entryset detects it; generation must be invalid, no accepted marker); modification after S0/beforecopy (same-length content mutation with original timestamps restored, prove New-Generation refuses at sourcehash and original sourcecurrentbytesretained). If small, also modification after copy before S1 to prove finalfullhash check. Mutation is deliberate ONLY within new synthetic fixture. No livepath parameter. Use freshcurrent-user owner/group, simpleinheritedDACL; native helperoriginal writeguards remain. Return structuredsummary with each expectedreason/diff, evidence ofpostcondition, retainedfixture, codesha/pinnedhelperhash; exit0onlyallchecks pass, knownSACLunknown. Pin/checkhelpersbeforeandafter. No circularmanifestselfhash. PS5.1, non-elevated only, no policybypass. Parentwillapply120swatchdog. Keep code under~250lines if practical; focusontheactualdriftoracles, not a newrecoveryframework. Returnwithin~360s ifpossible.

## Result

```powershell
#Requires -Version 5.1
<#
.SYNOPSIS
  Synthetic-only drift test for the pinned ai cold-capture helpers.

.DESCRIPTION
  Creates one retained fixtures\ai-cold-<GUID> fixture. It never accepts a live
  source path, reads no descriptor-report content, performs no deletion, and
  mutates only synthetic files beneath that fixture.
#>
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$TaskRoot = 'C:\Users\danie\Projects\Filesystem-Cleanup'
$Driver = Join-Path $TaskRoot 'scripts\test-ai-cold-recovery.ps1'
$Restore = Join-Path $TaskRoot 'scripts\ai-cold-restore.ps1'
$DriverPin = '168824AB8E310FCCD3C5848E287C74AB68ABD80886893FA8D296240CF68B8877'
$RestorePin = 'AA0EE2C2B269C622BD354D5AC24B76F37F1CDA6FCC8E68F91D85ECD2BDEC81F5'

function Refuse-DriftTest([string]$Why) {
    Write-Output (ConvertTo-Json -Depth 5 -InputObject ([ordered]@{
        schema = 'ai-capture-drift-test/1'
        refused = $Why
        fixtureCreated = $false
        exitCode = 2
    }))
    exit 2
}
function Get-PathHash([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}
function Test-ExactDiff($Actual, [string[]]$Expected) {
    $a = @($Actual)
    if ($a.Count -ne $Expected.Count) { return $false }
    for ($i = 0; $i -lt $a.Count; $i++) {
        if ([string]$a[$i] -cne $Expected[$i]) { return $false }
    }
    $true
}
function Find-EntryLocal($Tree, [string]$Rel) {
    foreach ($e in $Tree) {
        if ([string]$e.path -ceq $Rel) { return $e }
    }
    throw "entry absent: $Rel"
}
function Restore-Basic([string]$Path, $Entry) {
    Set-Basic $Path ([int64]$Entry.creationFileTime) ([int64]$Entry.lastWriteFileTime) ([int64]$Entry.attributes)
}
function Get-IdentityProblems($Tree, [string]$Owner, [string]$Group) {
    @($Tree | Where-Object {
        -not ([string]$_.sddl).StartsWith("O:$($Owner)G:$($Group)D:", [StringComparison]::Ordinal)
    } | ForEach-Object { [string]$_.path })
}
function Add-Result($Value) { [void]$Results.Add($Value) }

$principal = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Refuse-DriftTest 'non-elevated execution required'
}
if ($PSVersionTable.PSEdition -ne 'Desktop' -or
    $PSVersionTable.PSVersion.Major -ne 5 -or
    $PSVersionTable.PSVersion.Minor -ne 1) {
    Refuse-DriftTest "Windows PowerShell 5.1 Desktop required; got $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)"
}
foreach ($p in @($Driver, $Restore)) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Refuse-DriftTest "missing pinned helper: $p" }
}

$Before = [ordered]@{ driver = Get-PathHash $Driver; restore = Get-PathHash $Restore }
if ($Before.driver -cne $DriverPin) { Refuse-DriftTest "driver hash mismatch: $($Before.driver)" }
if ($Before.restore -cne $RestorePin) { Refuse-DriftTest "restore hash mismatch: $($Before.restore)" }
$CodeSha = Get-PathHash $PSCommandPath

\# Trust model: only the reviewed driver's exact pinned bytes are parsed. The
\# unique top-level $TestSha assignment is the boundary between setup/helpers
\# and the original test main. Nothing at or after that assignment is evaluated.
$driverText = [IO.File]::ReadAllText($Driver, [Text.Encoding]::UTF8)
$tokens = $null
$parseErrors = $null
$driverAst = [Management.Automation.Language.Parser]::ParseInput(
    $driverText, $Driver, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { Refuse-DriftTest 'pinned driver does not parse cleanly' }

$assignments = @($driverAst.FindAll({
    param($n)
    $n -is [Management.Automation.Language.AssignmentStatementAst] -and
    $n.Left -is [Management.Automation.Language.VariableExpressionAst] -and
    $n.Left.VariablePath.UserPath -ceq 'TestSha'
}, $true))
$topAssignments = @($assignments | Where-Object {
    $p = $_.Parent
    $insideFunction = $false
    while ($null -ne $p) {
        if ($p -is [Management.Automation.Language.FunctionDefinitionAst]) {
            $insideFunction = $true
            break
        }
        $p = $p.Parent
    }
    -not $insideFunction
})
if ($assignments.Count -ne 1 -or $topAssignments.Count -ne 1) {
    Refuse-DriftTest "expected one unique top-level TestSha assignment; found $($assignments.Count)/$($topAssignments.Count)"
}
$boundary = $topAssignments[0]
if ($boundary.Extent.Text -cnotmatch '^\s*\$TestSha\s*=') {
    Refuse-DriftTest 'unexpected extraction-boundary syntax'
}
$prefix = $driverText.Substring(0, $boundary.Extent.StartOffset)
if ($prefix -cmatch '(?i)C:\\Users\\danie\\source\\repos' -or
    $prefix -cmatch '(?im)^\s*\$TestSha\s*=') {
    Refuse-DriftTest 'prefix contains a live source path or crossed the boundary'
}

$prefixTokens = $null
$prefixErrors = $null
$prefixAst = [Management.Automation.Language.Parser]::ParseInput(
    $prefix, 'pinned-driver-prefix.ps1', [ref]$prefixTokens, [ref]$prefixErrors)
if (@($prefixErrors).Count -ne 0) { Refuse-DriftTest 'extracted prefix does not parse cleanly' }
$readerCommands = @($prefixAst.FindAll({
    param($n)
    if ($n -isnot [Management.Automation.Language.CommandAst]) { return $false }
    $name = $n.GetCommandName()
    $null -ne $name -and $name -cin @(
        'Get-Content', 'Import-Csv', 'Import-Clixml',
        'Invoke-WebRequest', 'Invoke-RestMethod'
    )
}, $true))
if ($readerCommands.Count -ne 0) {
    Refuse-DriftTest ('prefix contains disallowed reader command(s): ' +
        (($readerCommands | ForEach-Object { $_.GetCommandName() }) -join ','))
}

\# Dot-source only the verified setup/helper prefix. This sets the original
\# native guards, $Run, bounded walker, and New-Generation implementation.
. ([scriptblock]::Create($prefix))

$Me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$ParentAccess = "D:P(A;OICI;FA;;;$Me)(A;OICI;FA;;;SY)"
$ExpectedParentAccess = "D:PAI(A;OICI;FA;;;$Me)(A;OICI;FA;;;SY)"
$ExpectedChildAccess = "D:AI(A;OICIID;FA;;;$Me)(A;OICIID;FA;;;SY)"
$Results = New-Object Collections.ArrayList
$Fatal = $null

function New-SyntheticSource([string]$Name) {
    $case = New-RunDir (Join-Path $CasesRoot $Name)
    $parent = New-RunDir (Join-Path $case 'source-parent')
    Set-Dacl $parent $ParentAccess $true
    $probe = Join-Path $parent 'stage-probe.txt'
    Write-RunFile $probe $ProbeBytes
    $probeSecurity = Get-Security $probe

    $src = New-RunDir (Join-Path $parent 'ai')
    $data = New-RunDir (Join-Path $src 'data')
    Write-RunFile (Join-Path $src 'notes.txt') $Utf8.GetBytes("synthetic drift fixture`r`n")
    Write-RunFile (Join-Path $data 'alpha.bin') ([byte[]](1..32))

    $base = [DateTime]::new(2026, 1, 10, 12, 0, 0, [DateTimeKind]::Utc).ToFileTimeUtc()
    Set-Basic (Join-Path $src 'notes.txt') ($base + 100) ($base + 200) 0x20
    Set-Basic (Join-Path $data 'alpha.bin') ($base + 300) ($base + 400) 0x20
    Set-Basic $data ($base + 500) ($base + 600) 0x10
    Set-Basic $src ($base + 700) ($base + 800) 0x10

    [ordered]@{
        case = $case
        src = $src
        parent = $parent
        group = $probeSecurity.group
        parentAccess = (Get-Security $parent).access
    }
}

try {
    Assert-NoReparseChain $FixturesRoot
    [void](New-RunDir $Run)
    $CasesRoot = New-RunDir (Join-Path $Run 'cases')

    \# Stable: S0 -> generation -> S1, with exact source and recovery comparisons.
    $c = New-SyntheticSource 'stable'
    $S0 = Read-Tree $c.src
    $identityBad = Get-IdentityProblems $S0 $Me $c.group
    $rootAccess = Get-AccessPart ([string](Find-EntryLocal $S0 '.').sddl)
    $recRoot = New-Generation $c.src (Join-Path $c.case 'recovery') @()
    $recoveryDiff = Compare-Entries $S0 (Read-Tree $recRoot) $false
    $sourceDiff = Compare-Entries $S0 (Read-Tree $c.src) $true
    $marker = Join-Path $c.case 'capture.accepted'
    $valid = ($recoveryDiff.Count -eq 0 -and $sourceDiff.Count -eq 0 -and
        $identityBad.Count -eq 0 -and $c.parentAccess -ceq $ExpectedParentAccess -and
        $rootAccess -ceq $ExpectedChildAccess)
    if ($valid) { Write-RunFile $marker $Utf8.GetBytes('accepted') }
    Add-Result ([ordered]@{
        name = 'stable'
        expectedReason = 'none'
        expectedDiff = @()
        observedDiff = @($sourceDiff)
        pass = ($valid -and [AiColdCapture.Native]::Probe($marker) -eq 0)
        postcondition = [ordered]@{
            recoveryExact = ($recoveryDiff.Count -eq 0)
            sourceExactIncludingIdentity = ($sourceDiff.Count -eq 0)
            currentUserOwnerGroup = ($identityBad.Count -eq 0)
            protectedParentAndOrderedInheritance = (
                $c.parentAccess -ceq $ExpectedParentAccess -and $rootAccess -ceq $ExpectedChildAccess)
            acceptedMarker = ([AiColdCapture.Native]::Probe($marker) -eq 0)
        }
    })

    \# Addition after S0: generation ignores it, but S1 entry-set comparison invalidates capture.
    $c = New-SyntheticSource 'addition-before-copy'
    $S0 = Read-Tree $c.src
    $root0 = Find-EntryLocal $S0 '.'
    $added = Join-Path $c.src 'added.bin'
    Write-RunFile $added ([byte[]](90, 91, 92, 93))
    Restore-Basic $c.src $root0
    $recRoot = New-Generation $c.src (Join-Path $c.case 'recovery') @()
    $recoveryDiff = Compare-Entries $S0 (Read-Tree $recRoot) $false
    $sourceDiff = Compare-Entries $S0 (Read-Tree $c.src) $true
    $marker = Join-Path $c.case 'capture.accepted'
    $pass = ($recoveryDiff.Count -eq 0 -and
        (Test-ExactDiff $sourceDiff @('added.bin|unexpected')) -and
        [AiColdCapture.Native]::Probe((Join-Path $recRoot 'added.bin')) -eq 2 -and
        [AiColdCapture.Native]::Probe($marker) -eq 2)
    Add-Result ([ordered]@{
        name = 'addition-before-copy'
        expectedReason = 'S1 entry set differs from S0'
        expectedDiff = @('added.bin|unexpected')
        observedDiff = @($sourceDiff)
        pass = $pass
        postcondition = [ordered]@{
            generationExactToS0 = ($recoveryDiff.Count -eq 0)
            addedFileIgnoredByCopy = ([AiColdCapture.Native]::Probe((Join-Path $recRoot 'added.bin')) -eq 2)
            generationRetained = ([AiColdCapture.Native]::Probe((Join-Path $c.case 'recovery')) -eq 0)
            acceptedMarkerAbsent = ([AiColdCapture.Native]::Probe($marker) -eq 2)
        }
    })

    \# Same-length mutation after S0 and before copy: New-Generation must refuse at source hash.
    $c = New-SyntheticSource 'modification-before-copy'
    $S0 = Read-Tree $c.src
    $target0 = Find-EntryLocal $S0 'data\alpha.bin'
    $target = Join-Path $c.src 'data\alpha.bin'
    [AiColdCapture.Native]::XorFirstByte($target)
    Restore-Basic $target $target0
    $mutatedHash = Get-FileSha $target
    $reason = $null
    try { [void](New-Generation $c.src (Join-Path $c.case 'recovery') @()) }
    catch { $reason = $_.Exception.GetBaseException().Message }
    $current = Read-Tree $c.src
    $sourceDiff = Compare-Entries $S0 $current $true
    $currentEntry = Find-EntryLocal $current 'data\alpha.bin'
    $marker = Join-Path $c.case 'capture.accepted'
    $wantedReason = 'source bytes changed during capture: data\alpha.bin'
    $pass = ($reason -ceq $wantedReason -and
        (Test-ExactDiff $sourceDiff @('data\alpha.bin|sha256')) -and
        $currentEntry.sha256 -ceq $mutatedHash -and $currentEntry.sha256 -cne $target0.sha256 -and
        $currentEntry.length -eq $target0.length -and
        $currentEntry.creationFileTime -ceq $target0.creationFileTime -and
        $currentEntry.lastWriteFileTime -ceq $target0.lastWriteFileTime -and
        [AiColdCapture.Native]::Probe($marker) -eq 2)
    Add-Result ([ordered]@{
        name = 'modification-before-copy'
        expectedReason = $wantedReason
        expectedDiff = @('data\alpha.bin|sha256')
        observedReason = $reason
        observedDiff = @($sourceDiff)
        pass = $pass
        postcondition = [ordered]@{
            sameLength = ($currentEntry.length -eq $target0.length)
            timestampsRestored = ($currentEntry.creationFileTime -ceq $target0.creationFileTime -and
                $currentEntry.lastWriteFileTime -ceq $target0.lastWriteFileTime)
            sourceCurrentBytesRetained = ($currentEntry.sha256 -ceq $mutatedHash)
            partialGenerationRetained = ([AiColdCapture.Native]::Probe((Join-Path $c.case 'recovery')) -eq 0)
            acceptedMarkerAbsent = ([AiColdCapture.Native]::Probe($marker) -eq 2)
        }
    })

    \# Mutation after copy but before S1: final full-hash comparison invalidates the generation.
    $c = New-SyntheticSource 'modification-before-s1'
    $S0 = Read-Tree $c.src
    $target0 = Find-EntryLocal $S0 'data\alpha.bin'
    $target = Join-Path $c.src 'data\alpha.bin'
    $recRoot = New-Generation $c.src (Join-Path $c.case 'recovery') @()
    $recoveryDiff = Compare-Entries $S0 (Read-Tree $recRoot) $false
    [AiColdCapture.Native]::XorFirstByte($target)
    Restore-Basic $target $target0
    $sourceDiff = Compare-Entries $S0 (Read-Tree $c.src) $true
    $marker = Join-Path $c.case 'capture.accepted'
    $pass = ($recoveryDiff.Count -eq 0 -and
        (Test-ExactDiff $sourceDiff @('data\alpha.bin|sha256')) -and
        [AiColdCapture.Native]::Probe($marker) -eq 2)
    Add-Result ([ordered]@{
        name = 'modification-before-s1'
        expectedReason = 'S1 full-file SHA-256 differs from S0'
        expectedDiff = @('data\alpha.bin|sha256')
        observedDiff = @($sourceDiff)
        pass = $pass
        postcondition = [ordered]@{
            generationExactToS0 = ($recoveryDiff.Count -eq 0)
            generationRetained = ([AiColdCapture.Native]::Probe((Join-Path $c.case 'recovery')) -eq 0)
            acceptedMarkerAbsent = ([AiColdCapture.Native]::Probe($marker) -eq 2)
        }
    })
}
catch {
    $Fatal = $_.Exception.GetBaseException().Message
}

try {
    $After = [ordered]@{ driver = Get-PathHash $Driver; restore = Get-PathHash $Restore }
}
catch {
    $After = [ordered]@{ driver = 'unavailable'; restore = 'unavailable' }
    if (-not $Fatal) { $Fatal = "post-run helper hash failed: $($_.Exception.GetBaseException().Message)" }
}
$HelpersStable = ($Before.driver -ceq $DriverPin -and $After.driver -ceq $DriverPin -and
    $Before.restore -ceq $RestorePin -and $After.restore -ceq $RestorePin)
$AllPassed = ($null -eq $Fatal -and $HelpersStable -and
    $Results.Count -eq 4 -and @($Results | Where-Object { -not $_.pass }).Count -eq 0)
$ExitCode = $(if ($AllPassed) { 0 } else { 1 })

$Summary = [ordered]@{
    schema = 'ai-capture-drift-test/1'
    syntheticOnly = $true
    allPassed = $AllPassed
    exitCode = $ExitCode
    codeSha256 = $CodeSha
    pinnedHelperHash = [ordered]@{
        driver = [ordered]@{ expected = $DriverPin; before = $Before.driver; after = $After.driver }
        restore = [ordered]@{ expected = $RestorePin; before = $Before.restore; after = $After.restore }
        stableBeforeAndAfter = $HelpersStable
    }
    extractionTrust = [ordered]@{
        source = 'exact SHA-256-pinned reviewed driver bytes'
        boundary = 'unique top-level $TestSha assignment; assignment and original main excluded'
        prefixParsed = $true
        embeddedLiveSourcePathAbsent = $true
        disallowedReaderCommandsAbsent = $true
        descriptorReportContentRead = $false
    }
    fixtureRetained = $Run
    deletionPerformed = $false
    sacl = 'UNKNOWN'
    cases = @($Results)
    fatal = $Fatal
}
try { Save-Json (Join-Path $Run 'drift-summary.json') $Summary }
catch {
    $Summary.allPassed = $false
    $Summary.exitCode = 1
    $Summary.fatal = "summary write failed: $($_.Exception.GetBaseException().Message)"
}
Write-Output (ConvertTo-Json -Depth 12 -InputObject $Summary)
exit ([int]$Summary.exitCode)
```

Limitations: Windows PowerShell 5.1/NTFS only; SACL, last-access time, and change time remain untested. Trust rests on the exact pinned driver prefix and its reviewed native helpers. The prefix checks that the descriptor-report path exists but never opens its contents. The test is synthetic and does not authorize live capture.
