# desk ⇄ VM movement + Atlas orchestrator — design agenda handoff — 2026-08-20

**Topic:** The cloud cutover is DONE (control plane live+armed on the VM, browser-verified, no sign-in —
see `2026-08-19-cloud-migration-cutover-COMPLETE.md`). This handoff captures the FORWARD design agenda
Daniel surfaced in the post-cutover conversation. Nothing here is built. Each item is a design question
with the constraint that makes it non-trivial, options, and a lean. Resume with the **brainstorming
skill** per item → spec → plan → build. Do NOT bolt any of these on ad hoc; they share one trust model.

### The mental model to preserve (established this session)
Two tiers. **Local = the cockpit** (Daniel's desktop: interactive Claude sessions, local CLIs, VSCode,
Atlas voice, personal `~/.claude`). **VM = the factory** (always-on governed control plane: workflows,
runs, managed agents, cadences). They share ONLY what's in git or explicitly copied. The VM is safe to
leave always-on-armed BECAUSE it is immutable (signed whole-artifact releases), credential-sandboxed
(agents use ambient creds, never handle them as objects), and quiescence-gated. Every "make it auto/
seamless" wish below pushes against one of those three properties — that tension IS the design surface.
Current live release `439fc90d`; VM env: DASHBOARD_REPO_ROOT=/var/lib/kb/ops, STATE=/var/lib/kb/state,
PLATFORM_ROOT=/opt/kb-releases/current.

---

### 1. Resume-safe deploys — THE NORTH STAR (Daniel: "would be amazing")
**Want:** push code to the VM anytime WITHOUT waiting for running workflows to drain — the way merging
main doesn't disturb running local terminals.
**Why hard today:** deploy = atomic release swap + **service restart**, which would kill in-flight VM
runs; the `require_quiescence` gate exists solely to stop that (blockers: execution-unlocked,
queue-bridge-running, workers-active). It's "restart kills work," not "busy = unsafe code."
**Options:** (a) **checkpoint + rehydrate** — runs persist state (much already is: we migrated
runs/stages/attempts/sessions), so a restart pauses+resumes instead of aborting. Cleaner fit. (b)
**blue-green/rolling** — new release comes up alongside; old runs drain on old process, new runs on new.
More infra. **Interim cheap win:** a **deferred deploy** that auto-blocks new work and applies at the
next clean boundary, so Daniel never hand-waits even though the swap still lands quiescent.
**Lean:** (a) resume-safe runs. Removes the quiescence toil entirely.

### 2. One-click / cadence deploy (Daniel: push→VM "on a cadence, or click of a button")
**Want:** stop hand-running watch-CI → download → verify → disarm → deploy.
**Constraint:** the signing step is the trust boundary (only signed releases run armed). **Where the
signing key lives decides everything.** (a) **one-click**: a script/dashboard button runs
build→sign→ship→swap with Daniel's key at click-time — "button" UX, key stays in his hands, weakens
nothing. RECOMMENDED first. (b) **fully-unattended cadence**: needs the key on the VM (a VM compromise
self-signs — bad), or in CI (CI-held key), or on a desktop cadence (desktop must be up). A real T3
key-custody decision, NOT a default.
**Also decide:** auto-deploy should gate on green-CI + quiescent + no-migration; the exceptions
(failing CI, a state migration, mid-flight work) must pause for a human. Push-to-GitHub is always fine;
auto-RUN-on-the-armed-box is the gated part.
**Lean:** ship one-click now; treat cadence as a separate, later, explicit key-custody decision.

### 3. Asset movement home (FYT outputs)
**Want:** image/video/voiceover assets a VM run produces should be reachable locally.
**Reality:** they land on the VM filesystem; NOT auto-local. Get them via commit+promote, scp/rsync, or
the dashboard serving them. **Design a deliberate "pull assets home" step** into FYT-on-VM pipelines so
rendered output isn't stranded on the VM. (Ties to running FYT on the VM — see 5.)

### 4. Memory / context parity (VM agents start context-poor)
**Gap:** the repo (code, skills, `memory/*.md`, ops cards) syncs to the VM, but Daniel's **personal
`~/.claude`** store — the auto-memory + MEMORY.md index, session transcripts, unpushed standalone clones
(kb-clones/*) — is LOCAL ONLY. So a VM agent starts with less context than a local session.
**Decide:** where should that context live so BOTH see it — sync `~/.claude/…/memory` to the VM, or
promote the load-bearing parts into the repo (which already syncs)? Pick one.

### 5. Credential / MCP provisioning to the VM (Daniel: "re-set them up for the VM not my local")
**Confirmed correct instinct:** MCP servers + account access are per-machine; the VM has NONE of
Daniel's accounts today. To run FYT / connect Drive/Gmail/Chrome from VM workflows, provision each on the
VM: OAuth the VM env into the account (refresh token in the service env) or run the MCP servers on the
VM; headless Chromium (Playwright) works but is a FRESH browser (no logged-in sessions unless provisioned).
**Governance holds:** an agent USES ambient creds, never harvests them; outbound/irreversible actions
(send mail, delete, SPEND) stay human-gated regardless of access; "never spend real money" is a ceiling.
**Decide per integration:** which creds, at what scope, which actions stay gated. Granting an always-on
autonomous loop standing account access is a real blast-radius call — bound it deliberately.

### 6. Unified approval inbox (Daniel: "current inbox is shit… you should think about it")
**Want:** ONE surface showing everything that needs his approval — code merges (PRs), deploys, governed
cards — with the single action per item. Today it's split (GitHub PRs + dashboard queue) and the current
inbox UX is poor. **Redesign target:** a first-class "what wants me + one click" review surface in the
dashboard. Not scoped yet — own design pass, tie to items 1–2 (deploys become inbox items).

### 7. Atlas as the local orchestrator (Daniel's larger vision)
**Shape (agreed):** Atlas = voice-driven orchestrator at the HUMAN layer. Stays **local** (voice I/O
needs the mic/speakers at Daniel's desk — physics, not preference; a datacenter VM has no audio hardware).
It's a **standalone local autostart app**, a **tailnet-operator client** of the VM dashboard — reaches
the VM over the tailnet with Daniel's ambient identity (no keys of its own; authenticates like his
browser). Latency of the tailnet hop is immaterial next to STT/LLM/TTS.
**Two capability directions (future, "build later"):** (a) **control the desktop** ("pull up Instagram
saved") — only possible because it's local; unsandboxed power over the real machine → bound the scope
deliberately. (b) **dispatch VM work** ("run FYT runner in VM") — a governed remote launch via the
dashboard API; the cutover is what makes this clean. Atlas conducts; the VM executes.
**Atlas-on-VM check (item 8):** voiceover FILE generation can run on the VM (pure compute); LIVE voice
conversation cannot (audio devices are local). Confirm Atlas's headless-clean parts before any VM port.

---

### Immediate residual closeout (not design — just housekeeping owed)
- **Phase 8** (time-gated ~2026-09-02): after a clean rollback window, decommission the stopped desktop
  stacks; sweep `cutover-run` + `boss-cloud-migration` worktrees (keep until then for deploy scripts).
  `dashboard-ops` + `AppData/.../control/*` EXEMPT.
- Deploy recipe (armed platform): `curl.exe -sS -X POST https://kb.tail82dd4f.ts.net/api/control/execution/lock`
  (disarm) → `python scripts/deploy_platform_release.py <archive> <attestation> --signing-key
  ~/.ssh/kb-release-signing --host kb@100.89.73.118` → boots re-armed. Artifact = CI's
  `kb-platform-<sha>` on main.

### Load list
- `handoffs/2026-08-19-cloud-migration-cutover-COMPLETE.md` (the cutover itself)
- `memory/claude-boss.md` + personal arc [[cloud-migration-arc]]
- This file — then invoke the **brainstorming skill** on whichever item Daniel picks first.
- Deploy scripts: `kb-worktrees/cutover-run/scripts/deploy_platform_release.py`, `deploy/activate_release.py`.
