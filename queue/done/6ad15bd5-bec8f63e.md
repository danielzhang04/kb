---
schema-version: 1
id: 6ad15bd5-bec8f63e
project: kb-ops
action: cleanup-ait25-corruption-build
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 3acbd10160e83afd
state: done
approval: null
workflow: 01a141c9-6b3d-71f0-a7da-189468400545
depends-on: []
variant-group: null
role: work
session-id: 6ad15a77-d967f80a
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

AUTHOR recovery-corruption synthetic harness as code in FINAL RESPONSE ONLY. No file writes/execution/compilation/Git. R=C:\Users\danie\Projects\Filesystem-Cleanup. Selected cleanup scripts/reports and synthetic metadata authorized; no original projects/payload/auth/OAuth/private unrelated logs. Return BEGIN_POWERSHELL newline completePS5.1script newline END_POWERSHELL then BEGIN_NOTE...END_NOTE. Intended scripts/test-ait25-recovery-corruption.ps1 and NOTE.
Read reviews/claude-ait25-remaining-fault-design.md HarnessK only, reviews/codex-ait25-manifest-postrun.md, scripts/test-ait25-manifest-refusals.ps1 D7FA1A98BB77F13931EE356596EB6595A091D7C9822A71245152BEAE77D3EEC9, compact FCADAC10B50C9855B09B1898F5B2CAFB7B75264BCBC0DBF1DD8FAC5A03946233, frozenv5capture CC25B3F014A7CCE5F33AA8D50823B7CCADA13EA91CA4708525BCA9CA87684266 restoreCA4A691AF7A367402F994EDFC69DF351E8F0CBB6956DE0586C1B8793C98DE269. Acceptedcompactfixture a25c-12490ffbeaa2462a9f2badd947f97b5e read-only manifestE309B2DEFCB9E90F81879B454E1D959FAB14E4D9220B5B286E501DFE91A1E700 report0FFB6A71CB550DAE715ED68564FD78081BB5BB790E64DA8C425ABEC0856A925A. Adapt child GenerationsRoot ONLY, inversebyte/AST/pathproofs, same source provenance synthetic never opened.
Fresh a25k-GUID fixture with four freshg-GUID generations, create-newonly, use pinned nativewriters. K0positivecontrol gates K1bytes/K2Zone/K3validLXcorruption. Regenerate exactcompactpayload/Zoneformulas andverifyagainstmanifesthashes BEFOREgenerationwrites; rawLXfrommanifesthashvalidated. Seed metadata/envelopes/probe exactly from design+engine; freshIDs expected, preserve originalmanifest semanticbindings andrepin runId/code. Corrupt bytes at creation only, no overwrite acceptedfixture. Exact independentdifferences beforelaunch: noneK0, exact intendedfieldsKn. Actualnonzero+exactcategory/message/stage+restoreStartedfalse/outputabsent forKn. K0mustfullypassactualrestore independentfidelity or remainingNOTRUN+overallfail. No falsepass missingrecoveryparent. Capturemanifest recoveryIds may referoriginalsyntheticIDs: verify engine's comparisonsemantics before implement; donotweakenvalidation. Bound perchild60s/total10min plusdrains, ownretainedhandle, no retry. FreshreportsCreateNew, errorshonest, pinsbeforeafter. Existing root outerwatchdog pattern willbeadapted separately. No scale/source-drift/originaltests here. Use exacttested helpers/launcher and PS5.1 ASTunwrap/Base64 byteequality. No maincodeexec byauthor. Favor concise reuse over giant framework; allfourcasesmandatory. Author actualcode notplan. OutputcodeonlymarkersandNOTE.

## Result

BEGIN_POWERSHELL
#Requires -Version 5.1
<#
.SYNOPSIS
  Bounded synthetic AIT25 recovery-corruption harness.

.DESCRIPTION
  Creates only fresh synthetic fixtures below:
    C:\Users\danie\Projects\Filesystem-Cleanup\fixtures\a25k-<32hex>

  Reads only the pinned compact harness, frozen synthetic writers, accepted compact
  report, accepted synthetic manifest, and accepted adapted restore child named below.
  Provenance sourcePath, sourceParentPath, and ForbiddenRoot remain inert strings and
  are never opened.

  K0 is the positive recovery control. K1-K3 inject corruption while recovery objects
  are first created; accepted fixtures are never overwritten. K0 gates later launches.
  All generated artifacts are retained.
#>

[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$R = 'C:\Users\danie\Projects\Filesystem-Cleanup'
$Fixtures = Join-Path $R 'fixtures'
$AcceptedRoot = Join-Path $Fixtures 'a25c-12490ffbeaa2462a9f2badd947f97b5e'
$CompactHarness = Join-Path $R 'scripts\test-ait25-provisional-compact.ps1'
$FrozenCapture = Join-Path $R 'reports\v5-candidate-ait25-provisional-capture.ps1'
$FrozenRestore = Join-Path $R 'reports\v5-candidate-ait25-provisional-restore.ps1'
$CompactReportPath = Join-Path $AcceptedRoot 'compact-report.json'
$AcceptedManifestPath = Join-Path $AcceptedRoot 'g\g-fe1fcc4bad104575a6a10eb09a3b1458\recovery\manifest.json'
$AcceptedChildPath = Join-Path $AcceptedRoot 'x\r.ps1'

$ExpectedCompactHarnessSha = 'FCADAC10B50C9855B09B1898F5B2CAFB7B75264BCBC0DBF1DD8FAC5A03946233'
$ExpectedFrozenCaptureSha = 'CC25B3F014A7CCE5F33AA8D50823B7CCADA13EA91CA4708525BCA9CA87684266'
$ExpectedFrozenRestoreSha = 'CA4A691AF7A367402F994EDFC69DF351E8F0CBB6956DE0586C1B8793C98DE269'
$ExpectedAcceptedManifestSha = 'E309B2DEFCB9E90F81879B454E1D959FAB14E4D9220B5B286E501DFE91A1E700'
$ExpectedCompactReportSha = '0FFB6A71CB550DAE715ED68564FD78081BB5BB790E64DA8C425ABEC0856A925A'

$MaxInputBytes = [int64]1MB
$MaxPayloadBytes = [int64]4MB
$MaxZoneBytes = [int64]1MB
$MaxStreamBytes = [int64]1MB
$MaxReportBytes = [int64]1MB
$CaseCeilingMs = 60000
$OverallCeilingMs = 600000
$DrainWaitMs = 10000
$MainStream = '::$DATA'
$ZoneName = ':Zone.Identifier:$DATA'
$CopyFields = @(
    'kind', 'attributes', 'creationFileTime', 'lastWriteFileTime',
    'length', 'sha256', 'lxRawBase64', 'lxRawSha256',
    'lxTarget', 'sddl', 'sdBase64', 'daclProtected'
)
$ExpectedPassSteps = @(
    'cli.bound',
    'manifest.digest',
    'manifest.provenance',
    'manifest.valid',
    'paths.withinLimits',
    'recovery.verified',
    'restore.envelope',
    'restore.written',
    'restore.verified'
)
$PassMessage = 'restored tree equals the pinned manifest exactly; recovery identities distinct from manifest source identities; stage probe exact; the manifest labels this generation real-provisional (label only); this child did not access the original source or assess its availability; NOT cold-withheld; SACL, last-access time and change time not verified or preserved'
$ExitFor = @{
    pass = 0
    integrity = 4
}

$Utf8 = New-Object Text.UTF8Encoding $false
$StrictUtf8 = New-Object Text.UTF8Encoding $false, $true
$Clock = [Diagnostics.Stopwatch]::StartNew()
$Results = New-Object Collections.ArrayList
$Fatal = $null
$FixtureRoot = $null
$GenerationRoot = $null
$ChildRoot = $null
$ChildPath = $null
$ChildSha = $null
$ReportPath = $null
$ReportWritten = $false
$PinsBefore = $null
$PinsFinal = $null

function Get-ShaBytes([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-', '')
    } finally {
        $sha.Dispose()
    }
}

function Get-FileSha([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Assert-Hash([string]$Path, [string]$Expected) {
    $actual = Get-FileSha $Path
    if ($actual -cne $Expected) {
        throw "SHA256 mismatch for '$Path': expected $Expected, got $actual"
    }
    $actual
}

function Read-Bounded([string]$Path, [int64]$Limit) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer) {
        throw "expected a file: $Path"
    }
    if ($item.Length -gt $Limit) {
        throw "input exceeds $Limit bytes: $Path"
    }
    [IO.File]::ReadAllBytes($Path)
}

function Count-Ordinal([string]$Text, [string]$Needle) {
    if ($Needle.Length -eq 0) {
        throw 'empty count needle'
    }

    $count = 0
    $at = 0
    while ($true) {
        $position = $Text.IndexOf($Needle, $at, [StringComparison]::Ordinal)
        if ($position -lt 0) {
            break
        }
        $count++
        $at = $position + $Needle.Length
    }
    $count
}

function Splice-Once(
    [string]$Text,
    [string]$Old,
    [string]$New,
    [string]$Label
) {
    $count = Count-Ordinal $Text $Old
    if ($count -ne 1) {
        throw "$Label anchor count is $count, expected 1"
    }

    $position = $Text.IndexOf($Old, [StringComparison]::Ordinal)
    $result = $Text.Substring(0, $position) +
        $New +
        $Text.Substring($position + $Old.Length)

    if ((Count-Ordinal $result $New) -ne 1) {
        throw "$Label injected-span count is not exactly 1"
    }

    $inverse = $result.Substring(0, $position) +
        $Old +
        $result.Substring($position + $New.Length)

    if ($inverse -cne $Text) {
        throw "$Label inverse text proof failed"
    }
    $result
}

function Get-AssignmentLiteral($Ast, [string]$Name) {
    $hits = @($Ast.FindAll({
        param($node)
        if ($node -isnot [Management.Automation.Language.AssignmentStatementAst]) {
            return $false
        }
        if ($node.Left -isnot [Management.Automation.Language.VariableExpressionAst]) {
            return $false
        }
        $node.Left.VariablePath.UserPath -ceq $Name
    }, $true))

    if ($hits.Count -ne 1) {
        throw "assignment '$Name' count is $($hits.Count), expected 1"
    }

    $rhs = $hits[0].Right
    if ($rhs -is [Management.Automation.Language.CommandExpressionAst] -and
        $rhs.Redirections.Count -eq 0) {
        $rhs = $rhs.Expression
    }

    if ($rhs -isnot [Management.Automation.Language.StringConstantExpressionAst] -or
        $rhs.StringConstantType -ne
            [Management.Automation.Language.StringConstantType]::SingleQuoted) {
        throw "assignment '$Name' is not a single-quoted string literal"
    }

    [string]$rhs.Value
}

function Get-ExactAddTypeLiteral([string]$ScriptText) {
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput(
        $ScriptText,
        [ref]$tokens,
        [ref]$errors
    )

    if (@($errors).Count -ne 0) {
        throw 'frozen capture has PowerShell parse errors'
    }

    $values = New-Object Collections.ArrayList
    $commands = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.CommandAst] -and
            $node.GetCommandName() -ceq 'Add-Type'
    }, $true))

    foreach ($command in $commands) {
        for ($i = 0; $i -lt $command.CommandElements.Count - 1; $i++) {
            $element = $command.CommandElements[$i]
            if ($element -is [Management.Automation.Language.CommandParameterAst] -and
                $element.ParameterName -ceq 'TypeDefinition') {
                $next = $command.CommandElements[$i + 1]
                if ($next -isnot
                    [Management.Automation.Language.StringConstantExpressionAst]) {
                    throw 'Add-Type -TypeDefinition is not an exact string AST literal'
                }
                [void]$values.Add([string]$next.SafeGetValue())
            }
        }
    }

    if ($values.Count -ne 1) {
        throw "Add-Type -TypeDefinition literal count is $($values.Count), expected 1"
    }

    [string]$values[0]
}

function Assert-PlainDirectory([string]$Path) {
    $probe = [Ait25ProvisionalCapture.Native]::Probe($Path)
    if ($probe -ne 0) {
        throw "plain-directory probe failed ($probe): $Path"
    }

    $attrs = [int64][Ait25ProvisionalCapture.Native]::Attrs($Path)
    if (($attrs -band 0x10) -eq 0 -or ($attrs -band 0x400) -ne 0) {
        throw "not a plain no-follow directory: $Path"
    }
}

function Assert-InFixture([string]$Path) {
    if ($null -eq $FixtureRoot -or
        $null -eq $Path -or
        $Path.Length -lt 3 -or
        $Path.IndexOf(':', 2) -ge 0 -or
        [IO.Path]::GetFullPath($Path) -cne $Path -or
        -not (
            $Path -ceq $FixtureRoot -or
            $Path.StartsWith(
                $FixtureRoot + '\',
                [StringComparison]::Ordinal
            )
        )) {
        throw "fixture path guard refused '$Path'"
    }
    $Path
}

function New-BoundDirectory([string]$Path) {
    [Ait25ProvisionalCapture.Native]::CreateDir(
        (Assert-InFixture $Path)
    )
    Assert-PlainDirectory $Path
}

function Write-BoundNew([string]$Path, [byte[]]$Bytes) {
    [void][Ait25ProvisionalCapture.Native]::WriteNew(
        (Assert-InFixture $Path),
        $Bytes
    )
}

function Get-PinSnapshot([Collections.IDictionary]$Pins) {
    $snapshot = [ordered]@{}
    foreach ($name in $Pins.Keys) {
        $path = [string]$Pins[$name].path
        $expected = [string]$Pins[$name].sha256
        $actual = Assert-Hash $path $expected
        $snapshot[$name] = [ordered]@{
            path = $path
            expected = $expected
            actual = $actual
        }
    }
    $snapshot
}

function Compare-PinSnapshot($Before, $After) {
    $failures = New-Object Collections.ArrayList
    foreach ($name in $Before.Keys) {
        if (-not $After.Contains($name)) {
            [void]$failures.Add("missing after-pin: $name")
        } elseif (
            [string]$Before[$name].actual -cne
            [string]$After[$name].actual
        ) {
            [void]$failures.Add("external pin changed: $name")
        }
    }
    @($failures)
}

function Convert-ManifestObjectToText($Object) {
    ConvertTo-Json -Depth 30 -Compress -InputObject $Object
}

function New-BaseManifest(
    [string]$SeedText,
    [string]$RunId,
    [string]$AdaptedChildSha
) {
    $object = ConvertFrom-Json -InputObject $SeedText
    $object.runId = $RunId
    $object.provenance.restoreCodeSha256 = $AdaptedChildSha
    $object
}

function Get-FullEntryPath([string]$Root, [string]$Relative) {
    if ($Relative -ceq '.') {
        $Root
    } else {
        $Root + '\' + $Relative
    }
}

function New-LxRaw([string]$Target) {
    $targetBytes = $StrictUtf8.GetBytes($Target)
    $raw = New-Object byte[] (12 + $targetBytes.Length)
    $tag = [Convert]::ToUInt32('A000001D', 16)

    [Array]::Copy(
        [BitConverter]::GetBytes([uint32]$tag),
        0,
        $raw,
        0,
        4
    )
    [Array]::Copy(
        [BitConverter]::GetBytes([uint16](4 + $targetBytes.Length)),
        0,
        $raw,
        4,
        2
    )
    [Array]::Copy(
        [BitConverter]::GetBytes([uint32]2),
        0,
        $raw,
        8,
        4
    )
    [Array]::Copy(
        $targetBytes,
        0,
        $raw,
        12,
        $targetBytes.Length
    )

    if (
        [Ait25ProvisionalCapture.Native]::LxTarget($raw) -cne $Target
    ) {
        throw "LX v2 raw buffer does not round-trip target '$Target'"
    }

    ,$raw
}

function Get-FormulaBytes([string]$Path) {
    switch -CaseSensitive ($Path) {
        'd1\a.txt' {
            return ,$Utf8.GetBytes(
                "synthetic ait25 compact fixture file 'd1\a.txt'; not project data`r`n"
            )
        }
        'd1\b.bin' {
            return ,[byte[]](0..255)
        }
        'd1\empty.bin' {
            return ,(New-Object byte[] 0)
        }
        'd1\d2\deep.txt' {
            return ,$Utf8.GetBytes(
                "synthetic ait25 compact fixture file 'd1\d2\deep.txt'; not project data`r`n"
            )
        }
        'd3\c.txt' {
            return ,$Utf8.GetBytes(
                "synthetic ait25 compact fixture file 'd3\c.txt'; not project data`r`n"
            )
        }
        'h.txt' {
            return ,$Utf8.GetBytes(
                "synthetic ait25 compact fixture file 'h.txt'; not project data`r`n"
            )
        }
        'ro.txt' {
            return ,$Utf8.GetBytes(
                "synthetic ait25 compact fixture file 'ro.txt'; not project data`r`n"
            )
        }
        'u-é中文.txt' {
            return ,$Utf8.GetBytes(
                "synthetic ait25 compact fixture file 'unicode-name'; not project data`r`n"
            )
        }
        'z1.txt' {
            return ,$Utf8.GetBytes(
                "synthetic ait25 compact fixture file 'z1.txt'; not project data`r`n"
            )
        }
        'z0.txt' {
            return ,$Utf8.GetBytes(
                "synthetic ait25 compact fixture file 'z0.txt'; not project data`r`n"
            )
        }
        default {
            throw "no compact payload formula for '$Path'"
        }
    }
}

function New-Zone2010 {
    $zone = New-Object byte[] 2010
    $head = $Utf8.GetBytes(
        "synthetic zone stream bytes for the ait25 compact rehearsal; not a URL`r`n"
    )
    [Array]::Copy($head, 0, $zone, 0, $head.Length)
    for ($i = $head.Length; $i -lt $zone.Length; $i++) {
        $zone[$i] = [byte](0x61 + ($i % 26))
    }
    ,$zone
}

function New-ValidatedSeedPlan($Manifest) {
    $plan = New-Object Collections.ArrayList

    foreach ($entry in @($Manifest.entries)) {
        $path = [string]$entry.path
        $kind = [string]$entry.kind
        $data = $null
        $zone = $null
        $raw = $null

        if ($kind -ceq 'file') {
            [byte[]]$data = Get-FormulaBytes $path
            if ([int64]$data.Length -ne [int64]$entry.length) {
                throw "formula length differs from manifest for '$path'"
            }
            if ((Get-ShaBytes $data) -cne [string]$entry.sha256) {
                throw "formula SHA256 differs from manifest for '$path'"
            }

            $zoneStreams = @($entry.streams | Where-Object {
                [string]$_.name -ceq $ZoneName
            })

            if ($zoneStreams.Count -gt 1) {
                throw "multiple Zone streams in manifest for '$path'"
            }

            if ($zoneStreams.Count -eq 1) {
                if ($path -ceq 'z1.txt') {
                    [byte[]]$zone = New-Zone2010
                } elseif ($path -ceq 'z0.txt') {
                    [byte[]]$zone = New-Object byte[] 0
                } else {
                    throw "unexpected Zone stream formula target '$path'"
                }

                if (
                    [int64]$zone.Length -ne
                    [int64]$zoneStreams[0].length
                ) {
                    throw "Zone formula length differs from manifest for '$path'"
                }
                if (
                    (Get-ShaBytes $zone) -cne
                    [string]$zoneStreams[0].sha256
                ) {
                    throw "Zone formula SHA256 differs from manifest for '$path'"
                }
            }
        } elseif ($kind -ceq 'lx') {
            try {
                [byte[]]$raw = [Convert]::FromBase64String(
                    [string]$entry.lxRawBase64
                )
            } catch {
                throw "manifest LX Base64 is invalid for '$path'"
            }

            if (
                (Get-ShaBytes $raw) -cne
                [string]$entry.lxRawSha256
            ) {
                throw "manifest LX raw SHA256 differs for '$path'"
            }

            $target = [Ait25ProvisionalCapture.Native]::LxTarget($raw)
            if ($target -cne [string]$entry.lxTarget) {
                throw "manifest LX target differs from validated raw bytes for '$path'"
            }
        } elseif ($kind -cne 'dir') {
            throw "unexpected manifest kind '$kind' at '$path'"
        }

        [void]$plan.Add([ordered]@{
            entry = $entry
            path = $path
            kind = $kind
            data = $data
            zone = $zone
            raw = $raw
        })
    }

    if ($plan.Count -ne 17) {
        throw "validated seed plan has $($plan.Count) entries, expected 17"
    }

    ,$plan
}

function Get-NamesNative([string]$Path) {
    $names = New-Object 'Collections.Generic.List[string]'
    [void][Ait25ProvisionalCapture.Native]::Inspect(
        (Assert-InFixture $Path),
        $names,
        1000,
        0,
        -1,
        [uint32]8371
    )
    $array = $names.ToArray()
    [Array]::Sort($array, [StringComparer]::Ordinal)
    $array -join '|'
}

function Get-IndependentEntry([string]$TreeRoot, $ManifestEntry) {
    $relative = [string]$ManifestEntry.path
    $path = Get-FullEntryPath $TreeRoot $relative
    $names = New-Object 'Collections.Generic.List[string]'
    $node = [Ait25ProvisionalCapture.Native]::Inspect(
        (Assert-InFixture $path),
        $names,
        1000,
        $MaxPayloadBytes,
        $MaxZoneBytes,
        [uint32]8371
    )

    $attrs = [int64]$node.Attrs
    $kind = if ($attrs -band 0x400) {
        'lx'
    } elseif ($attrs -band 0x10) {
        'dir'
    } else {
        'file'
    }

    $descriptor = New-Object Security.AccessControl.RawSecurityDescriptor(
        ([byte[]]$node.Sd),
        0
    )
    $sections = [Security.AccessControl.AccessControlSections]'Owner, Group, Access'
    $protectedFlag =
        [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected
    $isProtected = (
        ($descriptor.ControlFlags -band $protectedFlag) -ne 0
    )

    $streams = New-Object Collections.ArrayList
    foreach ($stream in @($node.Streams)) {
        $streamHash = ''
        if ([string]$stream.Name -ceq $ZoneName) {
            if ($null -eq $node.Zone) {
                $streamHash = '<zone-bytes-absent>'
            } else {
                $streamHash = Get-ShaBytes ([byte[]]$node.Zone)
            }
        }

        [void]$streams.Add([ordered]@{
            name = [string]$stream.Name
            length = [int64]$stream.Size
            sha256 = $streamHash
        })
    }

    $rawBase64 = ''
    $rawSha = ''
    $rawTarget = ''
    if ($kind -ceq 'lx') {
        if ($null -eq $node.Raw) {
            $rawBase64 = '<raw-absent>'
            $rawSha = '<raw-absent>'
            $rawTarget = '<raw-absent>'
        } else {
            [byte[]]$rawBytes = $node.Raw
            $rawBase64 = [Convert]::ToBase64String($rawBytes)
            $rawSha = Get-ShaBytes $rawBytes
            $rawTarget = [Ait25ProvisionalCapture.Native]::LxTarget(
                $rawBytes
            )
        }
    }

    [ordered]@{
        path = $relative
        kind = $kind
        attributes = $attrs
        creationFileTime = [string]$node.Created
        lastWriteFileTime = [string]$node.Written
        length = if ($kind -ceq 'file') {
            [int64]$node.Size
        } else {
            [int64]0
        }
        sha256 = if ($kind -ceq 'file' -and $null -ne $node.Data) {
            Get-ShaBytes ([byte[]]$node.Data)
        } elseif ($kind -ceq 'file') {
            '<payload-absent>'
        } else {
            ''
        }
        streams = @($streams)
        lxRawBase64 = $rawBase64
        lxRawSha256 = $rawSha
        lxTarget = $rawTarget
        sddl = $descriptor.GetSddlForm($sections)
        sdBase64 = [Convert]::ToBase64String([byte[]]$node.Sd)
        daclProtected = [bool]$isProtected
        sourceId = [string]$node.Id
    }
}

function Get-StreamKey($Entry) {
    @(
        foreach ($stream in @($Entry.streams)) {
            '{0}|{1}|{2}' -f
                $stream.name,
                $stream.length,
                $stream.sha256
        }
    ) -join ';'
}

function Get-IndependentTree([string]$TreeRoot, $Manifest) {
    $records = New-Object Collections.ArrayList
    foreach ($entry in @($Manifest.entries)) {
        [void]$records.Add(
            (Get-IndependentEntry $TreeRoot $entry)
        )
    }
    ,$records
}

function Compare-IndependentTree($Manifest, $ActualEntries) {
    $diffs = New-Object Collections.ArrayList
    $actualByPath =
        New-Object 'Collections.Generic.Dictionary[string,object]' (
            [StringComparer]::Ordinal
        )

    foreach ($entry in @($ActualEntries)) {
        $actualByPath[[string]$entry.path] = $entry
    }

    $seen = New-Object 'Collections.Generic.HashSet[string]' (
        [StringComparer]::Ordinal
    )

    foreach ($want in @($Manifest.entries)) {
        $path = [string]$want.path
        [void]$seen.Add($path)

        if (-not $actualByPath.ContainsKey($path)) {
            [void]$diffs.Add("$path|missing")
            continue
        }

        $got = $actualByPath[$path]
        foreach ($field in $CopyFields) {
            if ([string]$want.$field -cne [string]$got.$field) {
                [void]$diffs.Add("$path|$field")
            }
        }

        if ((Get-StreamKey $want) -cne (Get-StreamKey $got)) {
            [void]$diffs.Add("$path|streams")
        }
    }

    foreach ($got in @($ActualEntries)) {
        if (-not $seen.Contains([string]$got.path)) {
            [void]$diffs.Add("$($got.path)|unexpected")
        }
    }

    ,$diffs
}

function Assert-ExpectedDifferences(
    [string[]]$Actual,
    [string[]]$Expected,
    [string]$Label
) {
    if ($Actual.Count -ne $Expected.Count) {
        throw "$Label difference count $($Actual.Count), expected $($Expected.Count): $($Actual -join '; ')"
    }

    for ($i = 0; $i -lt $Expected.Count; $i++) {
        if ([string]$Actual[$i] -cne [string]$Expected[$i]) {
            throw "$Label difference[$i] '$($Actual[$i])', expected '$($Expected[$i])'"
        }
    }
}

function Assert-IdentityFidelity(
    $Manifest,
    $RecoveryEntries,
    $RestoreEntries
) {
    $sourceIds = New-Object 'Collections.Generic.HashSet[string]' (
        [StringComparer]::Ordinal
    )
    foreach ($entry in @($Manifest.entries)) {
        [void]$sourceIds.Add([string]$entry.sourceId)
    }
    [void]$sourceIds.Add([string]$Manifest.provenance.sourceParentId)

    $recoveryIds = New-Object 'Collections.Generic.HashSet[string]' (
        [StringComparer]::Ordinal
    )
    foreach ($entry in @($RecoveryEntries)) {
        $id = [string]$entry.sourceId
        if (-not $recoveryIds.Add($id)) {
            throw "independent K0 check found duplicate recovery identity '$id'"
        }
        if ($sourceIds.Contains($id)) {
            throw "independent K0 check found recovery/source identity overlap '$id'"
        }
    }

    $restoreIds = New-Object 'Collections.Generic.HashSet[string]' (
        [StringComparer]::Ordinal
    )
    foreach ($entry in @($RestoreEntries)) {
        $id = [string]$entry.sourceId
        if (-not $restoreIds.Add($id)) {
            throw "independent K0 check found duplicate restore identity '$id'"
        }
        if ($sourceIds.Contains($id) -or $recoveryIds.Contains($id)) {
            throw "independent K0 check found restore identity overlap '$id'"
        }
    }
}

function Assert-EnvelopeAndProbe(
    [string]$Container,
    [string]$SourceLeaf,
    $Manifest,
    [bool]$HasManifest
) {
    $expectedTop = if ($HasManifest) {
        'manifest.json|parent'
    } else {
        'parent'
    }
    if ((Get-NamesNative $Container) -cne $expectedTop) {
        throw "independent envelope top-level mismatch at '$Container'"
    }

    $parent = Join-Path $Container 'parent'
    if (
        (Get-NamesNative $parent) -cne
        "$SourceLeaf|stage-probe.txt"
    ) {
        throw "independent envelope child-set mismatch at '$parent'"
    }

    $parentNode = [Ait25ProvisionalCapture.Native]::Inspect(
        (Assert-InFixture $parent),
        $null,
        1000,
        0,
        -1,
        [uint32]8371
    )
    $parentDescriptor =
        [Convert]::ToBase64String([byte[]]$parentNode.Sd)

    if (
        $parentDescriptor -cne
        [string]$Manifest.originalParent.envelopeSdBase64
    ) {
        throw "independent envelope descriptor mismatch at '$parent'"
    }

    $probePath = Join-Path $parent 'stage-probe.txt'
    $probeNode = [Ait25ProvisionalCapture.Native]::Inspect(
        (Assert-InFixture $probePath),
        $null,
        1000,
        1MB,
        -1,
        [uint32]8371
    )
    $expectedProbe = $Utf8.GetBytes(
        "ait25 provisional stage probe`r`n"
    )

    if (
        $null -eq $probeNode.Data -or
        [Convert]::ToBase64String([byte[]]$probeNode.Data) -cne
        [Convert]::ToBase64String($expectedProbe)
    ) {
        throw "independent stage-probe bytes mismatch at '$probePath'"
    }

    if (
        [Convert]::ToBase64String([byte[]]$probeNode.Sd) -cne
        [string]$Manifest.originalParent.probeFileSdBase64
    ) {
        throw "independent stage-probe descriptor mismatch at '$probePath'"
    }
}

function New-RecoveryGeneration(
    [string]$Generation,
    $Manifest,
    $SeedPlan,
    [string]$CaseName,
    [byte[]]$ManifestBytes
) {
    $recovery = Join-Path $Generation 'recovery'
    $parent = Join-Path $recovery 'parent'
    $sourceLeaf = [IO.Path]::GetFileName(
        [string]$Manifest.provenance.sourcePath
    )
    $treeRoot = Join-Path $parent $sourceLeaf
    $manifestPath = Join-Path $recovery 'manifest.json'

    New-BoundDirectory $Generation
    New-BoundDirectory $recovery
    New-BoundDirectory $parent

    [Ait25ProvisionalCapture.Native]::SetDacl(
        (Assert-InFixture $parent),
        [string]$Manifest.originalParent.accessSddl,
        $true
    )

    Write-BoundNew (
        (Join-Path $parent 'stage-probe.txt')
    ) (
        $Utf8.GetBytes("ait25 provisional stage probe`r`n")
    )

    New-BoundDirectory $treeRoot

    foreach ($row in @($SeedPlan)) {
        if (
            [string]$row.kind -ceq 'dir' -and
            [string]$row.path -cne '.'
        ) {
            New-BoundDirectory (
                (Get-FullEntryPath $treeRoot ([string]$row.path))
            )
        }
    }

    foreach ($row in @($SeedPlan)) {
        $entry = $row.entry
        $path = Get-FullEntryPath $treeRoot ([string]$row.path)

        if ([string]$row.kind -ceq 'file') {
            [byte[]]$data = ([byte[]]$row.data).Clone()
            $zone = $null
            if ($null -ne $row.zone) {
                [byte[]]$zone = ([byte[]]$row.zone).Clone()
            }

            if (
                $CaseName -ceq 'K1-bytes' -and
                [string]$row.path -ceq 'd1\b.bin'
            ) {
                $data[0] = [byte]($data[0] -bxor 0xFF)
            }

            if (
                $CaseName -ceq 'K2-zone' -and
                [string]$row.path -ceq 'z1.txt'
            ) {
                $zone[0] = [byte]($zone[0] -bxor 0x01)
            }

            $objectId = [Ait25ProvisionalCapture.Native]::WriteNew(
                (Assert-InFixture $path),
                $data
            )

            if ($null -ne $zone) {
                [Ait25ProvisionalCapture.Native]::WriteZoneNew(
                    (Assert-InFixture $path),
                    $objectId,
                    $zone
                )
            }

            [Ait25ProvisionalCapture.Native]::SetBasic(
                (Assert-InFixture $path),
                [int64]$entry.creationFileTime,
                [int64]$entry.lastWriteFileTime,
                [uint32]$entry.attributes
            )
        } elseif ([string]$row.kind -ceq 'lx') {
            [byte[]]$raw = ([byte[]]$row.raw).Clone()
            if (
                $CaseName -ceq 'K3-lx' -and
                [string]$row.path -ceq 'l2'
            ) {
                [byte[]]$raw = New-LxRaw 'd1/b.txt'
                if ($raw.Length -ne ([byte[]]$row.raw).Length) {
                    throw 'K3 LX replacement changed raw-buffer length'
                }
            }

            $objectId = [Ait25ProvisionalCapture.Native]::AuthorLxNew(
                (Assert-InFixture $path),
                $raw
            )
            [Ait25ProvisionalCapture.Native]::SetBasicLx(
                (Assert-InFixture $path),
                $objectId,
                $raw,
                [int64]$entry.creationFileTime,
                [int64]$entry.lastWriteFileTime,
                [uint32]0x20,
                [uint32]0x420
            )
        }
    }

    for ($i = $SeedPlan.Count - 1; $i -ge 0; $i--) {
        $row = $SeedPlan[$i]
        if ([string]$row.kind -ceq 'dir') {
            $entry = $row.entry
            $path = Get-FullEntryPath $treeRoot ([string]$row.path)
            [Ait25ProvisionalCapture.Native]::SetBasic(
                (Assert-InFixture $path),
                [int64]$entry.creationFileTime,
                [int64]$entry.lastWriteFileTime,
                [uint32]0x80
            )
        }
    }

    Write-BoundNew $manifestPath $ManifestBytes

    [ordered]@{
        recovery = $recovery
        parent = $parent
        treeRoot = $treeRoot
        manifestPath = $manifestPath
        sourceLeaf = $sourceLeaf
    }
}

function Invoke-Child(
    [string]$Child,
    [string]$Generation,
    [string]$ManifestPin
) {
    if ($Clock.ElapsedMilliseconds -ge $OverallCeilingMs) {
        throw 'overall 10-minute ceiling reached before child launch'
    }

    $psExe = Join-Path $env:SystemRoot (
        'System32\WindowsPowerShell\v1.0\powershell.exe'
    )
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $psExe
    $start.Arguments = (
        '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -Generation "{1}" -ManifestSha256 {2}' -f
        $Child,
        $Generation,
        $ManifestPin
    )
    $start.WorkingDirectory = $Generation
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true

    $caseClock = [Diagnostics.Stopwatch]::StartNew()
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $null
    $stderr = $null
    $stdoutDone = $false
    $stderrDone = $false
    $timedOut = $false
    $killed = $false
    $exitCode = $null
    $ownedInspection = $null
    $stderrEncoding = $Utf8

    try {
        $stderrEncoding = $process.StandardError.CurrentEncoding
        $stdout = [Ait25ProvisionalCapture.BoundedDrain]::new(
            $process.StandardOutput.BaseStream,
            [int]$MaxStreamBytes
        )
        $stderr = [Ait25ProvisionalCapture.BoundedDrain]::new(
            $process.StandardError.BaseStream,
            [int]$MaxStreamBytes
        )

        while (-not $process.WaitForExit(250)) {
            if (
                $caseClock.ElapsedMilliseconds -ge $CaseCeilingMs -or
                $Clock.ElapsedMilliseconds -ge $OverallCeilingMs
            ) {
                $timedOut = $true
                break
            }
        }

        if ($timedOut) {
            $ownedInspection = [ordered]@{
                pid = $process.Id
                hasExitedBeforeKill = $process.HasExited
                retry = 'none'
            }
            if (-not $process.HasExited) {
                $process.Kill()
                $killed = $true
            }
            if (-not $process.WaitForExit(10000)) {
                throw "owned child PID $($process.Id) did not exit after kill"
            }
        } else {
            $process.WaitForExit()
            $exitCode = $process.ExitCode
            $ownedInspection = [ordered]@{
                pid = $process.Id
                hasExitedBeforeKill = $true
                retry = 'none'
            }
        }

        $stdoutDone = $stdout.Wait($DrainWaitMs)
        $stderrDone = $stderr.Wait($DrainWaitMs)
    } finally {
        if (-not $process.HasExited) {
            $ownedInspection = [ordered]@{
                pid = $process.Id
                hasExitedBeforeKill = $false
                retry = 'none'
            }
            $process.Kill()
            $killed = $true
            [void]$process.WaitForExit(10000)
        }
        $process.Dispose()
    }

    $outBytes = $stdout.Snapshot()
    $errBytes = $stderr.Snapshot()

    [ordered]@{
        exitCode = $exitCode
        timedOut = $timedOut
        killed = $killed
        elapsedMs = $caseClock.ElapsedMilliseconds
        ownedProcessInspection = $ownedInspection
        noAutomaticRetry = $true
        stdoutBytes = $stdout.TotalBytes
        stdoutRetained = $outBytes.Length
        stdoutOverflow = $stdout.Overflow
        stdoutDrained = $stdoutDone
        stdoutDrainError = $stdout.Error
        stderrBytes = $stderr.TotalBytes
        stderrRetained = $errBytes.Length
        stderrOverflow = $stderr.Overflow
        stderrDrained = $stderrDone
        stderrDrainError = $stderr.Error
        stderrEncoding = $stderrEncoding.WebName
        stdoutData = $outBytes
        stderrData = $errBytes
    }
}

function Add-NotRunCase($Definition, [string]$Reason) {
    [void]$Results.Add([ordered]@{
        name = [string]$Definition.name
        status = 'NOTRUN'
        injection = [string]$Definition.injection
        reason = $Reason
        expectedExit = [int]$Definition.expectedExit
        expectedCategory = [string]$Definition.expectedCategory
        expectedMessage = [string]$Definition.expectedMessage
        expectedDifferences = @($Definition.expectedDifferences)
        actualExit = $null
        actualCategory = $null
        actualMessage = $null
        actualLastStep = $null
        restoreStarted = $null
        failures = @($Reason)
    })
}

try {
    foreach ($pair in @(
        @($R, 'project root'),
        @($Fixtures, 'fixtures root')
    )) {
        $full = [IO.Path]::GetFullPath([string]$pair[0])
        if ($full -cne [string]$pair[0]) {
            throw "$($pair[1]) is not normalized"
        }
    }

    [void](Assert-Hash $CompactHarness $ExpectedCompactHarnessSha)
    [void](Assert-Hash $FrozenCapture $ExpectedFrozenCaptureSha)
    [void](Assert-Hash $FrozenRestore $ExpectedFrozenRestoreSha)
    [void](Assert-Hash $AcceptedManifestPath $ExpectedAcceptedManifestSha)
    [void](Assert-Hash $CompactReportPath $ExpectedCompactReportSha)

    $captureBytes = Read-Bounded $FrozenCapture $MaxInputBytes
    $captureText = $StrictUtf8.GetString($captureBytes)
    $captureLiteral = Get-ExactAddTypeLiteral $captureText
    Add-Type -TypeDefinition $captureLiteral

    Assert-PlainDirectory $R
    Assert-PlainDirectory $Fixtures

    $compactReportBytes = Read-Bounded $CompactReportPath $MaxInputBytes
    $compactReportText = [Ait25ProvisionalCapture.JsonScan]::Validate(
        $compactReportBytes,
        64,
        8000000
    )
    $compactReport = ConvertFrom-Json -InputObject $compactReportText
    if (
        -not [bool]$compactReport.allPassed -or
        [int]$compactReport.exitCode -ne 0
    ) {
        throw 'accepted compact report is not passing'
    }

    $literalSha = Get-ShaBytes $Utf8.GetBytes($captureLiteral)
    if (
        $literalSha -cne
        [string]$compactReport.pins.harnessCsharpLiteralSha256
    ) {
        throw "exact frozen Add-Type AST literal hash mismatch: $literalSha"
    }

    $acceptedChildSha =
        [string]$compactReport.pins.adaptedRestore.sha256
    if ($acceptedChildSha -cnotmatch '\A[0-9A-F]{64}\z') {
        throw 'accepted child pin is not uppercase SHA256'
    }
    [void](Assert-Hash $AcceptedChildPath $acceptedChildSha)

    $acceptedManifestBytes =
        Read-Bounded $AcceptedManifestPath $MaxInputBytes
    if (
        (Get-ShaBytes $acceptedManifestBytes) -cne
        $ExpectedAcceptedManifestSha
    ) {
        throw 'accepted manifest changed between pin and bounded read'
    }
    $acceptedManifestText =
        [Ait25ProvisionalCapture.JsonScan]::Validate(
            $acceptedManifestBytes,
            64,
            8000000
        )
    $acceptedManifest =
        ConvertFrom-Json -InputObject $acceptedManifestText

    $FixtureRoot = Join-Path $Fixtures (
        'a25k-' + [Guid]::NewGuid().ToString('N')
    )
    $GenerationRoot = Join-Path $FixtureRoot 'g'
    $ChildRoot = Join-Path $FixtureRoot 'x'
    $ChildPath = Join-Path $ChildRoot 'r.ps1'
    $ReportPath = Join-Path $FixtureRoot (
        'recovery-corruption-report.json'
    )

    if (
        [IO.Path]::GetDirectoryName($FixtureRoot) -cne $Fixtures -or
        [IO.Path]::GetFileName($FixtureRoot) -cnotmatch
            '\Aa25k-[0-9a-f]{32}\z'
    ) {
        throw 'fresh fixture-root binding failed'
    }
    if ([Ait25ProvisionalCapture.Native]::Probe($FixtureRoot) -eq 0) {
        throw 'fresh fixture root is occupied'
    }

    $acceptedChildBytes =
        Read-Bounded $AcceptedChildPath $MaxInputBytes
    if (
        (Get-ShaBytes $acceptedChildBytes) -cne
        $acceptedChildSha
    ) {
        throw 'accepted child changed between pin and bounded read'
    }

    $acceptedChildText = $StrictUtf8.GetString(
        $acceptedChildBytes
    )
    $oldGenerationRoot = Join-Path $AcceptedRoot 'g'
    $oldRootAssignment =
        '$GenerationsRoot = ''' + $oldGenerationRoot + ''''
    $newRootAssignment =
        '$GenerationsRoot = ''' + $GenerationRoot + ''''

    $childText = Splice-Once \
        $acceptedChildText \
        $oldRootAssignment \
        $newRootAssignment \
        'restore.GenerationsRoot'

    $reverseText = Splice-Once \
        $childText \
        $newRootAssignment \
        $oldRootAssignment \
        'restore.GenerationsRoot.inverse'

    if (
        [Convert]::ToBase64String($Utf8.GetBytes($reverseText)) -cne
        [Convert]::ToBase64String($acceptedChildBytes)
    ) {
        throw 'adapted child inverse byte proof failed'
    }

    $childTokens = $null
    $childErrors = $null
    $childAst = [Management.Automation.Language.Parser]::ParseInput(
        $childText,
        [ref]$childTokens,
        [ref]$childErrors
    )
    if (@($childErrors).Count -ne 0) {
        throw 'adapted child has PowerShell parse errors'
    }

    $oldSource = Join-Path $AcceptedRoot 'p\q\ait25'
    $oldSourceParent = Join-Path $AcceptedRoot 'p\q'
    $oldForbidden = Join-Path $AcceptedRoot 'p'

    if (
        (Get-AssignmentLiteral $childAst 'GenerationsRoot') -cne
        $GenerationRoot
    ) {
        throw 'adapted child GenerationsRoot AST binding failed'
    }
    if (
        (Get-AssignmentLiteral $childAst 'SourcePathLiteral') -cne
        $oldSource
    ) {
        throw 'SourcePathLiteral provenance changed'
    }
    if (
        (Get-AssignmentLiteral $childAst 'SourceParentLiteral') -cne
        $oldSourceParent
    ) {
        throw 'SourceParentLiteral provenance changed'
    }

    $forbiddenLiteral =
        'const string ForbiddenRoot = @"' + $oldForbidden + '";'
    if ((Count-Ordinal $childText $forbiddenLiteral) -ne 1) {
        throw 'ForbiddenRoot exact literal was not preserved once'
    }

    $rootedStrings = @($childAst.FindAll({
        param($node)
        $node -is
            [Management.Automation.Language.StringConstantExpressionAst] -and
            ([string]$node.Value) -cmatch '\A[A-Za-z]:\\'
    }, $true) | ForEach-Object {
        [string]$_.Value
    })

    $approvedRooted = @(
        $GenerationRoot,
        $oldSource,
        $oldSourceParent
    )
    if ($rootedStrings.Count -ne $approvedRooted.Count) {
        throw "adapted child rooted AST string count is $($rootedStrings.Count)"
    }
    foreach ($approved in $approvedRooted) {
        if (
            @($rootedStrings | Where-Object {
                $_ -ceq $approved
            }).Count -ne 1
        ) {
            throw "adapted child static path proof failed for '$approved'"
        }
    }

    $childBytes = $Utf8.GetBytes($childText)
    $ChildSha = Get-ShaBytes $childBytes

    \# Hard gate: regenerate and hash-check every payload, Zone stream, and
    \# manifest-provided LX raw buffer before any generation directory exists.
    $SeedPlan = New-ValidatedSeedPlan $acceptedManifest

    $pins = [ordered]@{
        compactHarness = [ordered]@{
            path = $CompactHarness
            sha256 = $ExpectedCompactHarnessSha
        }
        frozenCapture = [ordered]@{
            path = $FrozenCapture
            sha256 = $ExpectedFrozenCaptureSha
        }
        frozenRestore = [ordered]@{
            path = $FrozenRestore
            sha256 = $ExpectedFrozenRestoreSha
        }
        compactReport = [ordered]@{
            path = $CompactReportPath
            sha256 = $ExpectedCompactReportSha
        }
        acceptedManifest = [ordered]@{
            path = $AcceptedManifestPath
            sha256 = $ExpectedAcceptedManifestSha
        }
        acceptedChild = [ordered]@{
            path = $AcceptedChildPath
            sha256 = $acceptedChildSha
        }
    }
    $PinsBefore = Get-PinSnapshot $pins

    [Ait25ProvisionalCapture.Native]::BindWriteRoot($FixtureRoot)
    New-BoundDirectory $FixtureRoot
    New-BoundDirectory $GenerationRoot
    New-BoundDirectory $ChildRoot
    Write-BoundNew $ChildPath $childBytes

    if ((Get-FileSha $ChildPath) -cne $ChildSha) {
        throw 'fresh adapted-child readback hash mismatch'
    }

    $definitions = @(
        [ordered]@{
            name = 'K0-control'
            injection = 'none'
            expectedExit = 0
            expectedCategory = 'pass'
            expectedMessage = $PassMessage
            expectedLastStep = 'restore.verified'
            expectedDifferences = @()
        },
        [ordered]@{
            name = 'K1-bytes'
            injection = 'd1\b.bin byte 0 XOR 0xFF at create-new'
            expectedExit = 4
            expectedCategory = 'integrity'
            expectedMessage = 'recovery differs from pinned manifest: d1\b.bin|sha256'
            expectedLastStep = 'paths.withinLimits'
            expectedDifferences = @(
                'd1\b.bin|sha256'
            )
        },
        [ordered]@{
            name = 'K2-zone'
            injection = 'z1.txt Zone byte 0 XOR 0x01 at create-new'
            expectedExit = 4
            expectedCategory = 'integrity'
            expectedMessage = 'recovery differs from pinned manifest: z1.txt|streams'
            expectedLastStep = 'paths.withinLimits'
            expectedDifferences = @(
                'z1.txt|streams'
            )
        },
        [ordered]@{
            name = 'K3-lx'
            injection = 'l2 valid LX v2 target d1/a.txt -> d1/b.txt at create-new'
            expectedExit = 4
            expectedCategory = 'integrity'
            expectedMessage = 'recovery differs from pinned manifest: l2|lxRawBase64; l2|lxRawSha256; l2|lxTarget'
            expectedLastStep = 'paths.withinLimits'
            expectedDifferences = @(
                'l2|lxRawBase64',
                'l2|lxRawSha256',
                'l2|lxTarget'
            )
        }
    )

    $K0Passed = $false

    foreach ($definition in $definitions) {
        if (
            [string]$definition.name -cne 'K0-control' -and
            -not $K0Passed
        ) {
            Add-NotRunCase \
                $definition \
                'K0 positive control did not fully pass; corruption launch gated'
            continue
        }

        $caseFailures = New-Object Collections.ArrayList
        $runId = [Guid]::NewGuid().ToString('N')
        $generation = Join-Path $GenerationRoot ('g-' + $runId)
        $childReportPath = Join-Path $generation 'child-report.json'
        $stdoutPath = Join-Path $generation 'child.stdout.bin'
        $stderrPath = Join-Path $generation 'child.stderr.bin'
        $restorePath = Join-Path $generation 'restore'
        $launch = $null
        $childReport = $null
        $lastStep = $null
        $manifestSha = $null
        $manifestBefore = $null
        $manifestAfter = $null
        $prelaunchDifferences = $null
        $pinsAfterCase = $null
        $layout = $null

        try {
            if (
                [IO.Path]::GetDirectoryName($generation) -cne
                    $GenerationRoot -or
                [IO.Path]::GetFileName($generation) -cnotmatch
                    '\Ag-[0-9a-f]{32}\z'
            ) {
                throw 'fresh generation binding is invalid'
            }

            $manifest = New-BaseManifest \
                $acceptedManifestText \
                $runId \
                $ChildSha
            $manifestText = Convert-ManifestObjectToText $manifest
            $manifestBytes = $Utf8.GetBytes($manifestText)
            $manifestSha = Get-ShaBytes $manifestBytes

            $layout = New-RecoveryGeneration \
                $generation \
                $manifest \
                $SeedPlan \
                ([string]$definition.name) \
                $manifestBytes

            $manifestBefore = Get-FileSha $layout.manifestPath
            if ($manifestBefore -cne $manifestSha) {
                throw 'fresh manifest write/readback hash mismatch'
            }

            Assert-EnvelopeAndProbe \
                $layout.recovery \
                $layout.sourceLeaf \
                $manifest \
                $true

            $prelaunchTree = Get-IndependentTree \
                $layout.treeRoot \
                $manifest
            $prelaunchDifferences = Compare-IndependentTree \
                $manifest \
                $prelaunchTree

            Assert-ExpectedDifferences \
                @($prelaunchDifferences) \
                @($definition.expectedDifferences) \
                ([string]$definition.name + ' prelaunch Inspect')

            Write-Output (
                '[a25k] {0}: launch' -f $definition.name
            )
            $launch = Invoke-Child \
                $ChildPath \
                $generation \
                $manifestSha

            Write-BoundNew $stdoutPath ([byte[]]$launch.stdoutData)
            Write-BoundNew $stderrPath ([byte[]]$launch.stderrData)

            if ($launch.timedOut) {
                [void]$caseFailures.Add('child timed out')
            }
            if ([int]$launch.exitCode -ne [int]$definition.expectedExit) {
                [void]$caseFailures.Add(
                    "actual exit '$($launch.exitCode)' != '$($definition.expectedExit)'"
                )
            }
            if (-not $launch.stdoutDrained -or -not $launch.stderrDrained) {
                [void]$caseFailures.Add(
                    'stdout/stderr drain did not reach EOF'
                )
            }
            if ($launch.stdoutOverflow -or $launch.stderrOverflow) {
                [void]$caseFailures.Add(
                    'stdout/stderr exceeded the 1 MiB per-stream bound'
                )
            }
            if (
                $null -ne $launch.stdoutDrainError -or
                $null -ne $launch.stderrDrainError
            ) {
                [void]$caseFailures.Add('stdout/stderr drain error')
            }

            if (
                [Ait25ProvisionalCapture.Native]::Probe(
                    $childReportPath
                ) -ne 0
            ) {
                [void]$caseFailures.Add('child-report.json absent')
            } else {
                $reportBytes = Read-Bounded \
                    $childReportPath \
                    $MaxReportBytes
                $reportText =
                    [Ait25ProvisionalCapture.JsonScan]::Validate(
                        $reportBytes,
                        32,
                        2000000
                    )
                $childReport = ConvertFrom-Json -InputObject $reportText

                if (
                    [string]$childReport.category -cne
                    [string]$definition.expectedCategory
                ) {
                    [void]$caseFailures.Add(
                        "category '$($childReport.category)' != '$($definition.expectedCategory)'"
                    )
                }
                if (
                    [string]$childReport.message -cne
                    [string]$definition.expectedMessage
                ) {
                    [void]$caseFailures.Add(
                        "exact message '$($childReport.message)' != '$($definition.expectedMessage)'"
                    )
                }
                if (
                    [int]$childReport.exitCode -ne
                    [int]$launch.exitCode
                ) {
                    [void]$caseFailures.Add(
                        'report exit differs from actual process exit'
                    )
                }
                if (
                    [string]$childReport.generation -cne
                    $generation
                ) {
                    [void]$caseFailures.Add(
                        'report generation binding mismatch'
                    )
                }
                if (
                    [string]$childReport.codeSha256 -cne
                    $ChildSha
                ) {
                    [void]$caseFailures.Add(
                        'report adapted-child code pin mismatch'
                    )
                }
                if (
                    [string]$childReport.manifestSha256Pinned -cne
                    $manifestSha
                ) {
                    [void]$caseFailures.Add(
                        'report manifest CLI pin mismatch'
                    )
                }
                if (
                    [string]$childReport.reportFile -cne
                        $childReportPath -or
                    $null -ne $childReport.reportWriteError
                ) {
                    [void]$caseFailures.Add(
                        'bounded child report write binding failed'
                    )
                }

                $steps = @($childReport.steps)
                if ($steps.Count -gt 0) {
                    $lastStep = [string]$steps[-1].step
                }
                if (
                    $lastStep -cne
                    [string]$definition.expectedLastStep
                ) {
                    [void]$caseFailures.Add(
                        "last step '$lastStep' != '$($definition.expectedLastStep)'"
                    )
                }

                if ([string]$definition.name -ceq 'K0-control') {
                    $actualSteps = @($steps | ForEach-Object {
                        [string]$_.step
                    })
                    if (
                        $actualSteps.Count -ne
                            $ExpectedPassSteps.Count -or
                        ($actualSteps -join "`n") -cne
                            ($ExpectedPassSteps -join "`n")
                    ) {
                        [void]$caseFailures.Add(
                            'K0 did not emit the exact nine pass steps'
                        )
                    }
                    if (-not [bool]$childReport.restoreStarted) {
                        [void]$caseFailures.Add(
                            'K0 restoreStarted is not true'
                        )
                    }
                } else {
                    if ([bool]$childReport.restoreStarted) {
                        [void]$caseFailures.Add(
                            'negative case restoreStarted is not false'
                        )
                    }
                    if (
                        @($steps | Where-Object {
                            [string]$_.step -ceq
                                'recovery.verified'
                        }).Count -ne 0
                    ) {
                        [void]$caseFailures.Add(
                            'negative case reached recovery.verified'
                        )
                    }
                    if (
                        [string]$childReport.message -match
                        '(?i)recovery top level|recovery\\parent|missing.*parent|path component.*parent'
                    ) {
                        [void]$caseFailures.Add(
                            'missing recovery/parent caused a false pass path'
                        )
                    }
                }
            }

            if ([string]$definition.name -ceq 'K0-control') {
                if (
                    [Ait25ProvisionalCapture.Native]::Probe(
                        $restorePath
                    ) -ne 0
                ) {
                    [void]$caseFailures.Add('K0 restore output absent')
                } else {
                    try {
                        Assert-EnvelopeAndProbe \
                            $restorePath \
                            $layout.sourceLeaf \
                            $manifest \
                            $false

                        $restoreTreeRoot = Join-Path (
                            (Join-Path $restorePath 'parent')
                        ) $layout.sourceLeaf
                        $independentRestore = Get-IndependentTree \
                            $restoreTreeRoot \
                            $manifest
                        $restoreDifferences =
                            Compare-IndependentTree \
                                $manifest \
                                $independentRestore

                        Assert-ExpectedDifferences \
                            @($restoreDifferences) \
                            @() \
                            'K0 independent restored-tree fidelity'

                        $independentRecovery =
                            Get-IndependentTree \
                                $layout.treeRoot \
                                $manifest
                        Assert-IdentityFidelity \
                            $manifest \
                            $independentRecovery \
                            $independentRestore
                    } catch {
                        [void]$caseFailures.Add(
                            'K0 independent fidelity failed: ' +
                            $_.Exception.GetBaseException().Message
                        )
                    }
                }
            } else {
                if (
                    [Ait25ProvisionalCapture.Native]::Probe(
                        $restorePath
                    ) -eq 0
                ) {
                    [void]$caseFailures.Add(
                        'negative case restore output exists'
                    )
                }
            }

            $manifestAfter = Get-FileSha $layout.manifestPath
            if ($manifestAfter -cne $manifestBefore) {
                [void]$caseFailures.Add(
                    'fresh case manifest changed during child execution'
                )
            }
            if ((Get-FileSha $ChildPath) -cne $ChildSha) {
                [void]$caseFailures.Add(
                    'fresh adapted child changed during execution'
                )
            }

            $pinsAfterCase = Get-PinSnapshot $pins
            foreach (
                $pinFailure in @(
                    Compare-PinSnapshot $PinsBefore $pinsAfterCase
                )
            ) {
                [void]$caseFailures.Add($pinFailure)
            }
        } catch {
            [void]$caseFailures.Add(
                'harness exception: ' +
                $_.Exception.GetBaseException().Message
            )
        }

        $status = if ($caseFailures.Count -eq 0) {
            'PASS'
        } else {
            'FAIL'
        }

        if ([string]$definition.name -ceq 'K0-control') {
            $K0Passed = ($status -ceq 'PASS')
        }

        Write-Output (
            '[a25k] {0}: {1}' -f
            $definition.name,
            $status
        )

        [void]$Results.Add([ordered]@{
            name = [string]$definition.name
            status = $status
            injection = [string]$definition.injection
            runId = $runId
            expectedExit = [int]$definition.expectedExit
            expectedCategory = [string]$definition.expectedCategory
            expectedMessage = [string]$definition.expectedMessage
            expectedLastStep = [string]$definition.expectedLastStep
            expectedDifferences = @($definition.expectedDifferences)
            prelaunchDifferences = @($prelaunchDifferences)
            actualExit = if ($null -ne $launch) {
                $launch.exitCode
            } else {
                $null
            }
            actualCategory = if ($null -ne $childReport) {
                $childReport.category
            } else {
                $null
            }
            actualMessage = if ($null -ne $childReport) {
                $childReport.message
            } else {
                $null
            }
            actualLastStep = $lastStep
            restoreStarted = if ($null -ne $childReport) {
                $childReport.restoreStarted
            } else {
                $null
            }
            timedOut = if ($null -ne $launch) {
                $launch.timedOut
            } else {
                $null
            }
            killed = if ($null -ne $launch) {
                $launch.killed
            } else {
                $null
            }
            elapsedMs = if ($null -ne $launch) {
                $launch.elapsedMs
            } else {
                $null
            }
            ownedProcessInspection = if ($null -ne $launch) {
                $launch.ownedProcessInspection
            } else {
                $null
            }
            noAutomaticRetry = $true
            manifestSha256 = $manifestSha
            manifestBefore = $manifestBefore
            manifestAfter = $manifestAfter
            pinsAfterCase = $pinsAfterCase
            failures = @($caseFailures)
            artifacts = [ordered]@{
                generation = $generation
                manifest = if ($null -ne $layout) {
                    $layout.manifestPath
                } else {
                    $null
                }
                childReport = $childReportPath
                stdout = $stdoutPath
                stderr = $stderrPath
                restore = $restorePath
            }
            bounded = [ordered]@{
                stdoutBytes = if ($null -ne $launch) {
                    $launch.stdoutBytes
                } else {
                    $null
                }
                stderrBytes = if ($null -ne $launch) {
                    $launch.stderrBytes
                } else {
                    $null
                }
                childReportBytes = if (
                    Test-Path -LiteralPath $childReportPath -PathType Leaf
                ) {
                    (Get-Item -LiteralPath $childReportPath).Length
                } else {
                    $null
                }
                limitPerArtifactBytes = $MaxReportBytes
            }
        })
    }

    $PinsFinal = Get-PinSnapshot $pins
    $finalPinFailures = @(
        Compare-PinSnapshot $PinsBefore $PinsFinal
    )
    if ($finalPinFailures.Count -gt 0) {
        $Fatal = 'external pins changed: ' +
            ($finalPinFailures -join '; ')
    }
} catch {
    $Fatal = $_.Exception.GetBaseException().Message
}

$requiredNames = @(
    'K0-control',
    'K1-bytes',
    'K2-zone',
    'K3-lx'
)
$missingOrRepeated = @($requiredNames | Where-Object {
    $name = $_
    @($Results | Where-Object {
        [string]$_.name -ceq $name
    }).Count -ne 1
})
$passCount = @($Results | Where-Object {
    [string]$_.status -ceq 'PASS'
}).Count
$failCount = @($Results | Where-Object {
    [string]$_.status -ceq 'FAIL'
}).Count
$notRunCount = @($Results | Where-Object {
    [string]$_.status -ceq 'NOTRUN'
}).Count

$allPassed = (
    $null -eq $Fatal -and
    $missingOrRepeated.Count -eq 0 -and
    $Results.Count -eq $requiredNames.Count -and
    $passCount -eq $requiredNames.Count
)

$finalReport = [ordered]@{
    schema = 'ait25-recovery-corruption-synthetic/1'
    label = 'SYNTHETIC recovery corruption and positive-control tests only'
    synthetic = $true
    allPassed = $allPassed
    exitCode = if ($allPassed) { 0 } else { 1 }
    fatal = $Fatal
    fixtureRoot = $FixtureRoot
    reportFile = $ReportPath
    acceptedInputs = [ordered]@{
        compactHarness = $CompactHarness
        frozenCapture = $FrozenCapture
        frozenRestore = $FrozenRestore
        compactReport = $CompactReportPath
        acceptedManifest = $AcceptedManifestPath
        acceptedChild = $AcceptedChildPath
    }
    pinsBefore = $PinsBefore
    pinsAfter = $PinsFinal
    childAdaptation = [ordered]@{
        freshChild = $ChildPath
        freshChildSha256 = $ChildSha
        changedBinding = 'GenerationsRoot exact assignment only'
        oldSyntheticSourcePathLiteralPreserved = $true
        oldSyntheticSourceParentLiteralPreserved = $true
        oldSyntheticForbiddenRootPreserved = $true
        inverseBase64ByteProofRequired = $true
        parseErrorsRequired = 0
        staticRootedPathReviewRequired = $true
    }
    payloadGate = [ordered]@{
        completedBeforeGenerationCreation = $true
        ordinaryFiles = 'regenerated from exact compact formulas and checked against manifest SHA256'
        zoneStreams = 'regenerated from exact compact formulas and checked against manifest length/SHA256'
        lx = 'decoded only from hash-validated manifest lxRawBase64; K3 replacement regenerated as valid LX v2'
    }
    recoveryIdentitySemantics = 'fresh recovery IDs are required to be unique and disjoint from manifest source IDs/sourceParentId; equality with original synthetic source IDs is neither required nor permitted'
    summary = [ordered]@{
        required = $requiredNames.Count
        PASS = $passCount
        FAIL = $failCount
        NOTRUN = $notRunCount
        missingOrRepeated = @($missingOrRepeated)
    }
    cases = @($Results)
    limits = [ordered]@{
        caseCeilingMs = $CaseCeilingMs
        overallCeilingMs = $OverallCeilingMs
        stdoutBytes = $MaxStreamBytes
        stderrBytes = $MaxStreamBytes
        childReportBytes = $MaxReportBytes
        harnessReportBytes = $MaxReportBytes
        drainWaitMs = $DrainWaitMs
        outerWatchdog = 'SEPARATE; existing root watchdog pattern to be adapted independently'
        automaticRetry = 'NONE'
    }
    safety = [ordered]@{
        createNewOnly = $true
        corruptionAppliedOnlyAtCreation = $true
        acceptedFixtureMutation = 'NONE'
        deletion = 'NONE'
        overwrite = 'NONE'
        merge = 'NONE'
        originalProjectOrPayloadAccess = 'REFUSED'
        credentialsOrOAuth = 'NONE'
        unrelatedPrivateLogs = 'NONE'
        git = 'NONE'
        retainedArtifacts = 'ALL'
    }
    notRun = [ordered]@{
        sourceDrift = 'NOT RUN'
        scale = 'NOT RUN'
        originalRuntime = 'NOT RUN; provenance paths remain inert strings'
        originalTests = 'NOT RUN'
    }
    elapsedMs = $Clock.ElapsedMilliseconds
    finishedUtc = [DateTime]::UtcNow.ToString('o')
}

if (
    $ReportPath -and
    $FixtureRoot -and
    [Ait25ProvisionalCapture.Native]::Probe($FixtureRoot) -eq 0
) {
    try {
        $finalBytes = $Utf8.GetBytes(
            (ConvertTo-Json -Depth 30 -InputObject $finalReport)
        )
        if ($finalBytes.Length -gt $MaxReportBytes) {
            throw "final report exceeds $MaxReportBytes bytes"
        }
        Write-BoundNew $ReportPath $finalBytes
        $ReportWritten = $true
        Write-Output "[a25k] report: $ReportPath"
    } catch {
        [Console]::Error.WriteLine(
            'final CREATE_NEW report write failed: ' +
            $_.Exception.GetBaseException().Message
        )
    }
}

if ($Fatal) {
    [Console]::Error.WriteLine([string]$Fatal)
}
if (-not $ReportWritten -or -not $allPassed) {
    exit 1
}
exit 0
END_POWERSHELL
BEGIN_NOTE
Intended path: scripts/test-ait25-recovery-corruption.ps1

This is authored but deliberately unexecuted and uncompiled. It requires a separately adapted outer watchdog before execution. The harness is limited to fresh retained a25k-* synthetic fixtures, uses create-new native writers, keeps accepted inputs read-only, and never opens the provenance source paths.
END_NOTE
