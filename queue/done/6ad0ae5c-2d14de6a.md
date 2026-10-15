---
schema-version: 1
id: 6ad0ae5c-2d14de6a
project: kb-ops
action: cleanup-nyu-link-metadata-build
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 93875688f9b793ca
state: done
approval: null
workflow: 01a13f24-e4e6-7ea3-9e4a-757e749926a3
depends-on: []
variant-group: null
role: work
session-id: 6ad0ad30-831173f5
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Worker builder, notboss. Rootpreamble passed. Read only KB CLAUDE.md/governance/agent-rules.md and under C:\Users\danie\Projects\Filesystem-Cleanup: scripts/test-nyu-lx-capability.ps1 (SHA045E04C84350D8D7CDE8A254D0FE8EFD1F6231E6F6A845B25B66CC3092519F10), reports/nyu-link-target-map.json (SHA3B1BE06AA356B4309D7F3800A4A4C663E8139B627A362DA3842DC596C3EC60E0), reviews/claude-next-lx-recovery-design-20261015.md. No otherfiles/searches, coursework, credentials, private logs. Do notexecute/readliveoriginals/writefiles. Return exactnew standalone PowerShell5.1script fencedpowershell plusshortnote; rootmaterializes scripts/read-nyu-link-metadata.ps1 for independentreviewfirst.
Goal: bounded READ-ONLY metadata evidence on the97 knownLXlinks and deduplicated ancestor directories inside their threefixedcourse roots. Discover no otherpaths; never follow/query linktargets. Inputmapstrictpinnedbytescounts97 validalias ait25/ait26/cs202; rootsfixed C:\Users\danie\source\repos\{alias}. Validate rowshape, relativepath slashcomponents no..colon/control/device/trailingdotspace, uniqueordinalignorecase; no rawGitconfig/courseworkcontent. Pin map andhelperbefore/after. Compile frozen C#literal ASTextraction ONLY from approvedcapabilityscript; no dot-source/no main. Native.One(path,0) reads rawlinkbuffer andEA size but no ordinarypayload exceptzerobyte andno targetfollow; do NOT callSnap on originals. For metadata-only improve standalone nofollow nativehelper so evenregularcontentneveropened: CreateFile OPEN_REPARSE_POINT|BACKUP_SEMANTICS with READ_ATTRIBUTES|READ_EA|READ_CONTROL ONLY, share7,OPEN_EXISTING. Query attr/ID/length/creation/write; GetKernelObjectSecurity OWNER/GROUP/DACL (noSACL, no privilegechanges); NtQueryInformationFile FileEaInformation sizeonly; GetFileInformationByHandleEx FileCaseSensitiveInfo23 fordirectories; FileStreamInfo7 liststreamnames/sizes bounded64KB/128entries, no readstreamcontent. Read FSCTL_GET raw dataforlinkonly; validate tag/version/rawUTF8target equals pinnedmap withoutresolvingtarget. Native helpers have NO write/delete/set/rename APIs. No robocopy/git/WSL/subprocess/network. Allancestorhandles up todrive guardplainnonreparsedir; linkleafmayonlyLXtag, unexpectedkindrefuse/UNKNOWN. Parentchecks bothbefore/after plusreadtwoobservations comparestableIDs/rawbuffer/rawSD/basicmeta/EA/case/streams. Windowsunsupportedflag error87 or50 => UNKNOWN notfalseoff. Failgracefullyonpermissions asUNKNOWN withcode; noadminrequest.
Report new CreateNew file under fixed cleanup/reports/read-nyu-link-metadata-<GUID>.json, guardedancestors, no otherwritesexceptAddTypecompilerTEMPdisclosed. Report digestpinnedinput, actualscriptSHA, nodesmetadata, entryset=maponlynotfreshfullinventory, nofollowbyconstructionnotOSaudit, unknowns anddrifts. Writes mustnotfollowexistingreport leaf (CreateNew). No creds/regular-filecontent. Exit0 allknownstable,2unknown/unsupported,1mismatch/drift/error; never implyrecovery ormoveapproval. Keep ~300lines maximumifpossible; deferstreamsorSDfield onlyifexplicitunknown. Runtimebudget120s withrootouterwatchdogneeded. Pureparse/validation self-test mode optional BUT nofixturewritesneeded: define functions for reviewer to ASTextract; no flag to acceptarbitrarymap/paths.
Return code and exactlimitations, noexecutionclaim. Afterreviewrootcanrunreadonlyoriginalscan alreadyauthorized; workersneverreadoriginals.

## Result

```powershell
#Requires -Version 5.1
<#
Read-only metadata probe for the 97 pinned NYU LX links and their computed ancestors.
No parameters. No directory enumeration, target resolution, subprocess, network, or content reads.
Only persistent write: one CreateNew JSON report beneath the fixed cleanup reports directory.
Add-Type may use compiler-managed TEMP files. Use an outer 120-second watchdog.
#>
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$Cleanup = 'C:\Users\danie\Projects\Filesystem-Cleanup'
$MapPath = "$Cleanup\reports\nyu-link-target-map.json"
$CapabilityPath = "$Cleanup\scripts\test-nyu-lx-capability.ps1"
$ReportRoot = "$Cleanup\reports"
$MapPin = '3B1BE06AA356B4309D7F3800A4A4C663E8139B627A362DA3842DC596C3EC60E0'
$CapabilityPin = '045E04C84350D8D7CDE8A254D0FE8EFD1F6231E6F6A845B25B66CC3092519F10'
$Roots = [ordered]@{
    ait25 = 'C:\Users\danie\source\repos\ait25'
    ait26 = 'C:\Users\danie\source\repos\ait26'
    cs202 = 'C:\Users\danie\source\repos\cs202'
}
$ExpectedAliasCounts = @{ ait25 = 41; ait26 = 55; cs202 = 1 }
$Clock = [Diagnostics.Stopwatch]::StartNew()
$StartUtc = [DateTime]::UtcNow.ToString('o')
$Utf8 = New-Object Text.UTF8Encoding($false, $true)
$Unknowns = New-Object Collections.ArrayList
$Drifts = New-Object Collections.ArrayList
$Mismatches = New-Object Collections.ArrayList

function Get-Sha256Bytes([byte[]]$Bytes) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-', '') }
    finally { $h.Dispose() }
}
function Read-Pinned([string]$Path, [string]$Pin) {
    $b = [IO.File]::ReadAllBytes($Path)
    $sha = Get-Sha256Bytes $b
    if ($sha -cne $Pin) { throw "pinned input mismatch: $Path expected $Pin actual $sha" }
    [ordered]@{ bytes = $b; sha256 = $sha }
}
function Get-Literal([string]$Text, [string]$VariableName) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput(
        $Text, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw "AST parse failed: $($errors[0].Message)" }
    $hits = @($ast.FindAll({
        param($n)
        $n -is [Management.Automation.Language.AssignmentStatementAst] -and
        $n.Left -is [Management.Automation.Language.VariableExpressionAst] -and
        $n.Left.VariablePath.UserPath -ceq $VariableName -and
        $n.Right -is [Management.Automation.Language.StringConstantExpressionAst]
    }, $true))
    if ($hits.Count -ne 1) { throw "expected one frozen literal assignment to `$$VariableName" }
    $hits[0].Right.Value
}
function Get-AddTypeLiteral([string]$Text) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput(
        $Text, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw "approved capability AST parse failed: $($errors[0].Message)" }
    $hits = New-Object Collections.ArrayList
    foreach ($c in @($ast.FindAll({
        param($n)
        $n -is [Management.Automation.Language.CommandAst] -and
        $n.GetCommandName() -ceq 'Add-Type'
    }, $true))) {
        for ($i = 0; $i -lt $c.CommandElements.Count - 1; $i++) {
            $e = $c.CommandElements[$i]
            if ($e -is [Management.Automation.Language.CommandParameterAst] -and
                $e.ParameterName -ceq 'TypeDefinition') {
                $v = $c.CommandElements[$i + 1]
                if ($v -isnot [Management.Automation.Language.StringConstantExpressionAst]) {
                    throw 'approved capability TypeDefinition is not a literal'
                }
                [void]$hits.Add($v.Value)
            }
        }
    }
    if ($hits.Count -ne 1) { throw 'expected one literal Add-Type TypeDefinition in approved capability' }
    [string]$hits[0]
}
function Add-Unknown([string]$Node, [string]$Field, [string]$Detail) {
    [void]$Unknowns.Add([ordered]@{ node = $Node; field = $Field; detail = $Detail })
}
function Test-Deadline {
    if ($Clock.Elapsed.TotalSeconds -gt 120) { throw 'internal runtime bound exceeded; outer watchdog remains required' }
}
function Test-Under([string]$Path, [string]$Root) {
    $Path -ceq $Root -or $Path.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Test-Component([string]$Component) {
    if ([string]::IsNullOrEmpty($Component) -or $Component -ceq '.' -or
        $Component -ceq '..' -or $Component -match '[:\x00-\x1F]' -or
        $Component -match '[. ]$') { return $false }
    $stem = ($Component -split '\.', 2)[0]
    -not ($stem -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$')
}
function Get-Fingerprint($R) {
    $o = [ordered]@{
        kind = $R.Kind; openStatus = $R.OpenStatus; attributes = $R.Attributes
        links = $R.Links; length = $R.Length; creation = $R.Creation
        write = $R.Write; id = $R.Id; idStatus = $R.IdStatus
        eaBytes = $R.EaBytes; eaStatus = $R.EaStatus
        sdSha256 = $R.SdSha256; sddl = $R.Sddl; daclProtected = $R.DaclProtected
        sdStatus = $R.SdStatus; caseFlags = $R.CaseFlags
        caseStatus = $R.CaseStatus; streams = $R.Streams
        streamsStatus = $R.StreamsStatus; tag = $R.Tag
        rawSha256 = $R.RawSha256; rawBase64 = $R.RawBase64
        version = $R.Version; target = $R.Target; decodeStatus = $R.DecodeStatus
    }
    Get-Sha256Bytes $Utf8.GetBytes((ConvertTo-Json -Compress -Depth 8 -InputObject $o))
}
function Add-RecordUnknowns([string]$Name, $R) {
    foreach ($p in 'OpenStatus','IdStatus','EaStatus','SdStatus','CaseStatus','StreamsStatus') {
        $v = [string]$R.$p
        if ($v -and $v -cne 'OK' -and $v -cne 'N/A') { Add-Unknown $Name $p $v }
    }
}

$ScriptBytes0 = [IO.File]::ReadAllBytes($PSCommandPath)
$ScriptSha0 = Get-Sha256Bytes $ScriptBytes0
$Map0 = Read-Pinned $MapPath $MapPin
$Capability0 = Read-Pinned $CapabilityPath $CapabilityPin

\# Parse, but never compile or execute, the approved capability program.
$CapabilityLiteral = Get-AddTypeLiteral ($Utf8.GetString($Capability0.bytes))
foreach ($marker in 'FILE_FLAG_OPEN_REPARSE_POINT','FSCTL_GET_REPARSE_POINT',
                   'public static Rec One') {
    if ($CapabilityLiteral.IndexOf($marker, [StringComparison]::Ordinal) -lt 0) {
        throw "approved capability literal lacks marker: $marker"
    }
}

\# Frozen replacement contains read-only APIs only. It has no write, delete, set-security,
\# rename, directory-enumeration, target-resolution, or ordinary-content API.
$NativeCSharp = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace NyuLxMetadata {
 public sealed class StreamRec { public string Name; public long Size, Allocation; }
 public sealed class Rec {
  public string Kind="unknown", OpenStatus, Id, IdStatus, EaStatus, SdSha256, Sddl, SdStatus;
  public string CaseStatus, StreamsStatus, RawSha256, RawBase64, Target, DecodeStatus;
  public uint Attributes, Links, EaBytes, Tag, Version, CaseFlags;
  public long Length, Creation, Write;
  public bool DaclProtected;
  public List<StreamRec> Streams = new List<StreamRec>();
 }
 public static class Native {
  [StructLayout(LayoutKind.Sequential)]
  struct BHFI {
   public uint Attrs,C1,C2,A1,A2,W1,W2,Vol,SizeHigh,SizeLow,Links,IdxHigh,IdxLow;
  }
  [StructLayout(LayoutKind.Sequential)] struct IOSB { public IntPtr Status, Info; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string n,uint a,uint s,IntPtr sa,uint d,uint f,IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle h,out BHFI i);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int c,byte[] b,uint l);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool DeviceIoControl(SafeFileHandle h,uint c,byte[] i,uint il,byte[] o,uint ol,out uint r,IntPtr ov);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool GetKernelObjectSecurity(SafeFileHandle h,uint q,byte[] d,uint l,ref uint need);
  [DllImport("ntdll.dll")]
  static extern int NtQueryInformationFile(SafeFileHandle h,out IOSB io,out uint ea,uint len,int cls);

  const uint Access=0x00020088u; // READ_CONTROL | READ_ATTRIBUTES | READ_EA
  const uint Flags=0x02200000u;  // OPEN_REPARSE_POINT | BACKUP_SEMANTICS
  const uint LxTag=0xA000001Du;
  static readonly UTF8Encoding Strict = new UTF8Encoding(false,true);

  static string Hex(byte[] b) { return BitConverter.ToString(b).Replace("-",""); }
  static string Sha(byte[] b) {
   using (SHA256 s=SHA256.Create()) return Hex(s.ComputeHash(b));
  }
  static string Win(int e) {
   return (e==50 || e==87 ? "UNKNOWN_UNSUPPORTED_WIN32_" : "UNKNOWN_WIN32_") + e;
  }
  static string Nt(int s) {
   return s==0 ? "OK" : "UNKNOWN_NTSTATUS_0x"+unchecked((uint)s).ToString("X8");
  }
  static long U64(uint hi,uint lo) { return unchecked((long)(((ulong)hi<<32)|lo)); }

  static void ReadId(SafeFileHandle h, Rec r) {
   byte[] b=new byte[24];
   if (!GetFileInformationByHandleEx(h,18,b,24)) { r.IdStatus=Win(Marshal.GetLastWin32Error()); return; }
   r.Id=BitConverter.ToUInt64(b,0).ToString("X16")+"-"+Hex(new ArraySegment<byte>(b,8,16).ToArray());
   r.IdStatus="OK";
  }
  static void ReadEa(SafeFileHandle h, Rec r) {
   IOSB io; uint ea=0; int s=NtQueryInformationFile(h,out io,out ea,4,7);
   r.EaBytes=ea; r.EaStatus=Nt(s);
  }
  static void ReadSecurity(SafeFileHandle h, Rec r) {
   uint need=0; GetKernelObjectSecurity(h,7,null,0,ref need);
   int first=Marshal.GetLastWin32Error();
   if (need==0) { r.SdStatus=Win(first); return; }
   byte[] b=new byte[need];
   if (!GetKernelObjectSecurity(h,7,b,(uint)b.Length,ref need)) {
    r.SdStatus=Win(Marshal.GetLastWin32Error()); return;
   }
   if (need!=b.Length) Array.Resize(ref b,(int)need);
   r.SdSha256=Sha(b);
   try {
    RawSecurityDescriptor sd=new RawSecurityDescriptor(b,0);
    r.Sddl=sd.GetSddlForm(AccessControlSections.Owner|AccessControlSections.Group|AccessControlSections.Access);
    r.DaclProtected=(sd.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0;
    r.SdStatus="OK";
   } catch (Exception e) { r.SdStatus="UNKNOWN_SD_PARSE_"+e.GetType().Name; }
  }
  static void ReadCase(SafeFileHandle h, Rec r) {
   if ((r.Attributes&0x10u)==0) { r.CaseStatus="N/A"; return; }
   byte[] b=new byte[4];
   if (!GetFileInformationByHandleEx(h,23,b,4)) {
    r.CaseStatus=Win(Marshal.GetLastWin32Error()); return;
   }
   r.CaseFlags=BitConverter.ToUInt32(b,0); r.CaseStatus="OK";
  }
  static void ReadStreams(SafeFileHandle h, Rec r) {
   byte[] b=new byte[65536];
   if (!GetFileInformationByHandleEx(h,7,b,(uint)b.Length)) {
    r.StreamsStatus=Win(Marshal.GetLastWin32Error()); return;
   }
   int off=0;
   for (int count=0; ; count++) {
    if (count>=128) { r.StreamsStatus="UNKNOWN_STREAM_COUNT_OVER_128"; return; }
    if (off<0 || off+24>b.Length) { r.StreamsStatus="UNKNOWN_STREAM_BUFFER_BOUNDS"; return; }
    uint next=BitConverter.ToUInt32(b,off);
    uint nameBytes=BitConverter.ToUInt32(b,off+4);
    if ((nameBytes&1)!=0 || nameBytes>65512 || off+24+(long)nameBytes>b.Length) {
     r.StreamsStatus="UNKNOWN_STREAM_NAME_BOUNDS"; return;
    }
    r.Streams.Add(new StreamRec {
     Name=Encoding.Unicode.GetString(b,off+24,(int)nameBytes),
     Size=BitConverter.ToInt64(b,off+8),
     Allocation=BitConverter.ToInt64(b,off+16)
    });
    if (next==0) break;
    if (next<24 || off+(long)next>b.Length) { r.StreamsStatus="UNKNOWN_STREAM_NEXT_BOUNDS"; return; }
    off+=(int)next;
   }
   r.StreamsStatus="OK";
  }
  static void ReadRaw(SafeFileHandle h, Rec r) {
   byte[] b=new byte[16384]; uint got=0;
   if (!DeviceIoControl(h,0x000900A8u,null,0,b,(uint)b.Length,out got,IntPtr.Zero)) {
    r.DecodeStatus=Win(Marshal.GetLastWin32Error()); return;
   }
   if (got<12 || got>b.Length) { r.DecodeStatus="MISMATCH_RAW_LENGTH_"+got; return; }
   Array.Resize(ref b,(int)got);
   r.RawSha256=Sha(b); r.RawBase64=Convert.ToBase64String(b);
   r.Tag=BitConverter.ToUInt32(b,0);
   ushort payload=BitConverter.ToUInt16(b,4), reserved=BitConverter.ToUInt16(b,6);
   r.Version=BitConverter.ToUInt32(b,8);
   if (r.Tag!=LxTag) { r.DecodeStatus="MISMATCH_TAG"; return; }
   if (payload!=b.Length-8 || reserved!=0) { r.DecodeStatus="MISMATCH_HEADER"; return; }
   if (r.Version!=2) { r.DecodeStatus="MISMATCH_VERSION"; return; }
   try { r.Target=Strict.GetString(b,12,b.Length-12); }
   catch (ArgumentException) { r.DecodeStatus="MISMATCH_TARGET_UTF8"; return; }
   if (r.Target.IndexOf('\0')>=0) { r.DecodeStatus="MISMATCH_TARGET_NUL"; return; }
   r.DecodeStatus="OK";
  }

  // mode 0: expected link leaf, including raw FSCTL read. mode 1: expected directory ancestor.
  // Neither mode opens or reads ordinary file content, including nonzero regular files.
  public static Rec One(string path,int mode) {
   Rec r=new Rec();
   SafeFileHandle h=CreateFileW(path,Access,7,IntPtr.Zero,3,Flags,IntPtr.Zero);
   if (h.IsInvalid) {
    int e=Marshal.GetLastWin32Error(); h.Dispose(); r.OpenStatus=Win(e); return r;
   }
   using (h) {
    r.OpenStatus="OK"; BHFI i;
    if (!GetFileInformationByHandle(h,out i)) {
     r.OpenStatus=Win(Marshal.GetLastWin32Error()); return r;
    }
    r.Attributes=i.Attrs; r.Links=i.Links; r.Length=U64(i.SizeHigh,i.SizeLow);
    r.Creation=U64(i.C2,i.C1); r.Write=U64(i.W2,i.W1);
    r.Kind=(i.Attrs&0x400u)!=0 ? "reparse" : ((i.Attrs&0x10u)!=0 ? "directory" : "file");
    ReadId(h,r); ReadEa(h,r); ReadSecurity(h,r); ReadCase(h,r); ReadStreams(h,r);
    if (mode==0 && r.Kind=="reparse") ReadRaw(h,r);
    else r.DecodeStatus="N/A";
   }
   return r;
  }
 }
}
'@

\# A reviewer can AST-extract this exact literal without running the script.
$SelfText = $Utf8.GetString($ScriptBytes0)
$ExtractedNative = Get-Literal $SelfText 'NativeCSharp'
if ($ExtractedNative -cne $NativeCSharp) { throw 'self AST extraction differs from frozen native literal' }
$ForbiddenNative = 'CreateDirectoryW|MoveFile|DeleteFile|RemoveDirectory|SetFile|SetKernel|WriteFile|FileStream'
if ($ExtractedNative -match $ForbiddenNative) { throw 'native literal contains a forbidden mutation/content API' }
if (-not ('NyuLxMetadata.Native' -as [type])) {
    Add-Type -TypeDefinition $ExtractedNative
}
$N = [NyuLxMetadata.Native]

\# Parse and strictly validate the pinned map.
$Map = ConvertFrom-Json $Utf8.GetString($Map0.bytes)
$topNames = @($Map.PSObject.Properties.Name)
if (($topNames -join '|') -cne 'legend|counts|unresolved_targets|mapping') {
    throw "map top-level shape mismatch: $($topNames -join ',')"
}
if (@($Map.mapping).Count -ne 97 -or $Map.counts.E -ne 96 -or $Map.counts.L -ne 1) {
    throw 'map pinned counts mismatch'
}
$Rows = New-Object Collections.ArrayList
$Seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$AliasCounts = @{ ait25 = 0; ait26 = 0; cs202 = 0 }
foreach ($row in @($Map.mapping)) {
    Test-Deadline
    if (@($row).Count -ne 5) { throw 'map row shape mismatch' }
    $a,$p,$t,$resolved,$state = @($row)
    if ($a -isnot [string] -or -not $Roots.Contains($a)) { throw "invalid alias: $a" }
    if ($p -isnot [string] -or $t -isnot [string] -or
        $state -isnot [string] -or $state -cnotin @('E','L')) { throw 'invalid map row types' }
    if ($p.StartsWith('/') -or $p.StartsWith('\') -or $p.Contains('\') -or
        $p.IndexOf(':') -ge 0 -or $p -match '[\x00-\x1F]') { throw "invalid relative path: $p" }
    $parts = @($p.Split('/'))
    if (-not $parts.Count -or @($parts | Where-Object { -not (Test-Component $_) }).Count) {
        throw "invalid relative path component: $p"
    }
    if (-not $Seen.Add("$a/$p")) { throw "duplicate/case-colliding ordinal path: $a/$p" }
    if ($state -ceq 'L') {
        if ($a -cne 'cs202' -or $p -cne 'lab5/mnt' -or
            $t -cne '/lab5mnt' -or $null -ne $resolved) { throw 'invalid L row' }
    } elseif ($resolved -isnot [string]) { throw "invalid E row: $a/$p" }
    $AliasCounts[$a]++
    $full = [IO.Path]::Combine($Roots[$a], $p.Replace('/', '\'))
    if (-not (Test-Under $full $Roots[$a])) { throw "computed path escaped root: $a/$p" }
    [void]$Rows.Add([ordered]@{ alias=$a; relativePath=$p; target=$t; fullPath=$full })
}
foreach ($a in $Roots.Keys) {
    if ($AliasCounts[$a] -ne $ExpectedAliasCounts[$a]) {
        throw "alias count mismatch for $a"
    }
}

\# Ancestors are derived only from pinned rows; no filesystem inventory or enumeration occurs.
$Dirs = New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($row in $Rows) {
    $root = $Roots[$row.alias]
    for ($p = [IO.Path]::GetDirectoryName($row.fullPath); Test-Under $p $root;
         $p = [IO.Path]::GetDirectoryName($p)) {
        if (-not $Dirs.ContainsKey($p)) {
            $Dirs[$p] = [ordered]@{ alias=$row.alias; fullPath=$p }
        }
        if ($p -ieq $root) { break }
    }
}

function Read-Node([string]$Name, [string]$Path, [int]$Mode, [string]$WantKind) {
    Test-Deadline
    $r = $N::One($Path, $Mode)
    Add-RecordUnknowns $Name $r
    if ($r.OpenStatus -ceq 'OK' -and $r.Kind -cne $WantKind) {
        Add-Unknown $Name 'kind' "expected $WantKind; observed $($r.Kind)"
    }
    $r
}

$DirFirst = [ordered]@{}
foreach ($d in @($Dirs.Keys | Sort-Object)) {
    $DirFirst[$d] = Read-Node $d $d 1 'directory'
}
$LinkFirst = [ordered]@{}
foreach ($row in $Rows) {
    $name = "$($row.alias)/$($row.relativePath)"
    $r = Read-Node $name $row.fullPath 0 'reparse'
    $LinkFirst[$name] = $r
    if ($r.OpenStatus -ceq 'OK') {
        if ($r.Kind -ceq 'reparse') {
            if ($r.Tag -ne 0xA000001D) { [void]$Mismatches.Add("$name tag") }
            if ($r.DecodeStatus -cne 'OK') { [void]$Mismatches.Add("$name decode=$($r.DecodeStatus)") }
            elseif ($r.Target -cne $row.target) { [void]$Mismatches.Add("$name target") }
            if ($r.Length -ne 0) { [void]$Mismatches.Add("$name nonzero length") }
        }
    }
}
$LinkSecond = [ordered]@{}
foreach ($row in $Rows) {
    $name = "$($row.alias)/$($row.relativePath)"
    $LinkSecond[$name] = Read-Node $name $row.fullPath 0 'reparse'
}
$DirSecond = [ordered]@{}
foreach ($d in @($Dirs.Keys | Sort-Object)) {
    $DirSecond[$d] = Read-Node $d $d 1 'directory'
}

$Nodes = New-Object Collections.ArrayList
foreach ($d in @($Dirs.Keys | Sort-Object)) {
    $f1 = Get-Fingerprint $DirFirst[$d]; $f2 = Get-Fingerprint $DirSecond[$d]
    if ($f1 -cne $f2) { [void]$Drifts.Add([ordered]@{ node=$d; kind='ancestor'; first=$f1; second=$f2 }) }
    [void]$Nodes.Add([ordered]@{
        node=$d; role='computed-ancestor'; metadata=$DirFirst[$d]
        secondObservationSha256=$f2; stable=($f1 -ceq $f2)
    })
}
foreach ($row in $Rows) {
    $name = "$($row.alias)/$($row.relativePath)"
    $f1 = Get-Fingerprint $LinkFirst[$name]; $f2 = Get-Fingerprint $LinkSecond[$name]
    if ($f1 -cne $f2) { [void]$Drifts.Add([ordered]@{ node=$name; kind='link'; first=$f1; second=$f2 }) }
    [void]$Nodes.Add([ordered]@{
        node=$name; role='pinned-map-link'; expectedTarget=$row.target
        metadata=$LinkFirst[$name]; secondObservationSha256=$f2; stable=($f1 -ceq $f2)
    })
}

\# Re-pin both approved inputs and the running script after all original-object reads.
$Map1 = Read-Pinned $MapPath $MapPin
$Capability1 = Read-Pinned $CapabilityPath $CapabilityPin
$ScriptSha1 = Get-Sha256Bytes ([IO.File]::ReadAllBytes($PSCommandPath))
if ($Map1.sha256 -cne $Map0.sha256) { [void]$Drifts.Add('map changed during run') }
if ($Capability1.sha256 -cne $Capability0.sha256) { [void]$Drifts.Add('capability helper changed during run') }
if ($ScriptSha1 -cne $ScriptSha0) { [void]$Drifts.Add('running script changed during run') }

\# Guard the fixed report directory and its ancestors without enumeration or following reparses.
$ReportGuards = New-Object Collections.ArrayList
for ($p = $ReportRoot; $p; $p = [IO.Path]::GetDirectoryName($p)) {
    $r = Read-Node "report-guard:$p" $p 1 'directory'
    [void]$ReportGuards.Add([ordered]@{ path=$p; metadata=$r })
    if ([IO.Path]::GetPathRoot($p) -ieq $p) { break }
}

$ExitCode = if ($Mismatches.Count -or $Drifts.Count) { 1 }
            elseif ($Unknowns.Count) { 2 } else { 0 }
$Id = [guid]::NewGuid().ToString('D')
$ReportPath = "$ReportRoot\read-nyu-link-metadata-$Id.json"
$Report = [ordered]@{
    schema = 'read-nyu-link-metadata/1'
    runId = $Id
    scope = 'READ-ONLY metadata evidence for the 97 pinned LX map entries and computed ancestors only'
    startUtc = $StartUtc
    endUtc = [DateTime]::UtcNow.ToString('o')
    elapsedMs = $Clock.ElapsedMilliseconds
    pinnedInputs = [ordered]@{
        map = [ordered]@{ path=$MapPath; expected=$MapPin; start=$Map0.sha256; end=$Map1.sha256 }
        approvedCapability = [ordered]@{
            path=$CapabilityPath; expected=$CapabilityPin
            start=$Capability0.sha256; end=$Capability1.sha256
            handling='AST-parsed literal for provenance validation only; main was not invoked'
        }
    }
    script = [ordered]@{ path=$PSCommandPath; sha256=$ScriptSha0; endSha256=$ScriptSha1 }
    entrySet = [ordered]@{
        source='pinned map only; not a fresh/full inventory'
        links=97; aliasCounts=$AliasCounts; ancestorDirectories=$Dirs.Count
    }
    noFollow = 'by construction: OPEN_REPARSE_POINT|BACKUP_SEMANTICS, metadata rights only; not an OS audit'
    compilerResidual = 'Add-Type may create compiler-managed TEMP artifacts; this script requests no other temporary writes'
    security = 'OWNER/GROUP/DACL only; SACL not requested and remains UNKNOWN'
    reportGuards = $ReportGuards
    nodes = $Nodes
    unknowns = $Unknowns
    mismatches = $Mismatches
    drifts = $Drifts
    limitations = @(
        'No target was followed, resolved, queried, or opened.',
        'No ordinary file payload or stream content was read.',
        'The entry set is exactly the pinned map plus lexically computed ancestors.',
        'ERROR_NOT_SUPPORTED (50), ERROR_INVALID_PARAMETER (87), permissions, and bounded-query failures are UNKNOWN.',
        'FileStreamInfo is capped at 64 KiB and 128 entries per object.',
        'SACL is UNKNOWN; no privilege was requested or changed.',
        'An external 120-second watchdog is required because an in-process deadline cannot interrupt a blocked native call.',
        'This is metadata evidence only and does not approve recovery, restore, move, or deletion.'
    )
    recoveryApproved = $false
    moveApproved = $false
    exitCode = $ExitCode
}
$json = ConvertTo-Json -Depth 12 -InputObject $Report
$bytes = $Utf8.GetBytes($json)

\# FileMode.CreateNew refuses every existing leaf, including a reparse leaf.
$fs = New-Object IO.FileStream(
    $ReportPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    $fs.Write($bytes, 0, $bytes.Length)
    $fs.Flush()
} finally {
    $fs.Dispose()
}
Write-Output $json
exit $ExitCode
```

Limitations: this was not executed and no file was written. The script AST-parses the pinned capability helper for provenance but deliberately does not compile that helper because it exposes mutation APIs; it compiles its own AST-extractable, read-only frozen literal. An independent reviewer should specifically confirm that interpretation against the “from approved capability script” requirement before materialization.
