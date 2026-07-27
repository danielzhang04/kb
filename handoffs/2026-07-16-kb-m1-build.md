# M1 BUILD HANDOFF — resume point for the next terminal (2026-07-16)

**You are the boss** (Fable 5 if capacity allows — `/config` → claude-fable-5; auto-demotes to Opus 4.8
under load, fine). Delegate heavy work to subagents; **verify each subagent's model via transcript grep**
(`~/.claude/projects/C--Users-danie-kb/<session>/subagents/**/agent-*.jsonl` for `"model":"..."`) — never
assume. Present HUMAN GATES to Daniel **one at a time at their plan position**, with directions. Run
builders in the background so Daniel's messages reach you. `py -3` for python (MSYS python lacks pyyaml).
ECC GateGuard fact-forces the first Bash/Write — state the facts and retry.

## DONE before this handoff (all durable, all Opus-verified)
- **Fleet Wave 0** proven: cloud Run-now worked (DIRECT-PUSH), carve-out acts alone, dashboards regen.
- **Fleet Wave 1 COMPLETE.** Build + all human gates done; approvals security core fixed (F1–F8),
  re-reviewed (READY-FOR-O1), N1 hardened + N2 flagged for Wave 3; **O1 APPROVED by Daniel 2026-07-16**
  (accepted residual: cloud-sandbox merge-capability unverified — probe in Wave 2 before any cloud T3
  path; desktop agents are git-transport-only so cannot mint a web-flow signature). Suite 84 passed
  (with gpg) / 75 passed + 9 skipped (without). Branch `claude/m1-fleet` unpushed→push+PR to main next.
- **Dashboard D0** (read-only observatory) complete: 11 commits, 93 tests green, integrates as one app.
- Branches: `claude/m1-fleet` (fleet code, unpushed — PR to main after O1), `claude/m1-dashboard`
  (dashboard D0, unpushed — PR to main), `ops` = coordination truth. Worktrees under
  `C:\Users\danie\kb-worktrees\`. Plans: `docs/plans/2026-07-16-m1-fleet-implementation.md`,
  `docs/plans/2026-07-16-dashboard-implementation.md`. Full detail in memory
  `m1-build-state-2026-07-16.md`.

## WHAT THIS TERMINAL DOES: fleet Waves 2–5 + dashboard D1–D3
Read both plans first. Order:
1. **Do O1 first if not done.** Then push `claude/m1-fleet` + `claude/m1-dashboard` as PRs → main
   (Daniel merges), merge main→ops for any routine-read prose.
2. **Fleet Wave 2** (Telegram transport) ∥ **Fleet Wave 3** (grader+promotion) — independent after
   Wave-1's 1.1–1.2. Wave 2's task 2.4 needs 3.1's `assurance_class`.
3. **Fleet Wave 4** (roles+DAG+≥3 projects) — serializes dispatch.py edits (see below).
4. **Fleet Wave 5** (Codex onboarding) — ops-push (5.9) HARD-GATED behind Wave-1 exit.
5. **Dashboard D1** (sessionId join key) — appends to the END of the fleet dispatch.py serialized
   queue: `3.4 → 4.1 → 4.2 → 5.2 → D1`. Do NOT edit dispatch.py in a concurrent worktree.
6. **Dashboard D2** (governed writes) — HARD-GATED on fleet Wave-1 exit + WebAuthn-verifier security
   review (D2.11). D3 gated on SDK-ToS re-verify + Broker threat review.

## SUBAGENT PLAYBOOK (Daniel-approved 2026-07-16 — DO NOT rehash, just apply)
See memory `token-efficiency-orchestration.md`. Concrete assignments:

**Model tier by task type (verify via transcript grep every time):**
- **Sonnet** (`model:'sonnet'`) — mechanical build tasks: all Wave-2 Telegram scripts, Wave-4 role
  templates/scaffolds/cards.py enum, Wave-5 Codex adapter/runner/config/docs, dashboard D2 write
  modules (inbox, CodeMirror save, launch/rerun, vibe-code box, stop floor, audit log), D3
  canvas/panels/PTY-pane. These are CRUD-shaped, near-zero exploit risk.
- **Opus** (`model:'opus'`) — security-critical / authorization / privileged-spawn code ONLY:
  `promotion.py` `decide()` (authorization: T3 cap, standing-auth main-ref cross-check),
  `reconcile.py` (integrity), the **dashboard WebAuthn verifier (D2.3)** and the **Broker daemon
  (D3.3)** — both also carry a **human security/threat-review gate before merge** — plus any
  synthesis/design step. dispatch.py DAG (4.1) is coordination-critical: Sonnet is fine but verify
  `test_dispatch.py` stays green after every additive edit.

**Adversarial review (separate agent, attacks the output):**
- **On exploitable CODE only** — approvals (done), `promotion.decide()`, the WebAuthn verifier, the
  Broker. Run these on **Opus**. That's the bar: the approvals review caught two real T3-auth blockers.
- **On plan/design DOCS** — KEEP doing it (Daniel's call) but run on **Sonnet** (lower reward, cheaper).
- Do NOT adversarially review mechanical build tasks — TDD + a model-verified green suite suffices.

**Context:** give each subagent RICH context — full relevant plan section + ground truth. Daniel does
NOT want briefs trimmed to save tokens; good context is worth it. Only avoid pointless re-derivation
(don't have an agent re-discover what a prior agent already reported — pass the report).

**Probe before researching:** for any unknown about tool/platform behavior, try the cheap empirical
test first (run the thing, read the error); only spawn a web-research agent if the probe is
inconclusive. (This session burned ~450k tokens researching what one push-probe would have answered.)

**Parallelism:** fan out independent tasks in one message; keep each agent to its own files; shared-file
edits (server/index.ts registration, dispatch.py) get ONE line and are serialized, never concurrent.
Verify the integrated suite after a wave, not just per-agent green.

## OPEN HUMAN GATES coming up (present one at a time)
- **O1** (if not done): Daniel reads fixed `scripts/approvals.py` before it's load-bearing.
- Wave 2: 2.7 BotFather bot token, 2.8 token in desktop Credential Manager, 2.9 humans.yaml telegram_id.
- Wave 3: 3.7 graders.yaml (agent proposes, Daniel commits).
- Wave 4: 4.7 card-schema.md role enum.
- Wave 5: 5.0 verify codex exec headless-sub, 5.7 codex login, 5.8 SSH deploy key + push ruleset +
  invariant re-audit, 5.9 Phase-B ops-push (post-Wave-1), 5.10 Task Scheduler.
- Dashboard: D0.12 install Tailscale+Serve+ACL, D1.4 card-schema additions, D2.11 WebAuthn security
  review, D2.12 register passkeys, D3.0 ToS re-verify, D3.1 constrained fleet identity, D3.6 Broker review.
- Cloud-leg: routine push is DIRECT-PUSH today but keep the PR fallback (see memory
  cloud-leg-pr-fallback); Daniel may `/feedback` the missing Permissions tab.
