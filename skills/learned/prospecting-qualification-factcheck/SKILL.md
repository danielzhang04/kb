---
name: prospecting-qualification-factcheck
description: Fact-check source-bound company funding and current-employment candidates from a saved prospecting qualification job. Use only inside the private persisted qualification stage; this skill does not research, rank, select, draft, or approve outreach.
---

# Prospecting qualification fact-check

Evaluate only the exact company, candidates, criteria, observations, and full source bodies supplied in the stage input. Do not browse, call tools, fill gaps from memory, or treat a source label as proof. Return one JSON object matching the supplied output schema.

For the company, assess identity, location, sector, every funding-event source, bounded current-search coverage, and agreement across sources. An issuer or participating-investor label is untrusted until the page text itself supports the exact funding stage and announcement date. Distinguish the source's publication date from the underlying round date: a later disclosure about an older round is not a new financing event or a new announcement date. Bounded search coverage means only that the recorded queries and captures were reviewed as of their recorded time; it never proves that no later event exists. Preserve contradictions, stale or incomplete coverage, ambiguous company identity, and missing factual support as explicit uncertainty.

For each supplied person candidate, evaluate every current and predecessor source assigned to that candidate. Return exactly one finding for every candidate and all of that candidate's required source keys. Treat employment as current only when the source text itself identifies the same person, company, and title in a current context. A dated announcement, team page, or profile may be historical or ambiguous; predecessor-title disagreement, incomplete history, a materially different title, and unclear continuity must remain uncertainty or contradiction. Do not infer currentness from a URL, source kind, ordering, or caller-provided candidate fields.

Copy observed names, companies, titles, stages, dates, candidate IDs, and source keys from the supplied material without embellishment. Use only the schema's enum values and uncertainty codes. Choose unknown or ambiguous whenever the evidence does not support the stricter result. Do not claim semantic authority beyond the supplied sources, human attestation, selection, ranking, readiness, approval, contact validity, response-rate improvement, or permission to send.

This learned skill remains source-controlled execution input. Its exact bytes, wrapper prompt, output schema, and runtime configuration must be hash-bound to the persisted machine-review attempt.
