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

    It 'ignores corrupt lease files rather than throwing' {
        New-KeepAwakeLease -Label 'good' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        Set-Content -Path (Join-Path $script:TestRoot 'leases\bad.lease') -Value '{not json' -Encoding utf8
        @(Get-KeepAwakeLeases).Count | Should -Be 1
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
        Restore-PowerBaseline | Should -BeTrue
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
        Restore-PowerBaseline | Should -BeFalse
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
        Restore-PowerBaseline | Should -BeFalse
        Test-PowerArmed | Should -BeTrue
        $b = Get-PowerBaseline
        $b.original.lidaction_ac     | Should -Be 1
        $b.original.standbyidle_ac   | Should -Be 1200
        $b.original.hibernateidle_ac | Should -Be 900
    }

    It 'returns $false from Restore-PowerBaseline when any single write fails' {
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
        Restore-PowerBaseline | Should -BeFalse
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
