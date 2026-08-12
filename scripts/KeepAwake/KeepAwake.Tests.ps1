BeforeAll {
    $script:ModulePath = Join-Path $PSScriptRoot 'KeepAwake.psm1'
    Import-Module $script:ModulePath -Force
}

Describe 'lease store' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'honours the KB_KEEPAWAKE_ROOT override' {
        Get-KeepAwakeRoot | Should -Be $script:TestRoot
    }

    It 'creates a lease and reads it back' {
        New-KeepAwakeLease -Label 'claude-abc' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 1.5 | Out-Null
        $leases = @(Get-KeepAwakeLeases)
        $leases.Count | Should -Be 1
        $leases[0].label | Should -Be 'claude-abc'
        $leases[0].mode  | Should -Be 'idle-expiry'
        $leases[0].pid   | Should -Be $PID
    }

    It 'is idempotent on re-acquire: updates in place, does not duplicate' {
        New-KeepAwakeLease -Label 'claude-abc' -Mode 'idle-expiry' -ProcessId 1111 -CpuSample 1.0 | Out-Null
        New-KeepAwakeLease -Label 'claude-abc' -Mode 'idle-expiry' -ProcessId 2222 -CpuSample 9.0 | Out-Null
        $leases = @(Get-KeepAwakeLeases)
        $leases.Count | Should -Be 1
        $leases[0].pid | Should -Be 2222
    }

    It 'removes a lease' {
        New-KeepAwakeLease -Label 'claude-abc' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        Remove-KeepAwakeLease -Label 'claude-abc' | Should -BeTrue
        @(Get-KeepAwakeLeases).Count | Should -Be 0
    }

    It 'sanitises labels so they cannot escape the lease directory' {
        New-KeepAwakeLease -Label '../../evil' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        $leaseDir = Join-Path $script:TestRoot 'leases'
        @(Get-ChildItem $leaseDir -Filter *.lease).Count | Should -Be 1
        (Get-LeasePath -Label '../../evil') | Should -BeLike "$leaseDir*"
    }

    It 'ignores corrupt lease files rather than throwing, and deletes them (M2)' {
        # M2 fix: a lease that fails to parse used to be silently skipped on
        # every single pass forever (logging one lease-corrupt line every poll
        # interval indefinitely) without ever being cleaned up. It carries no
        # recoverable information, so the fix deletes it outright.
        New-KeepAwakeLease -Label 'good' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        $badPath = Join-Path $script:TestRoot 'leases\bad.lease'
        Set-Content -Path $badPath -Value '{not json' -Encoding utf8
        @(Get-KeepAwakeLeases).Count | Should -Be 1
        Test-Path $badPath | Should -BeFalse
    }

    It 'writes lease files atomically (no bare temp file left behind)' {
        New-KeepAwakeLease -Label 'atomic-check' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        $leaseDir = Join-Path $script:TestRoot 'leases'
        @(Get-ChildItem $leaseDir -Filter '*.tmp').Count | Should -Be 0
        @(Get-ChildItem $leaseDir -Filter '*.lease').Count | Should -Be 1
    }
}

Describe 'Write-JsonFileAtomic concurrency (F1: MoveFileExW ends the delete-then-create race)' {
    # Incident 2026-08-12 01:29: the OLD Move-Item -Force implementation is
    # delete-then-create on an existing destination -- a window in which a
    # concurrent writer's own create can collide, throwing "Cannot create a
    # file when that file already exists." That escaped into the supervisor's
    # own lease rewrite (no try/catch there at the time) and killed it with
    # four live leases still held. See docs/specs/2026-08-12-keepawake-
    # supervisor-hardening.md.
    BeforeEach {
        $script:root = Join-Path $env:TEMP ("ka-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root | Out-Null
        $env:KB_KEEPAWAKE_ROOT = $script:root
    }
    AfterEach {
        Remove-Item $script:root -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'survives two concurrent writers hammering the same path' {
        $target = Join-Path $script:root 'contended.lease'
        $modPath = (Resolve-Path "$PSScriptRoot\KeepAwake.psm1").Path
        $writer = {
            param($ModPath, $Target, $Tag)
            Import-Module $ModPath -Force
            for ($i = 0; $i -lt 200; $i++) {
                Write-JsonFileAtomic -Path $Target -Data @{ tag = $Tag; i = $i }
            }
        }
        $j1 = Start-Job -ScriptBlock $writer -ArgumentList $modPath, $target, 'a'
        $j2 = Start-Job -ScriptBlock $writer -ArgumentList $modPath, $target, 'b'
        $out = Receive-Job -Job $j1, $j2 -Wait -AutoRemoveJob -ErrorAction Stop
        # The old Move-Item -Force implementation throws
        # "Cannot create a file when that file already exists" here.
        (Get-Content $target -Raw | ConvertFrom-Json).tag | Should -BeIn @('a', 'b')
    }

    It 'file content is never torn mid-write' {
        $target = Join-Path $script:root 'contended.lease'
        Write-JsonFileAtomic -Path $target -Data @{ tag = 'seed'; i = 0 }
        $modPath = (Resolve-Path "$PSScriptRoot\KeepAwake.psm1").Path
        $writerJob = Start-Job -ScriptBlock {
            param($ModPath, $Target)
            Import-Module $ModPath -Force
            for ($i = 0; $i -lt 300; $i++) { Write-JsonFileAtomic -Path $Target -Data @{ tag = 'w'; i = $i } }
        } -ArgumentList $modPath, $target
        for ($r = 0; $r -lt 300; $r++) {
            $raw = $null
            try { $raw = [System.IO.File]::ReadAllText($target) } catch { continue } # reader may race the replace instant; only content matters
            if ($raw) { { $raw | ConvertFrom-Json | Out-Null } | Should -Not -Throw }
        }
        Receive-Job -Job $writerJob -Wait -AutoRemoveJob -ErrorAction Stop
    }
}

Describe 'lease heartbeat update (I3: atomic, corruption-safe, moved off the CLI)' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'updates the heartbeat field and preserves every other field' {
        New-KeepAwakeLease -Label 'hb' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 12.5 | Out-Null
        $before = @(Get-KeepAwakeLeases)[0]

        (Update-KeepAwakeLeaseHeartbeat -Label 'hb') | Should -BeTrue

        $after = @(Get-KeepAwakeLeases)[0]
        $after.pid        | Should -Be $before.pid
        $after.label      | Should -Be $before.label
        $after.mode       | Should -Be $before.mode
        $after.acquired   | Should -Be $before.acquired
        $after.cpu_sample | Should -Be $before.cpu_sample
    }

    It 'is a silent no-op (returns $false, does not throw) when the lease does not exist' {
        { Update-KeepAwakeLeaseHeartbeat -Label 'nobody-here' } | Should -Not -Throw
        (Update-KeepAwakeLeaseHeartbeat -Label 'nobody-here') | Should -BeFalse
    }

    It 'treats a corrupt lease file as a no-op instead of throwing (must never surface into a hook)' {
        $path = Get-LeasePath -Label 'corrupt-hb'
        Set-Content -Path $path -Value '{not valid json' -Encoding utf8
        { Update-KeepAwakeLeaseHeartbeat -Label 'corrupt-hb' } | Should -Not -Throw
        (Update-KeepAwakeLeaseHeartbeat -Label 'corrupt-hb') | Should -BeFalse
    }
}

Describe 'lease activity rules' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
        $script:Now = [datetimeoffset]::Parse('2026-07-20T03:00:00+09:00')
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    # Pester 6 separates discovery from run: a bare `function` in a Describe
    # body only exists at discovery time and is gone before any It runs.
    # BeforeAll executes in the run phase, so this is where it must live.
    BeforeAll {
        function New-TestLease {
            param($Mode = 'idle-expiry', $HeartbeatAgoMinutes = 0, $CpuSample = 100.0)
            return @{
                pid        = $PID
                label      = 't'
                mode       = $Mode
                acquired   = $script:Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
                heartbeat  = $script:Now.AddMinutes(-$HeartbeatAgoMinutes).ToString('yyyy-MM-ddTHH:mm:sszzz')
                cpu_sample = $CpuSample
            }
        }
    }

    It 'keeps a lease active when the heartbeat is recent' {
        $r = Update-LeaseActivity -Lease (New-TestLease -HeartbeatAgoMinutes 2) -CpuNow 100.0 `
             -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeTrue
    }

    It 'expires an idle-expiry lease when heartbeat is stale and CPU is flat' {
        $r = Update-LeaseActivity -Lease (New-TestLease -HeartbeatAgoMinutes 20) -CpuNow 100.0 `
             -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeFalse
        $r.Reason | Should -Be 'idle-timeout'
    }

    It 'refreshes a stale heartbeat when CPU delta exceeds the threshold' {
        # This is the subagent/Workflow case: no hook events fired, but the
        # process tree is clearly burning CPU, so the lease must survive.
        $r = Update-LeaseActivity -Lease (New-TestLease -HeartbeatAgoMinutes 20 -CpuSample 100.0) `
             -CpuNow 105.0 -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeTrue
        $r.Reason | Should -Be 'cpu-activity'
        $r.Lease.heartbeat | Should -Be $script:Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
    }

    It 'does not refresh when CPU delta is below the threshold' {
        $r = Update-LeaseActivity -Lease (New-TestLease -HeartbeatAgoMinutes 20 -CpuSample 100.0) `
             -CpuNow 100.5 -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeFalse
    }

    It 'never idle-expires a pid-only lease' {
        $r = Update-LeaseActivity -Lease (New-TestLease -Mode 'pid-only' -HeartbeatAgoMinutes 600) `
             -CpuNow 100.0 -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeTrue
        $r.Reason | Should -Be 'pid-only'
    }

    It 'always stores the latest CPU sample' {
        $r = Update-LeaseActivity -Lease (New-TestLease -CpuSample 100.0) -CpuNow 123.5 `
             -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Lease.cpu_sample | Should -Be 123.5
    }

    It 'reports this process as alive and a bogus pid as dead' {
        Test-ProcessAlive -ProcessId $PID | Should -BeTrue
        Test-ProcessAlive -ProcessId 999999 | Should -BeFalse
    }

    It 'returns a non-negative CPU total for this process tree' {
        (Get-ProcessTreeCpu -ProcessId $PID) | Should -BeGreaterOrEqual 0
    }

    It 'returns 0 CPU for a dead pid instead of throwing' {
        (Get-ProcessTreeCpu -ProcessId 999999) | Should -Be 0
    }
}

Describe 'power arm and restore' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
        # Fake provider: an in-memory power scheme. No real machine state is touched.
        $script:FakeStore = @{
            '4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936' = 1
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da' = 1200
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364' = 900
        }
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = { param($SubGuid, $SettingGuid, $Value) $script:FakeStore["$SubGuid|$SettingGuid"] = $Value; $true }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'captures the current values as the baseline' {
        $b = Save-PowerBaseline
        $b.original.lidaction_ac     | Should -Be 1
        $b.original.standbyidle_ac   | Should -Be 1200
        $b.original.hibernateidle_ac | Should -Be 900
        Test-Path (Join-Path $script:TestRoot 'armed.json') | Should -BeTrue
    }

    It 'does not mutate anything while capturing the baseline' {
        # Ordering is load-bearing: if arming dies half-way, the baseline must
        # already be on disk or the original values are lost forever.
        Save-PowerBaseline | Out-Null
        $script:FakeStore['4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936'] |
            Should -Be 1
    }

    It 'arms all three settings to never/do-nothing' {
        Set-PowerArmed | Should -BeTrue
        $script:FakeStore['4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936'] | Should -Be 0
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 0
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364'] | Should -Be 0
    }

    It 'round-trips: restore puts every original value back exactly' {
        Set-PowerArmed | Out-Null
        $r = Restore-PowerBaseline
        $r.Result | Should -BeTrue
        $r.Reason | Should -Be 'restored'
        $script:FakeStore['4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936'] | Should -Be 1
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 1200
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364'] | Should -Be 900
    }

    It 'clears armed.json after a successful restore' {
        Set-PowerArmed | Out-Null
        Test-PowerArmed | Should -BeTrue
        Restore-PowerBaseline | Out-Null
        Test-PowerArmed | Should -BeFalse
    }

    It 'adopts an existing armed.json instead of overwriting it' {
        # Supervisor-crash recovery: a second supervisor must restore the ORIGINAL
        # values, not capture the already-armed zeros as if they were the baseline.
        Set-PowerArmed | Out-Null
        Save-PowerBaseline | Out-Null
        (Get-PowerBaseline).original.standbyidle_ac | Should -Be 1200
    }

    It 'treats an absent original value as the documented default' {
        $script:FakeStore.Remove('4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936')
        (Save-PowerBaseline).original.lidaction_ac | Should -Be 1
    }

    It 'restore is a no-op when nothing was armed' {
        $r = Restore-PowerBaseline
        $r.Result | Should -BeFalse
        $r.Reason | Should -Be 'nothing-to-restore'
    }

    # Regression test for the -and short-circuit bug: a naive
    # `$ok = $ok -and (& $prov.SetAcValue ...)` chain stops calling SetAcValue
    # the moment one call returns $false, so later settings are never even
    # attempted. That is exactly what the global "no single failure may leave
    # the machine permanently unable to sleep" constraint forbids, since the
    # skipped settings are the ones that actually gate sleep. This fake
    # provider fails only the lid write and records every GUID pair it was
    # asked to write, so the test can prove all three were attempted regardless.
    It 'attempts all three writes even when the first one fails' {
        $script:Attempted = @()
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = {
                param($SubGuid, $SettingGuid, $Value)
                $script:Attempted += "$SubGuid|$SettingGuid"
                if ($SettingGuid -eq '5ca83367-6e45-459f-a27b-476b1d01c936') { return $false }
                $script:FakeStore["$SubGuid|$SettingGuid"] = $Value
                return $true
            }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
        Set-PowerArmed | Out-Null
        $script:Attempted | Should -Contain '4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936'
        $script:Attempted | Should -Contain '238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'
        $script:Attempted | Should -Contain '238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364'
    }

    # Regression test for the -and short-circuit bug in Restore-PowerBaseline
    # specifically (the sibling test above only covers Set-PowerArmed). A prior
    # reviewer traced by hand that none of the other restore tests would fail if
    # Restore-PowerBaseline alone were reverted to the buggy chained
    # `$ok = $ok -and (...)` form: the "retains armed.json" test below uses a
    # uniformly-failing provider so write order can't be observed, and the
    # "returns $false" test only fails the LAST write, so short-circuiting
    # changes nothing observable. This test arms first (so armed.json holds the
    # real originals), then fails only the FIRST restore write (lid) while the
    # fake provider records every GUID pair it was asked to write, so the test
    # can prove STANDBYIDLE and HIBERNATEIDLE were still attempted -- and still
    # applied -- despite the earlier failure.
    It 'Restore-PowerBaseline attempts all three writes even when the first one fails' {
        Set-PowerArmed | Out-Null
        $script:Attempted = @()
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = {
                param($SubGuid, $SettingGuid, $Value)
                $script:Attempted += "$SubGuid|$SettingGuid"
                if ($SettingGuid -eq '5ca83367-6e45-459f-a27b-476b1d01c936') { return $false }
                $script:FakeStore["$SubGuid|$SettingGuid"] = $Value
                return $true
            }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
        Restore-PowerBaseline | Out-Null
        $script:Attempted | Should -Contain '4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936'
        $script:Attempted | Should -Contain '238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'
        $script:Attempted | Should -Contain '238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364'
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 1200
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364'] | Should -Be 900
    }

    It 'retains armed.json and its original baseline values when restore fails' {
        Set-PowerArmed | Out-Null
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = { param($SubGuid, $SettingGuid, $Value) $false }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
        $r = Restore-PowerBaseline
        $r.Result | Should -BeFalse
        $r.Reason | Should -Be 'restore-failed'
        Test-PowerArmed | Should -BeTrue
        $b = Get-PowerBaseline
        $b.original.lidaction_ac     | Should -Be 1
        $b.original.standbyidle_ac   | Should -Be 1200
        $b.original.hibernateidle_ac | Should -Be 900
    }

    It 'returns Result=$false from Restore-PowerBaseline when any single write fails' {
        Set-PowerArmed | Out-Null
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = {
                param($SubGuid, $SettingGuid, $Value)
                if ($SettingGuid -eq '9d7815a6-7ee4-497e-8888-515a05f02364') { return $false }
                $script:FakeStore["$SubGuid|$SettingGuid"] = $Value
                return $true
            }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
        (Restore-PowerBaseline).Result | Should -BeFalse
    }

    # C1 fix regression tests: a corrupt/unparseable armed.json used to make
    # Test-PowerArmed report "armed" (path-existence only) while
    # Get-PowerBaseline silently returned $null, so Restore-PowerBaseline
    # bailed immediately and the machine was stuck at lid=0/standby=0/
    # hibernate=0 with no automatic recovery -- and -Repair claimed "nothing
    # to repair" while the file sat right there. These prove the fix: the
    # documented Windows defaults (this machine's true originals) are
    # restored instead of stranding the machine armed.
    It 'restores the documented defaults and clears the file when armed.json is unparseable' {
        New-Item -ItemType Directory -Path $script:TestRoot -Force | Out-Null
        Set-Content -Path (Join-Path $script:TestRoot 'armed.json') -Value '{not valid json' -Encoding utf8
        Test-PowerArmed | Should -BeTrue
        $r = Restore-PowerBaseline
        $r.Result | Should -BeTrue
        $r.Reason | Should -Be 'restored-from-corruption'
        $script:FakeStore['4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936'] | Should -Be 1
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 1200
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364'] | Should -Be 900
        Test-PowerArmed | Should -BeFalse
    }

    It 'restores the documented defaults when armed.json parses but is missing the original keys' {
        # Reproduces a torn/partial write specifically: valid JSON, but the
        # 'original' block never made it to disk.
        New-Item -ItemType Directory -Path $script:TestRoot -Force | Out-Null
        '{"armed_at":"2026-07-20T00:00:00+00:00","scheme":"x"}' |
            Set-Content -Path (Join-Path $script:TestRoot 'armed.json') -Encoding utf8
        $r = Restore-PowerBaseline
        $r.Result | Should -BeTrue
        $r.Reason | Should -Be 'restored-from-corruption'
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 1200
    }

    It 'Save-PowerBaseline refuses to recapture when armed.json is present but corrupt' {
        # Regression for the defeat-the-adopt-invariant scenario: recapturing
        # "now" against a corrupt armed.json would read back the already-armed
        # zeros and durably record THOSE as the baseline, losing the real
        # originals forever.
        New-Item -ItemType Directory -Path $script:TestRoot -Force | Out-Null
        Set-Content -Path (Join-Path $script:TestRoot 'armed.json') -Value '{not valid json' -Encoding utf8
        $result = Save-PowerBaseline
        $result | Should -BeNullOrEmpty
        # The corrupt file must be left exactly as it was for -Repair to see --
        # refusing must not itself further mutate the file.
        (Get-Content (Join-Path $script:TestRoot 'armed.json') -Raw).TrimEnd("`r", "`n") | Should -Be '{not valid json'
    }

    It 'Set-PowerArmed aborts without mutating power settings when baseline capture is refused' {
        New-Item -ItemType Directory -Path $script:TestRoot -Force | Out-Null
        Set-Content -Path (Join-Path $script:TestRoot 'armed.json') -Value '{not valid json' -Encoding utf8
        (Set-PowerArmed) | Should -BeFalse
        # Values must be untouched -- Set-PowerArmed must not have proceeded
        # to write zeros without a trustworthy baseline on disk.
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 1200
    }
}

Describe 'stale arm reconciliation (I2: reconcile after a hard kill or power loss)' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
        $script:FakeStore = @{
            '4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936' = 1
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da' = 1200
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364' = 900
        }
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = { param($SubGuid, $SettingGuid, $Value) $script:FakeStore["$SubGuid|$SettingGuid"] = $Value; $true }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'reconciles (restores originals) when armed with zero live leases -- the stale-arm signature' {
        Set-PowerArmed | Out-Null
        # A dead pid stands in for "a hard-killed supervisor's session is gone".
        New-KeepAwakeLease -Label 'ghost' -Mode 'pid-only' -ProcessId 999999 -CpuSample 0 | Out-Null

        (Resolve-StaleArmReconciliation) | Should -BeTrue
        Test-PowerArmed | Should -BeFalse
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 1200
    }

    It 'does nothing when at least one lease is backed by a live process' {
        Set-PowerArmed | Out-Null
        New-KeepAwakeLease -Label 'alive' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null

        (Resolve-StaleArmReconciliation) | Should -BeFalse
        Test-PowerArmed | Should -BeTrue
    }

    It 'does nothing when the machine is not armed at all' {
        (Resolve-StaleArmReconciliation) | Should -BeFalse
    }

    It 'also reconciles when armed with no lease files present at all (zero is zero either way)' {
        Set-PowerArmed | Out-Null
        (Resolve-StaleArmReconciliation) | Should -BeTrue
        Test-PowerArmed | Should -BeFalse
    }
}

Describe 'supervisor pass' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
        $script:Now = [datetimeoffset]::Parse('2026-07-20T03:00:00+09:00')
        $script:FakeStore = @{
            '4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936' = 1
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da' = 1200
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364' = 900
        }
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = { param($SubGuid, $SettingGuid, $Value) $script:FakeStore["$SubGuid|$SettingGuid"] = $Value; $true }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'arms on the 0 -> 1 lease transition' {
        New-KeepAwakeLease -Label 'a' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        $r = Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 1
        $r.Armed | Should -BeTrue
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 0
    }

    It 'prunes a lease whose process is dead' {
        New-KeepAwakeLease -Label 'dead' -Mode 'pid-only' -ProcessId 999999 -CpuSample 0 | Out-Null
        $r = Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 0
        $r.Pruned | Should -Contain 'dead'
    }

    # Task 7 fix-round: acquire-time freshness can't tell a legitimate owner
    # from an ephemeral wrapper (both are young at that instant), so the
    # unambiguous signal is moved here -- a lease pruned as process-dead
    # within seconds of its own acquisition means PID resolution almost
    # certainly pinned the lease to a wrapper, not the real long-lived owner.
    It 'flags a lease pruned within seconds of acquisition as an immediate prune' {
        New-KeepAwakeLease -Label 'wrapper' -Mode 'pid-only' -ProcessId 999999 -CpuSample 0 | Out-Null
        # New-KeepAwakeLease stamps 'acquired' with the REAL wall clock, which
        # this test cannot control -- rewrite it onto the test's synthetic
        # $script:Now (same pattern as the idle-expiry test below) so the age
        # comparison is deterministic (clock-injected via -Now) rather than
        # depending on real wall-clock time or which shell invoked the suite.
        $leasePath = Get-LeasePath -Label 'wrapper'
        $lease = Get-Content $leasePath -Raw | ConvertFrom-Json
        $lease.acquired = $script:Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
        $lease | ConvertTo-Json -Compress | Set-Content -Path $leasePath -Encoding utf8

        $r = Invoke-SupervisorPass -Now $script:Now.AddSeconds(5) -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 0
        $r.Pruned | Should -Contain 'wrapper'
        $r.ImmediatePruned | Should -Contain 'wrapper'
        $logText = Get-Content (Join-Path $script:TestRoot 'keepawake.log') -Raw
        $logText | Should -Match 'lease-pruned-IMMEDIATELY label=wrapper'
        $logText | Should -Match 'NOT protected'
    }

    It 'does not flag a lease pruned long after acquisition as an immediate prune' {
        New-KeepAwakeLease -Label 'stale' -Mode 'pid-only' -ProcessId 999999 -CpuSample 0 | Out-Null
        $leasePath = Get-LeasePath -Label 'stale'
        $lease = Get-Content $leasePath -Raw | ConvertFrom-Json
        $lease.acquired = $script:Now.AddHours(-2).ToString('yyyy-MM-ddTHH:mm:sszzz')
        $lease | ConvertTo-Json -Compress | Set-Content -Path $leasePath -Encoding utf8

        $r = Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 0
        $r.Pruned | Should -Contain 'stale'
        $r.ImmediatePruned | Should -Not -Contain 'stale'
        $logText = Get-Content (Join-Path $script:TestRoot 'keepawake.log') -Raw
        $logText | Should -Match 'lease-pruned label=stale reason=process-dead'
        $logText | Should -Not -Match 'lease-pruned-IMMEDIATELY'
    }

    It 'restores on the 1 -> 0 lease transition' {
        New-KeepAwakeLease -Label 'a' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0 | Out-Null
        Remove-KeepAwakeLease -Label 'a' | Out-Null
        $r = Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 0
        $r.Armed | Should -BeFalse
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 1200
    }

    It 'stays armed at 2 -> 1 leases' {
        New-KeepAwakeLease -Label 'a' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        New-KeepAwakeLease -Label 'b' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0 | Out-Null
        Remove-KeepAwakeLease -Label 'a' | Out-Null
        $r = Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 1
        $r.Armed | Should -BeTrue
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 0
    }

    It 'prunes an idle-expired lease even though its process is alive' {
        New-KeepAwakeLease -Label 'idle' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        # New-KeepAwakeLease stamps heartbeat with the REAL wall clock, which
        # this test cannot control. Rewrite it onto the test's synthetic
        # $script:Now so the idle-timeout comparison below is anchored to one
        # consistent clock instead of comparing real-vs-fictitious time --
        # otherwise whether this passes depends on how $script:Now's fixed
        # literal happens to relate to whatever real instant the suite runs.
        $leasePath = Get-LeasePath -Label 'idle'
        $lease = Get-Content $leasePath -Raw | ConvertFrom-Json
        $lease.heartbeat = $script:Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
        $lease.acquired = $lease.heartbeat
        $lease | ConvertTo-Json -Compress | Set-Content -Path $leasePath -Encoding utf8

        $future = $script:Now.AddHours(5)
        $r = Invoke-SupervisorPass -Now $future -IdleTimeoutMinutes 15 -CpuThreshold 999999
        $r.LiveCount | Should -Be 0
        $r.Pruned | Should -Contain 'idle'
    }

    It 'persists the refreshed cpu_sample back to the lease file' {
        New-KeepAwakeLease -Label 'a' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0 | Out-Null
        (@(Get-KeepAwakeLeases)[0]).cpu_sample | Should -BeGreaterOrEqual 0
    }

    # M1 regression test: the supervisor's lease rewrite used to hand-list six
    # field names (pid/label/mode/acquired/heartbeat/cpu_sample), so any field
    # later added to New-KeepAwakeLease would be silently dropped the first
    # time the supervisor rewrote that lease. The fix instead clones the
    # in-memory lease and removes only 'path' (the one key that must never
    # reach disk), so anything else present flows through untouched. This
    # exercises that exact mechanism directly against a lease hashtable
    # carrying a field the schema does not define today, which is the
    # cleanest deterministic way to prove "preserved by exclusion" rather
    # than "dropped by hand-listed inclusion" -- Get-KeepAwakeLeases' own
    # read-side projection is a separate, pre-existing concern not in scope
    # for this fix (it was not named in the finding) and is left untouched.
    It 'the rewrite mechanism preserves unknown/future fields by removing "path" rather than hand-listing known ones (M1)' {
        $leasePath = Get-LeasePath -Label 'future'
        $lease = @{
            pid = $PID; label = 'future'; mode = 'pid-only'
            acquired = '2026-07-20T00:00:00+00:00'; heartbeat = '2026-07-20T00:00:00+00:00'
            cpu_sample = 0.0; path = $leasePath; future_field = 'keep-me'
        }
        # Exactly the two lines Invoke-SupervisorPass runs before persisting.
        $toWrite = $lease.Clone()
        $toWrite.Remove('path')
        Write-JsonFileAtomic -Path $leasePath -Data $toWrite

        $onDisk = Get-Content $leasePath -Raw | ConvertFrom-Json
        $onDisk.future_field | Should -Be 'keep-me'
        $onDisk.pid          | Should -Be $PID
        # 'path' is an internal Get-KeepAwakeLeases artifact, never a real
        # lease field, and must not leak into the file on disk.
        $onDisk.PSObject.Properties['path'] | Should -BeNullOrEmpty
    }

    It 'writes the rewritten lease file atomically (no bare temp file left behind)' {
        New-KeepAwakeLease -Label 'a' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0 | Out-Null
        $leaseDir = Join-Path $script:TestRoot 'leases'
        @(Get-ChildItem $leaseDir -Filter '*.tmp').Count | Should -Be 0
    }
}

Describe 'supervisor shutdown race (I1: a concurrent -Acquire must not be lost)' {
    # The supervisor used to break out of its loop the instant LiveCount hit
    # 0, then spend the rest of its `finally` block (three SetAcValue calls --
    # six powercfg.exe spawns, plausibly 1-3 seconds) still holding the mutex
    # before releasing it. A concurrent -Acquire landing in that window spawns
    # a new supervisor that loses the mutex race and exits immediately, and
    # nothing retries -- the new lease sits live and unprotected. This tests
    # the extracted decision seam (Test-SupervisorShouldContinueAfterEmptyPass)
    # directly rather than the real blocking loop/mutex/Start-Sleep, per the
    # brief's "do not test by sleeping" constraint -- both with an injected
    # fake lease-count query (fully deterministic) and with the real default
    # seam against actual lease files in a test root (still no timing
    # dependency: it only checks presence/absence, never elapsed time).
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'resumes (returns $true) when a lease appeared during the final check' {
        Test-SupervisorShouldContinueAfterEmptyPass -GetLiveLeaseCount { 1 } | Should -BeTrue
    }

    It 'exits normally (returns $false) when no lease appeared during the final check' {
        Test-SupervisorShouldContinueAfterEmptyPass -GetLiveLeaseCount { 0 } | Should -BeFalse
    }

    It 'default seam: detects a real live lease present on disk' {
        New-KeepAwakeLease -Label 'race-winner' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        Test-SupervisorShouldContinueAfterEmptyPass | Should -BeTrue
    }

    It 'default seam: reports $false when the lease directory is empty' {
        Test-SupervisorShouldContinueAfterEmptyPass | Should -BeFalse
    }

    It 'default seam: ignores a lease whose process is dead (does not falsely resume)' {
        New-KeepAwakeLease -Label 'dead' -Mode 'pid-only' -ProcessId 999999 -CpuSample 0 | Out-Null
        Test-SupervisorShouldContinueAfterEmptyPass | Should -BeFalse
    }
}

Describe 'owner pid resolution' {
    # Pure resolution logic over an injected fake process map -- no real OS
    # process state involved, so this is fully deterministic.
    BeforeAll {
        function New-FakeProcessInfoLookup {
            param([hashtable]$Map)
            return {
                param([int]$ProcessId)
                if ($Map.ContainsKey($ProcessId)) { return $Map[$ProcessId] }
                return $null
            }.GetNewClosure()
        }
    }

    It 'resolves directly when the immediate parent is not a shell' {
        # cli(100) -> claude.exe(200)
        $map = @{
            100 = @{ Name = 'powershell.exe'; ParentProcessId = 200 }
            200 = @{ Name = 'claude.exe'; ParentProcessId = 1 }
        }
        $r = Resolve-KeepAwakeOwnerPid -StartProcessId 100 -GetProcessInfo (New-FakeProcessInfoLookup -Map $map)
        $r.Resolved  | Should -BeTrue
        $r.ProcessId | Should -Be 200
        $r.Hops      | Should -Be 1
    }

    It 'walks past one ephemeral shell hop to reach the real long-lived owner' {
        # cli(100) -> wrapper shell(150) -> claude.exe(200)
        # This is the shape observed empirically on this machine.
        $map = @{
            100 = @{ Name = 'powershell.exe'; ParentProcessId = 150 }
            150 = @{ Name = 'powershell.exe'; ParentProcessId = 200 }
            200 = @{ Name = 'claude.exe'; ParentProcessId = 1 }
        }
        $r = Resolve-KeepAwakeOwnerPid -StartProcessId 100 -GetProcessInfo (New-FakeProcessInfoLookup -Map $map)
        $r.Resolved  | Should -BeTrue
        $r.ProcessId | Should -Be 200
        $r.Hops      | Should -Be 2
    }

    It 'walks past cmd.exe as well as powershell.exe' {
        $map = @{
            100 = @{ Name = 'powershell.exe'; ParentProcessId = 150 }
            150 = @{ Name = 'cmd.exe'; ParentProcessId = 200 }
            200 = @{ Name = 'agent_runner_host.exe'; ParentProcessId = 1 }
        }
        $r = Resolve-KeepAwakeOwnerPid -StartProcessId 100 -GetProcessInfo (New-FakeProcessInfoLookup -Map $map)
        $r.Resolved  | Should -BeTrue
        $r.ProcessId | Should -Be 200
    }

    It 'fails cleanly when the parent chain is entirely shells within MaxHops' {
        $map = @{
            100 = @{ Name = 'powershell.exe'; ParentProcessId = 150 }
            150 = @{ Name = 'powershell.exe'; ParentProcessId = 160 }
            160 = @{ Name = 'powershell.exe'; ParentProcessId = 170 }
            170 = @{ Name = 'claude.exe'; ParentProcessId = 1 }
        }
        $r = Resolve-KeepAwakeOwnerPid -StartProcessId 100 -GetProcessInfo (New-FakeProcessInfoLookup -Map $map) -MaxHops 2
        $r.Resolved | Should -BeFalse
        $r.Reason   | Should -Be 'max-hops-exceeded'
    }

    It 'fails cleanly when a parent in the chain no longer exists' {
        $map = @{
            100 = @{ Name = 'powershell.exe'; ParentProcessId = 150 }
            # 150 deliberately absent -- process already exited by the time we look it up.
        }
        $r = Resolve-KeepAwakeOwnerPid -StartProcessId 100 -GetProcessInfo (New-FakeProcessInfoLookup -Map $map)
        $r.Resolved | Should -BeFalse
        $r.Reason   | Should -Be 'parent-process-not-found'
    }

    It 'fails cleanly when the start pid itself has no parent info' {
        $r = Resolve-KeepAwakeOwnerPid -StartProcessId 999999 -GetProcessInfo (New-FakeProcessInfoLookup -Map @{})
        $r.Resolved | Should -BeFalse
        $r.Reason   | Should -Be 'start-process-not-found'
    }

    It 'fails cleanly when the chain terminates with no further parent' {
        $map = @{
            100 = @{ Name = 'powershell.exe'; ParentProcessId = 0 }
        }
        $r = Resolve-KeepAwakeOwnerPid -StartProcessId 100 -GetProcessInfo (New-FakeProcessInfoLookup -Map $map)
        $r.Resolved | Should -BeFalse
        $r.Reason   | Should -Be 'no-parent'
    }

    It 'defaults to the live provider seam when no lookup is injected' {
        # Deterministic version (fix round 2026-07-20): the previous form of
        # this test asserted $r.Resolved -BeTrue, i.e. that the ancestor walk
        # against REAL OS process state happens to succeed. That depends on how
        # many ephemeral-shell hops sit between this test process and its real
        # long-lived owner, which varies by how the suite is invoked -- a plain
        # PowerShell window walks 0-1 hops, but nested Git Bash walks 3-4
        # (measured empirically: powershell.exe -> bash.exe -> bash.exe ->
        # bash.exe -> claude.exe -- see task-7-report.md fix-round section).
        # The old MaxHops=3 default made this test fail under nested bash even
        # though nothing was broken -- a test whose result depends on the
        # invoking shell is not a useful test. This version only proves the
        # live GetProcessInfoProvider seam (no injected -GetProcessInfo) is
        # actually wired up and returns a well-formed result without throwing;
        # it does not assert resolution succeeds. For a success-path assertion
        # against a *known* chain, see the 'walks past a bash.exe wrapper hop'
        # regression test below, which uses an injected fake map instead.
        { $script:LiveResult = Resolve-KeepAwakeOwnerPid -StartProcessId $PID } | Should -Not -Throw
        $r = $script:LiveResult
        $r | Should -Not -BeNullOrEmpty
        $r.ContainsKey('Resolved')  | Should -BeTrue
        $r.ContainsKey('ProcessId') | Should -BeTrue
        $r.ContainsKey('Reason')    | Should -BeTrue
        $r.ContainsKey('Hops')      | Should -BeTrue
        $r.Reason | Should -BeIn @('ok', 'start-process-not-found', 'no-parent', 'parent-process-not-found', 'max-hops-exceeded')
        # If it did resolve, the field really is named ProcessId (verified
        # correct 2026-07-20 against the function's own `return @{ ProcessId = ...`
        # literal) and it really does point at a live process -- otherwise the
        # 0/false failure fields are what's populated and there is nothing live
        # to check.
        if ($r.Resolved) {
            Test-ProcessAlive -ProcessId $r.ProcessId | Should -BeTrue
        }
    }

    # Regression test for the exact live defect caught during Task 7: Claude
    # Code runs Windows hook commands through Git Bash, so the real chain for
    # a hook-invoked keep_awake.ps1 includes a bash.exe -c wrapper hop. Before
    # bash.exe/sh.exe were added to $script:EphemeralHostProcessNames, the walk
    # stopped there and accepted the wrapper as "owner" with Reason='ok' --
    # reproduced empirically: the supervisor pruned that lease as process-dead
    # one second after acquiring it (see task-7-report.md). This must never
    # regress silently back to that state.
    It 'walks past a bash.exe wrapper hop (the real Windows Claude Code hook shell)' {
        # cli(100) -> bash.exe -c wrapper(150) -> claude.exe(200)
        $map = @{
            100 = @{ Name = 'powershell.exe'; ParentProcessId = 150 }
            150 = @{ Name = 'bash.exe'; ParentProcessId = 200 }
            200 = @{ Name = 'claude.exe'; ParentProcessId = 1 }
        }
        $r = Resolve-KeepAwakeOwnerPid -StartProcessId 100 -GetProcessInfo (New-FakeProcessInfoLookup -Map $map)
        $r.Resolved  | Should -BeTrue
        $r.ProcessId | Should -Be 200
        $r.Name      | Should -Be 'claude.exe'
        $r.Hops      | Should -Be 2
    }
}

Describe 'acquire target resolution (Task 7 finding B: CLI decision logic, moved into the module)' {
    # This is the exact logic scripts/keep_awake.ps1's -Acquire branch runs.
    # Living here as a pure function over an injected GetProcessInfo means
    # every branch -- explicit PID, resolved walk, failed walk -- is
    # unit-testable without spawning a real process tree or a real detached
    # supervisor (which would risk touching real machine power state -- see
    # task-7-report.md for why that path is NOT exercised via a real
    # scripts/keep_awake.ps1 subprocess in this suite).
    #
    # Task 7 finding A originally added a "freshly spawned" acquire-time
    # warning here. The Task 7 fix-round review found it fired on nearly every
    # legitimate SessionStart (a real owner is also young at acquire time) and
    # replaced it with a precise post-hoc detector in Invoke-SupervisorPass
    # (immediate-prune -- see 'supervisor pass' > 'immediate-prune detector'
    # below), so that warning and its tests were removed.
    BeforeAll {
        function New-FakeProcessInfoLookup2 {
            param([hashtable]$Map)
            return {
                param([int]$ProcessId)
                if ($Map.ContainsKey($ProcessId)) { return $Map[$ProcessId] }
                return $null
            }.GetNewClosure()
        }
    }
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'takes the explicit -ProcessId shortcut without consulting the walk at all' {
        $map = @{ 999 = @{ Name = 'powershell.exe'; ParentProcessId = 0 } }  # would fail if consulted
        $r = Resolve-KeepAwakeAcquireTarget -SelfProcessId 999 -ProcessId 4242 -Label 'x' `
                -GetProcessInfo (New-FakeProcessInfoLookup2 -Map $map)
        $r.Resolved  | Should -BeTrue
        $r.ProcessId | Should -Be 4242
        $r.Reason    | Should -Be 'explicit'
    }

    It 'uses the resolved walk target when the owner is well-established' {
        $map = @{
            100 = @{ Name = 'powershell.exe'; ParentProcessId = 200 }
            200 = @{ Name = 'claude.exe'; ParentProcessId = 1 }
        }
        $r = Resolve-KeepAwakeAcquireTarget -SelfProcessId 100 -Label 'x' `
                -GetProcessInfo (New-FakeProcessInfoLookup2 -Map $map)
        $r.Resolved  | Should -BeTrue
        $r.ProcessId | Should -Be 200
    }

    It 'resolves the walk target and does not warn even when the owner was created moments ago' {
        # No acquire-time freshness warning any more (Task 7 fix-round): a
        # legitimate owner (claude.exe) is genuinely just as young as an
        # ephemeral wrapper at this instant, so this case is indistinguishable
        # here by design -- the resolved PID is used as-is, and the real
        # detector lives downstream in the supervisor's prune path instead.
        $now = [datetime]'2026-07-20T15:00:00'
        $map = @{
            100 = @{ Name = 'powershell.exe'; ParentProcessId = 200 }
            200 = @{ Name = 'claude.exe'; ParentProcessId = 1; StartTime = $now.AddSeconds(-1) }
        }
        $r = Resolve-KeepAwakeAcquireTarget -SelfProcessId 100 -Label 'sess-1' `
                -GetProcessInfo (New-FakeProcessInfoLookup2 -Map $map)
        $r.Resolved  | Should -BeTrue
        $r.ProcessId | Should -Be 200
        (Get-Content (Join-Path $script:TestRoot 'keepawake.log') -Raw -ErrorAction SilentlyContinue) |
            Should -Not -Match 'pid-resolution-SUSPICIOUS'
    }

    It 'falls back to the self PID and logs pid-resolution-FAILED when the walk cannot resolve an owner' {
        $map = @{ 100 = @{ Name = 'powershell.exe'; ParentProcessId = 0 } }  # no-parent -> unresolved
        $r = Resolve-KeepAwakeAcquireTarget -SelfProcessId 100 -Label 'sess-2' `
                -GetProcessInfo (New-FakeProcessInfoLookup2 -Map $map)
        $r.Resolved  | Should -BeFalse
        $r.ProcessId | Should -Be 100
        $logText = Get-Content (Join-Path $script:TestRoot 'keepawake.log') -Raw
        $logText | Should -Match 'pid-resolution-FAILED'
        $logText | Should -Match 'label=sess-2'
        $logText | Should -Match 'falling back to ephemeral PID=100'
    }
}

Describe 'session label from hook stdin (Task 7: CLAUDE_SESSION_ID does not expand)' {
    # Empirically verified 2026-07-20 (see task-7-report.md): Claude Code does
    # NOT expose the session id as an environment variable to hook
    # subprocesses. The brief's `-Label claude-$CLAUDE_SESSION_ID` either
    # renders literally or bash-expands the unset var to an empty string
    # (verified: yields the fixed label "claude-", not a real session id) --
    # both silently collapse every concurrent session onto one shared lease.
    # The session id IS present as `session_id` in the JSON every hook command
    # receives on stdin, so that's what this resolves from instead.
    It 'derives claude-<session_id> from a real hook-shaped JSON payload' {
        $json = '{"session_id":"8e10cef5-8298-4232-acfa-e674d046960d","hook_event_name":"SessionStart","cwd":"C:\\Users\\danie\\kb"}'
        $r = Resolve-KeepAwakeSessionLabel -StdinJson $json -FallbackLabel 'claude-session'
        $r.Label  | Should -Be 'claude-8e10cef5-8298-4232-acfa-e674d046960d'
        $r.Source | Should -Be 'stdin-session-id'
    }

    It 'falls back to the fixed label when stdin is empty' {
        $r = Resolve-KeepAwakeSessionLabel -StdinJson '' -FallbackLabel 'claude-session'
        $r.Label  | Should -Be 'claude-session'
        $r.Source | Should -Be 'fallback-empty-stdin'
    }

    It 'falls back to the fixed label when stdin is not valid JSON' {
        # This is what the brief's literal-string failure mode would look like
        # if it were ever piped in as "JSON": not parseable, so fall back
        # cleanly rather than emitting a garbage label.
        $r = Resolve-KeepAwakeSessionLabel -StdinJson 'claude-$CLAUDE_SESSION_ID' -FallbackLabel 'claude-session'
        $r.Label  | Should -Be 'claude-session'
        $r.Source | Should -Be 'fallback-json-parse-error'
    }

    It 'falls back to the fixed label when the JSON has no session_id' {
        $r = Resolve-KeepAwakeSessionLabel -StdinJson '{"hook_event_name":"SessionStart"}' -FallbackLabel 'claude-session'
        $r.Label  | Should -Be 'claude-session'
        $r.Source | Should -Be 'fallback-missing-session-id'
    }
}

Describe 'CLI entry point (scripts/keep_awake.ps1 invoked as a real subprocess)' {
    # Finding B (Task 5 review): the Pester suite imported KeepAwake.psm1 only
    # and never invoked the CLI itself, so its argument-parsing/module-import/
    # dispatch wiring had zero automated coverage -- only manually smoke-tested.
    # These tests close that gap for -Heartbeat/-Release specifically: unlike
    # -Acquire, neither one ever calls Start-DetachedSupervisor or touches real
    # power settings, so they're safe to run as genuine child-process
    # invocations without any risk of arming this machine's real power scheme
    # from inside a test run. -Acquire's decision logic is instead covered
    # exhaustively above at the module level (Resolve-KeepAwakeAcquireTarget)
    # precisely to avoid that risk -- see task-7-report.md for the full
    # reasoning on why a real end-to-end -Acquire subprocess test was judged
    # too dangerous to add here.
    BeforeAll {
        $script:CliPath = (Resolve-Path (Join-Path $PSScriptRoot '..\keep_awake.ps1')).Path
    }
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-cli-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'removes a lease via -Release -Label end to end through a real child process' {
        New-KeepAwakeLease -Label 'explicit-cli' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script:CliPath -Release -Label 'explicit-cli' | Out-Null
        @(Get-KeepAwakeLeases).Count | Should -Be 0
    }

    It 'derives the label from real hook-shaped stdin JSON and releases the matching lease (-Release -FromStdin)' {
        # This is the exact mechanism used by settings.json's SessionEnd hook,
        # exercised end to end through a real OS-level stdin pipe (piping into
        # an external powershell.exe process, not an in-process `&` call --
        # [Console]::In inside the script only sees a real redirected pipe in
        # the former case, which is what a genuine Claude Code hook looks like).
        New-KeepAwakeLease -Label 'claude-stdin-test-session' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        $json = '{"session_id":"stdin-test-session","hook_event_name":"SessionEnd"}'
        $json | powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script:CliPath -Release -FromStdin | Out-Null
        @(Get-KeepAwakeLeases).Count | Should -Be 0
    }

    It 'falls back to the fixed label and logs it when -FromStdin gets no session id, via a real child process' {
        New-KeepAwakeLease -Label 'claude-session' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        '' | powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script:CliPath -Release -FromStdin | Out-Null
        @(Get-KeepAwakeLeases).Count | Should -Be 0
        (Get-Content (Join-Path $script:TestRoot 'keepawake.log') -Raw) | Should -Match 'session-label-fallback'
    }

    It 'is a silent no-op for -Heartbeat -FromStdin against a lease that does not exist' {
        $json = '{"session_id":"nobody-here"}'
        { $json | powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script:CliPath -Heartbeat -FromStdin } |
            Should -Not -Throw
        @(Get-KeepAwakeLeases).Count | Should -Be 0
    }
}

Describe 'Start-KeepAwakeSupervisor pass-failure resilience (F2: one bad pass must never kill the supervisor)' {
    # Incident 2026-08-12 01:29: a single lease-file write collision escaped
    # Invoke-SupervisorPass with no try/catch around it, and the `finally`
    # block then disarmed power management with four live leases still held.
    # Get-KeepAwakeMutexName isolates the production mutex name
    # ('Global\kb-keepawake-supervisor') from these tests -- a real supervisor
    # runs on this machine and must never be touched by the suite.
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
        $script:FakeStore = @{
            '4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936' = 1
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da' = 1200
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364' = 900
        }
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = { param($SubGuid, $SettingGuid, $Value) $script:FakeStore["$SubGuid|$SettingGuid"] = $Value; $true }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'derives an isolated mutex name under KB_KEEPAWAKE_ROOT' {
        Get-KeepAwakeMutexName | Should -Not -Be 'Global\kb-keepawake-supervisor'
    }

    It 'survives transient pass failures and exits 0 when leases drain' {
        $script:calls = 0
        Set-SupervisorPassInvoker {
            param($Now, $IdleTimeoutMinutes, $CpuThreshold)
            $script:calls++
            if ($script:calls -le 3) { throw 'injected transient failure' }
            return @{ LiveCount = 0; Pruned = @(); Armed = $false; ImmediatePruned = @() }
        }
        Start-KeepAwakeSupervisor -PollSeconds 0 | Should -Be 0
        $script:calls | Should -Be 4
        (Get-Content (Join-Path $script:TestRoot 'keepawake.log') -Raw) | Should -Match 'supervisor-pass-ERROR'
    }

    It 'exits 2 after 10 consecutive pass failures' {
        $script:calls = 0
        Set-SupervisorPassInvoker { $script:calls++; throw 'injected persistent failure' }
        Start-KeepAwakeSupervisor -PollSeconds 0 | Should -Be 2
        $script:calls | Should -Be 10
        (Get-Content (Join-Path $script:TestRoot 'keepawake.log') -Raw) | Should -Match 'supervisor-FAILING-persistently'
    }

    It 'a success resets the consecutive-failure counter' {
        $script:calls = 0
        Set-SupervisorPassInvoker {
            $script:calls++
            # 9 failures, one success (live lease so the loop continues), 9 more failures, then drain:
            if ($script:calls -eq 10) { return @{ LiveCount = 1; Pruned = @(); Armed = $true; ImmediatePruned = @() } }
            if ($script:calls -eq 20) { return @{ LiveCount = 0; Pruned = @(); Armed = $false; ImmediatePruned = @() } }
            throw 'injected'
        }
        Start-KeepAwakeSupervisor -PollSeconds 0 | Should -Be 0
        $script:calls | Should -Be 20
    }
}

Describe 'Test-SupervisorRespawnNeeded (F3: heartbeat watchdog self-heals a dead supervisor)' {
    # 2026-08-12 outage: nothing restarts a dead supervisor overnight -- only
    # -Acquire (SessionStart hook) ever spawns one, and -Heartbeat was a pure
    # lease-file write with no liveness check. Heartbeat fires on every tool
    # call of every session, so it is the one signal guaranteed to keep firing
    # overnight while work runs; wiring the respawn duty there closes the gap.
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'false when no leases exist, regardless of supervisor state' {
        Test-SupervisorRespawnNeeded | Should -BeFalse
    }

    It 'true when a lease exists and no pid file exists' {
        New-KeepAwakeLease -Label 't' -ProcessId $PID | Out-Null
        Test-SupervisorRespawnNeeded | Should -BeTrue
    }

    It 'true when a lease exists and the recorded pid is dead' {
        New-KeepAwakeLease -Label 't' -ProcessId $PID | Out-Null
        $dead = Start-Process powershell -ArgumentList '-NoProfile','-Command','exit' -PassThru -WindowStyle Hidden
        $dead.WaitForExit()
        Set-Content (Join-Path (Get-KeepAwakeRoot) 'supervisor.pid') -Value $dead.Id -Encoding utf8
        Test-SupervisorRespawnNeeded | Should -BeTrue
    }

    It 'false when a lease exists and the recorded pid is alive' {
        New-KeepAwakeLease -Label 't' -ProcessId $PID | Out-Null
        Set-Content (Join-Path (Get-KeepAwakeRoot) 'supervisor.pid') -Value $PID -Encoding utf8
        Test-SupervisorRespawnNeeded | Should -BeFalse
    }

    It 'true when the pid file is unreadable garbage' {
        New-KeepAwakeLease -Label 't' -ProcessId $PID | Out-Null
        Set-Content (Join-Path (Get-KeepAwakeRoot) 'supervisor.pid') -Value 'not-a-pid' -Encoding utf8
        Test-SupervisorRespawnNeeded | Should -BeTrue
    }
}

Describe 'supervisor singleton' {
    # A named Win32 mutex is reentrant PER THREAD, not per handle: a second
    # Mutex object opened for the same name on the SAME thread that already
    # holds it will WaitOne() successfully (verified empirically -- $created2
    # correctly reports $false, but WaitOne(0) still returns $true). Real
    # contention between two supervisor processes is always cross-thread, so
    # the second acquire attempt must run on a genuinely different thread to
    # prove exclusion -- otherwise this test cannot fail no matter what
    # Start-KeepAwakeSupervisor does.
    It 'lets the first holder in and keeps the second out' {
        $name = 'Global\kb-keepawake-test-' + [guid]::NewGuid()
        $created = $false
        $m1 = New-Object System.Threading.Mutex($true, $name, [ref]$created)
        try {
            $rs = [runspacefactory]::CreateRunspace()
            $rs.Open()
            $ps = [powershell]::Create()
            $ps.Runspace = $rs
            try {
                $ps.AddScript({
                    param($n)
                    $c2 = $false
                    $m2 = New-Object System.Threading.Mutex($true, $n, [ref]$c2)
                    try { return $m2.WaitOne(0, $false) } finally { $m2.Dispose() }
                }).AddArgument($name) | Out-Null
                $secondAcquired = $ps.Invoke()[0]
                $secondAcquired | Should -BeFalse
            } finally { $ps.Dispose(); $rs.Close() }
        } finally { $m1.ReleaseMutex(); $m1.Dispose() }
    }
}
