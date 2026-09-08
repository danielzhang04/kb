#!/usr/bin/env bash
# MANUAL, NO-AUTHORITY verification runner.
#
# Input must be a trusted archive made locally from a reviewed Git object. This
# runner performs synthetic local Linux tests only: it does not contact a VM or
# network, invoke models, inspect credentials, spend money, or touch a production broker service.
# It never claims a deployment or full acceptance.
#
# Usage:
#   linux-verification.sh SOURCE_ARCHIVE EVIDENCE_DIRECTORY [all|unaffected] [NODE_TOOLCHAIN_PREFIX]
#
# `all` is the default. `unaffected` omits only adapters.test.ts after a separately
# recorded adapter-fixture failure; it is deliberately not a full-gate acceptance.

set -Eeuo pipefail
IFS=$'\n\t'

if [[ $# -lt 2 || $# -gt 4 ]]; then
  echo "usage: $0 SOURCE_ARCHIVE EVIDENCE_DIRECTORY [all|unaffected] [NODE_TOOLCHAIN_PREFIX]" >&2
  exit 64
fi

source_archive=$1
evidence_root=$2
mode=${3:-all}
toolchain_prefix=${4:-}
case "$mode" in
  all|unaffected) ;;
  *) echo "invalid mode '$mode' (expected all or unaffected)" >&2; exit 64 ;;
esac
[[ -f "$source_archive" ]] || { echo "source archive is not a regular file: $source_archive" >&2; exit 66; }
if [[ -n "$toolchain_prefix" && "$toolchain_prefix" != /* ]]; then
  echo "toolchain prefix must be an absolute Linux path: $toolchain_prefix" >&2
  exit 64
fi

run_root=$(mktemp -d /tmp/kb-vm-resume-linux-gates.XXXXXX)
run_id=$(basename "$run_root")
log="$run_root/gate.log"
versions="$run_root/versions.txt"
archive_sha="$run_root/source-archive.sha256"
status_file="$run_root/status.txt"
scope_file="$run_root/scope.txt"

copy_evidence() {
  local status=$?
  set +e
  printf 'exit_status=%s\nrun_root=%s\n' "$status" "$run_root" >"$status_file"
  mkdir -p "$evidence_root"
  install -m 0644 "$log" "$evidence_root/$run_id.log"
  install -m 0644 "$versions" "$evidence_root/$run_id.versions.txt" 2>/dev/null || true
  install -m 0644 "$archive_sha" "$evidence_root/$run_id.source-archive.sha256" 2>/dev/null || true
  install -m 0644 "$scope_file" "$evidence_root/$run_id.scope.txt" 2>/dev/null || true
  install -m 0644 "$status_file" "$evidence_root/$run_id.status.txt"
  trap - EXIT
  exit "$status"
}
trap copy_evidence EXIT

exec > >(tee "$log") 2>&1

for program in tar sha256sum git python3 make g++; do
  command -v "$program" >/dev/null || { echo "required program unavailable: $program" >&2; exit 69; }
done
if [[ -n "$toolchain_prefix" ]]; then
  [[ -x "$toolchain_prefix/bin/node" && -x "$toolchain_prefix/bin/npm" ]] || {
    echo "isolated toolchain is missing executable node or npm below $toolchain_prefix/bin" >&2
    exit 69
  }
  [[ -d "$toolchain_prefix/include/node" ]] || {
    echo "isolated toolchain is missing bundled Node headers below $toolchain_prefix/include/node" >&2
    exit 69
  }
  [[ -f "$toolchain_prefix/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js" ]] || {
    echo "isolated toolchain is missing bundled node-gyp below $toolchain_prefix" >&2
    exit 69
  }
  child_path="$toolchain_prefix/bin:$PATH"
  node_bin="$toolchain_prefix/bin/node"
  npm_bin="$toolchain_prefix/bin/npm"
  node_dir="$toolchain_prefix"
  node_headers="$toolchain_prefix/include/node"
  node_gyp="$toolchain_prefix/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"
else
  command -v npm >/dev/null || { echo 'required program unavailable: npm' >&2; exit 69; }
  command -v node >/dev/null || { echo 'required program unavailable: node' >&2; exit 69; }
  [[ -d /usr/include/node ]] || { echo "missing native Node headers at /usr/include/node; refusing node-gyp download" >&2; exit 69; }
  [[ -f /usr/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js ]] || {
    echo 'missing bundled system node-gyp; refusing node-gyp download' >&2
    exit 69
  }
  child_path="$PATH"
  node_bin=$(command -v node)
  npm_bin=$(command -v npm)
  node_dir=/usr
  node_headers=/usr/include/node
  node_gyp=/usr/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js
fi

printf 'run_root=%s\n' "$run_root"
printf 'source_archive=%s\n' "$source_archive"
if [[ "$mode" == all ]]; then
  scope='all selected gates, including adapters.test.ts'
else
  scope='unaffected selected gates; adapters.test.ts intentionally excluded after its recorded fixture failure'
fi
printf 'mode=%s\nscope=%s\n' "$mode" "$scope" | tee "$scope_file"
sha256sum "$source_archive" | tee "$archive_sha"
cp -- "$source_archive" "$run_root/linux-source.tar"
tar -xf "$run_root/linux-source.tar" -C "$run_root"

mapfile -t dashboard_markers < <(find "$run_root" -mindepth 2 -maxdepth 3 -path '*/dashboard/package.json' -type f -print)
[[ ${#dashboard_markers[@]} -eq 1 ]] || {
  echo "archive must contain exactly one dashboard/package.json; found ${#dashboard_markers[@]}" >&2
  exit 65
}
dashboard_root=$(dirname "${dashboard_markers[0]}")
source_root=$(dirname "$dashboard_root")
[[ "$source_root" != /mnt/c/* ]] || { echo "refusing to execute source below /mnt/c" >&2; exit 65; }

mkdir -p "$run_root/state" "$run_root/xdg-cache"
mapfile -t required_pins < <(python3 - "$dashboard_root/package.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    engines = json.load(source)['engines']
print(engines['node'])
print(engines['npm'])
PY
)
[[ ${#required_pins[@]} -eq 2 ]] || { echo 'package.json engines pins are invalid' >&2; exit 65; }
expected_node=${required_pins[0]}
expected_npm=${required_pins[1]}
actual_node=$("$node_bin" --version)
actual_npm=$(env PATH="$child_path" "$npm_bin" --version)
resolved_node=$(readlink -f "$node_bin")
resolved_npm=$(readlink -f "$npm_bin")
node_sha=$(sha256sum "$resolved_node" | awk '{print $1}')
node_gyp_version=$("$node_bin" "$node_gyp" --version)
printf 'toolchain_prefix=%s\nnode_path=%s\nnode_sha256=%s\nnpm_path=%s\nnode_gyp_path=%s\nnode_gyp_version=%s\nnode_headers=%s\nnpm_config_nodedir=%s\nnode_actual=%s\nnpm_actual=%s\nnode_pin=%s\nnpm_pin=%s\n' \
  "${toolchain_prefix:-system-path}" "$resolved_node" "$node_sha" "$resolved_npm" "$node_gyp" "$node_gyp_version" "$node_headers" "$node_dir" "$actual_node" "$actual_npm" "$expected_node" "$expected_npm" | tee "$versions"
if [[ "$actual_node" != "v$expected_node" || "$actual_npm" != "$expected_npm" ]]; then
  echo "PIN-MISMATCH (recorded, not waived): repo requires Node $expected_node / npm $expected_npm; executor has $actual_node / $actual_npm"
  exit 70
else
  echo "PIN-MATCH: Node $actual_node / npm $actual_npm"
fi

# The runner process is already a child of the invoking WSL shell.  These exports affect only its
# extracted-source children; they never alter the operator's login PATH or system Node configuration.
export PATH="$child_path"

export DASHBOARD_STATE_ROOT="$run_root/state"
export XDG_CACHE_HOME="$run_root/xdg-cache"
export npm_config_offline=true
export npm_config_audit=false
export npm_config_fund=false
export npm_config_update_notifier=false
export npm_config_nodedir="$node_dir"
export npm_config_cache="${npm_config_cache:-$(npm config get cache)}"

cd "$dashboard_root"
echo 'BEGIN PREAMBLE'
python3 "$source_root/scripts/preamble.py"
echo 'PASS PREAMBLE'
echo "installing locked dependencies from existing npm cache (offline; source-build only)"
npm ci --offline --no-audit --no-fund

echo 'BEGIN NODE_PTY BUILD'
npm_config_offline=true npm_config_nodedir="$node_dir" \
  "$node_bin" "$node_gyp" rebuild \
  --directory="$dashboard_root/node_modules/node-pty" --nodedir="$node_dir"
node -e "const pty = require('node-pty'); if (typeof pty.spawn !== 'function') throw new Error('node-pty spawn capability missing');"
echo 'PASS NODE_PTY BUILD'

run_test() {
  local label=$1
  shift
  echo "BEGIN TEST: $label"
  npm test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism "$@"
  echo "PASS TEST: $label"
}

selected_tests=(
  server/control/executionLifetime.test.ts
  server/control/agentSessionChains.test.ts
  server/control/execution.test.ts
  server/control/managedExecution.test.ts
  server/control/spendGrantProvision.test.ts
  server/control/canonicalResultIntegrator.test.ts
  server/control/attemptSessionAdapter.test.ts
  server/control/attemptVertical.integration.test.ts
  server/control/toolPolicyWire.test.ts
  server/pty/contracts.test.ts
  server/pty/sessionRecord.test.ts
  server/pty/sessionPersistence.test.ts
  server/pty/sessionMigration.test.ts
  server/control/atomicJsonDocument.test.ts
  server/control/fleetLedgerReceipt.test.ts
  server/planeA/ledgers.test.ts
  server/agents/roster.test.ts
  server/control/activation.test.ts
  server/control/routes.test.ts
  server/control/launch.test.ts
  server/http/surface.test.ts
  server/bootDiagnostics.test.ts
  server/control/storeBootDiagnostics.test.ts
  server/control/automaticFailureReporter.test.ts
  server/control/store.test.ts
  server/control/queueBridge.test.ts
  server/pty/realBroker.integration.test.ts
)
if [[ "$mode" == all ]]; then
  selected_tests+=(server/control/adapters.test.ts)
  run_test phase0-integrated "${selected_tests[@]}"
else
  echo 'HISTORICAL UNAFFECTED MODE: adapters.test.ts intentionally excluded after its recorded fixture failure; this is not a full acceptance claim.'
  run_test historical-unaffected "${selected_tests[@]}"
fi

echo 'BEGIN PYTHON LEDGER UNIT'
if ! python3 -m pytest --version; then
  echo 'missing Python pytest prerequisite; obtain an approved offline Python pytest environment before rerunning (no install attempted)' >&2
  exit 69
fi
(cd "$source_root" && python3 -m pytest tests/test_ledger.py --basetemp="$run_root/pytest-basetemp")
echo 'PASS PYTHON LEDGER UNIT'

echo 'BEGIN TYPECHECK'
npm run typecheck
echo 'PASS TYPECHECK'
echo 'BEGIN BUILD'
npm run build -- --configLoader native
echo 'PASS BUILD'
echo "SELECTED GATES PASSED (mode=$mode); this is not a full acceptance claim. Native workspace retained at $run_root"
