# Cloud-migration cutover — COMPLETE handoff — 2026-08-19

**Topic:** Desktop→VM cutover of the kb dashboard control plane. The always-on
certified platform now runs on the Hetzner VM (`kb@100.89.73.118`, tailnet),
armed-at-boot under tailnet-trust auth, reachable at `https://kb.tail82dd4f.ts.net`.
Functional work is DONE and verified end-to-end. Only the time-gated Phase 8
(rollback window + decommission) remains.

### What WORKED (with evidence)
- **Platform live + armed on Fix-B release** — confirmed by `curl.exe https://kb.tail82dd4f.ts.net/readyz`
  → `{"ok":true,"quiescent":false,"blockers":["execution-unlocked","queue-bridge-running","workers-active"]}`.
  `execution-unlocked` = re-armed at boot (tailnet mode); `ok:true` = healthy.
- **Release `0e301d85` deployed** (#137 forward-compat parser merged into main) — deploy printed
  `activated 0e301d856864e909d085b3e09461b192d500ee96` after static+live VM runtime validation.
  The boot-crash class (unknown card frontmatter key → `additionalProperties` fail) is gone permanently:
  boot scan now tolerates+logs unknown keys; runtime claim/execute stays strict.
- **Reboot survival** — proven earlier in the arc (platform returned armed + serving 443 in ~24s, zero intervention).
- **Zero data loss recovered** — the 2026-08-19 sanitize (`45ec546f`) that stripped 20 `kit_sha` + 39
  `autonomy` card fields was surgically reverted (`fff158f5` on ops): all 59 fields restored, the
  4 `queue/paused/` cadence sentinels KEPT (they were bundled into the same reverted commit).
  Verified: `git diff` showed `39 autonomy: acts-alone` + 20 `kit_sha` re-added. `autonomy` was a VALID
  schema field over-stripped in the emergency; now correct.
- **Quiescence-gated hot-swap works** — activation refuses to swap an armed plane; the supported drain is
  `POST /api/control/execution/lock` (tailnet operator, via `curl.exe` through serve 443), which fires the
  latch `onChange` → stops queue bridge + zeroes workers → quiescent → activate → restart → re-arm at boot.

### What did NOT work (and why)
- **`kb.command.ts.net` URL rename — ABANDONED, not achievable.** Tailscale only offers *rolling* the
  tailnet name to another random `tailXXXXX.ts.net`; no custom word on a personal-Gmail tailnet. The only
  route to a chosen name is a custom domain via Funnel, deliberately rejected (Funnel publishes publicly +
  strips the `Tailscale-User-*` identity headers the tailnet-trust auth requires). DECISION (Daniel,
  2026-08-19): keep `kb.tail82dd4f.ts.net` for now (hostname `kb` is already the clean part); do NOT
  roll (pure churn, forces a VM repoint for nothing). REVISIT only if we ever move to a **paid Tailscale
  plan** — its custom-tailnet-name feature (verify a domain you own) is the one path to a vanity host
  without breaking the tailnet-only trust boundary.
- **First activation attempt failed** `release activation is not quiescent` — expected; the platform was
  armed. Fixed by the lock→activate→re-arm sequence above.

### What has NOT been tried yet
- Deeper §5 acceptance (outbox drain proof, a full W1–W7 governed workflow on the VM) — non-blocking, optional.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| ops `queue/done/*.md` (59) | DONE | kit_sha+autonomy restored @ `fff158f5` |
| ops `queue/paused/{daemon-dirs-sync,grades-reconcile,nightly-review,weekly-audit}` | DONE | cadence sentinels intact; desktop stays inert |
| VM release `/opt/kb-releases/0e301d85…` → current | DONE | armed, serving 443 |
| VM `previous` symlink → `0554dc81` | DONE | rollback target for the 2-week window |
| Desktop stacks (user daemon :5317, atlas) | STOPPED (not deleted) | rollback insurance |

### Exact Next Step (Phase 8 — time-gated, ~2026-09-02)
After a ~2-week clean rollback window (no VM regressions):
1. Decommission the OLD desktop stacks — remove the inert `dashboard-prod` worktree + legacy user unit :5317,
   stop/disable atlas on desktop. (Judge "safe to decommission" by VM uptime + zero incidents over the window.)
2. Optionally prune the VM `previous` release once confident.
3. Sweep leftover arc worktrees: `cutover-run`, `boss-cloud-migration` (branches `claude/cutover-run`,
   `claude/cloud-migration`) — keep until Phase 8 in case a rollback needs the deploy scripts.
   `dashboard-ops` + `AppData/.../control/*` are EXEMPT from all sweeps (per BOSS.md).
Nothing before the window elapses. Platform needs no attention until then.

### Load list
- `memory/claude-boss.md` → arc [[cloud-migration-arc]]
- `orgs/` — n/a; this is infra. VM: `ssh kb@100.89.73.118` (tailnet, Tailscale SSH).
- Deploy scripts (if a rollback/redeploy is needed): worktree `kb-worktrees/cutover-run`
  → `scripts/deploy_platform_release.py`, `deploy/activate_release.py` (`activate --upload-dir`, `rollback`).
- Quiesce-for-swap recipe: `POST /api/control/execution/lock` via `curl.exe` through serve 443, then deploy.

---
### UPDATE 2026-08-20 — browser UI gap found + fixed (the real capstone)
Opening the dashboard in a browser revealed Phase 0 shipped tailnet auth SERVER-side only: the CLIENT
still gated on a WebAuthn bearer → stuck on a passkey ceremony that 503s in tailnet mode. "Verified 8/8"
was headless/API only. FIXED by PR #138 (client discovers mode via `GET /api/auth/context`; tailnet →
unlocked ambient sentinel, win32 bit-for-bit unchanged, fail-closed; opus adversarial review SHIP,
model-verified). Live release is now **`439fc90d`** (= #137 + #138); browser confirmed usable, no sign-in.
LESSON: a user-facing cutover is not verified until a human loads the actual screen.
STILL OPEN: (1) Phase 8 decommission (~2026-09-02), (2) the desk⇄VM movement design doc Daniel wants —
resume-safe deploys is the north star (deploy without draining runs), plus one-click/cadence deploy,
asset/memory sync, credential provisioning to the VM, unified approval inbox, Atlas-as-local-orchestrator.

---
### UPDATE 2026-08-20 — browser UI gap found + fixed (the real capstone)
Opening the dashboard in a browser revealed Phase 0 shipped tailnet auth SERVER-side only: the CLIENT
still gated on a WebAuthn bearer → stuck on a passkey ceremony that 503s in tailnet mode. "Verified 8/8"
was headless/API only. FIXED by PR #138 (client discovers mode via GET /api/auth/context; tailnet →
unlocked ambient sentinel, win32 unchanged, fail-closed; opus review SHIP, model-verified). Live release
now **439fc90d**; browser confirmed usable, no sign-in. LESSON: a user-facing cutover is not verified
until a human loads the actual screen. Forward design agenda → handoffs/2026-08-20-desk-vm-movement-design.md
