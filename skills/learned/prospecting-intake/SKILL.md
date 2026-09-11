---
name: prospecting-intake
description: Turn a natural-language prospecting brief into a private typed intake, import operator-captured evidence, run source-bound qualification, and order supported roles. Use for starting, safely retrying, or inspecting this local prospecting pipeline; this draft does not perform outreach.
---

# Prospecting intake and evidence capture

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

Create one funding-import manifest beneath the same `snapshots/` directory. Use a retained canonical UUID for `request_id`; use the intake projection's opaque `run_id` and `intake_hash`; and use null predecessor fields for the first batch. Later complete replacement batches must use the preceding safe projection's exact batch ID and hash. Each candidate contains only `name`, nullable `website_url`, nullable `location`, nullable `sector`, `pages`, and `events`. Each page contains `body_ref`, `source_url`, `source_kind`, `captured_at`, and optionally `coverage`; `source_kind` must be exactly `issuer`, `participating_investor`, `independent_report`, or `search_coverage`. A coverage object contains only `query`, `searched_at`, `status`, `result_count`, and `result_cap`. Each event contains only `page_ordinal`, `stage`, `announced_at`, and an exact `excerpt` present in that captured page. Do not put page bodies, classifications, reviewer decisions, provider commands, or caller-created IDs and hashes in the manifest.

For `latest_known`, document a bounded current search or news-index review as of the intake date. Save the queries, coverage status, date, result count and cap, plus evidence of any known newer round. This means the latest public round found within that documented search, not a guarantee that no newer round exists. With no valid coverage, preserve the result as unknown. Treat geography and sector as unknown until sourced when the intake did not constrain them. When the intake does constrain them, capture the candidate's location and sector at the requested scope granularity; keep a richer address or sector description in the evidence. Do not silently relabel either field without source support or loosen the saved filter.

Import or safely replay the manifest with:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --funding-import <selected-store-parent>/snapshots/<funding-manifest.json>
```

Inspect the latest aggregate projection without reading private evidence into output:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --funding-project <opaque-run-id>
```

Report only the returned opaque IDs, hashes, state, and counts. `awaiting_qualification_factcheck` means the deterministic import found provisional matches that still need factual review. It does not mean that a company is qualified.

Before capturing people, retrieve the latest validated opaque research scope:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --person-scope <opaque-run-id>
```

This output contains only the current intake and funding batch hashes, the requested company cap, and each provisional match's ordinal, funding result ID, and company ID. It contains no company name, source text, or qualification. Match the ordinal to the retained private funding manifest. Choose the exact result IDs to research within the saved request; this is a research scope, not a human qualification decision. The person import service revalidates every ID against the current funding batch.

For each person candidate, save one exact public current-role page body beneath the selected store's `snapshots/` directory. The page must support the supplied full name, current title, and exact scoped company in one compact excerpt of at most 240 characters. Prefer a targeted individual bio or self-profile; a company team page with distant headings may remain source unknown even when the full page contains each fact. Preserve the original capture. Do not concatenate or rewrite source text, or infer an employer from the host, to force a match. Preserve an optional HTTPS profile URL only when the captured source supports it. Derive `first_name` from an exact contiguous token sequence in `full_name`; do not guess it from an account handle or email address.

Create a private person-import manifest with exactly `request_id`, `run_id`, `expected_intake_hash`, `funding_batch_id`, `funding_batch_hash`, `predecessor_batch_id`, `predecessor_hash`, `research_result_ids`, and `candidates`. Each candidate has exactly `funding_result_id`, `company_id`, `first_name`, `full_name`, `title`, nullable `profile_url`, `source_url`, `body_ref`, and `captured_at`. Use the opaque values returned by `--person-scope`; never put page bodies, qualification flags, reviewer decisions, rankings, contact details, or caller-created entity IDs in the manifest.

Retain one canonical UUID for an exact person-import retry. A complete replacement batch needs a new UUID and the preceding person projection's exact batch ID and hash. Import or replay with:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --person-import <selected-store-parent>/snapshots/<person-manifest.json>
```

Inspect the latest aggregate person projection with:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --person-project <opaque-run-id>
```

Keep person and source details in the private store. Report only returned opaque batch and funding IDs, hashes, state, and counts. `awaiting_person_qualification_factcheck` means current-role pages were imported provisionally. It does not select or rank people, confirm the source as a human, create contact data, or authorize drafting or outreach. Company factcheck, ranking to the requested per-company count, humanization, criticism, human approval, and sending remain later gated work. Local source-bound drafting can precede human source confirmation; confirmation remains mandatory before readiness and outbound steps.

Retrieve the current qualification inputs after the person import:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --qualification-scope <opaque-run-id>
```

This returns the exact current intake, campaign policy, funding, and person hashes, plus the prior qualification batch ID and hash when one exists. It contains no company or person identity. Create a private qualification-start manifest beneath the selected store's `snapshots/` directory with exactly `request_id`, `run_id`, `expected_intake_hash`, `funding_batch_id`, `funding_batch_hash`, `person_batch_id`, `person_batch_hash`, `predecessor_batch_id`, and `predecessor_hash`. Copy every non-request field from the current scope and retain one canonical UUID for replay. A replacement needs a new UUID and the returned predecessor values.

Start or replay the source-bound qualification batch:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --qualification-start <selected-store-parent>/snapshots/<qualification-start.json>
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --qualification-project <opaque-run-id>
```

`awaiting_qualification_adapter` is a real pending state. The start command does not run a model and must not be described as a completed factcheck. The projection returns only opaque item IDs, states, candidate counts, context codes, and batch aggregate counts. For each pending item, create and retain a separate canonical request UUID and invoke the accepted private qualification runtime:

```text
python -m scripts.prospecting.qualification_stage_cli --store <existing-private-store.sqlite> --item-id <opaque-item-id> --request-id <canonical-uuid>
```

Do not invent, edit, or import a qualification result. The stage controller binds the actual runtime result to the exact saved source bytes. Re-run the qualification projection after each item. Stop on `qualification_failed`, exhausted attempts, missing context, stale or changed sources, or any other fixed refusal. `machine_reviewed` means the bounded machine source review completed; it is neither human source confirmation nor outreach approval. When a newer funding or person replacement makes the batch stale, retrieve a fresh qualification scope and start a replacement against the returned predecessor instead of reusing old results.

After every qualification item is machine reviewed, retrieve the current ranking inputs:

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --rank-scope <opaque-run-id>
```

This validates the current machine-reviewed qualification sources and returns only its exact batch ID and hash plus the latest opaque ranking predecessor, if one exists. It remains usable for a replacement when the prior ranking projection has correctly become stale. Create a private rank-start manifest with exactly `request_id`, `run_id`, `expected_intake_hash`, `qualification_batch_id`, `qualification_batch_hash`, `predecessor_batch_id`, and `predecessor_hash`. Copy every non-request value from the rank scope and retain its canonical request UUID for exact replay.

```text
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --rank-start <selected-store-parent>/snapshots/<rank-start.json>
python -m scripts.prospecting.pipeline_cli --store <existing-private-store.sqlite> --rank-project <opaque-run-id>
```

The ranker orders only exact source-supported current employments against the saved role-family policy, deduplicates exact person IDs, and preserves deficits. It does not score personal affinity or sender background and must not be called optimal. `deterministic_role_ordered` does not create campaign selections, contact data, drafts, approvals, or sends. A stale rank projection requires new source qualification and a new ranking batch; an exact old request may replay its original opaque batch receipt without making that historical batch current.

This learned skill is a sandboxed draft until separately reviewed and promoted.
