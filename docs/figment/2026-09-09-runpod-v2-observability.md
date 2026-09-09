# RunPod v2 pod observability note — 2026-09-09

RunPod's current API v2 exposes two authenticated, read-only Pod endpoints that
were absent from the v1 OpenAPI surface checked earlier:

- [`GET https://api.runpod.io/v2/pods/{id}`](https://docs.runpod.io/api-reference-v2/pods/get-a-pod)
  returns lifecycle status, connection details, current hourly cost, and live
  runtime metrics. The documented v2 states distinguish `PROVISIONING`,
  `STARTING`, healthy-container `RUNNING`, `EXITED`, `ERROR`, and `TERMINATED`.
- [`GET https://api.runpod.io/v2/pods/{id}/logs`](https://docs.runpod.io/api-reference-v2/pods/stream-pod-logs)
  streams Server-Sent Events. `source=system` selects host lifecycle/user logs;
  `source=container` selects container stdout/stderr. `tail` supports 0–5000
  historical lines and `since` accepts an RFC 3339 cursor. Each event carries
  `source`, `line`, and `ts`; `Last-Event-ID` supports resumption.

Both use the standard scoped bearer authorization described by the official
pages. The earlier conclusion that RunPod had no documented REST Pod-log route
was based only on the v1 OpenAPI and was therefore incomplete. Future provider
source reviews must check the current API version before treating an endpoint's
absence from an older schema as absence from the provider API.

## Qwen v1 evidence

Fresh read-only v2 requests against the same owned Pod returned HTTP 200 for
both status and logs. The preserved snapshots are:

- `C:/Users/danie/kb/_private/figment-qwen-reference-v1-provider-diagnostic-20260909.json`
- `C:/Users/danie/kb/_private/figment-qwen-reference-v1-container-diagnostic-20260909.json`

The system stream records the container image pull completing at 16:21:00 UTC,
container creation at 16:21:01, and container start beginning at 16:21:03. The
container stream then records successful Python, Git, curl, GPU, PyTorch CUDA,
and DNS checks; the pinned Comfy checkout completed at 16:22:27; and the Comfy
import smoke check completed at 16:22:31. Model 1 completed its first download
attempt successfully at 16:38:27, about 15 minutes 56 seconds after the import
smoke check. This establishes that the prolonged proxy 502 period was concurrent
with a slow model download after a successful container and bootstrap start. It
was not evidence of an image-pull or early bootstrap failure.

The bounded container-log snapshot ended with a client-side `ConnectionError`
after receiving HTTP 200 events. Because the documented endpoint is a continuing
SSE stream, that bounded idle/read timeout describes how the diagnostic capture
ended; it is not a Pod or bootstrap failure signal.

This note makes no claim about final images, final receipt, teardown, or cost.

## Small future integration

After the active harness run is complete, a later reviewed change may add an
optional read-only diagnostic command that snapshots v2 Pod status and bounded
`system`/`container` log tails. It should preserve the existing pinned harness
and live lifecycle logic, redact authorization material, set explicit connection
and idle limits for the SSE stream, and label a client timeout as snapshot end
rather than remote failure. No harness migration or live-control behavior is
needed for this evidence path.
