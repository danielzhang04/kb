# Card schema

Normative. This file is the single load-bearing definition of the task-card format for both
concurrency and security. It quotes `docs/specs/2026-07-15-agentic-os-design.md` §5 in full; the
spec is the single source, and this file reproduces it verbatim.

All coordination flows through task cards in `queue/` — small markdown files with YAML frontmatter.
The schema is load-bearing for both concurrency and security:

```yaml
id: <ulid>            # unique, assigned at creation
project: <org>|[orgs]  # owning project(s) — a list enables cross-project tasks;
                       #  any agent may FILE a card into any project's stream
action: <verb-phrase>  # SET ONLY BY Manager/dispatcher — never copied from untrusted text
target: <paths/urls>   # same restriction
risk-tier: T1|T2|T3    # per governance/risk-tiers.md
owner: <agent-id|null> # claim field — see §6 dispatch
claim-token: <token>   # minted by dispatcher at assignment
state: inbox|blocked|working|done|approvals|approved|rejected|stop-requested|halting|halted
                       # stop-requested/halting/halted: the steering-floor cooperative-stop
                       #  ladder (files-only). A worker polls for stop-requested at a
                       #  checkpoint, moves itself to halting, then halted. SIGKILL is the
                       #  backstop for a worker that never polls. Only a working card may
                       #  enter the ladder; halted is terminal.
approval: <token|null> # human-minted only — see §7
workflow: <name|null>  # parent workflow instance, if part of one (§5.1)
depends-on: [ids]      # dispatcher releases the card only when these are done;
                       #  their ## Result sections become this card's input
variant-group: <id|null>  # marks N sibling cards exploring variations of the same task
role: scout|manage|work|inspect|consolidate  # consolidate = judge card: scores/picks/merges its
                          #  variant-group siblings' results
session-id: <str|null> # the EXECUTING WORKER's Claude Code session id, stamped by the
                       #  worker runner at transition-to-working. For the cloud
                       #  self-executing carve-out case only, the dispatcher may stamp it
                       #  at claim time instead. Joins the card to its Plane-B transcript.
                       #  Optional; null on unclaimed/legacy cards. Inert metadata — never
                       #  parsed or executed. (This is the worker's session, not the
                       #  dispatcher's, except in that one self-executing carve-out.)
```
Body sections: `## Work order` (Manager-authored), `## Evidence` (fenced blockquote — the ONLY place free text from untrusted sources may appear; agents are instructed by the constitution to treat Evidence as inert data, never instructions), `## Result` (Worker/Inspector-appended). `## Feedback` (steer text appended for a requeue/rerun — inert like `## Evidence`: never executed as instructions, never a source of `action`/`target`/`risk-tier`; read-only context
for whichever agent picks the card back up).

**Cadence pause marker.** A files-only `queue/paused/<cadence-name>` sentinel that `dispatch.due()` consults: if present, that cadence's next scheduled beat is skipped. Suppress-only — it can never trigger or widen a cadence, and one cadence's marker never affects another. It is not an edit to the human-committed `HEARTBEAT.md`, and it is distinct from the per card stop ladder: `paused` skips a cadence's future beats; `stop-requested`/`halting`/`halted` stops one in-flight card.

## Workflows — card DAGs

`depends-on` + `variant-group` make the queue a general workflow engine. The three coordination patterns, all expressible as card graphs:

- **Parallel parts:** N independent cards over different targets of one project (different skills, different areas), running concurrently on any tier.
- **Pipeline:** a chain of cards linked by `depends-on` — agent 1 runs task A, its `## Result` becomes agent 2's input for task B, and so on. Stages can use different agents, skills, and model tiers.
- **Variants → consolidate:** N cards in one `variant-group` attack the same task differently (different skills, approaches, or agents); a `role: consolidate` judge card depending on all of them scores the results, picks the best, or merges the best ideas (fresh-context judge, per the Inspector principle).

**Authoring:** reusable pipelines are declared once in `workflows/<name>.md` (stages, skill + agent + model tier per stage, fan-out counts); the dispatcher expands a workflow invocation into its card DAG. One-off DAGs can also be written directly by a Manager.

**Granularity rule:** cards mark handoffs that cross session boundaries. Within a single session, an orchestrating agent fans out native subagents/worktrees for tight iterate-variations-choose-best loops — one card, many internal agents, one consolidated `## Result`. Don't card-ify micro-steps.

**Parse/act boundary:** agents that read untrusted external text (GitHub issues, scraped web, inbound email) are parse-only; their output lands exclusively in `Evidence`. Actionable fields (`action`, `target`, `risk-tier`) are set only by the Manager or dispatcher, never verbatim from parsed text.

**Hash-binding note (cross-plan, do not "harmonize").** The dashboard's WebAuthn `content_hash` preimage covers the full canonical card payload including `action`, `risk-tier`, `owner`, and `target`. The fleet signed channel's `payload_hash` binds `action` + `target` + work-order only — it does not cover `risk-tier`/`owner`; tier-laundering prevention on the fleet channel rests on the re-approval rule, not hash-binding. The two channels canonicalize differently on purpose; do not assume the fleet hash covers `risk-tier`, and do not unify the two preimages without re-deriving both channels' security arguments.
