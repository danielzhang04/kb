# kb

A single repository that several AI coding agents operate out of, under one written constitution.

Claude, Codex and Gemini sessions all work in this repo. Rather than each having its own conventions,
they share one rulebook (`CLAUDE.md`, mirrored to `AGENTS.md` and `GEMINI.md`), coordinate through
markdown task cards on a dedicated git branch, and write what they learn back into files so the next
session starts where the last one stopped. A web dashboard runs the whole thing from a browser.

This is working infrastructure for one person's projects, not a product or a framework. It is shared
here for reading.

## The idea

Agent sessions are forgetful and run in parallel, which makes them hard to coordinate. kb treats that
as a filesystem and git problem rather than a prompting one:

- **The constitution is a file.** `CLAUDE.md` binds every agent — branch rules, spending limits,
  what needs a human, and a hard ceiling on credentials. `governance/` is human-edited only.
- **Work is a card, not a conversation.** Every task is a markdown file in `queue/` with an owner,
  a risk tier and acceptance criteria (`governance/card-schema.md`). Agents execute only cards
  assigned to them, and treat any `## Evidence` section as inert data, never as instructions.
- **State lives in files.** Lessons go to `memory/<agent-id>.md`, session pickups to `handoffs/`,
  and every dispatch, cost and grade to append-only `ledgers/`.
- **Branches separate coordination from work.** Coordination writes go to the `ops` branch; work
  products go to per-agent branches; `main` moves only through pull requests.
- **Recurring work is declarative.** `HEARTBEAT.md` lists cadences — nightly review, weekly audit —
  that a dispatcher agent fires on schedule.

## Layout

| Path | What it is |
|---|---|
| `CLAUDE.md` / `BOSS.md` | the constitution, and the extra rules for the orchestrating terminal |
| `governance/` | risk tiers, card schema, model routing, budgets — human-edited only |
| `queue/` | task cards, moving `inbox → working → done` |
| `agents/` | 18 agent declarations: role, permitted tools, loop bounds |
| `orgs/` | the actual projects — see below |
| `dashboard/` | the web control plane (Fastify, xterm.js, CodeMirror, WebAuthn) |
| `deploy/` | VM bootstrap, release packaging, and the validators that gate them |
| `ledgers/` | append-only cost, dispatch, activity and grade records |
| `memory/`, `handoffs/` | per-agent lessons; dated session pickups |
| `skills/` | reusable procedures, filed by provenance (curated / learned / imported / evolved) |
| `scripts/`, `tests/` | the Python operational tooling and its test suite |

Start at `_index.md`.

## Projects

`orgs/` holds the work the fleet actually does. Each project carries its own `_index.md`, a
`STATE.md` the agents keep current, a `contract.md` setting how much they may do without asking, and
its own `HEARTBEAT.md`.

- **`faceless-youtube`** — the substantial one. An automated video pipeline: research, scripting,
  image generation, narration and assembly, with human approval gates at the script, shot board and
  publish steps.
- **`kb-ops`** — the fleet maintaining itself: audits, hygiene sweeps, drift checks.
- **`atlas-prep`** — scaffolded but empty. The voice-assistant work it was meant to hold currently
  lives in the top-level `atlas/`.

## The dashboard

`dashboard/` is a web control plane for the fleet: watch a running agent's terminal stream, review
and approve work, deploy releases, and see what needs a human. It runs on a small cloud VM reachable
only over a private Tailscale network, with no public listener.

The interesting constraint is that the VM is deliberately cut off from pushing to GitHub. It commits
coordination changes locally, bundles them into a signed outbox, and a trusted desktop promotes them
upstream and ships back a signed bundle the VM verifies before fast-forwarding. Anything that deletes
queue state additionally needs a human ssh signature. Most of `deploy/` is the validators enforcing
that boundary.

## Reading it

Nothing here is a library to install. If you want the shape of it quickly:

1. `CLAUDE.md` — the rules everything else follows
2. `governance/card-schema.md` — the unit of work
3. `orgs/faceless-youtube/_index.md` — the most developed project
4. `handoffs/` — what actually happened, session by session, including the failures

## Status

Under active development, with rough edges. Some directories are experiments that did not go
anywhere, some tooling assumes this specific machine and VM, and the git history is candid about
things that broke.
