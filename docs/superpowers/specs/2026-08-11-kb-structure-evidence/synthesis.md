# kb-structure synthesis — 2026-08-11 (post-evidence revision)

Inputs: research report (terra), adversarial critique r2 (sol/xhigh, RETHINK), boundary map (terra, spot-verified 3/3), media inventory (terra), creds options (terra), boss probes (daemon coupling grep, ops churn count 1,055/28d, queueBridge wiring check).

## What the evidence changed

The candidate design (two repos: kb-platform / kb-data) fails on evidence:

1. **Wrong axis.** The split separates platform code from the scripts/defs/skills it directly executes (`scripts/*.py` is the format authority for cards/ledgers/routing/grades — boundary map ranks 10 skew surfaces, cards.py #1; preamble is constitutionally required of every agent from the repo root). Meanwhile it PRESERVES the harmful marriage: machine churn (queue 510, ledgers 488, memory 111 file-touches in 28 days; 1,055 commits) sharing one history with knowledge and projects.
2. **Not executable as described.** DASHBOARD_REPO_ROOT is one root for policy, worktrees, integration, coordination (activation.ts:244); daemon imports scripts/* relative to the data root (launch.ts:119, queueBridge.ts:70); roster roles + skills resolve from the same root.
3. **Single-writer convergence is blocked by design today**: dashboard write routes are WebAuthn-session-gated (agents can't hold Daniel's session), and branch.ts:28 classifies only queue/, ledgers/, traces/ as coordination — memory/, dashboards/, handoffs/ silently take the durable path.
4. **Creds:** "VM credential that can only push ops" is not a PAT/deploy-key property (repo-scoped, never ref-scoped). Only a GitHub App named as ruleset bypass actor approximates it. Current kb trust anchor (no fleet-agent REST-write credential; worker deploy key blocked from main/ops by ruleset) would be reversed, not evolved.
5. **Media exile requires a hydration layer** at 4 verified boundaries: forge staging/copy (forge.py:306, 2363), board embed (build_board.py:112), renderer validation (render.py:212), publish preflight (publish_preflight.py:75). Manifests today bind review to path/status, not byte digest.

One critique claim corrected during grading: "createQueueBridge has no production caller" is false (surface.ts:128 wires it, env-gated default OFF, armed via passkey). Weaker form stands: default-off + Linux tests substituting python3 for hardcoded `py -3` means systemd-healthy proves nothing about Linux dispatch.

## Revised design (phased; replaces candidate B)

**Phase I — cloud fleet WITHOUT repo surgery (serves the actual goal: throughput + control).**
- Keep the monorepo as the single source repo.
- Deploy platform to the VM as an immutable, versioned release artifact (build on merge → release dir → systemd restart when QUIESCENT; rollback = previous release symlink). The VM's running platform is never a live checkout sharing state with data.
- VM holds: release artifact + `ops` data checkout + DASHBOARD_STATE_ROOT classified tier-0 (encrypted off-VM backup; the critique's DR blocker).
- Hardening gate before execution authority moves (distinct from read-only web cutover): queue-bridge Linux canary end-to-end (card → dispatch → integrate → ledger → restart mid-run → recover), platform-aware python resolver replacing `py -3`, worker drain on shutdown + KillMode=control-group, session-auth on read routes (browser API serves repo files unauthenticated today), per-resource-class concurrency limits.
- No GitHub credential on the VM. Desktop-promotion topology retained, hardened with a durable VM outbox (commit locally, spool, desktop promotes; degraded-mode = spool grows, reads stay live).

**Phase II — first physical split = STATE, not platform (when contention/scale warrants).**
- `kb-state` repo (or service): queue/, ledgers/, dashboards/ churn + run telemetry. Research line: production orchestrators ALL put run-state outside the definitions store; git keeps cards-as-records only if sharded/small, telemetry goes to DB/NDJSON with retention.
- Knowledge (orgs/, docs/, skills/) + platform stay atomically coupled in the monorepo — schema authority and schema instances move together.
- Prerequisites built in Phase I: versioned machine-readable schemas for cards/workflow defs (skew surface #1), repository registry in the server (project → root/remote/base/credential identity) so cloud-authored work targets the right repo.
- memory/ + handoffs/ placement decided at Phase II gate (low churn, agent-native reads — candidates to stay with knowledge).

**Phase III — triggers only:** project extraction (first collaborator / access control), three-plane design (state service + project repos). Registry from Phase II makes extraction provable in advance.

**Media exile — independent track, can start pre-cutover, staged:**
1. Manifest schema upgrade: required SHA-256, size, object key, provenance run-id alongside existing review fields.
2. Content-addressed materializer/cache in SHADOW mode (local assets stay canonical; hydration path proven).
3. First exile tranche = write-once archives (`_archive-*`, ~3+ GB across staging/assets) — lifecycle-clear, zero consumer risk.
4. Active working sets (`_staging`, current video assets) last, only after shadow hydration is proven at all 4 boundaries.
5. node_modules (602 MB) is not media — excluded; `_private/` copies (432 MB) get a cleanup pass instead.

## Rulings — LOCKED by Daniel 2026-08-11 (this session)

1. **Architecture**: ADOPTED — revised phased design (monorepo + immutable release artifact now; state-first split as the first physical split later; platform/data split abandoned).
2. **Sync topology**: ADOPTED — desktop promotion + durable VM outbox; NO GitHub credential on the VM. Staging-repo promotion is the pre-designed escalation; brokered GitHub App only if direct publication ever proves necessary; PAT permanently off the table.
3. **Sequencing**: media exile waits until AFTER cutover (Daniel kept original sequencing; pre-cutover archive tranche REJECTED). Cutover splits into TWO gates: read-only web dashboard first, execution authority behind the hardening checklist (Linux dispatch canary, python resolver, worker drain, read-route auth).
