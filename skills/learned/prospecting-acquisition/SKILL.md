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

- `--session-start FILE` opens a capture session bound to a run.
- `--enqueue FILE` adds one packet to a session.
- `--claim SESSION_ID` leases the next runnable task in that session,
  writes a private packet under `snapshots/capture-packets`, and returns
  `packet_ref`. You never choose which `task_id` you get.
- `--submit-packet FILE` records a successful capture using that owned claim
  packet; use it instead of manually transcribing the legacy submit fields.
- `--finish FILE` closes a claimed attempt with a failure code.
- `--progress SESSION_ID` lists task states and attempt counts.
- `--verify TASK_ID` re-checks a stored capture against its receipt.

## Exact capture inputs

Each input file is one JSON object with exactly the listed keys, no more
and no fewer; every value is a string unless noted.

- session-start: `request_id` (UUID text), `run_id` (`prun_` + 32 hex),
  `expected_intake_hash` (64 hex), `acquisition_skill_hash` (64 hex),
  `task_cap` (int, 1..32).
- enqueue: `request_id`, `session_id`, `task_kind`, `query`, `url`.
  For `search_visible_results` set `query`, and `url` must be null.
  For `open_https_capture_visible_text` set an `https` URL with a real
  DNS name, and `query` must be null.
- submit-packet: `packet_ref`, `body_ref`, `source_url`, `retrieved_at`.
  The packet reference is the one `--claim` wrote; do not put a query, URL,
  lease token, or captured body in the process arguments.
- finish: `task_id`, `lease_token`, `error_code`.

`body_ref` is a relative path under the store's `snapshots/` directory to a
regular UTF-8 text file holding the exact visible text, at most 2 MiB. Read
the private claim packet before acting; copy its values character for
character only into the private submit-packet wrapper.

## Fixed limits and failures

- 32 tasks per session, or the lower `task_cap` you chose.
- 3 attempts per task.
- 300 second maximum lease; an expired lease is reclaimed and its token
  stops working.
- Packets are deduplicated per session by content.
- `tab_closed`, `navigation_failed`, `challenge`, `no_result`, and
  `relay_unavailable` are the only accepted `error_code` values.

## Retrying honestly

- To retry a failed task, run `--claim SESSION_ID` again. It leases the next
  runnable task in ordinal order, which may be a different task. Inspect its
  private packet before acting.
- Never enqueue a duplicate packet or mint a fresh `request_id` for the same
  work to reset its attempt budget. Exhausting three attempts means failure.
- After `navigation_failed`, you may enqueue a genuinely different URL when a
  better source exists and the session cap remains. The original task retains
  its own remaining attempts.

## Redirects and URL matching

For `open_https_capture_visible_text`, submitted `source_url` must exactly
match the packet URL. If the tab lands elsewhere, finish that attempt with
`navigation_failed`, then, if warranted, enqueue the landing URL separately.
Search captures have no single expected page URL; follow the CLI validation
instead of inventing an exact-match rule.

## Capture meaning

A verified receipt proves only that the CLI accepted supplied bytes, URL, and
time and that those bytes still hash-match the snapshot. It does not itself
prove browser observation, qualification, approval, ranking, scoring, or
outreach. The browser path is currently unavailable; do not fake it or claim
live capture was tested.

## Compile and import after capture

Read [the acquisition runbook](../../../orgs/prospecting/runbook-acquisition.md)
for the private annotation schemas and the exact downstream sequence:
`--submit-packet`, optional `capture_import_cli --locate`,
`--compile-funding` or `--compile-people`, then explicit
`pipeline_cli --funding-import` or `--person-import`.

Only a private store path and opaque identifiers may be arguments. Queries,
URLs, excerpts, names, profiles, text, and annotation values stay in private
files and never enter stdout, logs, Git, or a VM sink. Locate offsets and
opaque example IDs are illustrative: substitute exact receipt references and
located Unicode-codepoint spans from the selected store.

Each compile export retains a request plus a manifest that names its exact
bytes and capture occurrences. Export is neither import nor browser proof;
the importer separately rechecks context and source hashes. No artifacts are
garbage-collected here, and neither capture nor import grants send authority.

## Recovery verification of a retained export

When recovery needs to check a compile result before an optional explicit
import, use only the selected store's private manifest file:

`python -B -m scripts.prospecting.capture_import_cli --store PATH --verify-export FILE`

`FILE` must be the exact unlinked
`snapshots/capture-imports/man_<opaque>.body` path returned by the compile
response. Do not pass manifest fields, request contents, source URLs, or other
private values as arguments. A successful envelope contains only `status`
(`verified`), `kind`, `request_id`, `capture_count`, and `request_sha256`.

This is consistency checking of a retained manifest/request pair against the
selected store's current capture and context records. It is not a
cryptographic manifest signature or annotation-file attestation, browser
proof, import, approval, readiness, send, or qualification decision. The mode
is read-only at the connection level: it opens the existing SQLite file with
`mode=ro`, enables query-only enforcement, performs no domain/schema writes or
migrations, and may use SQLite's normal WAL/SHM coordination files. Use the
separate pipeline import command only when import is explicitly intended.
