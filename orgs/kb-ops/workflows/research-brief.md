---
id: research-brief
project: kb-ops
title: Research brief (cited)
profile: research
stages:
  - id: brief
    title: Research a topic and write a cited brief
    action: research:web-brief
    target: orgs/kb-ops/output
    riskTier: T2
---

# Research brief — cited web research

Produce a concise, **cited** research brief on a topic. You have the `research` profile: WebSearch,
WebFetch, and read-only file tools (Read / Glob / Grep). You write exactly one output file; you make no
other changes to the repo and take no external action.

## Topic parameter convention

This definition is a template. The topic is supplied at launch time by the operator and passed to you in
the run's work-order context. Wherever this brief says `{{TOPIC}}`, substitute the operator-supplied
topic. If no topic is supplied, do not guess a subject — write a short report that states the topic was
missing and stop. (The registry compiles this definition unchanged; parameter substitution happens in the
operator's launch context, not in this file.)

## Method

1. Run several WebSearch queries around `{{TOPIC}}`, spanning at least a few independent angles.
2. WebFetch the most credible primary and secondary sources. Prefer primary sources, official docs, and
   reputable reporting over aggregators.
3. Adversarially cross-check the key claims: where sources disagree, say so rather than smoothing it over.

## Output

Write the brief to `orgs/kb-ops/output/research-brief-<slug>-YYYY-MM-DD.md`, where `<slug>` is a short
kebab-case slug of `{{TOPIC}}` and the date is today. The brief MUST contain:

- A one-paragraph executive summary.
- 3–6 findings, each a claim followed by its supporting citation(s).
- A **Sources** section listing every URL cited, with a one-line note on what each supports.
- An **Open questions / uncertainty** section naming what remains unresolved or contested.

## Rules

- Every non-obvious claim carries a citation. Do not state as fact anything no source supports.
- Do not fabricate URLs, quotes, dates, or figures. If you cannot verify something, say so.
- Read-only outside the single output file. Take no external action; spend no money.
