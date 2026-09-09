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

P12 does not replace that refused `run_workflow` path. It is a separate, desktop-pulled control
protocol for two bounded operations: counts-only `status` and local `queue_due`. A grant binds one
campaign, its current policy hash, approval tier T0, one operation and an expiry. Grant creation is
an explicit local action and starts disabled; campaign creation/import never activates it. The local
user must activate that exact grant before a request can produce an effect.

The VM spool contains opaque references, hashes, timestamps, operation names and counts only. The
desktop controller pulls a matching request and commits authority checks, `queue_due` effects and
the terminal local receipt in one SQLite transaction. A lost acknowledgement can replay the same
terminal receipt without repeating the local effect. The spool lives only under an owned lease; it
is not a public service or a persistent VM deployment. If the desktop is asleep, disconnected or
closed, the VM cannot access desktop data or perform the operation and can retain the request only
until that lease expires. `queue_due` can create only the existing T0 `gmail_draft` execution
requests; P12 does not call Gmail or send. It has no inbound operation, model call, general command
or tool/connector parity. The first isolated synthetic status-only proof used the shipped
`run_once`, recovered a simulated lost acknowledgement, collected an identical result hash, and
verified exact root/unit absence after cleanup. It did not test a physical laptop close or execute a
live campaign operation, so it does not establish a live control channel.

The companion's read-only status labels remote acknowledgement as unverified, even when a terminal
local result exists, because that view does not contact the VM. Only the response from an explicit
process action may report confirmed acknowledgement. An exact same-request retry uses the validated
stored result and, when necessary, reclaims only that matching expired claim to complete delivery;
it does not run the desktop operation again. A later read-only refresh returns to unverified rather
than inferring remote state.

The Activity control panel displays `No control request configured` unless the server receives a
trusted preconstructed adapter. When configured, it can inspect and explicitly process one exact
request binding. Its POST body contains only the campaign ID and configured request ID. It cannot
accept transport settings, create or activate a grant, run a background loop or send a message.

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

The audited local source-import backend accepts a source only for the selected campaign and person.
It requires an HTTPS source URL and a local response body no larger than 2 MiB, then creates an
unconfirmed candidate through the existing owned importer. A separate explicit human action must
attest that candidate as the current-company source before it can support drafting. Import does not
fetch the URL, accept a filesystem path or auto-attest a source. Exact retries are idempotent. Keep
the source body inside the desktop-local boundary and never copy it to a VM.

In People, enter the HTTPS source URL, choose the saved local HTML or text file, and select
`Add source for review`. After the candidate excerpt appears, check the sentence confirming the
person, role and company, then select `Confirm current role source`. Return to Campaign and select
`Prepare first drafts`. These are separate actions; uploading a page does not confirm it.

A feedback request can be fulfilled manually only after saving an edit against the current
revision. The edit must pass the real stored-context QA path and create immutable revision lineage;
a separate explicit local action then binds fulfillment to that result. Saving the edit alone does
not fulfill feedback. A new revision does not inherit editorial readiness or send approval. There
is no automated feedback rewriter; unavailable QA context remains pending/blocked rather than
creating a synthetic passing revision.

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

Manager recovery uses bound child-resource checkpoints and resumes the same saved work. If an
inspector is unavailable, the manager parks the work with the fixed unavailable outcome. It does
not fabricate an independent inspector grade, bless an eval or treat an unavailable inspector as a
pass.

Before calling the resumed implementation ready, complete this operator checklist. The reviewed
synthetic P12 status lifecycle, lost-ack recovery, hash collection and exact cleanup are already
recorded; the remaining work is:

- Perform visual and keyboard acceptance of the integrated source-upload and control-panel UI in an
  available browser.
- Import and review real desktop-local evidence, prepare actual local drafts, and inspect each
  source link and blocked reason without moving data to Git, logs or a VM.
- Keep live mining, provider calls, Gmail sending and T0-to-T1 graduation disabled until their
  existing explicit human approvals and release gates are satisfied.
- Refresh any human-owned historical manifest through its established human gate; source tests do
  not bless it.

Live readiness is not established here.
