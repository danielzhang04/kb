# HANDOFF — Month-1 Fleet Build (stop point: plan final, nothing executed)

**Written:** 2026-07-16, end of the design/planning session (Fable 5 boss + Opus 4.8 subagent workflows).
**Stop point (Daniel's instruction):** everything through planning is DONE; **no build task has been executed.** The next terminal starts at "execute the plan."

## What exists, where

All on this branch (`claude/m1-fleet`, cut from `main`):

1. `docs/specs/2026-07-16-m1-fleet-architecture.md` — the approved fleet architecture (approvals hardening, Telegram transport, Codex onboarding, grader/promotion, roles, cloud-leg fix). Survived a 3-lens adversarial panel; §8 is the revision log. Load-bearing concept: the **trust-anchor invariant** (no agent environment may hold a GitHub REST-capable `Contents: write` credential; git-transport only) — read its top call-out first.
2. `docs/specs/2026-07-16-dashboard-design.md` — the web dashboard/control-plane design (Daniel overrode the old "no web dashboard" no-goal). **Decided: Option B, Hybrid Workbench** (mission-control board + xterm.js terminal + CodeMirror panes; Node/TS Fastify+React; Broker/Dashboard split; Tailscale Serve; WebAuthn approval-minting). Built AFTER fleet foundations; v0 read-only observatory may start earlier.
3. `docs/plans/2026-07-16-m1-fleet-implementation.md` — **the plan to execute.** 54 numbered items across Waves 0–6: 30 AGENT-BUILDABLE strict-TDD tasks (each names real functions/lines, failing tests first, commit message) + 21 HUMAN GATES + 3 doc-verification checks. Ends with month-1 exit criteria and a parallel-vs-serial execution order (all `dispatch.py` edits are serialized; Waves 2 and 3 parallelize after tasks 1.1–1.2 merge).

Also: persistent session memory at `~/.claude/projects/C--Users-danie-kb/memory/` (MEMORY.md index) records the decisions below + Daniel's working style.

## Daniel's locked decisions (do not re-ask)

- **Gemini deferred entirely** (free tier trains on data; no acceptable $0 path). Month-1 non-Claude worker = **Codex CLI only**; adapter pattern + `one-off-agent.md` stay generic.
- **Telegram bot token custody = desktop** (Windows Credential Manager); desktop poll cadence owns `getUpdates`; PC-off time-critical approvals use the signed GitHub-mobile-merge channel.
- **Web research is fleet-wide and unrestricted.** Only the approval-minting poller *process* is isolated from untrusted web content. Never frame this as "agents can't fetch."
- **faceless-youtube untouched this month** — no cadence; the kb copy is OUTDATED (Daniel iterates locally). ≥3-projects requirement met by idle faceless-youtube + new `orgs/kb-ops` + `orgs/atlas-prep`.
- **Dashboard = Option B** (hybrid workbench), after foundations.
- Architecture open-question defaults adopted: dedicated protected `approvals` branch (O2); promotion keyed `(worker, project, task_type, tier)` (O7); novel-T3 signed-channel-only (O9); Codex runner fails loud on stale auth (O8); **Daniel personally reviews the rewritten `approvals.py` before it becomes load-bearing (O1)**.
- Nightly carve-out: approved in principle; plan re-keys it to `cadence:nightly-review` with an explicit write allow-list (grades/activity ledgers excluded). Human commits the governance patch verbatim.

## Next actions, in order

1. Read the implementation plan end-to-end.
2. **Ping Daniel with the Phase-0 human gates** (claude.ai routine settings: repo access, "Allow unrestricted branch pushes", setup script with pyyaml+gpg, connectors off; commit the carve-out patch on `main` and merge to ops) — these unblock the cloud leg and run independently of the code waves.
3. Execute the AGENT-BUILDABLE tasks in plan order on this branch (`claude/m1-fleet` → PR to `main`). Strict TDD. Wave-1 exit gate: nothing in Wave 5 Phase B before tasks 1.1–1.10 are merged and verified.
4. Every `governance/`, `card-schema.md`, `humans.yaml`, `graders.yaml`, HEARTBEAT-on-`main` change is an agent-PROPOSED patch that Daniel commits himself.

## Operating conventions this session established (Daniel's standing expectations)

- Boss terminal orchestrates; heavy work goes to **Opus 4.8** subagents/workflows — and the model is **verified at runtime**, not assumed: grep the subagent transcripts (`~/.claude/projects/C--Users-danie-kb/<session>/subagents/**/agent-*.jsonl`) for `"model":"claude-opus-4-8"`. This session: 613/613 turns verified across 4 workflows + 3 agents.
- Keep messages short; when a design choice is open, present concrete option cards, not abstract trade-offs.
- Run `python scripts/preamble.py` (use `py -3`; MSYS python lacks pip/yaml) before fleet work. ECC user-scope hooks (GateGuard fact-forcing) fire on first Bash/Write — present facts and retry; flagged for retargeting before fleet launch (see ECC handoff in `C:\Users\danie\atlas-design`).

## Provenance

Produced by three adversarially-verified Opus 4.8 workflows (run IDs `wf_346979f9-11e` architecture, `wf_32799f5a-714` dashboard, `wf_5a46bec1-dec` plan; journals under the 2026-07-16 session's `subagents/workflows/` dir). Architecture research carried one security flag (O1) — the approvals track investigated GitHub signature-forgery defensively; that is WHY Daniel must personally review `approvals.py`.
