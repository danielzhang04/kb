# Agentic OS — Design Specification

**Date:** 2026-07-15 (rev 2 — post adversarial review; 15 findings addressed)
**Status:** Draft for user review
**Owner:** Daniel (daniel.zhang.t1@gmail.com)
**Process:** Coordinated by Claude (Fable 5); research, video analysis, candidate architectures, and adversarial review performed by Opus 4.8 subagents (model enforced via harness `model: "opus"` override, empirically verified as `claude-opus-4-8`).

---

## 1. Goal

A personal agent operations platform: many agents (Claude Code primary; Codex CLI, Gemini CLI, and one-off API agents secondary) running multiple workflows across multiple projects inside one knowledge base — coordinating with each other, updating relevant files under a universal rule set, self-improving, and working while Daniel is away from the computer. Skills are authored once and available across all projects and agents. A dashboard/control surface supports: monitor & review (including approvals and costs), launch & steer work, manage skills/agents, and browse the KB — including from a phone.

### Non-goals (v1)
- No custom-built web dashboard until assembled surfaces prove insufficient (§9 exit criteria).
- No OpenClaw or any subscription-token-extraction tooling (ToS ban risk; RCE/credential-leak history).
- No fully unsupervised autonomy: graduated, earned autonomy with human gates throughout.
- No automated injection-scanning tooling in v1 (§6 names the manual gate that stands in).

## 2. Decisions (settled with user)

| Decision | Choice |
|---|---|
| Workloads | All: software dev, research, content/media, business ops |
| Architecture | **A + C now, B later**: cloud-Routines spine + git-native KB/queue/markdown-dashboard conventions from day one; desktop joins as local power-tier once spine is proven |
| Runtime when away | Cloud Routines carry scheduled work (PC-off-proof); desktop is 24/7-capable and carries heavy/local work |
| Knowledge base | **Single private GitHub monorepo** (`kb/`) |
| Billing | Ride subscriptions (Claude sub, ChatGPT sub for Codex, Gemini free tier); API keys only for one-off specialists, capped |
| Build strategy | Assemble first, build the gaps |
| Live phone control | **Omnara or Happy first** (brokered, no inbound ports); build nothing until proven insufficient |
| Non-Claude agents | In scope; **Claude-first sequencing** — Codex/Gemini wired in during month 1 after conventions stabilize |
| Hard autonomy ceiling | Credentials and money — see §8 for the precise, enforceable wording |
| ecc | Installed as managed plugin (`ecc@ecc`, user scope, toggleable); repo cloned at `C:\Users\danie\repos\ecc` as reference library |

## 3. Topology

Three execution tiers coordinate through the git monorepo. No message bus, no required daemon. Git history is the audit log.

1. **Cloud tier — Anthropic Routines + Claude Code on the web.** All scheduled/unattended Claude work. Subscription-billed (no VM charge), runs with PC off, monitorable/steerable from the Claude mobile app. Triggers: cron (≥1h granularity), per-routine HTTP endpoint, GitHub events.
2. **Desktop tier — Windows 11 PC (24/7).** Interactive Claude Code sessions, heavy jobs (media, large builds), and the non-Claude fleet: Codex CLI (device-auth, ChatGPT-sub-billed), Gemini CLI, one-off API agents. Each agent runs in its own git worktree. Local scheduling via Task Scheduler; "Keep computer awake" enabled; wake timers set.
3. **Phone tier — control only.** Claude mobile app (cloud sessions + Remote Control of local sessions), Omnara/Happy (launch/steer desktop fleet), GitHub mobile (browse KB, approve), Routines UI (schedules/logs).

### 3.1 Branch model (coordination vs. work products)

Coordination state and work products live on **different branches with different rules** — this is what lets isolated agents see shared state without violating branch discipline:

- **`ops` branch — the coordination bus.** Contains only coordination state: `queue/`, `ledgers/`, `memory/`, `dashboards/`, project `STATE.md`s. Always fast-forward, high-frequency, agent-writable. Agents `pull --rebase origin ops` immediately before any write and push immediately after; a rejected (non-fast-forward) push means re-read state and retry — this is the concurrency backstop.
- **Agent work branches** (`claude/*`, `codex/*`, etc.) — work products only (code, wiki edits, deliverables). Merged per `contract.md` gates.
- **`main`** — protected. Human-gated merges only. Holds the durable KB content, governance, skills, and specs.
- Cloud Routines fetch `ops` fresh at every fire; desktop agents rebase before every card transition. The nightly review asserts `ops` and `main` haven't diverged on files they share (they shouldn't share any).

**Failure modes:** PC down → cloud tier unaffected; time-critical work is assigned to Routines by policy. Anthropic preview features tightened → conventions are host-agnostic; scheduled work relocates to desktop Task Scheduler without redesign (rehearsed in month 1, §12).

## 4. Knowledge base — the `kb/` monorepo

Single private GitHub repository. Local checkout at `C:\Users\danie\kb\`. Obsidian may point at the folder for graph view and mobile browsing, but nothing depends on it — plain markdown in git.

```
kb/
  _index.md                    # master navigation. Test: "with a million files, is
                               #  there a clear path for an agent to find anything?"
  CLAUDE.md                    # the constitution (universal rules + shared loop preamble)
  AGENTS.md  GEMINI.md         # per-agent mirrors of the constitution
  orgs/<project>/              # one folder per project (see §11 lifecycle)
    _index.md  STATE.md  contract.md  HEARTBEAT.md
    raw/  wiki/  output/       # Karpathy pipeline: dump → structured → deliverables
  orgs/_archive/               # archived projects (moved, never deleted; history retained)
  governance/                  # agent-rules.md, security-rules.md, schema.md,
                               #  risk-tiers.md, card-schema.md — human-edited only
  skills/                      # source of truth, by provenance tier:
    curated/  learned/  imported/  evolved/
  .claude/skills/              # GENERATED from skills/curated by the dispatcher (§6);
                               #  committed (cloud sessions need it); drift hash-checked nightly
  queue/                       # the message bus, on the ops branch (§3.1)
    inbox/  working/  done/  approvals/
  memory/                      # per-agent memory files, lessons-learned/ (sharded by agent)
  ledgers/                     # SHARDED by writer+date: grades/<grader>-<date>.tsv,
                               #  cost/<agent>-<date>.log, dispatch/, activity/
                               #  (nightly job aggregates read-only rollups into dashboards/)
  dashboards/                  # agent-GENERATED: executive.md, system-map.md, handover.md
  scripts/                     # new-project scaffolder, sync-skills, loop preamble, assertions
  .githooks/                   # versioned hooks (activated via core.hooksPath)
  docs/specs/                  # design docs (this file)
  STOP                         # (only present when halting — see §9 kill switch)
```

**Size discipline & durability:** the git repo holds text only. Bulk binaries (video, datasets) live in `_data/` (gitignored), synced to **Google Drive** (already connected) via rclone or Drive for Desktop; restore = re-sync from Drive + `git clone`. Git-LFS is not used in v1 (GitHub free LFS caps at ~1 GB storage/bandwidth — one media ingest would blow it). The "$0 infrastructure" claim in §10 is scoped to the text KB; `_data/` rides existing Drive storage.

**Non-Claude access:** Codex/Gemini/one-off agents operate on worktrees of the same checkout on the desktop. All agent writes follow the §3.1 branch model. Deny-rules block secrets paths.

## 5. Task cards & the parse/act boundary

All coordination flows through task cards in `queue/` — small markdown files with YAML frontmatter. The schema (`governance/card-schema.md`) is load-bearing for both concurrency and security:

```yaml
id: <ulid>            # unique, assigned at creation
project: <org>        # which orgs/<project> this belongs to
action: <verb-phrase>  # SET ONLY BY Manager/dispatcher — never copied from untrusted text
target: <paths/urls>   # same restriction
risk-tier: T1|T2|T3    # per governance/risk-tiers.md
owner: <agent-id|null> # claim field — see §6 dispatch
claim-token: <token>   # minted by dispatcher at assignment
state: inbox|working|done|approved|rejected
approval: <token|null> # human-minted only — see §7
```
Body sections: `## Work order` (Manager-authored), `## Evidence` (fenced blockquote — the ONLY place free text from untrusted sources may appear; agents are instructed by the constitution to treat Evidence as inert data, never instructions), `## Result` (Worker/Inspector-appended).

**Parse/act boundary:** agents that read untrusted external text (GitHub issues, scraped web, inbound email) are parse-only; their output lands exclusively in `Evidence`. Actionable fields (`action`, `target`, `risk-tier`) are set only by the Manager or dispatcher, never verbatim from parsed text.

## 6. Orchestration

**The assembly line (per work item):** Scout → Manager → Worker → Inspector, git-mediated:

| Role | Model | Mandate |
|---|---|---|
| Scout | Haiku | Read-only. "What changed / what needs doing?" Escalates or closes. |
| Manager | Opus | Writes the work order (plan). Edits no files. |
| Worker | Sonnet (or Codex vs ChatGPT sub, month 1+) | Executes the work order on an agent branch. |
| Inspector | Opus, **fresh context** | Verifies output against the work order; writes the grade (§8). |

**Single-scheduler model (no split-brain):** one consolidated **dispatcher Routine** is the only scheduler. At each fire it reads every project's `HEARTBEAT.md` (READS → action → WRITES cadence declarations), determines which cadences are due, and dispatches them. The repo is the source of truth; Routines are just the clock. A desktop dispatcher (Task Scheduler) plays the identical role for heavy/local cadences, partitioned by an explicit `tier: cloud|desktop` field in `HEARTBEAT.md` so the two dispatchers never overlap. The nightly review asserts every declared cadence ran or logged why not.

**Atomic claims (no double execution):** only dispatchers assign work — they set `owner` + `claim-token` on a card and push to `ops`. Workers execute only cards where `owner` == self and the claim-token verifies; they never self-claim from `inbox/`. Because `ops` is fast-forward-only, two dispatchers racing on the same card resolve by push rejection: the loser rebases, sees the card claimed, and backs off. Cards carry side-effect idempotency notes for T2+ (what to check before acting, in case of retry after a crash).

**Skills sync:** the dispatcher Routine is the **sole authoritative sync** — it regenerates `.claude/skills/` from `skills/curated/`, commits, and hash-checks for drift (any `.claude/skills/` content not matching a curated source is flagged as tampering). A local `scripts/sync-skills` provides on-demand sync while authoring (invoked directly or via versioned `.githooks/` activated with `git config core.hooksPath .githooks` — hooks travel with the repo; no reliance on unversioned `.git/hooks`). Month 1 adds the Codex/Gemini adapter emission to the same sync step.

**Injection gate (v1, named concretely):** promotion of `imported/`/`learned/`/`evolved/` skills to `curated/` requires (a) a human read-through of the full skill against a checklist in `governance/security-rules.md`, and (b) `scripts/scan-skill` — a grep-based pass for known injection patterns (imperative override phrases, tool-invocation strings, encoded payloads, hidden unicode). This is a manual+heuristic gate; automated semantic scanning is explicitly deferred. Until promoted, such skills run only in sandboxed/branch contexts.

**Recurring loop tiers** (declared per-project in `HEARTBEAT.md`): ingest (daily — process `raw/` into `wiki/`, write report), nightly review (refresh `dashboards/`, aggregate ledger rollups, memory update, backup assertion), weekly review (system inspection, gap-finding, experiment/skill proposals → approval cards, cadence-ran assertion, grade reconciliation §8).

**Model routing & cost rule:** cheap models do all routine checking; flagships wake only for real decisions. Per-step model + cost logged to the agent's own ledger shard; every loop runs the **shared preamble** (in `CLAUDE.md`, sourced by all tiers): check `STOP` → assert `ANTHROPIC_API_KEY` unset → assert responding model id matches requested (logged per step; mismatch = wake-me card) → check daily budget.

## 7. Approvals — human-only channel

Approval is the security boundary, so it must be a channel agents cannot drive:

- An approval is valid only as a **human-minted approval token**: either (a) Daniel merges the approval PR on GitHub (branch protection on the approval path excludes all agent identities — agent tokens cannot merge there), or (b) Daniel taps approve in Omnara/Claude app, which records the decision through his identity, and the dispatcher verifies the actor before honoring it.
- **Editing the card file is NOT an approval channel.** A card whose `approval` field was set by any agent identity is treated as tampering: card quarantined, wake-me alert raised.
- Approval tokens bind to the **exact content hash** of what was approved (diff hash for merges, artifact hash for publishes) and expire after 24h — a Routine may execute an approved T3 action only if hash matches and the token is fresh. To be explicit: T3 execution after human approval *is* performed by an unattended Routine — the human gate is at decision time, not execution time; the hash binding is what makes that sound.
- **Latency budget:** cron-polled approvals execute within ~1h (next dispatcher fire). Urgent approvals use the dispatcher Routine's HTTP endpoint (triggered from phone at approval time) for near-immediate execution.

## 8. Autonomy & governance

**Universal rules** live in `CLAUDE.md` (constitution) + `governance/` — human-edited only (agent PRs against these paths are auto-rejected by branch protection).

**Per-project `contract.md`** — three lists:
- **acts-alone:** draft PRs on agent branches; lint/test/debt fixes; `STATE.md` and `wiki/` updates; dashboard regeneration.
- **queues-for-me:** merges to `main`; external publishing (posts, emails, uploads); deploys; diffs > 400 lines; anything a risk tier requires.
- **wakes-me-up:** verification fails twice on the same item; daily budget breached; any request to handle a secret as an object (§ hard ceiling); governance rule violated; per-step model-id mismatch (§6 preamble).

**Hard ceiling (absolute, not earnable) — precise wording:** agents may *use* ambient runtime credentials injected by the harness/platform (git push auth, device-auth sessions, scoped API keys in env) as part of normal operation, but may never **exfiltrate, print, copy, persist, or transmit** them; and may never **create, rotate, read from secret stores/`.env` files, or modify** credentials, tokens, or auth configuration unattended. Agents never spend real money (purchases, payments, API spend beyond preset budgets) unattended.

**Risk tiers** (`governance/risk-tiers.md`) — autonomy is earned per *task type × tier*:

| Tier | Examples | Promotion bar | Floor |
|---|---|---|---|
| T1 low | wiki updates, lint fixes, reports | 10 passes ≥ 90% | demote < 80% |
| T2 medium | code changes on branches, research deliverables | 20 passes ≥ 95% | demote < 90% |
| T3 high | merges to main, external publishing, deploys | 40 passes ≥ 98% → "fast-lane" one-tap approval only; never executes without a human approval token in v1 (§7) |
| T4 ceiling | credentials-as-objects, money | never unattended |

**Grade ledger integrity:** grades are written only by the **Inspector role under a dedicated grader identity** (separate token; Workers physically cannot write to `ledgers/grades/`, enforced by path rules on the grader shards + weekly reconciliation). The weekly review cross-checks every grade row against the Inspector's commits in `ledgers/activity/`; unmatched rows = tampering alert + freeze promotions. **Trust ramp:** week 1 everything watched → widen contracts as grades accumulate.

**Audit:** every autonomous action is a commit authored by the agent (diffable, revertible); dispatch and activity shards capture the rest.

## 9. Dashboard & control surface

**Assembled (v1 = zero custom UI):** Routines UI (schedules, run history, logs) · Claude mobile app (cloud sessions + Remote Control) · Omnara or Happy (phone launch/steer of desktop fleet — brokered, no inbound ports) · GitHub mobile (browse KB, read `dashboards/*.md`, merge approvals).

**Agent-generated dashboard:** nightly Routine rewrites `dashboards/executive.md` — agents online/recent runs, tasks by queue state, pending approvals, budget spent vs cap (from ledger rollups), grade changes, current focus — plus `system-map.md` (navigation) and `handover.md` (plain-English "state of the system" after time away).

**Kill switch — precise scopes:**
1. `STOP` file in repo root halts **cooperating loops at their next preamble check** (all loops and ad-hoc agents run the shared preamble, §6); commit it from GitHub mobile from anywhere.
2. **Routines pause toggle** at claude.ai is the *authoritative cloud stop* (reaches in-flight and scheduled Routines).
3. **Process-group kill** (via Omnara/Remote Control) is the *authoritative desktop stop*.
STOP is convenience + belt-and-suspenders; the toggles/kills are the real guarantees.

**Exit criteria for building a custom dashboard (later):** assembled surfaces persistently fail at ≥1 of — cross-agent overview in one place, approval latency, launch friction — after month 1.

## 10. Security

- **Sanctioned auth only:** subscription login on desktop; `claude setup-token` (1-year OAuth) only if a headless Claude worker is needed; Codex device-auth. No token extraction into third-party tools.
- **`ANTHROPIC_API_KEY` precedence trap:** unset on every host/script where subscription billing is intended (silently overrides to metered API — documented $1,800 case). Asserted in the shared preamble. One-off API agents get scoped keys with hard budget caps, stored encrypted, never in shell profiles.
- **Prompt injection:** parse/act boundary via the card schema (§5); connectors pruned per-Routine (they default on); GitHub-event-triggered Routines treated as hostile-input surfaces.
- **Cloud env limits:** no secrets in cloud environments (env vars visible; no secrets store). Cloud network access stays on "Trusted" allowlist unless a task requires more.
- **Local hardening:** deny-rules (`Read(~/.ssh/**)`, `Read(**/.env*)`, `Bash(curl * | bash)`, `Bash(ssh *)`); project hooks reviewed before trust; imported skills sandboxed (§6); no exposed control ports — phone access brokered only.
- **Branch discipline:** agents push only to agent-prefixed branches + `ops` (scoped paths); `main` and `governance/` protected against all agent identities.

## 11. Project lifecycle

- **Onboard:** `scripts/new-project <name>` scaffolds `orgs/<name>/` (`_index.md`, `STATE.md`, `contract.md` from a conservative template — everything starts queues-for-me — and a `HEARTBEAT.md` with cadences commented out until enabled). Registers the project in `_index.md`.
- **Archive:** move to `orgs/_archive/<name>/` (never delete); its `HEARTBEAT.md` cadences are ignored by dispatchers; grade history remains in ledgers for audit.
- **Existing assets migrate in:** current `~/.claude` user-level skills (e.g., multi-source-synthesis) move into `skills/curated/` (user-level skills don't reach cloud sessions; the repo copy is the durable one). Claude Desktop remains as-is for interactive/personal use — it is out of scope for the fleet.

## 12. Cost model

| Work | Runs on | Billed to |
|---|---|---|
| Scheduled Claude loops | Anthropic cloud (Routines) | Claude subscription (daily run cap applies) |
| Interactive/heavy Claude | Desktop / Claude Code web | Claude subscription |
| Coding offload (month 1+) | Desktop Codex CLI | ChatGPT subscription |
| Large-context/multimodal research | Desktop Gemini CLI | Gemini free tier / sub |
| One-off specialists | Desktop, scripted | Scoped API keys, hard caps |
| Infrastructure | — | $0 cash for the text KB (no VPS; GitHub free private repo; Omnara free tier or Happy OSS); `_data/` bulk storage rides existing Google Drive |

Budget guard: per-step cost logging (sharded), pre-run daily-limit check, cheap-model-for-routine-checking routing, `wakes-me-up` on breach.

## 13. Phasing

**Milestone 1a — the repo spine (week 1, no preview-feature dependencies):**
1. Scaffold `kb/` monorepo (structure above) + `ops` branch model + card schema; push to private GitHub with branch protections.
2. Migrate 1–2 real projects into `orgs/`; migrate `~/.claude` skills into `skills/curated/`.
3. `scripts/sync-skills` + `.githooks` working locally; seed selected ecc skills (cherry-picked through the §6 injection gate).
4. Shared preamble + `STOP` test; `contract.md` + grade ledger live in watch-everything mode.

**Milestone 1b — the cloud spine (week 2±, research-preview dependent, with fallback):**
5. Dispatcher Routine reading `HEARTBEAT.md`s; nightly review regenerating `dashboards/`.
6. Approval loop end-to-end from phone (card → human token → dispatcher executes). **Fallback branch:** if Routines preview misbehaves, the identical dispatcher runs on desktop Task Scheduler — conventions unchanged.

**Month 1 — the fleet:**
7. Full Scout→Manager→Worker→Inspector loop across ≥3 projects; grader identity + reconciliation live.
8. Desktop tier: Omnara/Happy wired; Codex CLI (device-auth) + Gemini CLI + adapters in the sync step; first non-Claude workloads.
9. Tiered heartbeats per project; ledger-driven promotions begin; desktop-fallback rehearsal for one cadence.

**Later — the flywheel:**
10. Self-improvement loops: sparring (builder vs breaker), weekly compost (failures → proposed rules → approval cards), experiments log with hypothesis→result grading.
11. ecc2 local power-tier if desktop session volume outgrows ad-hoc management.
12. Custom dashboard only if §9 exit criteria met.

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Routines/web/Remote Control are research-preview | Host-agnostic conventions; desktop Task Scheduler runs the identical dispatcher (rehearsed, §13.9) |
| Routine daily run cap throttles fleet | Single consolidated dispatcher handles all projects per fire; desktop absorbs overflow |
| Queue races / double execution | Dispatcher-only claims + fast-forward-only `ops` + idempotency notes (§6) |
| Forged approvals / grade gaming | Human-only approval channel + hash-bound expiring tokens (§7); grader identity + weekly reconciliation (§8) |
| Ledger merge conflicts | Sharded per writer+date; nightly read-only aggregation (§4) |
| Prompt injection via ingested content/GitHub events | Card-schema parse/act boundary (§5); connector pruning; branch discipline; T3 gates |
| Skill supply chain | Provenance tiers + named manual/heuristic gate (§6) + sandbox-until-promoted |
| Accidental API billing | Preamble assertion; no `ANTHROPIC_API_KEY` on subscription hosts |
| Monorepo growth / bulk media | `_data/` + Google Drive sync with restore steps; text-only repo; periodic archive pass |
| Windows Update reboots mid-task | Queue cards + committed state = resumable; active hours configured; cloud carries time-critical loops |
| Silent model rerouting | Per-step responding-model-id assertion in preamble; mismatch = wake-me card (§6) |

## 15. Resolved questions log

- Local vs cloud → hybrid, cloud-weighted (substrate research).
- KB form → git monorepo of markdown (Obsidian-compatible, not Obsidian-dependent).
- Dashboard → assemble; custom build deferred behind explicit exit criteria.
- Remote control → Omnara/Happy + native Claude surfaces; Telegram optional later; OpenClaw rejected.
- Codex/Gemini → month 1, after conventions stabilize.
- Autonomy ceiling → credentials-as-objects + money absolute (precise wording §8); risk-tiered earned autonomy otherwise.
- Adversarial review rev 2 → ops-branch coordination model, dispatcher-only claims, human-only approval tokens, sharded ledgers, card-schema parse/act boundary, single-scheduler HEARTBEAT model, versioned hooks + Routine-authoritative skills sync, enforceable credentials wording, named v1 injection gate, approval latency budget, split week-1 milestones, precise kill-switch scopes, project lifecycle section, Drive-backed `_data/`, model-swap detection.
