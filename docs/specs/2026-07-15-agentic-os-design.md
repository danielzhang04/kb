# Agentic OS — Design Specification

**Date:** 2026-07-15
**Status:** Draft for user review
**Owner:** Daniel (daniel.zhang.t1@gmail.com)
**Process:** Coordinated by Claude (Fable 5); all research, video analysis, and candidate-architecture drafting performed by Opus 4.8 subagents (model enforced via harness `model: "opus"` override, empirically verified as `claude-opus-4-8`).

---

## 1. Goal

A personal agent operations platform: many agents (Claude Code primary; Codex CLI, Gemini CLI, and one-off API agents secondary) running multiple workflows across multiple projects inside one knowledge base — coordinating with each other, updating relevant files under a universal rule set, self-improving, and working while Daniel is away from the computer. Skills are authored once and available across all projects and agents. A dashboard/control surface supports: monitor & review (including approvals and costs), launch & steer work, manage skills/agents, and browse the KB — including from a phone.

### Non-goals (v1)
- No custom-built web dashboard until assembled surfaces prove insufficient.
- No OpenClaw or any subscription-token-extraction tooling (ToS ban risk; RCE/credential-leak history).
- No fully unsupervised autonomy: every source reviewed converges on graduated, earned autonomy with human gates.

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
| Hard autonomy ceiling | Agents may **never touch credentials** and **never spend real money** unattended; all other sensitive actions are risk-tiered (see §7) |
| ecc | Installed as managed plugin (`ecc@ecc`, user scope, toggleable); repo cloned at `C:\Users\danie\repos\ecc` as reference library |

## 3. Topology

Three execution tiers coordinate exclusively through the git monorepo. No message bus, no required daemon: any agent anywhere reads a task card from `queue/`, works on a branch, commits results. Git history is the audit log.

1. **Cloud tier — Anthropic Routines + Claude Code on the web.** All scheduled/unattended Claude work: nightly ingest, dashboard regeneration, weekly reviews, queue polling. Subscription-billed (no VM charge), runs with PC off, monitorable/steerable from the Claude mobile app. Triggers: cron (≥1h granularity), per-routine HTTP endpoint, GitHub events.
2. **Desktop tier — Windows 11 PC (24/7).** Interactive Claude Code sessions, heavy jobs (media, large builds), and the non-Claude fleet: Codex CLI (device-auth, ChatGPT-sub-billed), Gemini CLI, one-off API agents. Each agent runs in its own git worktree. Local scheduling via Task Scheduler; "Keep computer awake" enabled; wake timers for resilience.
3. **Phone tier — control only.** Claude mobile app (cloud sessions + Remote Control of local sessions), Omnara/Happy (launch/steer desktop fleet), GitHub mobile (browse KB, merge approvals), Routines UI (schedules/logs).

**Failure modes:** PC down → cloud tier unaffected; time-critical work is assigned to Routines by policy. Anthropic preview features tightened → the KB, queue conventions, and skills are host-agnostic; scheduled work relocates to desktop Task Scheduler (candidate-B fallback) without redesign.

## 4. Knowledge base — the `kb/` monorepo

Single private GitHub repository. Local checkout at `C:\Users\danie\kb\`. Obsidian may point at the folder for graph view and mobile browsing, but nothing depends on it — plain markdown in git.

```
kb/
  _index.md                    # master navigation. Test: "with a million files, is
                               #  there a clear path for an agent to find anything?"
  CLAUDE.md                    # the constitution (universal rules)
  AGENTS.md  GEMINI.md         # per-agent mirrors of the constitution
  orgs/<project>/              # one folder per project
    _index.md                  # project navigation
    STATE.md                   # current state, updated by agents
    contract.md                # project autonomy policy (three lists + risk tiers)
    HEARTBEAT.md               # the project's recurring-loop instructions
    raw/                       # ingest inbox: dump anything
    wiki/                      # structured, agent-maintained knowledge (+ _index.md)
    output/                    # deliverables
  governance/                  # agent-rules.md, security-rules.md, schema.md,
                               #  risk-tiers.md — read by every agent, changed only by human
  skills/                      # source of truth, by provenance tier:
    curated/                   #  human-approved
    learned/                   #  promoted from repeated agent fixes (pending review)
    imported/                  #  third-party (sandboxed until reviewed)
    evolved/                   #  agent-improved variants (pending review)
  .claude/skills/              # SYNCED from skills/curated — what cloud sessions load
  queue/                       # the message bus (markdown/JSON task cards)
    inbox/  working/  done/  approvals/
  memory/                      # STATE.md, lessons-learned/, per-agent memory files
  ledgers/                     # grades.tsv, cost.log, dispatch.log, activity.log
  dashboards/                  # agent-GENERATED, rewritten nightly:
                               #  executive.md, system-map.md, handover.md
  docs/specs/                  # design docs (this file)
  STOP                         # (only when halting — see kill switch §8)
```

**Size discipline:** bulk binaries (video, datasets) live in Git-LFS or an ignored `_data/` directory synced out-of-band; cloud sessions have a 30 GB disk cap and context is precious.

**Non-Claude access:** Codex/Gemini/one-off agents operate on the same checkout (or worktrees of it) on the desktop. All agent writes go to agent-named branches; merges to `main` are gated per `contract.md`. Deny-rules block secrets paths.

## 5. Skills pipeline

1. **Author once** in `kb/skills/curated/<name>/SKILL.md` (+ optional scripts/references).
2. **Sync step** (pre-commit hook locally + nightly Routine as backstop):
   - copies curated skills to `.claude/skills/` → automatically present in every cloud session and Routine (repo-level skills are the only ones that carry to cloud);
   - runs adapter scripts (ecc ships Codex/Gemini adapters: `gemini-adapt-agents.js`, `sync-ecc-to-codex.sh` patterns) to emit `.codex/` and `.gemini/` equivalents (month 1).
3. **Provenance manifest** per skill: source, author, content hash, trust tier.
4. **Supply-chain gate:** `imported/` and `learned/` skills execute only in sandboxed/branch contexts until they pass an injection scan and human approval (approval card in `queue/approvals/`). Rationale: audited samples of public skills have shown ~36% prompt-injection rates; skills are supply chain.
5. **Self-improvement input:** the continuous-learning pattern (Stop-hook, per ecc longform guide) proposes `learned/` skills from repeated fixes; the weekly review proposes `evolved/` variants. Both route through the same gate. Nothing self-promotes to `curated/`.

## 6. Orchestration

**The assembly line (per work item):** Scout → Manager → Worker → Inspector, git-mediated and stateless:

| Role | Model | Mandate |
|---|---|---|
| Scout | Haiku | Read-only. "What changed / what needs doing?" Escalates or closes. |
| Manager | Opus | Writes the work order (plan). Edits no files. |
| Worker | Sonnet (or Codex vs ChatGPT sub, month 1+) | Executes the work order on an agent branch. |
| Inspector | Opus, **fresh context** | Verifies output against the work order before merge/approval routing. |

Each stage reads a `queue/` card and writes the next one; any stage can run on any tier. Failures route per `contract.md` (retry once → escalate → wake-me card).

**Recurring loops:** each project's `HEARTBEAT.md` declares its cadences as READS → action → WRITES contracts. Standard tiers (adapted from the "Jarvis OS" pattern):
- **Ingest** (daily): process `raw/`, file into `wiki/`, write ingest report.
- **Nightly review**: refresh `dashboards/*.md`, update `memory/`, reconcile ledgers, backup.
- **Weekly review**: inspect the whole system, find gaps, propose experiments/skills, stage approval cards.

Cloud Routines fire the scheduled loops (min 1h granularity is sufficient — nothing here needs sub-hourly). Desktop Task Scheduler fires heavy/local loops. The Routines HTTP endpoint lets the phone push urgent work into `queue/inbox/`.

**Model routing & cost rule:** cheap models do all routine checking; flagships wake only for real decisions. Per-step model + cost logged to `ledgers/cost.log`; every loop begins with a daily-budget check and a `STOP`-file check.

## 7. Autonomy & governance

**Universal rules** live in `CLAUDE.md` (constitution) + `governance/` — human-edited only.

**Per-project `contract.md`** — three lists:
- **acts-alone:** draft PRs on agent branches; lint/test/debt fixes; `STATE.md` and `wiki/` updates; dashboard regeneration.
- **queues-for-me:** merges to `main`; external publishing (posts, emails, uploads); deploys; diffs > 400 lines; anything a risk tier requires (below).
- **wakes-me-up:** verification fails twice on the same item; daily budget breached; any request for a secret; governance rule violated; safeguard router swapped models mid-run.

**Hard ceiling (absolute, not earnable):** agents never create/read/modify credentials, tokens, or auth config unattended; agents never spend real money (purchases, payments, API spend beyond preset budgets) unattended.

**Risk tiers** (`governance/risk-tiers.md`) — autonomy is earned per *task type × tier*:

| Tier | Examples | Promotion bar | Floor |
|---|---|---|---|
| T1 low | wiki updates, lint fixes, reports | 10 passes ≥ 90% | demote < 80% |
| T2 medium | code changes on branches, research deliverables | 20 passes ≥ 95% | demote < 90% |
| T3 high | merges to main, external publishing, deploys | 40 passes ≥ 98%, and only to "queues-for-me fast-lane" (one-tap approval), never fully unattended in v1 |
| T4 ceiling | credentials, money | never unattended |

**Grade ledger** (`ledgers/grades.tsv`): every task logged pass/fail per task-type; promotions/demotions are automatic, demotions notify. **Trust ramp:** week 1 everything watched → widen contracts as grades accumulate.

**Audit:** every autonomous action is a commit authored by the agent (diffable, revertible); `ledgers/activity.log` + `dispatch.log` capture the rest.

## 8. Dashboard & control surface

**Assembled (v1 = zero custom UI):**
- **Routines UI** (claude.ai/code/routines): schedules, run history, per-routine logs.
- **Claude mobile app**: monitor/steer cloud sessions; Remote Control for live local sessions.
- **Omnara (or Happy if OSS preferred)**: phone launch/steer of the desktop fleet — brokered, no inbound ports.
- **GitHub mobile**: browse KB, read `dashboards/*.md`, merge approval PRs.

**Agent-generated dashboard:** nightly Routine rewrites `dashboards/executive.md` — agents online/recent runs, tasks by queue state, pending approvals, budget spent vs cap, grade changes, current focus — plus `system-map.md` (navigation) and `handover.md` (plain-English "state of the system" for returning after time away).

**Approvals:** `[HUMAN]` cards in `queue/approvals/` (markdown card = what, why, diff/link, risk tier). Approve via Omnara tap, GitHub merge, or editing the card. A Routine polls and proceeds.

**Kill switch, layered:** (1) `STOP` file in repo root — every loop checks it first; commit it from GitHub mobile to freeze the fleet from anywhere; (2) pause-all-Routines toggle at claude.ai; (3) desktop process-group kill via Omnara/Remote Control. Acceptable latency: git-mediated stop is next-poll, not instant; branch-only writes bound the blast radius.

**Exit criteria for building a custom dashboard (later):** assembled surfaces fail at ≥1 of — cross-agent overview in one place, approval latency, launch friction — persistently after month 1.

## 9. Security

- **Sanctioned auth only:** subscription login on desktop; `claude setup-token` (1-year OAuth) only if a headless Claude worker is needed; Codex device-auth. No token extraction into third-party tools.
- **`ANTHROPIC_API_KEY` precedence trap:** keep it unset on every host/script where subscription billing is intended (it silently overrides and meters to API — documented $1,800 surprise-bill case). Every loop script asserts it is unset. One-off API agents get scoped keys with hard budget caps, stored encrypted, never in shell profiles.
- **Prompt injection:** any agent reading untrusted external text (GitHub issues/PRs, scraped web, inbound email) is a **parse-only** agent whose output is data, never instructions; acting agents are separate. Connectors pruned per-Routine (they default to on). GitHub-event-triggered Routines treated as hostile-input surfaces.
- **Cloud env limits:** no secrets in cloud environments (env vars are visible; no secrets store). Cloud network access stays on "Trusted" allowlist unless a task requires more.
- **Local hardening:** permission deny-rules (`Read(~/.ssh/**)`, `Read(**/.env*)`, `Bash(curl * | bash)`, `Bash(ssh *)`); project hooks reviewed before trust (known CVE class); imported skills sandboxed (§5); no exposed control ports — phone access is brokered only.
- **Branch discipline:** agents push only to `claude/`- or agent-prefixed branches (cloud default; enforced locally via branch protection on `main`).

## 10. Cost model

| Work | Runs on | Billed to |
|---|---|---|
| Scheduled Claude loops | Anthropic cloud (Routines) | Claude subscription (daily run cap applies) |
| Interactive/heavy Claude | Desktop / Claude Code web | Claude subscription |
| Coding offload (month 1+) | Desktop Codex CLI | ChatGPT subscription |
| Large-context/multimodal research | Desktop Gemini CLI | Gemini free tier / sub |
| One-off specialists | Desktop, scripted | Scoped API keys, hard caps |
| Infrastructure | — | $0 (no VPS; GitHub free private repo; Omnara free tier or Happy OSS) |

Budget guard: per-step cost logging, pre-run daily-limit check, cheap-model-for-routine-checking routing rule, `wakes-me-up` on breach.

## 11. Phasing

**Week 1 — the spine (Claude-only):**
1. Scaffold `kb/` monorepo (structure above), push to private GitHub.
2. Migrate 1–2 real projects into `orgs/`.
3. Skills sync hook (curated → `.claude/skills/`); seed with existing skills (e.g., multi-source-synthesis) and selected ecc skills (cherry-picked, scanned).
4. First Routine: nightly review → regenerates `dashboards/`, writes handover.
5. Approval loop tested end-to-end from phone (card → approve → Routine proceeds).
6. `contract.md` + grade ledger live in watch-everything mode; `STOP`-file kill switch tested.

**Month 1 — the fleet:**
7. Full Scout→Manager→Worker→Inspector loop across ≥3 projects.
8. Desktop tier: Omnara/Happy wired; Codex CLI (device-auth) + Gemini CLI + adapters; first non-Claude workloads.
9. Tiered heartbeats per project (ingest/nightly/weekly); ledger-driven promotions begin.
10. Ingest pipeline habits: everything lands in `raw/`, agents file it.

**Later — the flywheel:**
11. Self-improvement loops: sparring (builder vs breaker on yesterday's work), weekly compost (read failures → propose rules), experiments log with hypothesis→result grading.
12. ecc2 local power-tier if desktop session volume outgrows ad-hoc management.
13. Custom dashboard only if §8 exit criteria met.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Routines/web/Remote Control are research-preview; limits may change | Host-agnostic conventions; desktop Task Scheduler fallback rehearsed (run one heartbeat locally in month 1) |
| Routine daily run cap throttles fleet | Consolidate loops (one nightly Routine handles many projects); desktop absorbs overflow |
| Prompt injection via ingested content/GitHub events | Parse/act separation; connector pruning; branch-only writes; approval gates on T3 |
| Skill supply chain | Provenance tiers + injection scan + sandbox-until-reviewed |
| Accidental API billing | Unset-assertion in every loop; no `ANTHROPIC_API_KEY` on subscription hosts |
| Monorepo grows past cloud limits | LFS/`_data/` discipline; `_index` navigation; periodic archive pass |
| Windows Update reboots desktop mid-task | Queue cards + git-committed state make all work resumable; active hours configured; cloud carries time-critical loops |
| Grade-ledger gaming (agent marks own work passed) | Inspector (fresh context) grades, never the Worker; spot-check sampling in weekly review |

## 13. Resolved questions log

- Local vs cloud → hybrid, cloud-weighted (evidence: substrate research).
- KB form → git monorepo of markdown (Obsidian-compatible, not Obsidian-dependent).
- Dashboard → assemble; custom build deferred behind explicit exit criteria.
- Remote control → Omnara/Happy + native Claude surfaces; Telegram optional later; OpenClaw rejected.
- Codex/Gemini → month 1, after conventions stabilize.
- Autonomy ceiling → credentials + money absolute; risk-tiered earned autonomy otherwise.
