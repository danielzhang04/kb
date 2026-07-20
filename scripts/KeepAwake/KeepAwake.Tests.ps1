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
