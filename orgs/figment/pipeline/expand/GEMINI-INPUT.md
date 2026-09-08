# Gemini g01 input diagnostic

`gemini_input.py` is Figment-only. It does not call the FYT dashboard adapter and it
does not alter a provider, pod, or ledger implementation. By default it is an offline
plan validator:

```powershell
py -3 orgs/figment/pipeline/expand/gemini_input.py `
  --root C:/Users/danie/kb `
  --manifest _private/figment-gemini-input-YYYYMMDD/request.json
```

It reads no credential and makes no network request unless `--execute` is supplied.

## Fixed diagnostic

The only supported request is one `image/jpeg` source (canonical g01), one candidate,
`gemini-3-pro-image`, `IMAGE` response modality, `2K`, `16:9`, and
`maxOutputTokens: 4096`. It has no tools or grounding fields. The original Gemini model
used to make g01 is not recorded, so this is a comparison diagnostic and never a replay
claim. The manifest prompt must hash to the frozen E01 prompt SHA-256
`b1d305daa9c21f3ee4a0b9cbda9241b5ef5258aed5431058ecb743b411fe54df`.
The client sends g01 as JPEG; it does not transcode it.

The source must be no larger than 8 MiB and 16,777,216 pixels. Returned JPEG or PNG is
kept as returned, capped at 16 MiB and the same pixel ceiling. A narrow wide-2K 16:9
envelope accepts the reviewed plausible rasters `2752×1536` and `2816×1536`, while refusing
4K and material size or aspect drift. This is an output-validation envelope, not a claim that
Google specifies either exact raster. The JSON response is capped at 32 MiB. Only the selected
image's MIME type, dimensions, bytes, SHA-256, model version, and bounded usage counters reach
the receipt. When supplied, the sanitized counters include service tier and
`candidatesTokensDetails` modality/count pairs; no textual part, thought, response blob, key,
or prompt is recorded.

## Manifest and preflight

The root-relative JSON manifest has a canonical `frozen_sha256`, an issued/expiry window
of at most 30 minutes, the g01 SHA-256, the fixed request, fresh output locations, and an
`admission` object. Its `reservation_usd` is exactly **4.60**. This is a conservative
planning reserve, not an invoice claim: it rounds up the read-only `models/gemini-3-pro-image`
metadata's 131,072 input-token limit, 32,768 output-token limit, and a separate 32,768
thinking-token window. Gemini's documentation states that thinking tokens are billed in
addition to output tokens. `maxOutputTokens` limits the request's ordinary output but does
not make the full provider exposure provably lower.

The manifest also binds a private, hash-verified model metadata attestation. The parser
whitelists the top-level observation fields below and the exact nested `model` object; observed
context fields may remain alongside them. The nested model shape is:

```json
{
  "schema": "figment/provider-metadata-observation@1",
  "http_status": 200,
  "endpoint": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image",
  "model": {
    "name": "models/gemini-3-pro-image",
    "version": "3.0",
    "inputTokenLimit": 131072,
    "outputTokenLimit": 32768,
    "supportedGenerationMethods": ["generateContent", "countTokens", "batchGenerateContent"]
  }
}
```

Before `--execute`, the CLI uses the existing RunPod runner's read-only daily and arc
ledger readers. It requires exactly one existing row in today's Figment ledger, already
included in those totals:

```text
model	step	usd	request_id	reservation_ref	state
gemini-3-pro-image	gemini-input-diagnostic	4.600000	<request-id>	<reservation-ref>	reserved
```

The row must match the manifest request ID and reservation reference exactly. The CLI does
not write, update, or add the reservation. It verifies that the existing daily and arc
totals still fit their caps with **zero additional cost**, avoiding double-counting a held
reservation.

After all local checks and the ambient-key presence check, the CLI first writes an
exclusive reservation-attempt marker under the trusted local root and then `dispatch.json` in the fresh run directory. The marker is a local control for this one experiment, not a cross-copy or distributed lock,
before its one non-redirecting request. A missing key therefore does not consume the held
reservation. Once either marker exists, it remains if the process is interrupted or the
provider response is ambiguous, and any later invocation refuses rather than retrying. A
returned image and `receipt.json` are atomic writes. Timeout, malformed, oversized, and
non-200 responses create only a sanitized `unconfirmed` receipt and retain the full
reservation; they never trigger a retry or claim actual provider billing.

The loader snapshots the manifest bytes before a request and rechecks same-root containment
before each output write. Those checks support ordinary local operation but assume no hostile
process replaces filesystem objects between checks; they are not a race-free filesystem-security
guarantee.
