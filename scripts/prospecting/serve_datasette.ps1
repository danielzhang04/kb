param(
    [string]$Store = (Join-Path $env:LOCALAPPDATA 'kb-prospecting\store.sqlite'),
    [int]$Port = 8001
)

$resolvedStore = (Resolve-Path -LiteralPath $Store -ErrorAction Stop).Path
$python = (& py -3 -c "import sys;print(sys.executable)").Trim()
if (-not $python) { throw 'Python 3 interpreter resolution failed' }
$env:KB_PROSPECTING_NO_NETWORK = '1'
& $python -c "import runpy; from scripts.prospecting import install_no_network_guard; install_no_network_guard(); runpy.run_module('datasette', run_name='__main__')" --host 127.0.0.1 --port $Port --immutable $resolvedStore
exit $LASTEXITCODE
