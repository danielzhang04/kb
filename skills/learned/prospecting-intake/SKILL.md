---
name: prospecting-intake
description: Turn a natural-language prospecting brief into a private typed intake and save it in the selected local prospecting pipeline store. Use for starting or safely retrying a prospecting brief; this draft does not perform research or outreach.
---

# Prospecting intake

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

Read the aggregate JSON projection. Report honestly that the intake was saved in `input_pending` or `awaiting_research_adapter`. Research, drafting, humanization, independent criticism, and human review are still unconnected in this slice; never imply that prospects or messages were produced.

This learned skill is a sandboxed draft until separately reviewed and promoted.
