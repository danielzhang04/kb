---
name: prospecting-acquisition
description: Acquire operator page and search captures for one saved prospecting run through the private durable capture CLI, using the single supported Chrome consumer, with fixed leases, attempt caps and error codes.
---

# Prospecting capture acquisition

Collect evidence for one saved P15 pipeline run: run searches, open HTTPS
pages, and store the visible text as durable, hash-verified captures.

## Executable

All commands below run as:
`python -B -m scripts.prospecting.research_capture_cli --store PATH <mode> ...`

## Where this runs

- Run every capture step from the root desktop session that owns the store
  and the supported Chrome window.
- All private values stay on that desktop: query text, target URLs, lease
  tokens, captured body text, packet files and the SQLite store itself.
- Private values travel only in JSON files under the store's own
  `snapshots/` directory. Never put them in process arguments, never echo
  them, never paste them into a shared channel or a remote service.
- Development workers get only source text and synthetic fixtures on the
  existing vCPU. Do not ship a store, a capture body, a packet file or a
  real query to them, and do not provision machines for capture.

## Browser rule

- Exactly one consumer executes packets: the supported root Chrome window
  driven by computer use. Every packet is a real, visible tab action.
- Do not install, launch or script a second browser, a headless engine, an
  HTTP fetch tool, a scraping library or any other automation path.
- Do not invent a search-provider allowlist. There is no host or provider
  allowlist beyond the CLI's own URL and query validation; do not add one.
- If that relay is unavailable, finish only the attempt you have already
  claimed with `relay_unavailable` and stop. Never claim a new lease just
  to burn attempts; a burnt attempt is lost capacity, not progress.

## Operations

Every call takes `--store PATH` plus exactly one mode:

- `--session-start FILE` open a capture session bound to a run.
- `--enqueue FILE` add one packet to a session.
- `--claim SESSION_ID` lease the next runnable task in that session,
  writing a private packet file under `snapshots/capture-packets`;
  returns `packet_ref`. You never choose which `task_id` you get.
- `--submit FILE` record a successful capture.
- `--finish FILE` close a claimed attempt with a failure code.
- `--progress SESSION_ID` list task states and attempt counts.
- `--verify TASK_ID` re-check a stored capture against its receipt.

## Exact input schemas

Each input file is one JSON object with exactly the listed keys, no more
and no fewer; every value is a string unless noted.

- session-start: `request_id` (UUID text), `run_id` (`prun_` + 32 hex),
  `expected_intake_hash` (64 hex), `acquisition_skill_hash` (64 hex),
  `task_cap` (int, 1..32).
- enqueue: `request_id`, `session_id`, `task_kind`, `query`, `url`.
  For `search_visible_results` set `query`, and `url` must be null.
  For `open_https_capture_visible_text` set an `https` `url` with a real
  DNS name, and `query` must be null.
- submit: `task_id`, `lease_token`, `body_ref`, `source_url`,
  `retrieved_at` (ISO 8601 with offset, never in the future).
- finish: `task_id`, `lease_token`, `error_code`.

`body_ref` is a relative path under the store's `snapshots/` directory to
a regular UTF-8 text file you wrote yourself holding the exact visible
text, at most 2 MiB. `task_id` and `lease_token` come only from the
packet file `--claim` just wrote for the attempt you are acting on; copy
them character for character, along with the packet's query or URL.

## Fixed limits

- 32 tasks per session, or the lower `task_cap` you chose.
- 3 attempts per task.
- 300 second maximum lease; an expired lease is reclaimed and its token
  stops working.
- Packets are deduplicated per session by content.

## Fixed failure codes

`tab_closed`, `navigation_failed`, `challenge`, `no_result`,
`relay_unavailable`. These five are the only accepted `error_code`
values. Pick the one matching what the tab actually did.

## Retrying honestly

- To retry a specific failed task, run `--claim SESSION_ID` again. It
  leases the next runnable task in ordinal order, which may be that task
  or may be a different one; it does not take a `task_id`. Inspect the
  private packet file after claiming to see which `task_id` you actually
  got before acting.
- Never enqueue a duplicate packet and never mint a fresh `request_id`
  for the same work to gain extra attempts; per-task attempt counts are
  the budget and must be preserved. Exhausting 3 attempts means the task
  is failed; report that.
- After `navigation_failed` you may enqueue a genuinely different URL as
  a new task when a better source exists and session cap remains. The
  original task keeps its own record and may still be claimed and
  retried on its own remaining attempts.

## Redirects and URL matching

For `open_https_capture_visible_text` tasks, the `source_url` you submit
must match the task's packet URL exactly. If the tab lands elsewhere, do
not submit it: finish the attempt with `navigation_failed`, and if
warranted enqueue the landing URL as its own task.
For `search_visible_results` tasks there is no single page URL to match;
follow the CLI's existing query and `source_url` validation on submit
instead of inventing an exact-match rule for search captures.

## What a capture proves, and what it does not

A committed, verified receipt proves only that the CLI accepted the
bytes you supplied, at the URL and time you supplied, and that those
bytes still hash-match the stored snapshot. It does not, by itself, prove
that the supported Chrome window actually observed that page or those
search results; that observation is separate evidence carried only by
the fact that you, running in the desktop session, performed the tab
action yourself. Never treat a stored, hash-verified receipt alone as
proof of browser execution, and never fabricate one from data you did
not see on screen.

A capture, once genuinely observed and stored, is still only evidence:
not qualification, approval, ranking, scoring or outreach, and it grants
no downstream authority. Do not treat task state or byte counts as a
decision, and do not invent approval gates or workflow steps that this
tooling does not define.

## Current state

The broker and the downstream compiler are not implemented yet; wiring
them is follow-up work and remains pending. Hand-written JSON input
files driving this CLI are today's working path, not the final
architecture, so keep sessions small and record what you learn for the
next iteration.
