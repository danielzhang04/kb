# Desktop → VM cutover — end state (2026-08-18)

**Status:** design of record for Step 5 of `handoffs/2026-08-18-boss-plan-remaining.md`.
**Replaces:** the Wave-3 end state implied by `docs/runbooks/2026-08-06-wave3-cutover.md` (that
runbook targets the *legacy* Wave-1 pilot stack, which is decommissioned, not cut over to).
**Companion runbook:** `docs/runbooks/2026-08-18-platform-cutover.md`.

Every fact below is marked `VERIFIED` (observed on the live VM or read out of `origin/main` on
2026-08-18) or `UNVERIFIED:` (could not be established without changing state / running the
cutover). Nothing is assumed from prior handoffs.

---

## 1. What runs where after cutover

### 1.1 The only production control plane — the certified platform on the VM

VERIFIED from `systemctl cat kb-dashboard.service` and `/opt/kb-releases` on `kb@100.89.73.118`:

| Property | Value |
| --- | --- |
| Unit | `/etc/systemd/system/kb-dashboard.service` — "kb dashboard immutable platform" (**system** unit, not `--user`) |
| Service identity | `User=kb-dashboard` / `Group=kb-dashboard` (NOT the `kb` login account) |
| Code | `/opt/kb-releases/current` → `0554dc81…` today; `ReadOnlyPaths=/opt/kb-releases` |
| Entry | `/usr/bin/node --experimental-strip-types server/index.ts`, cwd `/opt/kb-releases/current/dashboard` |
| Listener | `127.0.0.1:4317` |
| Public face | `tailscale serve` → `https://kb.tail82dd4f.ts.net` (443, **tailnet only**, no Funnel) |
| repoRoot | `DASHBOARD_REPO_ROOT=/var/lib/kb/ops` |
| stateRoot | `DASHBOARD_STATE_ROOT=/var/lib/kb/state` |
| Writable | `ReadWritePaths=/var/lib/kb/state /var/lib/kb/ops` only; `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true` |
| Publication | `KB_COORDINATION_PUBLICATION=outbox` — the daemon never fetches, pulls or pushes |
| Arming | **End state: armed at boot** under `DASHBOARD_AUTH_MODE=tailnet` (see §4). Today's live unit still reads `DASHBOARD_EXECUTION_ACTIVATED=0`; the tailnet-auth wave that flips this is a precondition of the window |
| Git | `GIT_CONFIG_GLOBAL=/dev/null`; repo-local identity `kb-dashboard@agents.local` |
| Auth | **End state: `DASHBOARD_AUTH_MODE=tailnet`** — a request through the `tailscale serve` proxy *is* the operator; proxy identity headers are audited (§4). No session, no passkey, no unlock latch on the platform |
| WebAuthn env | **Gone in the end state.** Today's live unit still carries `DASHBOARD_RP_ORIGIN` and `DASHBOARD_WEBAUTHN_CREDENTIALS` (credential `6aVHd1DLHfXDaCSqysF8Bw`, `transports:["internal"]`); the tailnet-auth wave removes both, which is what closes the repo-unit drift hazard (§9.7, D-10) |
| Denied env | `UnsetEnvironment=GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK DASHBOARD_SESSION_SECRET KB_CANARY_SESSION` |
| Preflight | `ExecStartPre=… validate_vm_runtime.py --phase static` — refuses to start on env drift |
| Helpers | `/usr/local/lib/kb/{activate_release,validate_vm_runtime,export_tier0,apply_ops_reconciliation}.py` (root-owned, `0555`) |

Runtime host facts VERIFIED: node v24.19.0, python 3.14.4, `sudo -n` works for `kb`, 136 GB free
on `/`, `NRestarts=0` since 2026-08-18 04:43:50 UTC, `/readyz` → `{"ok":true,"quiescent":true,"blockers":[]}`.

### 1.2 Capabilities that DO NOT survive the move to Linux

VERIFIED in `dashboard/server/runtime/capabilities.ts` on `origin/main`:

```ts
const windows = platform === 'win32';
return { platform, python: resolvePython(platform), pty: windows,
         runnerTrigger: windows, vibe: windows, dashboardBridge: true };
```

So on the VM, permanently: **`pty:false`, `runnerTrigger:false`, `vibe:false`.** Concretely the
cutover *removes*:

- the in-dashboard terminal (`/api/pty` is only registered when `runtimeCapabilities.pty`);
- the `DASHBOARD_CODEX_RUNNER_TASK=kb-codex-runner` trigger (a Windows `schtasks` object);
- Vibe.

These are not defects to fix during the window — they are the end state. Terminal work continues
in Daniel's local shells against the desktop checkout; only the *control plane* moves.

### 1.3 What stays on the desktop after cutover

- Interactive agent terminals (this boss session and its workers) and the main checkout
  `C:\Users\danie\kb`. The desktop remains the **only** machine holding a GitHub credential.
- `scripts/promote_vm_outbox.py` — the ops write-back operator tool (§3).
- `scripts/deploy_platform_release.py` + the release signing key — the only path that changes VM code.
- `scripts/backup_tier0.py` and the restic tier-0 repo `C:\Users\danie\kb-backups\restic-tier0`.
- The desktop codex-dispatch instance state `%LOCALAPPDATA%\kb-codex-dispatch\` (the tool now also
  has a POSIX process-control/state implementation, but this desktop state remains local; VERIFIED
  that nothing under `dashboard/server` reads it — the only references in the repo are the
  `dispatch-codex` skill and its docs). It does **not** migrate and does **not** get decommissioned.

---

## 2. State layout after cutover

`stateRoot` on the platform is `/var/lib/kb/state`. VERIFIED path mapping from `origin/main`
(`control/store.ts:5584`, `control/activation.ts:375-387`, `control/adapters.ts:645,767`,
`control/canonicalResultIntegrator.ts:464,475`, `control/paidActionService.ts:666`,
`control/spendGrant.ts:160`, `composer/store.ts:350`):

| Desktop (`DASHBOARD_STATE_ROOT=%LOCALAPPDATA%\kb-dashboard`) | Platform destination | Migrate? |
| --- | --- | --- |
| `control\control-plane.json` (120 KB) | `/var/lib/kb/state/control/control-plane.json` | **Yes** — replaces the 234-byte empty seed |
| `control\canonical-integration.json` | `…/control/canonical-integration.json` | **Yes** |
| `control\execution-accounting\` | `…/control/execution-accounting/` | **Yes** |
| `control\agent-session-chains\` | `…/control/agent-session-chains/` | **Yes** |
| `control\attempt-io\` | `…/control/attempt-io/` | **Yes** |
| `control\.disabled-hooks\` | `…/control/.disabled-hooks/` | **Yes** (read by `canonicalResultIntegrator.ts:475`) |
| `control\execution-results.json`, `paid-actions.json`, `spend-grants.json` | same names under `…/control/` | **Yes, if present** (none observed on the desktop today) |
| `workflows\assignment-amendments\` | `/var/lib/kb/state/workflows/assignment-amendments/` | **Yes** |
| `naming.json` | `/var/lib/kb/state/naming.json` | **Conflict — see §2.2** |
| `composer\workspaces.json` | `/var/lib/kb/state/composer/workspaces.json` (dir absent today) | **Yes, degraded — see §5** |
| `control\worktrees\` | *(reconciler rebuilds)* | **No** — host-specific git worktrees |
| `control\integration\` | *(reconciler rebuilds)* | **No** — host-specific git worktrees |
| `pty\`, `pty-priming\` | — | **No** — `pty:false` on Linux |
| `*.mutex.sqlite` (if present) | — | **No** — host lock artifacts |
| `%LOCALAPPDATA%\kb-codex-dispatch\**` | — | **No** — desktop-only tool (§1.3) |
| `ledgers/`, `queue/`, `traces/`, `memory/`, `dashboards/`, `handoffs/`, `orgs/*/STATE.md` | `/var/lib/kb/ops/**` **by git only** | **Never by file copy** — see §2.3 |

The old five-file list (`control-plane.json`, `composer/workspaces.json`, `threads.json`,
dispatch `logs/`, `ledgers/`) silently dropped seven of the rows above and copied two that must
not be copied. It is superseded.

### 2.1 Quiescence, and what actually has to be drained

VERIFIED desktop control-plane shape (2026-08-18): 10 runs, 16 stages, 19 attempts, 32 sessions,
43 events, 14 human requests.

- run states: `waiting-human` ×7, `succeeded` ×2, `failed` ×1
- attempt states: `queued` ×7, `interrupted` ×7, `succeeded` ×4, `failed` ×1
- session states: `interrupted` ×18, `pending` ×7, `completed` ×4, `stopped` ×2, `failed` ×1

Nothing is in flight. `AttemptState` is
`'queued'|'starting'|'running'|'waiting-human'|'succeeded'|'failed'|'stopped'|'interrupted'`
(`control/types.ts:72`), so the correct quiescence predicate is **no attempt in `starting`/`running`
and no session in `starting`/`running`/`waiting`** — not "no non-terminal run". The old runbook's
`state -notin terminal → throw` would demand Daniel force-terminate seven runs that are legitimately
parked at human gates and are supposed to migrate intact. Those seven runs, seven open human
requests and seven queued attempts **migrate as-is** and remain answerable on the VM.

**But under the tailnet arming model (§4) they are not inert while they wait.** The platform is armed
at boot, so a migrated queued attempt is a job the engine may claim, and a migrated open human
request is a live trigger the moment it is answered in the browser. Verified expectation: **7 queued
attempts** after the import. The runbook asserts that count and asserts **zero claimable queue cards**
*before* the first armed boot, and warns the operator that answering a migrated gate starts real
work rather than merely clearing a notification.

### 2.2 `naming.json` collision (must be decided before the copy)

VERIFIED: the platform already wrote `/var/lib/kb/state/naming.json` (13 934 bytes, 2026-08-18
04:48, mode `0600`). The desktop has its own (12 049 bytes). A blind copy destroys whichever side
loses. See OPEN DECISION D-4.

### 2.3 Ledgers are git, not files

`ledgers/` is git-tracked coordination state living inside the daemon's repoRoot checkout. On the
platform that is `/var/lib/kb/ops`, a **sparse** clone of `ops`
(`DATA_PATTERNS = /CLAUDE.md /BOSS.md /HEARTBEAT.md /docs/ /orgs/ /queue/ /ledgers/ /traces/
/memory/ /dashboards/ /handoffs/ /governance/ /agents/ /skills/`, VERIFIED in
`deploy/bootstrap_vm.py`). Ledgers reach the VM by `git`, from GitHub `ops`, never by `scp`. The
old runbook's `scp -r ledgers/ → ~/.local/state/kb-cutover/` created a *third* copy that no daemon
reads; it is deleted from the new procedure. Every ledger grep in acceptance targets
`/var/lib/kb/ops/ledgers/**`.

---

## 3. Ops write-back model

### 3.1 The constraint

VERIFIED, `deploy/bootstrap_vm.py:202-203`:

```
git -C /var/lib/kb/ops remote set-url        origin disabled://desktop-promotion-only
git -C /var/lib/kb/ops remote set-url --push origin disabled://desktop-promotion-only
```

The VM has, by construction, **no route to GitHub**. This is not an oversight to patch during the
window: it is Daniel's locked ruling #2 of 2026-08-11
(`docs/superpowers/specs/2026-08-11-kb-structure-design.md`):

> **Sync topology:** retain desktop promotion plus a durable VM outbox; place **no GitHub
> credential on the VM**. Staging-repository promotion is the pre-designed escalation; a brokered
> GitHub App is considered only if direct publication proves necessary. PAT is permanently out.

The legacy `~/kb-mirror.git` bare mirror is likewise a dead end — VERIFIED it has no GitHub remote,
and it belongs to the decommissioned stack (§6). **An audit must never count a commit reaching the
mirror, or reaching `/var/lib/kb/ops`, as "pushed".**

### 3.2 The two options, as required by the brief

**Option A — provision a deploy credential on the VM.** Daniel hand-places a GitHub deploy key /
fine-grained token scoped to `ops`; the daemon pushes directly; no drain step exists.
*Assessment:* **excluded.** It contradicts a standing locked ruling; it puts a push credential
inside a box that runs governed agent work; and `deploy/validate_vm_runtime.py` refuses to start
the unit when any env name matches
`(?i)(TOKEN|SECRET|PASSWORD|PASSKEY|CREDENTIAL|API_KEY|ACCESS_KEY|AUTH_SOCK|ASKPASS|COOKIE|SESSION)`
— with no sanctioned exception left once the tailnet-auth wave removes the WebAuthn public-key entry
(§4) — so it cannot even be implemented through the unit env without weakening the preflight that
Gate-1 was signed against. Recording it here only so a reviewer sees it was considered and why it
dies.

**Option B — outbox spool + desktop promotion (the shipped design).** VERIFIED to exist and to be
running:

1. The daemon commits coordination locally into `/var/lib/kb/ops` and, because
   `KB_COORDINATION_PUBLICATION=outbox`, spools each commit as an ordered incremental git bundle
   plus a canonical manifest into `/var/lib/kb/state/outbox/ready/<sha>.{bundle,json}`, advancing a
   durable anchor `refs/kb-outbox/spooled` (`dashboard/server/write/outbox.ts`).
2. The desktop drains it with `python scripts/promote_vm_outbox.py --spool … --repo … --work-root …
   --vm-host kb@… --trusted-ops-head <sha>` — which fetches the spool, validates the manifest chain
   against a trusted head, requires an **ssh-signed operator approval** for any bundle touching
   instruction-shaped paths (`queue/`, `memory/`, `dashboards/`, `handoffs/`, `orgs/*/STATE.md`;
   principal `kb-ops-approver`, namespace `kb-ops-instructions`), promotes into a fresh clone, and
   pushes to GitHub `ops`.
3. It writes receipts back to `/var/lib/kb/state/outbox/receipts/` and applies the return
   reconciliation bundle through `sudo /usr/local/lib/kb/apply_ops_reconciliation.py` so the VM's
   checkout converges on the promoted history.

**RECOMMENDATION: Option B, unchanged as the topology.** It is already the ruling and it needs no
credential ceremony inside the cutover window. But the framing "already built, only the operational
half is missing" is **wrong**, and neither this spec nor the runbook may be written as though the
first drain is a button-press.

VERIFIED in `scripts/promote_vm_outbox.py`: the promoter is a **sole-writer** tool. It validates each
bundle's manifest parent against the trusted ops head and **hard-fails when `origin/ops` has advanced
past the bundle's parent**; its receiptless-recovery path additionally **raises when the count of
remote commits ahead exceeds the count of pending bundles**. The desktop has pushed **108 commits to
`origin/ops`** since the Gate-1 bundle spooled. Consequence: **the live Gate-1 bundle is unpromotable
by the shipped tool under any combination of arguments.** That is not a flag to discover at the
keyboard during the window; it is a design collision between the tool's sole-writer invariant and a
desktop that goes on writing `ops`.

VERIFIED about the pending bundle itself (`a0e6777b…`, 793 B bundle + 352 B manifest): it carries a
**single delta to `ledgers/audit/dashboard-audit.ndjson`**. The manifest is world-readable and *was*
read; the bundle is **not instruction-shaped** — it touches none of `queue/`, `memory/`,
`dashboards/`, `handoffs/`, `orgs/*/STATE.md` — so it needs **no `kb-ops-approver` signature**. The
signed-approval ceremony is therefore not on the critical path of the first drain.

Pre-window reconciliation options for that one stranded bundle (either is acceptable; choose before
the window opens, never inside it):

1. **Hand-promote the delta.** Apply the `dashboard-audit.ndjson` delta to `ops` from the desktop,
   reset `/var/lib/kb/ops` to `origin/ops`, and `git update-ref refs/kb-outbox/spooled <new HEAD>` on
   the VM so the durable outbox anchor matches the history the daemon will spool from next.
2. **Freeze desktop `ops` writes for the duration of the promotion**, so `origin/ops` cannot advance
   between the tool's trusted-head read and its push.

Either is a **one-off** for this stranded bundle only. The *standing* answer is the write-authority
ruling in §3.4.

### 3.3 The live evidence that the drain has never run

VERIFIED on the VM right now:

```
/var/lib/kb/state/outbox/ready/     a0e6777b9f503b29546986798f16ccfb0a227c04.bundle  (793 B, Aug 18 04:47)
                                    a0e6777b9f503b29546986798f16ccfb0a227c04.json    (352 B, Aug 18 04:47)
/var/lib/kb/state/outbox/receipts/  (empty)
/var/lib/kb/state/outbox/incoming/  (empty)
```

One undrained bundle — VERIFIED (§3.2) to be a single `ledgers/audit/dashboard-audit.ndjson` delta
from the Gate-1 ceremony — has been sitting in `ready/` since that ceremony. The write-back path is
**built and unproven end-to-end**, and per §3.2 it cannot be proven by pointing the shipped tool at
*that* bundle: `origin/ops` has moved 108 commits past its parent. Reconciling the stranded bundle is
a **pre-window** task (§3.2, options 1 or 2). The cutover's first acceptance step is draining the
*fresh* bundle the platform's first armed boot produces, under the co-writer model ruled in §3.4.

### 3.4 Ops write authority — RULED: co-writers (Model B)

**Daniel's ruling: the desktop and the VM are co-writers of `ops`.** Desktop terminals keep pushing
`ops` under the existing `CLAUDE.md` ritual; `promote_vm_outbox.py` is what changes. Everything
downstream of the promotion drain — the acceptance drain in the runbook's §5.2, the outbox predicate
in §5.9, the VM ops-refresh step, and the cadence in D-1 — is written against this model.

The facts the ruling sits on:

- `promote_vm_outbox.py` validates each bundle's manifest parent against `--trusted-ops-head` and
  **hard-fails when `origin/ops` has advanced past that parent**; its receiptless-recovery path
  **raises when remote commits ahead exceed pending bundles**. Its shipped invariant is that the VM
  is the only writer of `ops` between drains.
- The desktop is, today, a second writer of `ops` — 108 commits since the Gate-1 bundle spooled.
- `/var/lib/kb/ops` has `origin` set to `disabled://desktop-promotion-only` on both fetch and push,
  so the VM's checkout has **no independent way to move forward**: the only downward path in the
  shipped design is the reconciliation bundle applied at the tail of a *successful* promotion. A
  promotion that never succeeds means a checkout that never refreshes.

The model that was **rejected** — *Model A, VM as sole writer of `ops`* — matched the shipped tool's
invariant exactly and needed no code, but it required every desktop terminal (boss session, workers,
cadences, the `dashboard-ops` worktree ritual in `CLAUDE.md`) to become read-only against `ops`, with
all coordination routed through the VM daemon and drained back. Recorded here so a reviewer sees the
alternative and why it was not taken: it rewrites the fleet's working rules to protect a tool.

**Model B — co-writers — is the ruling.** It is a code change with no policy change, and it carries
three **prerequisites that must land and ship in a release before the cutover window opens**:

1. **Rebase onto current `origin/ops`.** The promoter must re-derive each pending bundle's commits
   onto the current remote head rather than hard-failing when the trusted head has moved. Without
   this, any desktop push between two drains strands the spool — which is exactly how the Gate-1
   bundle got stranded.
2. **Empty-spool exit-0 no-op.** It raises today; a cadence would error on every tick where nothing
   spooled (D-1).
3. **Pull-only downward sync mode.** `/var/lib/kb/ops` must be able to converge on `origin/ops`
   *without* a successful upward promotion carrying the reconciliation. Today that is the only
   downward path, so a checkout whose promotions fail never refreshes — the state the VM is in now,
   108 commits behind.

Consequence for the runbook: its pre-acceptance VM ops-refresh step uses prerequisite 3, and its
acceptance drain relies on prerequisite 1 holding while the desktop keeps writing. Neither is
improvised during the window. See OPEN DECISION D-9 (ruled).

### 3.5 The standing mechanism (cadence)

A spool that only drains when a human remembers is a silent-loss shape wearing a durability
costume. The end state needs a *cadence*: after cutover, one recurring desktop-tier
`HEARTBEAT.md` cadence runs `promote_vm_outbox.py`, and a non-empty `ready/` older than the cadence
interval is a wake-me card, not a shrug. The cadence is **downstream of §3.4** — it cannot be
scheduled until the co-writer prerequisites (rebase-onto-current-head, empty-spool exit-0) land. See
OPEN DECISION D-1.

---

## 4. Arming model — tailnet trust, armed at boot

**This is a change of end state, ruled by Daniel on 2026-08-18 and built by a separate wave that is a
precondition of the cutover window.** The passkey-login-then-unlock ceremony does **not** survive the
move to the VM.

**End state: `DASHBOARD_AUTH_MODE=tailnet`.** The daemon is reachable only through the
`tailscale serve` proxy on `https://kb.tail82dd4f.ts.net` (443, tailnet only, no Funnel), and in this
mode **a request arriving through that proxy is the operator**. There is no session, no bearer, no
WebAuthn ceremony and no unlock latch. The proxy's identity headers are recorded on every audited
action, so "who did this" is answered by the tailnet identity rather than by a session cookie.
**Execution and the queue bridge are armed at boot**, which is what makes unattended operation
possible at all.

Consequences, stated plainly because they are the trade Daniel accepted:

- **The trust boundary is now the tailnet, entirely.** Anything that can reach the serve proxy can
  drive execution. There is no second factor behind it. The security of the control plane is exactly
  the security of the tailnet ACL and the absence of Funnel.
- **The platform is armed the moment it boots** — after a reboot, a release deploy, a crash restart.
  Queued work resumes without a human. This is the point; it is also why the runbook asserts a
  **zero-claimable-cards** precondition before the first armed boot (runbook §3.4) rather than trusting
  that nothing will start.
- The WebAuthn latch, session secret and unlock/lock routes **survive only as the win32-desktop
  mode**. They remain the auth model for a dashboard run on Daniel's machine; they are simply not the
  platform's model.
- The unit's `DASHBOARD_WEBAUTHN_CREDENTIALS` and `DASHBOARD_RP_ORIGIN` entries **disappear** with
  this wave. That incidentally dissolves the repo-unit-vs-live-unit drift hazard (§9.7): the two
  values that existed nowhere in the repo are the two values that stop existing at all (D-10).

**What replaces the old restart caveat:** nothing has to be re-armed, so there is no re-arm cost to
measure. The runbook's reboot test changes from "time the human re-arm" to "prove the platform comes
back **armed and working with no human at the keyboard**" — daemon active, `/readyz` clean, execution
armed, and a queue-bridge tick observed within 60 s of boot. See OPEN DECISION D-2 (ruled).

**What is now load-bearing instead:** with no unlock gate, the only thing standing between a boot and
real work is the state of the queue and of the open human requests. Both are migrated in this
cutover, and both are live triggers the instant the daemon starts. §2.1's seven queued attempts and
seven open human requests are therefore not inert cargo — see the runbook's pre-boot guard.

---

## 5. Session secret and operator access

**The desktop session secret must NOT be carried to the VM, and cannot be.** VERIFIED in
`deploy/validate_vm_runtime.py:13`:

```py
FORBIDDEN_ENV = frozenset({"GITHUB_TOKEN","GH_TOKEN","GIT_ASKPASS","SSH_AUTH_SOCK",
                           "DASHBOARD_SESSION_SECRET","KB_CANARY_SESSION"})
```

and reinforced by `UnsetEnvironment=… DASHBOARD_SESSION_SECRET` in the unit. `ExecStartPre` would
refuse to start the service if it were present. Section 3.5 of the old runbook — "Daniel provisions
the **same existing** `DASHBOARD_SESSION_SECRET` … if he cannot provide the exact secret, stop the
cutover" — is now not merely stale but **actively forbidden**, and the `sed -i` shape it used would
also rewrite already-correct env lines. Both are removed from the new runbook.

What that means for the composer import (VERIFIED, `composer/protector.ts` +
`composer/store.ts:258-266`):

- `workspaces.json` stores `protectedProviderId` sealed with AES-256-GCM under a key derived as
  `sha256("kb-dashboard/composer-provider-id/v1\0" || sessionSecret)`.
- The VM's secret is `randomBytes(32)` per process (`auth/session.ts:114-118`), so every sealed
  provider id migrated from the desktop is **permanently unopenable** there — and would be
  unopenable across any VM restart regardless of migration.
- This degrades safely, by design: `acquireWriter` catches the decrypt failure, nulls
  `protectedProviderId`, persists, and lets the turn route rehydrate a fresh Claude session from
  visible text. Workspace identity, titles and history survive; *provider-session resumption* does
  not.

So: copy `workspaces.json`, expect every workspace to lose its provider binding on first use, and
do not treat that as a cutover failure. See OPEN DECISION D-5 for whether it is worth copying at all.

**Operator access.** Under `DASHBOARD_AUTH_MODE=tailnet` (§4) there is nothing to migrate and
nothing to enrol: the platform has no credential store of its own, and the desktop's WebAuthn
enrolment (`http://localhost:5317`, credential `g4zK1F_rS_ZauyemvAFQWWb5TNPQ4bfpglzawiijdjg`, sourced
from `pm2.config.cjs` / `governance/webauthn-credentials.yaml`) stays where it is, serving the
win32-desktop mode only.

Access is **direct browsing of `https://kb.tail82dd4f.ts.net` over the tailnet**, and only that.
Every tunnel step from the old runbook (`ssh -N -L localhost:5317:127.0.0.1:5317`) is deleted, and
the reason is now stronger than an origin mismatch: a tunnel bypasses the `tailscale serve` proxy,
so the request arrives without the proxy identity the tailnet mode trusts and audits. A tunnelled
request is not an operator request. It is also the one shape that could make an unaudited action
look audited, so it is forbidden rather than merely unsupported.

---

## 6. What is decommissioned

### 6.1 Desktop

- **`pm2 kb-dashboard`** (currently `online`, cwd `C:\Users\danie\kb-worktrees\dashboard-prod\dashboard`,
  `DASHBOARD_STATE_ROOT=%LOCALAPPDATA%\kb-dashboard`, `DASHBOARD_SESSION_SECRET` present in the
  process env — VERIFIED via `pm2 jlist`). Cutover **stops** it and then `pm2 save`s, so the saved
  dump records it as `stopped` and logon-resurrection brings it back stopped rather than online. The
  process entry is *not* deleted during the two-week window — `pm2 delete` happens at day 14 (the
  window-close ritual in §7), because deleting it now would discard the rollback image's pm2
  registration.
- **`schtasks \kb-codex-runner` and `\kb-desktop-dispatcher`** — VERIFIED both already `Disabled`.
  Cutover asserts this rather than changing it.
- **`atlas-worker`** (pm2, `online`, cwd `C:\Users\danie\kb-worktrees\atlas\atlas`) — **OPEN, see
  D-3.** Atlas is a desktop voice stack (audio devices, Windows TTS); it has no VM story and the
  Atlas plan is explicitly sequenced *after* cutover. Default position: leave it running, untouched.

### 6.2 VM legacy stack (Wave-1 pilot — superseded, never revived)

VERIFIED present and inert: `systemctl --user is-active kb-dashboard` → `inactive`; the directories
`~/kb`, `~/kb-dashboard-ops`, `~/kb-mirror.git`, `~/.config/kb` all still exist under the `kb`
login account.

Decommission (after the two-week window, not during it): disable/remove the user unit and its
`~/.config/systemd/user` fragments, drop linger only if nothing else needs it, and delete `~/kb`,
`~/kb-dashboard-ops`, `~/kb-mirror.git`, `~/.config/kb`. Also delete the leftover
`/var/tmp/gate1-run.sh` collect runner.

These directories are **not** rollback material — the rollback target is the desktop (§7), and
`~/.config/kb` holds a `CLAUDE_CODE_OAUTH_TOKEN` that no longer has a consumer. Keeping a stopped
second control plane with its own credential on the same host is a standing hazard, which is why
the Item-10 ruling stopped it in the first place.

### 6.3 Not decommissioned

`dashboard-ops` (the permanently-checked-out `ops` worktree), `dashboard-prod` (§7), the
control-plane managed worktrees under `%LOCALAPPDATA%\kb-dashboard\control\{worktrees,integration}`,
`%LOCALAPPDATA%\kb-codex-dispatch\`, and the `boss-2026-08-11c` SDD ledger worktree.

---

## 7. Rollback story

Three independent layers, cheapest first.

**Layer 1 — release rollback (code only, seconds).**
`sudo /usr/local/lib/kb/activate_release.py rollback` flips `current` back to the `previous`
symlink (`ae4dad03…` today) and restarts. State is untouched. This is the answer to "the new
release is broken", not to "the cutover was wrong".

**Layer 2 — state restore (tier-0 restic).**
`python scripts/backup_tier0.py backup --host kb@100.89.73.118 --output <snap>` /
`restore --target <dir> --report <file>` against `C:\Users\danie\kb-backups\restic-tier0`.
Drill-proven during Gate-1 (RTO 16 s, isolated locked boot on :14317). A pre-cutover snapshot is
taken *before* the state import so the empty-seed platform state is recoverable.

**Layer 3 — return to the desktop (the two-week inert window).**
For 14 days after cutover the desktop stays a *cold standby*, not a competing writer:

- `C:\Users\danie\kb-worktrees\dashboard-prod` is **preserved byte-for-byte** — the worktree, its
  branch `claude/dashboard-prod-pin`, and `dashboard/pm2.config.cjs`. It is exempt from the
  Step-4 closure sweep and from "advance prod-pin to main" until the window closes. Deleting it is
  what would make rollback impossible.
- `%LOCALAPPDATA%\kb-dashboard\**` is **not** deleted or moved by the migration — the copy to the
  VM is a copy, and the desktop retains the original as the rollback image.
- Rollback procedure: stop the VM unit → drain the outbox one last time so no VM-side coordination
  is stranded → `git -C dashboard-ops pull --rebase origin ops` so the desktop sees everything the
  VM produced → copy `/var/lib/kb/state/control/**` back over `%LOCALAPPDATA%\kb-dashboard\control\**`
  → `pm2 start` from `dashboard-prod`. **Never run both daemons against one control plane**, and
  never restore state without the outbox drain first.

Window close ritual (day 14): decommission per §6, advance `claude/dashboard-prod-pin`, remove the
`dashboard-prod` worktree, delete the legacy VM directories.

---

## 8. OPEN DECISIONS (Daniel)

| # | Decision | Default if unanswered |
| --- | --- | --- |
| **D-1** | **Outbox drain cadence.** Manual-only, or a recurring desktop-tier `HEARTBEAT.md` cadence running `promote_vm_outbox.py` with a wake-me card when `ready/` is non-empty past one interval? **Code prerequisite, non-negotiable:** `promote_vm_outbox.py` must first gain an **empty-spool exit-0 path** — it raises today, so a cadence would error on every tick where nothing spooled and train the operator to ignore the alarm. Under Model B (D-9) the rebase-onto-current-`origin/ops` change is a second prerequisite. Also: who holds the `kb-ops-approver` signing key for instruction-path bundles, and does an unattended cadence get to use it (it must not — instruction-shaped promotions are the human gate)? | Manual drain at every acceptance + a cadence *card* filed for later, with the empty-spool fix named in it. Silent-loss risk stays open. |
| **D-2** | **Durable arming — RULED, and more sweepingly than the question asked.** Rather than a bounded re-arm token, Daniel removed the ceremony: a separate build wave introduces `DASHBOARD_AUTH_MODE=tailnet` (§4), where the tailnet serve proxy *is* the operator, identity headers are audited, and execution plus the queue bridge are **armed at boot**. WebAuthn/session/unlock survive only as the win32-desktop mode. Unattended overnight execution on the VM is therefore possible, and the trust boundary is the tailnet ACL. | Ruled. The wave is a **precondition of the cutover window**; the window does not open on the unlock-latch build. |
| **D-3** | **`atlas-worker` disposition.** Leave running on the desktop (it is device-bound), stop it for the cutover window, or fold it into the post-cutover Atlas plan? | Leave running, untouched. |
| **D-4** | **`naming.json` collision.** Desktop copy wins, VM copy wins, or merge? Contents were not read (avoiding needless state exposure), so the blast radius of picking wrong is unquantified. | Back up both, let the desktop copy win (it carries the real naming history), keep the VM copy as `naming.json.vm-preexisting`. |
| **D-5** | **Composer workspaces.** Copy `workspaces.json` knowing every provider binding is dead on arrival (§5), or start the VM composer empty? | Copy it — history has value, degradation is graceful. |
| **D-6** | **Audit-commit failure policy** (inherited, still owed). Should a failed audit git commit crash the daemon (today's behaviour, and the direct cause of the Gate-1 "bad-signature" hunt) or degrade to a blocked write surface? This is now *more* load-bearing: on the VM, a crash disarms execution. | Crash (status quo). |
| **D-7** | **Helper refresh gap — and it is a trust boundary, not an ergonomics wart.** `activate_release` never refreshes `/usr/local/lib/kb/*`; every deploy needs a manual `sudo install -m 0555`. The release path is **signed** (attestation ssh-signed under namespace `kb-release`, verified against the pinned `release_signing_public.py` before activation); the helper path is **unsigned** — a plain `scp` + `sudo install` of whatever four files sat in the operator's checkout, installed root-owned `0555` and executed by `ExecStartPre` and by every `sudo` helper call. The manual step is therefore an *unsigned root-code channel running alongside a signed one*. Fix before cutover, or carry the manual step in the runbook (with sha256 diff + backup, per the runbook's §4.3) and close it in the Task-24 window? | Carry the manual step, with the sha256-diff and backup-into-the-cutover-record guards the runbook now encodes, and file the signing gap as Task-24 work. |
| **D-8** | **Disposition of `claude/cloud-migration` — RE-DERIVATION, not merge.** Apply the clean additive commits `496a522e`, `4fa62cc3`, and `d18711f1`, then hand-split only the still-needed seams from `506af813`, `75a9a00a`, `8ebc337f`, and `fb9f501f`. Main's runtime Python resolver, exact state-root contract, tailnet auth/operator handling, mode-aware paid-action URL, and certified system unit win all overlaps. Preserve the complete Windows desktop stack: PTY/Terminal and dependencies, keep-awake, desktop dispatch/poll, sentinel, `agent_runner.ps1`, PM2, and Task Scheduler. The POSIX runner scaffold and selector/liveness implementation land, but Linux `runnerTrigger` stays false pending a separate activation/publication design. | Re-derive as above; do not merge the migration branch or import its desktop deletions. |
| **D-9** | **Ops write authority (§3.4) — RULED: Model B, co-writers.** The desktop keeps pushing `ops`; `promote_vm_outbox.py` gains (1) rebase-onto-current-`origin/ops`, (2) empty-spool exit-0, (3) a pull-only downward sync mode. Model A (VM sole writer, desktop goes read-only against `ops`) was rejected: it rewrites the fleet's working rules to protect a tool. | Ruled. The three tool changes are **preconditions of the window** — the drain steps assume them. |
| **D-10** | **Repo unit vs live unit — largely DISSOLVED by the D-2 ruling.** The two values that existed nowhere in the repo, `DASHBOARD_RP_ORIGIN` and `DASHBOARD_WEBAUTHN_CREDENTIALS`, are removed from the unit by the tailnet-auth wave, so a re-install from `deploy/` can no longer silently destroy operator access. What remains is hygiene: does the repo carry the tailnet-mode unit shape verbatim, so bootstrap and the live host cannot diverge again? | Capture `systemctl cat` into the cutover record (runbook §4.5) and assert the WebAuthn entries are **absent** post-wave; commit the unit shape to `deploy/` as follow-up. |
| **D-11** | **Codex-runtime invocation path on Linux.** The re-derived tree includes `agent_runner.sh`/`.py`, a detached-spawn selector, and PID/start-time liveness, while deliberately keeping Linux `runnerTrigger:false`. It includes no runner unit and no origin/ops fetch, branch-checkout, execution, or push-publication path; the VM ops remote is credential-less by design. Authentication storage is unchanged (`.codex/config.toml` remains keyring-backed). | Codex worker-runner activation and acceptance are **OUT OF SCOPE** for this cutover (runbook §5.5); file the publication/activation design as a follow-up. |

---

## 9. Contradictions found between the platform docs and VM reality

1. **`~/kb-mirror.git` is presented as the VM's repo source; the platform never touches it.** The
   platform's repoRoot is a sparse clone at `/var/lib/kb/ops` with a *disabled* origin. The mirror
   belongs entirely to the decommissioned stack. Any procedure that pushes to the mirror and calls
   the work "delivered" is wrong.
2. **The old runbook's session-secret step is forbidden by the platform's own preflight** (§5).
3. **The old runbook's tunnel is incompatible with how the platform identifies its operator** (§5).
   It was already wrong against the RP-origin guard; under tailnet auth it is worse — a tunnelled
   request bypasses the serve proxy and arrives without the identity the daemon audits.
4. **The old runbook's drain predicate would force-terminate seven legitimately parked runs** (§2.1).
5. **The re-derived port must replace the direct win32 secure-file import with the additive
   `platform/noReparseFiles.*` selector** while preserving the existing win32 implementation. This is
   a precondition of arming the VM, not authority to remove the Windows boundary.
6. **The re-derived tree includes `agent_runner.sh` / `agent_runner.py`, but not an activated Linux
   worker-runner.** `runnerTrigger:false` remains the Linux capability, no runner unit is installed,
   and the scaffold fails closed before execution/publication. Codex-runtime activation and acceptance
   remain out of scope for this cutover (§5.5) and are carried under D-11.
7. **The live systemd unit carries configuration that exists nowhere in the repo** —
   `DASHBOARD_RP_ORIGIN` and `DASHBOARD_WEBAUTHN_CREDENTIALS`, present only in
   `/etc/systemd/system/kb-dashboard.service`. Until the tailnet-auth wave lands, a re-install of the
   unit from `deploy/` silently destroys the only way in. The wave **removes both entries**, which
   dissolves the hazard rather than managing it (§4, D-10). The runbook still captures
   `systemctl cat` (credential value redacted) into the cutover record — before the wave as a
   backup, after it as the assertion that the entries are gone — and the residual hygiene item is
   committing the tailnet-mode unit shape to `deploy/`.

---

## 10. UNVERIFIED register

Items the review resolved have been **removed** rather than carried: the pending bundle's manifest
*was* read (ledger-only, not instruction-shaped — §3.2); `apply_ops_reconciliation.py` on the VM *is*
hash-verified current with `main`; the drifted helper is `validate_vm_runtime.py`, behind `main` by
exactly `validate_ops_git_identity()` (16 lines). Only genuinely unresolvable-before-the-window
items remain:

- `UNVERIFIED:` contents of `/var/lib/kb/state/naming.json` and of the desktop `naming.json`
  (deliberately not read — see D-4).
- **RESOLVED (kept because it changed the procedure):** arming does **not** leave migrated work
  inert. Queued attempts are claimable by the engine and open human requests are live triggers, so
  under armed-at-boot (§4) the first boot after the state import is the moment migrated work can
  start. The runbook therefore asserts the queued-attempt count (**7**) and **zero claimable queue
  cards** before that boot, and warns that answering a migrated gate starts real work.
- `UNVERIFIED:` whether the migrated `control/agent-session-chains/` records carry **desktop-only CLI
  session ids** that cannot resolve on the VM. If they do, chain continuity across the cutover is
  cosmetic rather than real, and the first resumed chain will fail in a way that looks like a
  platform defect.
- `UNVERIFIED:` whether the `DirtyIndexError` outbox recovery defect still reproduces on an unclean
  stop of the current release; the manual recovery (stop → `sudo git -C /var/lib/kb/ops reset` →
  start) is carried forward untested.
- `UNVERIFIED:` the location and name of the release signing key on the desktop. Reading `~/.ssh`
  is blocked by the hard-ceiling guard by design; `deploy_platform_release.py --signing-key` takes
  it as a path and Daniel supplies it. The VM's trusted public half is pinned in
  `/usr/local/lib/kb/release_signing_public.py`.
- `UNVERIFIED:` whether `tailscale serve` survives a VM reboot in this configuration (Gate-1
  measured a post-reboot state on the *legacy* stack). The runbook's reboot test measures it.
