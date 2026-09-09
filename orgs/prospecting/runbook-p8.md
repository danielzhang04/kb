# P8 affinity runbook

The affinity entry point is desktop-local and counts-only. Run it as
`py -3 -m scripts.prospecting.affinity`; do not put ask text, names, URLs, or
source material on the command line. The store location owns the permitted
directory for both ask and response files.

The current workflow CLI accepts `--ask-file` when creating a campaign, together with the saved
sender-profile, mailbox, store, create-request, model-response, prepared-output, and outbox bindings
required by its parser. A saved campaign is resumed with `--campaign-id` and its saved store and
required output paths. There is no literal raw `--ask` process argument. SSH is refused with
`ssh_saved_request_resolver_unavailable` before side effects; no SSH workflow or agent/connector
parity is advertised.

## Local review app access

Start the dedicated loopback review app with an explicit local store:

```text
py -3 -m scripts.prospecting.review_app --store <desktop-local-store.sqlite> --port 8765
```

The server prints `http://127.0.0.1:8765/` (using the chosen port). Open it in the browser
within 60 seconds; the first visit redirects to the one-use `/bootstrap` route and creates
the browser session. No token is printed or required in the URL. Later visits to the same
root link use that session, which lasts 8 hours. The app binds to loopback and
serves a bundled static interface; it does not alter the main KB dashboard or VM production.

For acceptance, first select a copy of the desktop-local store. Use that copy while historical
gates and visual acceptance remain pending. The selected store is paired only with its sibling
`sender-anchors.json`; there is no ambient fallback to another store or anchor file. Keep all
local data in the permitted desktop-local boundary and do not place credentials, PII, ask text,
names, URLs, or source material in commands, logs, Git, or VM jobs.

The currently implemented review mutations are campaign creation and deterministic first-draft
preparation at step 0, subject to the approved fit, current contact, and available evidence.
Users can create a human edit, submit feedback, and mark a draft editorially ready. Schedule and
Activity are projections only. The app does not self-send, graduate approval, or claim an agent
launch. Drafting QA checks only saved bindings; it does not verify every human claim.

Development Codex workers receive explicitly selected source files on the VM. Desktop data,
skills and connectors are not automatically available to them. The primary ask remains a 10–20 minute informational call.

| Verb | Preconditions | Writes | Prints |
| --- | --- | --- | --- |
| `ask compile --campaign camp_<16hex> --ask-file <path> [--response-file <path>]` | Draft campaign, no existing execution request; each file is directly beside the local store | A desktop-local model job, or a proposed fit specification | Campaign id, state, fit hash when available, and fit-table counts/codes |
| `ask approve --campaign camp_<16hex> --fit-hash <64hex>` | Draft unexecuted campaign and matching proposed fit spec | Approved fit-spec state, the two policy additions, and the approved two-touch cadence | Campaign id, fit hash, cadence step count, and whether the policy hash stayed unchanged |
| `research run --campaign camp_<16hex> [--max-linkedin N] [--max-bio-pages N]` | Existing campaign and desktop-local sender anchors | Snapshot requests and research-state/background facts | Candidate, fetch, LinkedIn, researched, and unresearchable counts |
| `score --campaign camp_<16hex>` | Approved fit spec and desktop-local sender anchors | `person_affinity` rows | Scored, rewritten, above-threshold, and zero-score counts |
| `fill-fit --campaign camp_<16hex> --target-per-firm N [--slack N] [--min-fit N]` | Approved fit spec and desktop-local sender anchors | P6 fill rows plus fit-ordered discovery/research/search work | P6 counts plus fit/research counts |
| `draft --campaign camp_<16hex> --step N` | Approved fit spec, sender anchors, and P8 evidence facts | P3-validated revision rows | Candidate, created, out-of-band, and QA-failed counts |
| `list --fit --campaign camp_<16hex>` | Existing campaign | Nothing | Score-band and reason-code counts only |

All refusals use a fixed code. Paths, exception text, ask content,
and source values are never printed. `ask compile` and `ask approve` fail closed with
`fit_spec_locked` once the campaign is not a draft or its policy has an execution request.

## Recorded upstream boundaries

The default saved cadence has two touches. The scheduler accepts one or two ordered entries and
maps their one-based steps to SQLite steps 0 and 1, and computes due dates from the saved offsets while observing the
same US federal-holiday policy across every year needed by the cadence. Each step has an independent
revision hash and independently scoped evidence.

Dry-run compiles against a read-only source SQLite connection and writes plan cards/artifacts to the
selected outbox. It does not migrate or mutate the source database. A non-dry-run local execution
uses the parser's saved bindings and remains subject to the existing human gates.

`deploy_preflight.check` hardcodes the phase tuple `P1` through `P5`; it has no registration seam
for P8. P8 therefore does not claim deployment preflight registration. A human must account for the
P8 gate separately.

If an inspector is unavailable, the manager parks the work with the fixed unavailable outcome. It
does not fabricate an independent inspector grade or treat an unavailable inspector as a pass.

The main source still requires a human historical manifest refresh, and live readiness is not
established here.
