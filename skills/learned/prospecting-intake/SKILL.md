---
name: prospecting-intake
description: Turn a natural-language prospecting brief into a private typed intake, then import operator-captured public funding evidence for provisional factcheck. Use for starting, safely retrying, or inspecting this local prospecting pipeline; this draft does not qualify people or perform outreach.
---

# Prospecting intake and funding capture

Convert the user's brief into one `PipelineStartRequest` JSON object and submit it through the repository's existing `PipelineService` CLI boundary. Keep the brief, outreach goal, names, and other private text out of arguments, stdout, logs, and tracked files.

Use only facts and constraints the user actually supplied. Keep preferences as preferences in `original_specification`; do not silently turn them into hard filters. Represent a missing geography or sector as `{"mode":"unknown","values":[]}`. Use `any` only when the user explicitly accepts any value, and use `specific` with a nonempty list for explicit constraints. Ask one focused question when a required campaign ID or choice must be resolved.

Preserve the user's original brief in `original_specification` and their stated outreach purpose in `outreach_goal`. Do not invent sender history, qualifications, metrics, relationships, recipient roles, job interest, approval, or message claims. Sender claims may appear only when they come from the approved sender profile or the user's supplied brief.

Pin `as_of_date` to the user's stated date or the current local date. Interpret every other field from the brief rather than relying on a past campaign: funding minimum and maximum, window in years, `latest_known` versus `any_eligible_within_window`, geography, sector, requested company count, people per company, and role-family slugs. Preserve ambiguity as private context and `unknown` scope where the schema supports it.

Create a canonical lowercase UUID once for `request_id` and retain it with the saved intake for exact retries. A changed intake needs a new UUID. Write compact UTF-8 JSON containing exactly these fields:

`request_id`, `campaign_id`, `as_of_date`, `funding_stage_min`, `funding_stage_max`, `funding_window_years`, `funding_stage_interpretation`, `geography`, `sector`, `requested_companies`, `requested_people_per_company`, `role_families`, `original_specification`, `outreach_goal`.

Save it beneath the selected existing `.sqlite` store's own `snapshots/` directory, including a nested directory when useful. Invoke only this adapter, with no private content in the command itself:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --input <selected-store-parent>/snapshots/<intake.json>
```

Read the aggregate JSON projection. Report honestly that the intake was saved in `input_pending` or `awaiting_research_adapter`. Stop for unresolved required fields when it is `input_pending`. The saved intake alone contains no researched or qualified prospects and no messages.

When the intake is complete, public funding research may be captured through the operator's approved browser workflow. Save exact page bodies beneath the selected store's `snapshots/` directory. Prefer issuer or participating-investor announcements for a funding event; an independent report can supplement them. Search snippets alone do not establish a funding fact. Do not assume that paid enrichment credits, credentials, or providers are available.

Create one funding-import manifest beneath the same `snapshots/` directory. Use a retained canonical UUID for `request_id`; use the intake projection's opaque `run_id` and `intake_hash`; and use null predecessor fields for the first batch. Later complete replacement batches must use the preceding safe projection's exact batch ID and hash. Each candidate contains only `name`, nullable `website_url`, nullable `location`, nullable `sector`, `pages`, and `events`. Each page contains `body_ref`, `source_url`, `source_kind`, `captured_at`, and optionally `coverage`. A coverage object contains only `query`, `searched_at`, `status`, `result_count`, and `result_cap`. Each event contains only `page_ordinal`, `stage`, `announced_at`, and an exact `excerpt` present in that captured page. Do not put page bodies, classifications, reviewer decisions, provider commands, or caller-created IDs and hashes in the manifest.

For `latest_known`, document a bounded current search or news-index review as of the intake date. Save the queries, coverage status, date, result count and cap, plus evidence of any known newer round. This means the latest public round found within that documented search, not a guarantee that no newer round exists. With no valid coverage, preserve the result as unknown. Treat geography and sector as unknown until sourced when the intake did not constrain them.

Import or safely replay the manifest with:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --funding-import <selected-store-parent>/snapshots/<funding-manifest.json>
```

Inspect the latest aggregate projection without reading private evidence into output:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --funding-project <opaque-run-id>
```

Report only the returned opaque IDs, hashes, state, and counts. `awaiting_qualification_factcheck` means the deterministic import found provisional matches that still need factual review. It does not mean that a company is qualified. Company qualification, two-person ranking, role verification, personalized drafting, humanization, criticism, human approval, and sending remain later gated work.

This learned skill is a sandboxed draft until separately reviewed and promoted.
