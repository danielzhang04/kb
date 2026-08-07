#!/usr/bin/env bash
# Phase-0 VM verification. Run as the persistent "kb" user after a reboot.
set -u

failures=0

pass() {
  printf 'PASS %s\n' "$1"
}

fail() {
  printf 'FAIL %s\n' "$1"
  failures=$((failures + 1))
}

warn() {
  printf 'WARN %s\n' "$1"
}

timed() {
  timeout 120 "$@"
}

# API keys override subscription authentication. Check their *presence*, including
# an exported empty value, before invoking either client and never print a value.
if [[ ${ANTHROPIC_API_KEY+x} || ${OPENAI_API_KEY+x} ]]; then
  fail 'Claude subscription auth: API-key environment variable present'
elif timed claude -p 'ok' >/dev/null 2>&1; then
  pass 'Claude subscription auth: claude -p succeeded without API keys'
else
  fail 'Claude subscription auth: claude -p failed'
fi

# Codex auth is file-backed (~/.codex/auth.json, mode 600) per Daniel's 2026-08-06
# fallback ruling: headless gnome-keyring cannot create its login collection on
# this box, and a blank-password keyring offers no real protection over a 600 file.
codex_status=''
codex_auth_mode=''
if timed codex exec --skip-git-repo-check 'say ok' >/dev/null 2>&1; then
  codex_status="$(timed codex login status 2>&1)"
  codex_auth_mode="$(stat -c '%a' "$HOME/.codex/auth.json" 2>/dev/null)"
  if [[ ${codex_status,,} == *chatgpt* && $codex_auth_mode == '600' ]]; then
    pass 'Codex auth: exec succeeded; ChatGPT login file-backed (auth.json mode 600)'
  else
    fail "Codex auth: exec succeeded but status/auth.json unexpected (mode ${codex_auth_mode:-missing})"
  fi
else
  fail 'Codex auth: codex exec failed'
fi

linger="$(timed loginctl show-user "$USER" -p Linger 2>/dev/null)"
if [[ $linger == 'Linger=yes' ]]; then
  pass 'User lingering: loginctl reports Linger=yes'
else
  fail 'User lingering: loginctl does not report Linger=yes'
fi

node_version="$(node --version 2>/dev/null || true)"
npm_version="$(npm --version 2>/dev/null || true)"
python_version="$(python3 --version 2>&1 || true)"
if [[ $node_version == 'v24.18.0' && $npm_version == '11.16.0' ]] \
  && python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
  pass "Runtime versions: node $node_version; npm $npm_version; $python_version"
else
  fail "Runtime versions: require node v24.18.0, npm 11.16.0, python >= 3.12 (found node ${node_version:-missing}; npm ${npm_version:-missing}; ${python_version:-python3 missing})"
fi

tailscale_json=''
if tailscale_json="$(timed tailscale status --json 2>/dev/null)" \
  && python3 -c 'import json, sys; raise SystemExit(0 if json.load(sys.stdin).get("BackendState") == "Running" else 1)' <<<"$tailscale_json" >/dev/null 2>&1; then
  pass 'Tailscale: status reports BackendState=Running'
else
  fail 'Tailscale: status is not healthy'
fi

if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(:|\])5317$'; then
  pass 'Port 5317: listener present'
else
  warn 'Port 5317: no listener detected (informational only)'
fi

exit "$failures"
