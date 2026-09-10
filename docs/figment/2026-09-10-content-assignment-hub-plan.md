# Content assignment hub snapshot plan

## Purpose

Expose the presence of a local, offline content-asset assignment beside an
existing compiled content brief. This is a read-only hub projection. It does
not revalidate current gen authority, select an image, approve an asset, create
a batch, publish content, or record performance.

## Fixed input and states

For each existing `orgs/figment/content/briefs/<brief-id>/brief.json`, the
collector may read only the sibling `assignment.json`. A missing sibling emits
`assignment: missing`. A valid, hash-bound assignment emits
`assignment: recorded-snapshot`. A malformed, stale, oversized, deep, linked,
or otherwise unsafe sibling emits `assignment: unavailable` for that brief
without hiding other valid brief planning records.

The collector does not follow the assignment's `brief.path`, asset paths,
source-plan paths, approval paths, or approved-list paths. It binds the snapshot
to the bytes of the sibling brief by comparing the assignment's recorded brief
SHA-256, creator, and every ordered slot index/role/type/kind. Each assignment
slot must have an explicit `fit` attribution and an approved-gen-still-shaped
asset record, but the hub never interprets that shape as current approval.

## Projection and UI boundary

Only `missing`, `recorded-snapshot`, or `unavailable` is returned and rendered.
The response and UI omit all paths, image IDs, byte counts, hashes, prompts,
reviewer identities, timestamps, approval records, and source provenance.
Existing brief fields keep `currentSourceRevalidated: false`; older hub payloads
that predate assignment state remain valid and render as missing.

## Verification

Tests cover missing, recorded, malformed/private-field, stale brief hash, slot
mismatch, size/depth, and reparse assignment inputs; UI tests cover recorded and
old-payload missing state. A separate isolated producer-to-collector probe must
use an actual `content_asset_binding` output before technical acceptance.
