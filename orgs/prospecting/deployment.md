# Prospecting P6 deployment

The VM orchestrates approved work. The desktop alone holds the SQLite store and Gmail capability;
the VM never receives recipient data, message content, or credentials.

## Health and monitoring

Use the deployment preflight before promotion to confirm recorded gates, pinned local versions,
desktop Tailscale reachability, one fixed desktop SSH no-op, and a tracked-secret paths-only scan.
The scan passes only when `git grep` exits 1 (no tracked matches); exit 0, or any other scan
error, fails preflight. Malformed probe output and local subprocess failures likewise produce a
failed coded check while the remaining checks continue, so readiness is never reported after a
probe failure.

The current CLI uses local execution with `--ask-file` plus saved sender-profile, mailbox, store,
and create-request bindings, or `--campaign-id` to resume a saved campaign. It also requires the
parser's model-response, prepared-output, and outbox paths for non-dry-run execution. A literal
raw `--ask` is not a supported process argument. SSH execution is explicitly refused with
`ssh_saved_request_resolver_unavailable` before side effects, so no runnable SSH promotion command
or agent/connector parity is claimed.

Monitor campaigner scan and status outputs for counts and typed result codes only. Logs must contain
counts and codes only, never contact data, message content, credentials, or assertion material.

Verify Windows Task Scheduler has the approved task enabled and that the desktop keep-awake setting
is active before a permitted sending window. A restart, wake, retry, or scheduler re-fire must not
create catch-up sends: delivery windows, caps, and deterministic scheduling remain authoritative.

The deployment source still requires a human historical manifest refresh. Live readiness is not
established by this document.

## Rollback

On a warning, bounce threshold, mismatch, Tailscale loss, sleep, or unexpected count, globally
pause sends. Do not catch up after recovery. Restore only a previous immutable release through the
reviewed promotion process, then re-run scan and status. An approval already consumed is never
unconsumed.
