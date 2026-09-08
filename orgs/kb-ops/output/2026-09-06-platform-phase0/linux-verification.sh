#!/usr/bin/env bash
# MANUAL, NO-AUTHORITY verification runner.
#
# Input must be a trusted archive made locally from a reviewed Git object. This
# runner performs synthetic local Linux tests only: it does not contact a VM or
# network, invoke models, inspect credentials, spend money, or touch a production broker service.
# It never claims a deployment or full acceptance.
#
# Usage:
#   linux-verification.sh SOURCE_ARCHIVE EVIDENCE_DIRECTORY [all|unaffected]
#
# `all` is the default. `unaffected` omits only adapters.test.ts after a separately
# recorded adapter-fixture failure; it is deliberately not a full-gate acceptance.

set -Eeuo pipefail
IFS=$'\n\t'

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 SOURCE_ARCHIVE EVIDENCE_DIRECTORY [all|unaffected]" >&2
  exit 64
fi

source_archive=$1
evidence_root=$2
mode=${3:-all}
case "$mode" in
  all|unaffected) ;;
  *) echo "invalid mode '$mode' (expected all or unaffected)" >&2; exit 64 ;;
esac
[[ -f "$source_archive" ]] || { echo "source archive is not a regular file: $source_archive" >&2; exit 66; }

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

for program in tar sha256sum npm node git python3 make g++; do
  command -v "$program" >/dev/null || { echo "required program unavailable: $program" >&2; exit 69; }
done
[[ -d /usr/include/node ]] || { echo "missing native Node headers at /usr/include/node; refusing node-gyp download" >&2; exit 69; }

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
actual_node=$(node --version)
actual_npm=$(npm --version)
expected_node=$(node -p "require('$dashboard_root/package.json').engines.node")
expected_npm=$(node -p "require('$dashboard_root/package.json').engines.npm")
printf 'node_actual=%s\nnpm_actual=%s\nnode_pin=%s\nnpm_pin=%s\n' \
  "$actual_node" "$actual_npm" "$expected_node" "$expected_npm" | tee "$versions"
if [[ "$actual_node" != "v$expected_node" || "$actual_npm" != "$expected_npm" ]]; then
  echo "PIN-MISMATCH (recorded, not waived): repo requires Node $expected_node / npm $expected_npm; executor has $actual_node / $actual_npm"
else
  echo "PIN-MATCH: Node $actual_node / npm $actual_npm"
fi

export DASHBOARD_STATE_ROOT="$run_root/state"
export XDG_CACHE_HOME="$run_root/xdg-cache"
export npm_config_offline=true
export npm_config_audit=false
export npm_config_fund=false
export npm_config_update_notifier=false
export npm_config_nodedir=/usr
export npm_config_cache="${npm_config_cache:-$(npm config get cache)}"

cd "$dashboard_root"
echo 'BEGIN PREAMBLE'
python3 "$source_root/scripts/preamble.py"
echo 'PASS PREAMBLE'
echo "installing locked dependencies from existing npm cache (offline; source-build only)"
npm ci --offline --no-audit --no-fund

echo 'BEGIN NODE_PTY BUILD'
npm_config_offline=true npm_config_nodedir=/usr \
  node /usr/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild \
  --directory="$dashboard_root/node_modules/node-pty" --nodedir=/usr
node -e "const pty = require('node-pty'); if (typeof pty.spawn !== 'function') throw new Error('node-pty spawn capability missing');"
echo 'PASS NODE_PTY BUILD'

run_test() {
  local label=$1
  shift
  echo "BEGIN TEST: $label"
  npm test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism "$@"
  echo "PASS TEST: $label"
}

if [[ "$mode" == all ]]; then
  run_test adapters server/control/adapters.test.ts
else
  echo 'SKIP TEST: adapters (unaffected mode excludes only this recorded fixture failure)'
fi
run_test spend-grant-provision server/control/spendGrantProvision.test.ts
run_test boot-diagnostics server/bootDiagnostics.test.ts
run_test store-boot-diagnostics server/control/storeBootDiagnostics.test.ts
run_test activation-containment server/control/activation.test.ts
run_test automatic-failure-reporter server/control/automaticFailureReporter.test.ts
run_test hydrate-provenance server/control/store.test.ts
run_test launch-failure-surfacing server/control/launch.test.ts
run_test queue-bridge-containment server/control/queueBridge.test.ts
run_test real-linux-broker server/pty/realBroker.integration.test.ts

echo 'BEGIN TYPECHECK'
npm run typecheck
echo 'PASS TYPECHECK'
echo 'BEGIN BUILD'
npm run build -- --configLoader native
echo 'PASS BUILD'
echo "SELECTED GATES PASSED (mode=$mode); this is not a full acceptance claim. Native workspace retained at $run_root"
