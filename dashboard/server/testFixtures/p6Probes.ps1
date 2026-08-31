# p6Probes.ps1 — the two probe sections of §4 and §9 of docs/plans/2026-08-23-dv3-p6-plan.md,
# owned by W6.5 [P6-C67]. One file, one Resolve-Rg + Invoke-P6Scan head, switched by -Section 4|9,
# so no probe is a dot-sourced markdown fence and neither helper is defined twice. Runs from the
# repository root and stays there (no directory change). Section 4 exits 0 when the seven rows hold.
# rg is NOT on PATH on this machine [P6-C57]; every probe in both sections resolves it through this helper,
# and no probe in either section ever calls `& $rg` directly [P6-C74].
param([Parameter(Mandatory)][ValidateSet(4,9)][int]$Section)
function Resolve-Rg {
  $cmd = Get-Command rg -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $pf = Join-Path $env:ProgramFiles 'ripgrep\rg.exe'
  if (Test-Path -LiteralPath $pf) { return $pf }
  $gitBash = 'C:\Program Files\Git\usr\bin\rg.exe'
  if (Test-Path -LiteralPath $gitBash) { return $gitBash }
  throw 'P6: ripgrep not found (PATH, $env:ProgramFiles\ripgrep, Git-Bash /usr/bin) - install rg or pin it'
}
function Invoke-P6Scan([string]$Label, [string[]]$RgArgs) {
  if (-not (Test-Path -LiteralPath $script:rg)) { throw "P6 scan: ripgrep binary missing at $script:rg" }
  $hits = & $script:rg @RgArgs
  $code = $LASTEXITCODE
  if ($code -eq 2) { throw "P6 scan errored (rg exit $code): $Label" }
  if ($code -notin 0,1) { throw "P6 scan returned rg exit $code : $Label" }
  return $hits
}
$script:rg = Resolve-Rg

if ($Section -eq 4) {   # --- Section 4 body; guarded, so -Section 9 does not run it [P6-C74] ---
  # W6.5 FOLD: this probe file lives under dashboard/server/testFixtures and names 'resolveExecutionHost'
  # in probe 2 of §9, so a raw scan self-matches. testFixtures is not product code (the same reason §9
  # probes 1 and 3 already post-filter 'testFixtures[/\\]'); excluding it is non-weakening — the only
  # real match is this file. rg over dashboard/server+src otherwise returns zero.
  $resolver = Invoke-P6Scan 'tier-resolver' @('-n','resolveExecutionHost','dashboard/server','dashboard/src') |
    Where-Object { $_ -notmatch 'testFixtures[/\\]' }
  if ($resolver) { $resolver; throw 'P6: the tier resolver survives' }
  $launchHost = (Invoke-P6Scan 'launch-host' @('-n',"\.platform === 'win32' \? '(desktop|vm)'",'dashboard/server')) |
    Where-Object { $_ -notmatch '\.test\.ts:' } |
    Where-Object { $_ -notmatch 'runtime[/\\]capabilities\.ts|control[/\\](migrations|store|migrationReport)\.ts' }
  if ($launchHost) { $launchHost; throw 'P6: a platform-derived launch host survives' }
  # W6.5 FOLD: exclude the P3 forbidden-pattern wall's own quoted evasion corpus. p3AttackManifest.test.ts
  # holds string literals like `'it.todo("case");'` in an array the scanner-wall test asserts are CAUGHT —
  # they are test DATA, not a real skip. Excluding lines whose code begins with a quote drops that corpus
  # only; a real skip/todo statement never starts its line with a quote, so nothing real is hidden.
  $deadSkips = Invoke-P6Scan 'dead-skips' @('-n','\bit\.skip\(|\bdescribe\.skip\(|\.todo\(','dashboard','--glob','*.test.*') |
    Where-Object { $_ -notmatch ':\d+:\s*["'']' }
  if ($deadSkips) { $deadSkips; throw 'P6: an unconditional skip appeared' }
  # Outbound HTTP is an ALLOWLIST, not a ban: desktopClient.ts (daemon-to-daemon, pinned /api/v1) plus
  # paidActionProviders.ts's injected fetchImpl (external providers, read-only). W6.5 FOLD: deploy/helperClient.ts
  # is the pre-existing P5 (W2) movement-helper transport (movement:235; §11 "P6 consumes the movement helper,
  # it does not rebuild it") — a separate deploy protocol, not a P6 cross-host launch call — so it joins the
  # allowlist. Any FOURTH module still throws.
  $outbound = Invoke-P6Scan 'outbound' @('-n','fetch\(|fetchImpl\(','dashboard/server','--glob','!*.test.*','--glob','!*testFixtures*')
  $unlisted = $outbound | Where-Object { $_ -notmatch 'placement[/\\]desktopClient\.ts|control[/\\]paidActionProviders\.ts|deploy[/\\]helperClient\.ts' }
  if ($unlisted) { $unlisted; throw 'P6: an unversioned cross-host call appeared outside the allowlist' }
  # W6.5 FOLD: the actual pin is `const base = assertApiV1Origin(origin)` at desktopClient.ts:71 — a
  # validating construction-time guard (stronger than a bare string literal); the plan's `apiV1Origin`
  # token is case-sensitive and misses `AssertApiV1Origin`. Match the real symbol.
  $pinnedOrigin = Invoke-P6Scan 'pinned-origin' @('-n',"'/api/v1'|apiV1Origin|assertApiV1Origin",'dashboard/server/placement/desktopClient.ts')
  if (-not $pinnedOrigin) { throw 'P6: desktopClient.ts does not pin an /api/v1 origin' }
}

# --- Section 9 BODY [P6-C67, P6-C74]. Same file as section 4: the head's param() block dispatches,
# Resolve-Rg and Invoke-P6Scan are already defined, $script:rg is already resolved, nothing is
# dot-sourced, and neither helper is defined twice. Repository root throughout [P6-C56]; rg is never bare.
# Run it with: pwsh dashboard/server/testFixtures/p6Probes.ps1 -Section 9
if ($Section -eq 9) {
  # 1. One launch service. The r1 probe named createRunFromLaunch/launchTransaction, which do NOT exist in
  # this tree, and omitted index.ts, where registerWorkflows is imported (:23) and invoked (:251) — so it
  # threw on the unmodified tree and proved nothing [P6-C28]. The real symbols are launchDefinition
  # (workflows/routes.ts:477, called :662,:1199) and launchDeclaredAgent (:630, called agents/routes.ts:323).
  $launch = Invoke-P6Scan 'launch-callers' @('-n','-e','launchDefinition|launchDeclaredAgent|registerWorkflows','dashboard/server')
  $launchCode = $launch | Where-Object { $_ -notmatch '\.test\.ts:|testFixtures[/\\]' } | Where-Object { $_ -notmatch '^[^:]+:\d+:\s*(//|\*|/\*)' }
  $unexpected = $launchCode | Where-Object { $_ -notmatch 'services[/\\]launchService\.ts|control[/\\](store|launch)\.ts|workflows[/\\]routes\.ts|agents[/\\]routes\.ts|index\.ts|api[/\\]v1[/\\]' }
  if ($unexpected) { $unexpected; throw 'P6: a launch caller appeared outside the allowlist' }
  # After W6.2 both entry points reach the store only through services/launchService.ts.
  $directStore = Invoke-P6Scan 'direct-launch-store' @('-n','withOpsTransaction','dashboard/server/workflows/routes.ts','dashboard/server/api/v1')
  if ($directStore) { $directStore; throw 'P6: a launch transaction survives outside launchService.ts' }
  # 2. No client-side host inference — expect exit 1.
  $clientHost = Invoke-P6Scan 'client-host' @('-n','-e',"process\.platform|navigator\.platform|'cloud'|resolveExecutionHost",'dashboard/src')
  if ($clientHost) { throw $clientHost }
  # 3. Platform-derived host — allowlist is EXACTLY runtime/capabilities.ts + the three migration sites.
  $platformHost = Invoke-P6Scan 'platform-host' @('-n','-e',"\.platform === 'win32' \? '(desktop|vm)'",'dashboard/server')
  $platformCode = $platformHost | Where-Object { $_ -notmatch '\.test\.ts:|testFixtures[/\\]' }
  $unexpectedHost = $platformCode | Where-Object { $_ -notmatch 'runtime[/\\]capabilities\.ts|control[/\\](migrations|store|migrationReport)\.ts' }
  if ($unexpectedHost) { throw $unexpectedHost }
  # 4. Node id is never taken from a path or body — expect exit 1.
  $bodyNode = Invoke-P6Scan 'body-node-id' @('-n','-e','body\.nodeId|params\.nodeId|body\.hostId','dashboard/server')
  if ($bodyNode) { throw $bodyNode }
  # 5. No second store, parallel implementation, flag, or adapter — expect exit 1.
  # W6.5 FOLD: this probe file names the very tokens it scans for, so a raw scan self-matches p6Probes.ps1
  # under dashboard/server/testFixtures. testFixtures is not product code (same idiom as probes 1 and 3);
  # excluding it is non-weakening — the only match is this file, product source is clean.
  $secondImpl = Invoke-P6Scan 'second-impl' @('-n','-e','v1Store|legacyLaunch|useV1|V1_ENABLED|compatMode','dashboard/server','dashboard/src') |
    Where-Object { $_ -notmatch 'testFixtures[/\\]' }
  if ($secondImpl) { throw $secondImpl }
  # 6. Absence inventory. Section 4 does NOT run here — W6.5 invokes it as its own `-Section 4` pass.
  git status --short
}
