# Figment input and authentication repairs: local operator use

This note covers local technical interfaces accepted on 2026-09-12:
the Research brief revision form and governed route, bounded content-brief
revision, its read-only final-path projection, and the experimental training
executor's default authenticated live branch. That
acceptance covers the local contracts and regression suites named below. It
does not assess creator quality and does not approve a paid or live provider
operation.

## Revise from Studio Research

Open **Research**, select a recorded `creator-001` item under **Base brief**,
then enter the revision date, slug, hypothesis and intended metric. The date
and slug determine a fresh revision ID. Select **Create local planning revision**
once. This changes local planning text and preserves the original brief; it
generates no media and records no observed audience outcome.

A confirmed result displays the new brief ID. Select **Refresh recorded briefs**
to request the current inventory through the Workspace's existing GET. A
successful POST does not refresh automatically. Mounting the form, navigating
tabs or retrying the inventory does not submit a revision.

If the request ends without a trustworthy result, the form retains uncertainty
and removes the repeat-submit control. Abort or a lost response does not prove
rollback. Inspect the local retained allocation/recovery evidence and the exact
final pair, then revalidate through the current authority before treating it as
current. Do not delete allocations by pattern or automatically repeat the POST:
the server retains uncertain allocation state across registrar restart. A
refresh can update recorded inventory but does not itself establish current
source proof. Fixed input or session refusals should be addressed before a new
explicit attempt; no automatic retry occurs.

The governed route retains Studio authentication, origin, write-rate,
admission and preamble checks and awaits its required audit. The browser sends
only the five bounded fields; filesystem paths and commands remain server-owned.
See [Research composition acceptance](2026-09-12-brief-workspace-review.md)
for the actual synthetic browser check and its limits.

## Revise a content brief through the local API or CLI

Use `revise_content_brief(root, base_dir, edits_path, out_dir)` only with
string, root-relative paths. `base_dir` identifies an existing
`content/briefs/<normalized-id>` directory whose record belongs to
`creator-001`, and `out_dir` identifies a fresh
root-relative directory. Do not pass `Path` objects for the three path
arguments: pass strings such as `"content/briefs/example-revision"`.

The edits file must be a JSON object with exactly these three fields and no
others:

```json
{
  "brief_date": "2026-09-12",
  "hypothesis": "Placeholder local revision hypothesis.",
  "intended_metric": "Placeholder local metric."
}
```

For example, these are safe placeholder-local paths, not production commands:

```python
from pathlib import Path
from orgs.figment.pipeline.content.content_brief import revise_content_brief

publication = revise_content_brief(
    Path(r"C:\local\figment-sandbox"),
    "content/briefs/base-brief",
    "local-revision-edits.json",
    "content/briefs/revised-brief",
)
```

The equivalent revision CLI flags are mutually exclusive with the legacy
`--request` and `--out` flags:

```text
python -m orgs.figment.pipeline.content.content_brief --root C:\local\figment-sandbox --revise-base content/briefs/base-brief --edits local-revision-edits.json --out-dir content/briefs/revised-brief
```

The original base `request.json` and `brief.json` remain byte-for-byte
unchanged. A successful output is a new directory containing exactly
`request.json` and `brief.json`.

This publication model is CPython on Windows only. The root must be local and
non-UNC, staging is a sibling of the final directory, and the final directory
must remain fresh until the exclusive rename. It assumes cooperative writers;
it does not promise power-loss durability.

The returned descriptor is a publication record, not proof that the final
paths have been reread. Its publication section deliberately contains
`"final_paths_revalidated": false`. A consumer that needs final-path proof
must perform the separate validation itself, for example:

```python
from pathlib import Path
from orgs.figment.pipeline.content.content_brief import revalidate_content_brief

proof = revalidate_content_brief(
    Path(r"C:\local\figment-sandbox"),
    "content/briefs/revised-brief/request.json",
    "content/briefs/revised-brief/brief.json",
)
```

Treat a raised `ContentBriefError` as an uncommitted revision: this invocation
publishes no final pair, while a pre-existing or competing final target remains
untouched. The implementation attempts cleanup only for staging it can
positively identify as its own. If identity or cleanup is uncertain, a staging
remainder can be left for an operator to inspect locally; do not treat it as a
publication or delete it by pattern.

## Read a current content-brief proof

`content_brief_read.py` is a separate read-only CLI adapter for the existing
sole `revalidate_content_brief` authority. It does not build, revise, or write
any record, and `content_brief.py` remains unchanged. Use root-relative string
paths for the already-published pair:

```text
python -B -m orgs.figment.pipeline.content.content_brief_read --root C:\local\figment-sandbox --request content/briefs/revised-brief/request.json --brief content/briefs/revised-brief/brief.json
```

A successful call writes exactly this bounded JSON shape to stdout:

```json
{
  "schema": "figment/content-brief-revalidation@1",
  "request_sha256": "<64 lowercase hex characters>",
  "brief_sha256": "<64 lowercase hex characters>"
}
```

Argument, validation, and malformed-projection refusals return exit code `2`,
write no stdout, and write only this fixed stderr line:

```text
content brief revalidation refused
```

Treat output as a result only after exit code `0` and strict decoding of the
exact DTO above. An ordinary stream write or flush failure is unsuccessful even
if it leaves partial stdout.

The direct-script form is also supported when the adapter remains beside its
`content_brief.py` authority. It sets bytecode suppression before loading that
authority, so it can be called without `-B`. Keep `-B` for package invocation:
package imports can occur before the adapter body gets a chance to suppress
bytecode.

The initial adapter acceptance passed 12 scoped local tests, including the real
producer-to-adapter path and direct-script bytecode behavior with synthetic
canonical-reference bytes. That result is historical: it used text-mode
subprocess capture, which normalized Windows newlines and did not exercise the
reader's exact stdout bytes.

The accepted binary-stdout repair is commit `734f1a80`. The reader now writes
its explicit UTF-8 JSON bytes through binary stdout, avoiding Windows CRLF
translation. Its fresh independent suite passed 14/14 with native exit `0`,
including direct-CLI raw-byte and write/flush refusal cases. See the
[brief revision real-process join acceptance](2026-09-12-brief-real-join-review.md).

The real brief join then passed 2/2 cases with native exit `0` in v3. Over
synthetic temporary repositories, it exercised the actual builder, collector,
revision route, final validator, and contained Windows runner. It proved one
successful local planning revision and conservative retained recovery after a
stale-input refusal, including refusal after a fresh registrar restart. It did
not use a provider, network, real media, account, or paid action. This remains
a local validator/publication path. Governed surface wiring is accepted at
`a3ab95ef` with 83/83 guard/audit tests and a passing typecheck. The isolated
form and decoder are accepted at `8218350f` with 47 form and 16 decoder cases
across separate runs. Research composition then passed 41/41 tests, typecheck
and build, followed by four root-viewed synthetic desktop states. These checks
are distinct from the real process join; they do not imply live browser/backend
authentication or publication was exercised end to end.

## Experimental executor modes and default authentication

Prepared-plan recorded status is accepted locally. In **Frozen plans**, choose
**Refresh status** to display execution metadata alongside each stored plan.
A missing stage means attempt history is unknown. Recorded running has unknown
current liveness; recorded completion does not assess media quality. A maintenance
state retains a safe summary and recorded status while disabling new preparation.
Unsafe metadata makes discovery unavailable. Preparation still validates current
checkpoint/source authority when it runs; a readable stored plan is not that proof.

GET uses exact `figment/studio-gen-plans@2`; preparation POST remains @1 with
existing intent/replay behavior. Navigation and refresh do not POST, and no
execution button was added. Preserve a pending preparation key after an uncertain
response; use the existing explicit resume flow rather than creating another intent.
The [accepted status-wiring review](2026-09-12-gen-status-wiring-review.md) records
268 passing cases across six suites, including both real planner integration files,
typecheck/build and four root-viewed synthetic browser states. A full live
browser/backend execution and assignment journey remains open.

New preparations now allocate beneath the Figment content-authority root. Existing
legacy plans remain visible and retain their original pending-intent replay; keep
them in place rather than copying or re-signing them. The real content-binding
producer accepted a newly prepared plan and rejected a separately produced legacy
outside-root plan in the [Stage A allocation review](2026-09-12-studio-allocation-review.md).
That evidence uses synthetic media and real authority/binding checks. It does not
add assignment display, navigation or execution to Studio; those remain separate work.

The executor has three separate modes:

```text
python -m orgs.figment.pipeline.train.experimental_execute --plan <local-plan> --out <fresh-local-out>
python -m orgs.figment.pipeline.train.experimental_execute --plan <local-plan> --out <fresh-local-out> --dry-run
python -m orgs.figment.pipeline.train.experimental_execute --plan <local-plan> --out <fresh-local-out> --execute
```

The default prepare mode and `--dry-run` do not construct the default
authenticated session. An injected runner also remains on its established
injected path. The existing ambient-authentication factory is used only for a
live default `--execute` call; this document supplies no credential setup or
secret values.

`--execute` is an explicit, separately admitted live attempt. It must still
satisfy the existing plan revalidation, admission, daily-budget and arc-budget
checks, accounting snapshot requirements, and dispatch-marker requirements.
It is not an instruction to run a paid operation automatically. Obtain the
required project approval before any real live attempt.

For an admitted default live call, the executor builds the existing
authenticated session and redactor, installs the runner module's terminal
redacting exception hook before fallible API/logger setup, and gives the same
API, logger, and redactor to the harness. A normal completion closes the owned
session exactly once before the `harness-complete` receipt. On failures, the
operational primary exception remains primary over a secondary cleanup failure,
while failure receipt and session cleanup are best effort. A close-only failure
returns the fixed refusal and writes no `harness-complete` receipt. The
receipt/marker sequence still describes the attempt under the existing
admission contract.

## Local evidence and limits

The independent brief suite passed 58 tests on the accepted revision interface.
The current reader suite passed 14/14 with native exit `0`; the earlier 12-test
adapter result is historical for the reason above. The real brief join passed
2/2 with native exit `0` in v3. The independent experimental-auth suite passed
35 tests on the accepted auth interface. These are local technical regression
results. The governed write surface, isolated editor and Research composition
have the additional accepted evidence described above. Together they establish
bounded local mechanics, not a full transitive dependency closure, an actual
creator-quality review, a provider call or paid-operation authorization.
