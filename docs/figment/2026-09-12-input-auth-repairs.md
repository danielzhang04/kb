# Figment input and authentication repairs: local operator use

This note covers two local technical interfaces accepted on 2026-09-12:
bounded content-brief revision and the experimental training executor's
default authenticated live branch. That acceptance covers the local contracts
and regression suites named below. It does not assess creator quality and does
not approve a paid or live provider operation.

## Revise a content brief

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

## Experimental executor modes and default authentication

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
The independent experimental-auth suite passed 35 tests on the accepted auth
interface. These are local technical regression results, not a full transitive
dependency closure, an actual creator-quality review, a provider call, or a
paid-operation authorization.
