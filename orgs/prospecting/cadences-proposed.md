# Prospecting cadence declarations — P6 proposal only

Status: HUMAN GATE. These are planning notes, not executable cadence blocks, and grant no standing
authority. Daniel must review a completed command before adding a cadence to HEARTBEAT.md on
protected main. Every send remains separately WebAuthn-approved.

The local CLI binds a saved sender profile, mailbox, store, and create request when starting from an
ask file. A resumed campaign uses `--campaign-id` instead. The parser does not accept a literal raw
`--ask`; no SSH workflow is runnable because the saved-request resolver is unavailable.

## outreach-sweep
- id: outreach-sweep
- schedule: "30 7 * * 1-5"
- timezone: America/New_York
- owner: prospecting-campaigner
- local start: `py -3 -m scripts.prospecting.run_workflow --workflow enroll-only --local --ask-file <path> --store <path> --create-request <request-id> --sender-profile-id <sender-profile-id> --mailbox-id <mailbox-id> --model-response-file <path> --prepared-output-file <path> --outbox <path>`
- local resume: use `--campaign-id <campaign-id>` with the saved `--store`, model-response, prepared-output, and outbox paths; omit ask-file and create-only bindings
- bridge: SSH is refused with `ssh_saved_request_resolver_unavailable` before side effects; no SSH workflow is advertised.
- writes: delivery,exec_request,audit
- gmail: drafts,sends,approved-labels
- result: counts,opaque-ids,hashes,failure-codes
- refire: same-minute re-fire is idempotent; no catch-up burst
- gate: each gmail_send requires an unconsumed exact T1 WebAuthn approval

## reply-scan
- id: reply-scan
- schedule: "0 9-18 * * 1-5"
- timezone: America/New_York
- owner: prospecting-campaigner
- local start: use the same saved ask-file, sender-profile, mailbox, store, request, model-response, prepared-output, and outbox bindings with `--workflow reply-triage --local`
- local resume: use `--workflow reply-triage --local --campaign-id <campaign-id>` with the saved store and required output paths
- bridge: SSH is refused with `ssh_saved_request_resolver_unavailable` before side effects; no SSH workflow is advertised.
- writes: exec_request,enrollment,inbound,inbound_claim
- gmail: labels,drafts
- result: counts,opaque-ids,hashes,failure-codes
- refire: duplicate Gmail IDs and completed cursor positions are no-ops
- gate: no reply send is enabled in P6
