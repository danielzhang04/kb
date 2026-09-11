# Acquisition runbook

This runbook connects the existing desktop-local capture, location, compile,
and import CLIs. It operates on one saved P15 run and its store. It does not
open a browser, fetch a page, approve a draft, make a readiness decision, or
send anything.

Run commands from the repository root. Substitute only the placeholder paths
and opaque IDs below:

```powershell
python -B -m scripts.prospecting.research_capture_cli --store <PRIVATE_STORE_PATH> <MODE> <VALUE>
python -B -m scripts.prospecting.capture_import_cli --store <PRIVATE_STORE_PATH> <MODE> <PRIVATE_FILE_PATH>
python -B -m scripts.prospecting.pipeline_cli --store <PRIVATE_STORE_PATH> <MODE> <PRIVATE_FILE_PATH_OR_RUN_ID>
```

`<PRIVATE_STORE_PATH>`, private file paths, session IDs, task IDs, and other
opaque identifiers may appear as arguments. Keep every query, source URL,
captured body, excerpt, name, role, profile URL, lease token, and annotation
value inside the store's private `snapshots/` files. They never belong in a
command argument, stdout, stderr, logs, Git, cards, or a VM sink. Examples in
this document use only synthetic `.test` values.

## Operating boundary

The supported consumer of claim packets is the existing root Chrome path. Do
not create or use a daemon, relay, raw HTTP client, headless browser, CDP
connection, second browser, or alternate browser transport. Do not widen the
existing generic HTTPS DNS capture authority or create an allowlist. This
runbook provides no substitute path if that browser is unavailable and does
not claim that a live browser capture was tested. A compiled capture proves
hash-verified bytes were accepted by the capture service; it is not proof that
a browser observed the page.

No step here creates approval, readiness, execution, or send rows. A capture,
scope, compiler artifact, or import result is evidence and pipeline state only.

## 1. Start a bounded capture session

Create a private JSON file under the chosen store's `snapshots/` directory.
This synthetic shape is exact:

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "run_id": "prun_0123456789abcdef0123456789abcdef",
  "expected_intake_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "acquisition_skill_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "task_cap": 3
}
```

```powershell
python -B -m scripts.prospecting.research_capture_cli --store <PRIVATE_STORE_PATH> --session-start <PRIVATE_SESSION_JSON>
```

The public result contains fixed-shape opaque identifiers, hashes, state, and
counts. Preserve the returned `session_id`; it binds all later tasks to the
saved run and intake hash.

## 2. Enqueue, claim, and submit through the packet

For each page or search task, write one private enqueue file. It has exactly
these fields:

```json
{
  "request_id": "22222222-2222-4222-8222-222222222222",
  "session_id": "pcs_opaque_session_id",
  "task_kind": "open_https_capture_visible_text",
  "query": null,
  "url": "https://example.test/funding"
}
```

For `search_visible_results`, use its exact task kind, put the private query
in the JSON file, and set `url` to `null`. For an open task, use
`open_https_capture_visible_text`, put the HTTPS DNS URL in the JSON file, and
set `query` to `null`.

```powershell
python -B -m scripts.prospecting.research_capture_cli --store <PRIVATE_STORE_PATH> --enqueue <PRIVATE_ENQUEUE_JSON>
python -B -m scripts.prospecting.research_capture_cli --store <PRIVATE_STORE_PATH> --claim <OPAQUE_SESSION_ID>
```

`--claim` writes an owned private packet below `snapshots/capture-packets/`
and returns its opaque `packet_ref`. Do not hand-copy a task ID or lease token
into a legacy `--submit` request. Capture the visible text through the supported
browser path, write it as a private UTF-8 body file under `snapshots/`, then
use `--submit-packet` with a private wrapper file:

```json
{
  "packet_ref": "capture-packets/pkt_opaque.body",
  "body_ref": "incoming/example-visible-text.txt",
  "source_url": "https://example.test/funding",
  "retrieved_at": "2026-09-10T12:00:00Z"
}
```

```powershell
python -B -m scripts.prospecting.research_capture_cli --store <PRIVATE_STORE_PATH> --submit-packet <PRIVATE_SUBMIT_PACKET_JSON>
```

The receipt's `task_id`, `receipt_id`, `snapshot_id`, and `content_sha256`
are the exact capture reference. Preserve all four receipt fields for the
next private annotation; do not infer identity from URL, time, or hash alone.
The same submit-packet request replays the existing receipt. A lease expires;
a later claim can reclaim the task with a new packet and lease epoch, after
which the earlier packet cannot revive it. Use `--progress <OPAQUE_SESSION_ID>`
to inspect state and attempt counts. Do not claim merely to consume attempts.

The session limit is 32 tasks (or its lower chosen `task_cap`), every task has
at most three attempts, and a lease lasts at most 300 seconds. To close an
already-claimed failed attempt, write a private file with exactly `task_id`,
`lease_token`, and `error_code`, then run:

```powershell
python -B -m scripts.prospecting.research_capture_cli --store <PRIVATE_STORE_PATH> --finish <PRIVATE_FINISH_JSON>
```

`tab_closed`, `navigation_failed`, `challenge`, `no_result`, and
`relay_unavailable` are the only accepted failure codes. If the supported
browser path is unavailable, finish only the attempt already claimed with
`relay_unavailable` and stop. Never claim to burn capacity, enqueue a duplicate
packet, or mint a fresh request ID to reset an attempt budget. For an open
task, `source_url` must exactly match the packet URL; a redirect must be
finished as `navigation_failed`, then its landing URL may be enqueued as a
separate task if the cap allows. Recheck a receipt with:

```powershell
python -B -m scripts.prospecting.research_capture_cli --store <PRIVATE_STORE_PATH> --verify <OPAQUE_TASK_ID>
```

## 3. Locate Unicode spans when authoring annotations

`--locate` finds every literal occurrence in one exact verified capture. Its
private request has this exact shape:

```json
{
  "session_id": "pcs_opaque_session_id",
  "run_id": "prun_0123456789abcdef0123456789abcdef",
  "expected_intake_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "capture": {
    "task_id": "pct_opaque_task_id",
    "expected_receipt_id": "pcr_opaque_receipt_id",
    "expected_content_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  },
  "needles": ["Example Systems", "Series B"]
}
```

```powershell
python -B -m scripts.prospecting.capture_import_cli --store <PRIVATE_STORE_PATH> --locate <PRIVATE_LOCATE_JSON>
```

The private locate artifact reports half-open Unicode codepoint offsets for
all literal matches. It does not choose among multiple matches. Resolve any
ambiguity in the private annotation before compiling. The CLI enforces its
needle and total-match caps; it refuses over-wide results rather than silently
truncating them. The opaque IDs and offsets in this synthetic example are not
input values to copy: substitute the selected store's exact receipt fields and
the exact located spans.

## 4. Compile funding captures

The compiler accepts exact receipt references and private annotations, then
writes an ordinary P17 request plus a paired provenance manifest. A minimal
synthetic funding annotation is:

```json
{
  "request_id": "33333333-3333-4333-8333-333333333333",
  "session_id": "pcs_opaque_session_id",
  "run_id": "prun_0123456789abcdef0123456789abcdef",
  "expected_intake_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "predecessor_batch_id": null,
  "predecessor_hash": null,
  "companies": [{
    "name": "Example Systems",
    "website_url": "https://example.test/",
    "location": "United States",
    "sector": "software",
    "pages": [{
      "capture": {"task_id": "pct_opaque_task_id", "expected_receipt_id": "pcr_opaque_receipt_id", "expected_content_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
      "source_kind": "issuer",
      "coverage": null
    }],
    "events": [{"page_ordinal": 0, "stage": "series_b", "announced_at": "2025-05-01", "excerpt": {"start": 0, "end": 47}}]
  }]
}
```

The sample `47` is illustrative only. Replace it with the exact
Unicode-codepoint span from `--locate` for the selected receipt.

```powershell
python -B -m scripts.prospecting.capture_import_cli --store <PRIVATE_STORE_PATH> --compile-funding <PRIVATE_FUNDING_ANNOTATION_JSON>
```

The public response gives opaque `request_ref` and `manifest_ref`, their
SHA-256 digests, and counts. The request and manifest are a pair: the manifest
names the exact request reference, byte length, byte hash, and every
task/receipt/snapshot/content-hash occurrence. They are retained under
`snapshots/capture-imports/`; do not garbage-collect them. Export is neither
an import nor browser proof.

## 4a. Verify a retained export pair before an optional import

Use the private manifest file produced by the matching compile call. `FILE`
must be that selected store's own unlinked
`snapshots/capture-imports/man_<opaque>.body` file; do not reconstruct a
manifest from its fields or pass request bytes as arguments.

```powershell
python -B -m scripts.prospecting.capture_import_cli --store <PRIVATE_STORE_PATH> --verify-export <PRIVATE_MANIFEST_FILE>
```

On success the public envelope has only metadata:

```json
{"capture_count":2,"kind":"funding","request_id":"33333333-3333-4333-8333-333333333333","request_sha256":"<64-lowercase-hex>","status":"verified"}
```

Verification checks the retained manifest/request pair against the selected
store's currently retained capture records and current pipeline context. It is
an integrity-consistency check only: it does not attest browser observation,
cryptographically sign the manifest, hash the original annotation file, import
the request, create approval/readiness/send authority, or make a qualification
decision. The verifier opens the existing SQLite file in read-only mode, enables
connection-level query-only enforcement, performs no domain/schema writes or
migrations, and may use SQLite's normal WAL/SHM coordination files. Import remains the separate explicit
command below.

Import only by a separate, explicit call:

```powershell
python -B -m scripts.prospecting.pipeline_cli --store <PRIVATE_STORE_PATH> --funding-import <PRIVATE_EXPORTED_REQUEST_PATH>
```

The importer rechecks run and intake context and the content hashes of the
referenced source bytes. Replaying the identical request bytes returns the
same funding batch with `replayed: true`; do not alter a retained request to
make a replay look new.

## 5. Select scope, compile people, and explicitly import

After the funding import, obtain the current eligible scope before authoring
people. It returns opaque funding result and company IDs only:

```powershell
python -B -m scripts.prospecting.pipeline_cli --store <PRIVATE_STORE_PATH> --person-scope <OPAQUE_RUN_ID>
```

Use the returned funding batch ID/hash and selected result/company IDs in the
private people annotation. Its exact top-level shape is:

```json
{
  "request_id": "44444444-4444-4444-8444-444444444444",
  "session_id": "pcs_opaque_session_id",
  "run_id": "prun_0123456789abcdef0123456789abcdef",
  "expected_intake_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "funding_batch_id": "pfb_opaque_batch_id",
  "funding_batch_hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "predecessor_batch_id": null,
  "predecessor_hash": null,
  "research_result_ids": ["pfr_opaque_result_id"],
  "people": [{
    "capture": {"task_id": "pct_opaque_task_id", "expected_receipt_id": "pcr_opaque_receipt_id", "expected_content_sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"},
    "funding_result_id": "pfr_opaque_result_id",
    "company_id": "cmp_opaque_company_id",
    "first_name": "Avery",
    "full_name": {"start": 0, "end": 11},
    "title": {"start": 15, "end": 33},
    "profile_url": "https://profile.example.test/avery"
  }]
}
```

`first_name`, spans, and profile URL remain in that private file. Compile and
import with distinct calls:

```powershell
python -B -m scripts.prospecting.capture_import_cli --store <PRIVATE_STORE_PATH> --compile-people <PRIVATE_PEOPLE_ANNOTATION_JSON>
python -B -m scripts.prospecting.pipeline_cli --store <PRIVATE_STORE_PATH> --person-import <PRIVATE_EXPORTED_REQUEST_PATH>
```

As with funding, compiler output is a retained request/manifest pair and the
people importer rechecks the funding batch context, selected scope, and source
hashes. Replaying unchanged request bytes is an idempotent replay, not a new
research decision. Qualification is a separate workflow and is outside this
runbook.
