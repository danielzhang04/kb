#!/bin/bash
# VM agent-launch preflight — run ON THE VM as root, READ-ONLY. Changes nothing.
#
# Generalised successor to the prior gate3-preflight.sh (2026-09-02). Run this before EVERY Gate
# window and before every deploy that touches dashboard/server/pty/**,
# dashboard/server/control/attemptSessionAdapter.ts, or the broker unit files: PRs #149-#152 each
# found their defect via a live launch attempt refusing on the VM, never via a unit test or a code
# read, because nothing else on the box inspects the exact filesystem shape the broker's
# fd-pinning walk (dashboard/server/pty/fdPinnedPaths.ts) demands. This script inspects it first.
# See docs/runbooks/2026-09-03-vm-agent-launch-preflight.md for the full narrative and citations.
#
# Usage: sudo ./vm_launch_preflight.sh [https://tailnet-url] [model-routing-sha256]
#   The tailnet URL is optional. Without it, the admission/health/readyz checks are skipped (they
#   need a real HTTP round trip); everything else — identities, filesystem shape, sockets, systemd
#   units, session state — is checked regardless.
#   The second argument (or $KB_MODEL_ROUTING_SHA256) is main's sha256 of
#   governance/model-routing.yaml, which the model-routing drift check below compares the ops
#   checkout against. Get it on the desktop with:
#     git show origin/main:governance/model-routing.yaml | sha256sum
#   Without it that check falls back to the release copy, and warns if the release has none.

fail=0
tailnet_url="${1:-}"
model_routing_sha="${2:-${KB_MODEL_ROUTING_SHA256:-}}"
ok()   { echo "  ok    $*"; }
bad()  { echo "  FAIL  $*"; fail=1; }
warn() { echo "  warn  $*"; }
section() { echo; echo "== $* =="; }

# ---------------------------------------------------------------------------------------------
section "identities"
id kb-shell 2>/dev/null || bad "kb-shell account missing"
id kb-dashboard 2>/dev/null || bad "kb-dashboard account missing"
# kb-dashboard.service:12 grants kb-shell via SupplementaryGroups=, which applies to the SERVICE
# PROCESS, not the account — `id kb-dashboard` never shows it, so asking the account is a false
# failure. Ask systemd what the unit actually grants.
systemctl show kb-dashboard.service -p SupplementaryGroups 2>/dev/null | grep -q "kb-shell" \
  && ok "kb-dashboard.service grants SupplementaryGroups=kb-shell" \
  || bad "kb-dashboard.service does NOT grant kb-shell (unit line 12 must set SupplementaryGroups=kb-shell)"

# ---------------------------------------------------------------------------------------------
section "root-owned chain above the home"
for p in / /var /var/lib /var/lib/kb-shell; do
  read -r u g m < <(stat -c '%U %G %a' "$p" 2>/dev/null)
  if [ "$u" = "root" ] && { [ "$m" = "755" ] || [ "$m" = "750" ]; }; then ok "$p ($u:$g $m)"
  else bad "$p is $u:$g $m — needs root-owned 0755 or 0750"; fi
done

# ---------------------------------------------------------------------------------------------
section "the provider home (mode must be EXACTLY 0700)"
read -r u g m < <(stat -c '%U %G %a' /var/lib/kb-shell/home 2>/dev/null)
[ "$u:$g" = "kb-shell:kb-shell" ] && [ "$m" = "700" ] \
  && ok "/var/lib/kb-shell/home ($u:$g $m)" \
  || bad "/var/lib/kb-shell/home is $u:$g $m — needs kb-shell:kb-shell 0700 exactly"

# ---------------------------------------------------------------------------------------------
section "auth state directories (must EXIST or systemd refuses to start the unit)"
for p in /var/lib/kb-shell/home/.claude /var/lib/kb-shell/home/.codex; do
  if [ -d "$p" ]; then
    read -r u g m < <(stat -c '%U %G %a' "$p")
    [ "$u:$g" = "kb-shell:kb-shell" ] && { [ "$m" = "700" ] || [ "$m" = "750" ]; } \
      && ok "$p ($u:$g $m)" || bad "$p is $u:$g $m — needs kb-shell:kb-shell 0700|0750"
  else bad "$p MISSING — install_pty_broker.py says the unit will not start"; fi
done
for f in /var/lib/kb-shell/home/.claude/.credentials.json /var/lib/kb-shell/home/.codex/auth.json; do
  [ -s "$f" ] && ok "$(basename "$f") present and non-empty" || bad "$(basename "$f") absent/empty — login not done"
done

# ---------------------------------------------------------------------------------------------
section "wrong ownership anywhere under .local (npm/root installs cause this)"
if [ -d /var/lib/kb-shell/home/.local ]; then
  n=$(find /var/lib/kb-shell/home/.local \( ! -user kb-shell -o ! -group kb-shell \) 2>/dev/null | wc -l)
  [ "$n" = "0" ] && ok "everything under .local is kb-shell:kb-shell" \
    || { bad "$n path(s) not owned by kb-shell:kb-shell:"; find /var/lib/kb-shell/home/.local \( ! -user kb-shell -o ! -group kb-shell \) 2>/dev/null | head -10 | sed 's/^/        /'; }
else bad "/var/lib/kb-shell/home/.local missing"; fi

section "0755 modes under .local (THE most common failure — npm's default)"
if [ -d /var/lib/kb-shell/home/.local ]; then
  n=$(find /var/lib/kb-shell/home/.local ! -type l ! -perm 0700 ! -perm 0750 2>/dev/null | wc -l)
  [ "$n" = "0" ] && ok "every component is 0700 or 0750" \
    || { bad "$n path(s) with a refused mode:"; find /var/lib/kb-shell/home/.local ! -type l ! -perm 0700 ! -perm 0750 2>/dev/null | head -10 | xargs -r stat -c '        %a %n' 2>/dev/null; }
  s=$(find /var/lib/kb-shell/home/.local -perm /6000 2>/dev/null | wc -l)
  [ "$s" = "0" ] && ok "no setuid/setgid anywhere under .local" || bad "$s setuid/setgid path(s)"
fi

# ---------------------------------------------------------------------------------------------
section "the two launchers"
for cli in claude codex; do
  p="/var/lib/kb-shell/home/.local/bin/$cli"
  if [ -e "$p" ] || [ -L "$p" ]; then
    read -r u g m t < <(stat -c '%U %G %a %F' "$p")
    if [ -L "$p" ]; then
      # A symlink is legal here. The fd-pinning walk pins the link itself with O_PATH|O_NOFOLLOW
      # and checks kind, the 0o6000 special bits, and OWNER only — it never looks at a symlink's
      # mode. Linux symlinks are always 0777 and chmod cannot change that, so applying the
      # 0700|0750 file rule here would be a false failure. npm stamps the link with the
      # installing user, so a root-run install yields root:root and IS refused.
      [ "$u:$g" = "kb-shell:kb-shell" ] \
        && ok "$cli (symlink, $u:$g — mode not checked for symlinks)" \
        || bad "$cli symlink is $u:$g — needs kb-shell:kb-shell (install as kb-shell, not root)"
      tgt=$(readlink -f "$p")
      case "$tgt" in
        /bin/*|/usr/bin/*|/usr/local/bin/*|/var/lib/kb-shell/home/.local/*) ok "  symlink target inside an approved root: $tgt";;
        *) bad "  symlink escapes the approved roots: $tgt";;
      esac
      read -r tu tg tm < <(stat -c '%U %G %a' "$tgt" 2>/dev/null)
      [ "$tu:$tg" = "kb-shell:kb-shell" ] && { [ "$tm" = "700" ] || [ "$tm" = "750" ]; } \
        && ok "  target ($tu:$tg $tm)" \
        || bad "  target is $tu:$tg $tm — needs kb-shell:kb-shell 0700|0750"
      p="$tgt"
    else
      [ "$u:$g" = "kb-shell:kb-shell" ] && { [ "$m" = "700" ] || [ "$m" = "750" ]; } \
        && ok "$cli ($u:$g $m, $t)" || bad "$cli is $u:$g $m — needs kb-shell:kb-shell 0700|0750"
    fi
    sb=$(head -c 128 "$p" 2>/dev/null | tr -d '\0' | head -1)
    case "$sb" in
      '#!'*) case "$sb" in
               '#!/usr/bin/env node'|'#!/bin/'*|'#!/usr/bin/'*) ok "  shebang accepted: $sb";;
               *) bad "  shebang REFUSED (fdPinnedPaths.ts shebangInterpreter): $sb";;
             esac;;
      *) ok "  no shebang (native binary — the safest shape)";;
    esac
  else bad "$cli NOT INSTALLED at $p"; fi
done

section "codex must pin at the NATIVE binary, never the npm wrapper (W30)"
# ~/.local/bin/codex is a 7 KB `#!/usr/bin/env node` wrapper whose only job is to spawn the vendored
# native. A shebang entrypoint reaches its interpreter as `args[0] = /proc/self/fd/<n>`, and that
# descriptor is FD_CLOEXEC, so it is already gone by the time node opens it: the tty path has always
# been silently broken for it and the headless path refuses it outright. fdPinnedPaths.ts therefore
# resolves codex through CODEX_EXECUTABLE_CANDIDATES, first hit wins. This is that list, in order.
codex_local=/var/lib/kb-shell/home/.local
codex_tail=@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex
codex_resolved=""
for cand in "$codex_local/lib/node_modules/@openai/codex/node_modules/$codex_tail" \
            "$codex_local/lib/node_modules/$codex_tail" \
            "$codex_local/bin/codex"; do
  [ -f "$cand" ] || continue
  if [ "$(head -c 2 "$cand" 2>/dev/null)" = '#!' ]; then
    warn "candidate is a #! script, skipped (cannot be a pinned entrypoint): $cand"
    continue
  fi
  codex_resolved="$cand"
  break
done
if [ -n "$codex_resolved" ]; then
  ok "codex resolves to a native binary: $codex_resolved"
  read -r u g m < <(stat -c '%U %G %a' "$codex_resolved")
  [ "$u:$g" = "kb-shell:kb-shell" ] && { [ "$m" = "700" ] || [ "$m" = "750" ]; } \
    && ok "  ($u:$g $m)" \
    || bad "  is $u:$g $m - the pin walk needs kb-shell:kb-shell 0700|0750"
  # The pin walk opens EVERY component O_NOFOLLOW and applies the same ownership/mode matrix to each,
  # so the leaf being right is not enough: npm creates the nested vendor directories 0755 under a
  # default umask, and one 0755 directory anywhere on this path refuses the whole launch.
  rel=${codex_resolved#"$codex_local"/}
  comp="$codex_local"
  bad_comp=""
  IFS=/ read -r -a parts <<< "$rel"
  for ((i = 0; i < ${#parts[@]} - 1; i++)); do
    comp="$comp/${parts[i]}"
    read -r cu cg cm < <(stat -c '%U %G %a' "$comp" 2>/dev/null)
    if [ "$cu:$cg" != "kb-shell:kb-shell" ] || { [ "$cm" != "700" ] && [ "$cm" != "750" ]; }; then
      bad_comp="$comp is $cu:$cg $cm"
      break
    fi
  done
  [ -z "$bad_comp" ] \
    && ok "  every directory below .local on that path is kb-shell:kb-shell 0700|0750" \
    || bad "  first refused component: $bad_comp - needs kb-shell:kb-shell 0700|0750"
else
  bad "NO native codex candidate exists - every headless codex launch refuses at create, and the capability probe will not advertise codex at all"
fi

section "pipe-stdin exec shim (W30: headless launches exec python3 on pipeStdinExec.py)"
# The shim is what gives a headless child a pipe on fd 0, a BLOCKING terminal on fd 1/2, a
# controlling tty, and a descriptor table with nothing inherited. The broker pins python3 once at
# start-up; if that pin fails, no agent launcher is advertised at all.
py=/usr/bin/python3
if [ -e "$py" ]; then
  read -r lu lm lt < <(stat -c '%U %a %F' "$py")
  pytgt="$py"
  if [ "$lt" = "symbolic link" ]; then
    [ "$lu" = "root" ] && ok "$py symlink is root-owned" || bad "$py symlink is $lu - needs root"
    pytgt=$(readlink -f "$py")
    case "$pytgt" in
      /bin/*|/usr/bin/*|/usr/local/bin/*) ok "  target inside an approved root: $pytgt";;
      *) bad "  target escapes the approved roots: $pytgt";;
    esac
  fi
  read -r tu tg tm < <(stat -c '%U %G %a' "$pytgt" 2>/dev/null)
  # fdPinnedPaths.ts validateComponent: a root-owned FILE must be EXACTLY 0755. The 0750 alternative
  # applies to directories only, so accepting it here would green a python3 the walk then refuses.
  [ "$tu" = "root" ] && [ "$tm" = "755" ] \
    && ok "  $pytgt ($tu:$tg $tm)" \
    || bad "  $pytgt is $tu:$tg $tm - the pin walk needs root-owned 0755 exactly"
else
  bad "$py MISSING - the broker's boot-time exec pin fails and NO agent launcher is advertised"
fi
shim=/opt/kb-shell-broker/current/server/pty/pipeStdinExec.py
if [ -f "$shim" ]; then
  read -r su sm < <(stat -c '%U %a' "$shim")
  # Whoever can write the shim owns every headless child. The release archive stamps it 0444.
  [ "$su" = "root" ] && [ "$((0$sm & 0022))" = "0" ] \
    && ok "$shim (root $sm)" \
    || bad "$shim is $su $sm - needs root-owned with no group or other write bit"
else
  bad "$shim MISSING from the deployed release - every headless launch refuses at create"
fi

# ---------------------------------------------------------------------------------------------
section "node interpreter (needed if either launcher is a JS shim)"
if [ -e /usr/bin/node ]; then
  read -r u g m < <(stat -c '%U %G %a' /usr/bin/node)
  [ "$u" = "root" ] && [ "$m" = "755" ] && ok "/usr/bin/node ($u:$g $m)" || bad "/usr/bin/node is $u:$g $m — needs root 0755"
else bad "/usr/bin/node missing (only matters for a '#!/usr/bin/env node' shim)"; fi

# ---------------------------------------------------------------------------------------------
section "worktree root (fdPinnedPaths.ts: dashboard-owned, group kb-shell, mode EXACTLY 02770)"
if [ -d /var/lib/kb-shell/worktrees ]; then
  read -r u g m < <(stat -c '%U %G %a' /var/lib/kb-shell/worktrees)
  [ "$u" = "kb-dashboard" ] && [ "$g" = "kb-shell" ] && [ "$m" = "2770" ] \
    && ok "/var/lib/kb-shell/worktrees ($u:$g $m)" \
    || bad "/var/lib/kb-shell/worktrees is $u:$g $m — needs kb-dashboard:kb-shell, mode EXACTLY 2770"
else bad "/var/lib/kb-shell/worktrees MISSING — attempts fail at provision with EACCES"; fi

section "every run-* / attempt-* worktree component (PR #152: adapters.ts creates these at 0700/2755, the validator demands exactly 02770)"
if [ -d /var/lib/kb-shell/worktrees ]; then
  offenders=0
  while IFS= read -r -d '' path; do
    read -r g m < <(stat -c '%G %a' "$path" 2>/dev/null)
    if [ "$g" != "kb-shell" ] || [ "$m" != "2770" ]; then
      bad "$path is group=$g mode=$m — needs group kb-shell, mode EXACTLY 2770"
      offenders=$((offenders + 1))
    fi
  done < <(find /var/lib/kb-shell/worktrees -mindepth 1 -maxdepth 2 -type d \( -name 'run-*' -o -name 'attempt-*' \) -print0 2>/dev/null)
  [ "$offenders" = "0" ] && ok "every run-*/attempt-* directory found is 2770 group kb-shell"
else
  warn "worktree root missing — skipped (already reported above)"
fi

# ---------------------------------------------------------------------------------------------
section "PTY session document schema"
pty_doc=/var/lib/kb/state/pty/session-runs.json
if [ -s "$pty_doc" ]; then
  schema=$(grep -o '"schema"[[:space:]]*:[[:space:]]*"[^"]*"' "$pty_doc" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
  [ "$schema" = "kb.pty-sessions/v3" ] && ok "session-runs.json schema is kb.pty-sessions/v3" \
    || bad "session-runs.json schema is '$schema', expected kb.pty-sessions/v3 — the boot migration (http/surface.ts ensurePtyDocumentMigrated) has not run"
elif [ -s "${pty_doc}.v2.bak" ]; then
  bad "session-runs.json is missing but ${pty_doc}.v2.bak exists — a migration ran and left only the backup; the live document never landed"
else
  warn "no session-runs.json yet (fresh install, or no session has ever started) — not a failure"
fi

# ---------------------------------------------------------------------------------------------
section "broker substrate"
systemctl is-active --quiet kb-shell-broker.socket && ok "kb-shell-broker.socket active" || bad "kb-shell-broker.socket not active"
if [ -S /run/kb-shell/broker.sock ]; then
  read -r u g m < <(stat -c '%U %G %a' /run/kb-shell/broker.sock)
  [ "$u:$g" = "kb-dashboard:kb-dashboard" ] && [ "$m" = "600" ] && ok "broker.sock ($u:$g $m)" \
    || bad "broker.sock is $u:$g $m — brokerProbe.ts needs kb-dashboard:kb-dashboard 0600"
  if command -v ss >/dev/null 2>&1; then
    if ss -xp 2>/dev/null | grep -q "/run/kb-shell/broker.sock.*ESTAB"; then
      ok "daemon holds an ESTAB peer connection to broker.sock"
    else
      warn "no ESTAB peer on broker.sock right now — daemon not connected yet (lazy connect); not a FAIL unless a launch is imminent"
    fi
  else
    warn "ss not available — cannot check for a live daemon<->broker connection"
  fi
else bad "/run/kb-shell/broker.sock absent"; fi
read -r u g m < <(stat -c '%U %G %a' /run/kb-shell 2>/dev/null)
[ "$u:$g" = "kb-shell:kb-dashboard" ] && [ "$m" = "750" ] && ok "/run/kb-shell ($u:$g $m)" \
  || bad "/run/kb-shell is $u:$g $m — the socket unit's ExecStartPre chown/chmod needs kb-shell:kb-dashboard 0750"

section "no API keys in the broker environment (constitution: subscription auth only)"
env_out=$(systemctl show kb-shell-broker.service -p Environment 2>/dev/null)
echo "$env_out" | grep -qE "ANTHROPIC_API_KEY|OPENAI_API_KEY" \
  && bad "an API key is present in the unit environment" || ok "no API key in the unit environment"

# ---------------------------------------------------------------------------------------------
section "no stale live PTY sessions in /run/kb-shell/state.json"
broker_state=/run/kb-shell/state.json
if [ -s "$broker_state" ]; then
  pids=$(grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' "$broker_state" | grep -o '[0-9]*$')
  if [ -z "$pids" ]; then
    ok "no sessions recorded in state.json"
  else
    stale=0
    for pid in $pids; do
      if ! kill -0 "$pid" 2>/dev/null; then
        bad "state.json records session pid $pid, which is not a running process — stale entry"
        stale=$((stale + 1))
      fi
    done
    [ "$stale" = "0" ] && ok "every recorded session pid is a live process"
  fi
else
  warn "no /run/kb-shell/state.json yet — nothing to check"
fi

# ---------------------------------------------------------------------------------------------
section "systemd units"
for unit in kb-dashboard.service kb-shell-broker.socket kb-shell-broker.service; do
  systemctl is-active --quiet "$unit" && ok "$unit active" || bad "$unit not active"
done
# Wall 1, found by the first successful claude launch (2026-09-03): the daemon runs `git worktree add`
# for every attempt, so ITS umask sets the modes inside the run worktree. At systemd's default 0022 git
# writes 2755 dirs / 644 files under the setgid kb-shell group and the worker (uid kb-shell) cannot
# write a byte into the tree it was handed. The unit ships UMask=0002; this proves the INSTALLED unit
# still carries it, because a release deploy does not reinstall units.
dashboard_umask=$(systemctl show kb-dashboard -p UMask --value 2>/dev/null)
[ "$dashboard_umask" = "0002" ] \
  && ok "kb-dashboard UMask=0002 (workers can write in their run worktree)" \
  || bad "kb-dashboard UMask=$dashboard_umask, needs 0002 - every worker write inside the run worktree will fail. Fix: add UMask=0002 to [Service] in deploy/systemd/kb-dashboard.service, reinstall the unit on the VM, systemctl daemon-reload, systemctl restart kb-dashboard"
# Twin of the check above, found in the same run (Gate 4b run 3): the BROKER's children (codex/claude
# worker processes) `mkdir -p` under the 2775 setgid run worktree, and at the systemd default 0022 those
# dirs come out 2755 kb-shell:kb-shell, which the daemon (uid kb-dashboard, group kb-shell) cannot
# unlink during `git worktree remove --force`. The unit ships UMask=0002; this proves the INSTALLED
# unit still carries it.
broker_umask=$(systemctl show kb-shell-broker -p UMask --value 2>/dev/null)
[ "$broker_umask" = "0002" ] \
  && ok "kb-shell-broker UMask=0002 (worker mkdirs stay group-writable for daemon cleanup)" \
  || bad "kb-shell-broker UMask=$broker_umask, needs 0002 - the daemon cannot clean up worker-created dirs. Fix: add UMask=0002 to [Service] in deploy/systemd/kb-shell-broker.service, reinstall the unit on the VM, systemctl daemon-reload, systemctl restart kb-shell-broker"

# ---------------------------------------------------------------------------------------------
# W61: the execution-profile catalogue the daemon compiles at launch admission comes from
# governance/model-routing.yaml IN THE OPS CHECKOUT - dashboard/server/control/environment.ts
# loadExecutionProfiles() -> loadRuntimeSkillRegistry(repoRoot) reads runtimes.<runtime>.known_models
# and turns each into manager:<runtime>:<model> / worker:<runtime>:<model>. That copy is mirrored
# from main by scripts/sync_daemon_dirs.py and only ever reaches the VM through a desktop-signed
# promotion, so it drifts silently: on 2026-09-04 ops still listed claude-opus-4-8 and one codex
# model, and every launch of an assignment naming claude-fable-5 answered 400
# assigned-profile-not-found. Nothing else on the box compares the two copies. See the runbook
# section "the execution-profile catalogue lives on ops".
section "execution-profile catalogue (governance/model-routing.yaml in the ops checkout)"
ops_routing=/var/lib/kb/ops/governance/model-routing.yaml
if [ ! -s "$ops_routing" ]; then
  bad "$ops_routing missing or empty - loadExecutionProfiles compiles an EMPTY catalogue and EVERY launch refuses 400 assigned-profile-not-found. Fix: python scripts/sync_daemon_dirs.py --sync on the desktop, then a promotion"
elif [ -n "$model_routing_sha" ]; then
  ops_sha=$(sha256sum "$ops_routing" 2>/dev/null | cut -d' ' -f1)
  if [ "$ops_sha" = "$model_routing_sha" ]; then
    ok "ops copy matches main's sha256 ($model_routing_sha)"
  else
    bad "ops copy is $ops_sha, main is $model_routing_sha - the ops mirror has DRIFTED. Fix: python scripts/sync_daemon_dirs.py --sync on the desktop, then python scripts/promote_vm_outbox.py (the reconciler admits this one governance path; the resident /usr/local/lib/kb/apply_ops_reconciliation.py must already carry the W61 allowlist)"
  fi
else
  # There is no on-VM copy of main's version to fall back to: the release payload ships no
  # governance/ (scripts/build_platform_release.py RELEASE_ROOTS), so an unhashed run cannot tell a
  # synced ops checkout from a drifted one. Unknown is a FAIL, not a pass.
  bad "no reference to compare against - pass main's sha256 as \$2 or \$KB_MODEL_ROUTING_SHA256: git show origin/main:governance/model-routing.yaml | sha256sum"
fi
# Whatever the comparison said, name what the daemon will actually compile - a launch names a model,
# not a file, and this is the list it is checked against.
if [ -s "$ops_routing" ] && command -v python3 >/dev/null 2>&1; then
  KB_OPS_ROUTING="$ops_routing" python3 -c '
import os, re, sys
text = open(os.environ["KB_OPS_ROUTING"], encoding="utf-8", errors="replace").read()
runtime = None
for line in text.splitlines():
    m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
    if m:
        runtime = m.group(1)
        continue
    m = re.match(r"^    known_models:\s*\[(.*)\]\s*$", line)
    if m and runtime:
        models = [v.strip().strip("\"" + chr(39)) for v in m.group(1).split(",") if v.strip()]
        print("        %s: %s" % (runtime, ", ".join(models)))
' 2>/dev/null
fi

# ---------------------------------------------------------------------------------------------
# W47: the CONSTRAINED tailnet passkey channel. Both names are OPTIONAL on this unit; when present
# they must satisfy exactly the rules the daemon asserts at boot and validate_vm_runtime.py asserts at
# ExecStartPre: RP origin (when set) == https://<tailnet host>; credentials (when set) parse to >=1
# entry AND require the origin; origin alone is the legal enrolment posture; both absent is the default.
# Values are never echoed: only presence, equality and a COUNT are reported. (The credential value is
# WebAuthn PUBLIC keys, harmless by design, but a preflight transcript is not where it belongs.)
section "T3 passkey channel (optional; governance/risk-tiers.md D2.13)"
# systemd quotes an Environment= value containing spaces, so a naive space split TRUNCATES it (and a
# truncated credentials value then "fails to parse" for the wrong reason). shlex is the same splitter
# deploy/validate_vm_runtime.py#_unit_environment uses, so preflight and ExecStartPre agree exactly.
unit_env=$(systemctl show kb-dashboard -p Environment --value 2>/dev/null)
read_unit_env() {
  KB_UNIT_ENV="$unit_env" KB_UNIT_ENV_NAME="$1" python3 -c '
import os, shlex, sys
name = os.environ["KB_UNIT_ENV_NAME"]
try:
    tokens = shlex.split(os.environ.get("KB_UNIT_ENV", ""), posix=True)
except ValueError:
    sys.exit(0)
for token in tokens:
    key, sep, value = token.partition("=")
    if sep and key == name:
        sys.stdout.write(value)
        break
' 2>/dev/null
}
passkey_host=$(read_unit_env DASHBOARD_TAILNET_HOST)
passkey_origin=$(read_unit_env DASHBOARD_RP_ORIGIN)
passkey_creds=$(read_unit_env DASHBOARD_WEBAUTHN_CREDENTIALS)
if [ -z "$passkey_origin" ] && [ -z "$passkey_creds" ]; then
  warn "no passkey channel provisioned - T3 gates (ceremony: webauthn) cannot be approved in the UI. See docs/runbooks/2026-09-03-vm-agent-launch-preflight.md section h"
elif [ -z "$passkey_origin" ]; then
  # Credentials with no RP origin can pin no RP-ID: a store nothing can ever verify against. The
  # daemon refuses to boot on this, so seeing it here means the unit was edited without a restart.
  bad "DASHBOARD_WEBAUTHN_CREDENTIALS is set without DASHBOARD_RP_ORIGIN - the daemon refuses to boot on this pair"
else
  if [ "$passkey_origin" = "https://$passkey_host" ]; then ok "DASHBOARD_RP_ORIGIN == https://$passkey_host"
  else bad "DASHBOARD_RP_ORIGIN does not equal https://$passkey_host exactly"; fi
  if [ -z "$passkey_creds" ]; then
    # The legal ENROLMENT posture, not a fault: the register ceremony needs the RP origin and is the
    # only way to obtain a credential. It grants nothing until one is provisioned.
    ok "RP origin set, no credential yet - enrolment posture (T3 gates stay unavailable until section h step 2)"
  else
    cred_count=$(DASHBOARD_WEBAUTHN_CREDENTIALS="$passkey_creds" python3 -c '
import json, os
raw = os.environ.get("DASHBOARD_WEBAUTHN_CREDENTIALS", "")
try:
    parsed = json.loads(raw)
except Exception:
    parsed = None
if not isinstance(parsed, list):
    print(0)
else:
    print(sum(1 for e in parsed if isinstance(e, dict) and isinstance(e.get("id"), str) and isinstance(e.get("publicKey"), str)))
' 2>/dev/null)
    [ "${cred_count:-0}" -ge 1 ] 2>/dev/null       && ok "DASHBOARD_WEBAUTHN_CREDENTIALS parses to $cred_count credential(s)"       || bad "DASHBOARD_WEBAUTHN_CREDENTIALS does not parse to at least one {id, publicKey} credential"
  fi
fi

# ---------------------------------------------------------------------------------------------
section "admission / readiness / health (over the tailnet URL)"
if [ -z "$tailnet_url" ]; then
  warn "no tailnet URL passed as \$1 — skipping admission/readyz/health checks"
else
  if command -v curl >/dev/null 2>&1; then
    health_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$tailnet_url/healthz" 2>/dev/null)
    [ "$health_code" = "200" ] && ok "/healthz -> 200" || bad "/healthz -> $health_code, expected 200"

    admission_probe="$tailnet_url/api/workflows/vm-launch-preflight-probe-nonexistent"
    admission_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X PUT "$admission_probe" 2>/dev/null)
    if [ "$admission_code" = "404" ]; then ok "admission probe -> 404 (healthy)"
    elif [ "$admission_code" = "503" ]; then bad "admission probe -> 503 (outbox-degraded — the daily drain has not run; see docs/runbooks/2026-09-03-vm-agent-launch-preflight.md §e)"
    else bad "admission probe -> $admission_code, expected 404"; fi

    ready_body=$(curl -s --max-time 10 "$tailnet_url/readyz" 2>/dev/null)
    if echo "$ready_body" | grep -q '"execution-locked"\|"execution-locking"'; then
      bad "readyz reports execution is not unlocked: $ready_body"
    elif echo "$ready_body" | grep -q '"quiescent"'; then
      ok "readyz reachable and execution is unlocked"
    else
      warn "readyz did not return the expected shape — got: $ready_body"
    fi

    # W47: the server's own answer to "can a T3 passkey ceremony run right now". WARN, never FAIL: a
    # false here blocks only T3 gates (ceremony: webauthn), not a launch, so it must not gate the run.
    ceremony_body=$(curl -s --max-time 10 "$tailnet_url/api/auth/context" 2>/dev/null)
    case "$ceremony_body" in
      *'"ceremonyAvailable":true'*) ok "/api/auth/context ceremonyAvailable=true (T3 gates approvable)" ;;
      *'"ceremonyAvailable":false'*) warn "/api/auth/context ceremonyAvailable=false - T3 gates will refuse 403 ceremony-unavailable; see the runbook section h" ;;
      *) warn "/api/auth/context did not report ceremonyAvailable" ;;
    esac
  else
    warn "curl not available — cannot check admission/readyz/health"
  fi
fi

echo
if [ "$fail" = "0" ]; then echo "PRE-FLIGHT CLEAN — every launch-time condition satisfied."
else echo "PRE-FLIGHT FAILED — fix the FAIL lines above before launching a session."; fi
exit $fail
