---
id: card-parse-valid
capability: card-parse
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: parse
  card_text: |
    ---
    id: sample-001
    project: kb
    action: report
    target: dashboards/x.md
    risk-tier: T1
    state: inbox
    ---

    ## Work order
    Regenerate the dashboard.
expected:
  ok: true
---

# Canary: a well-formed card parses

A card carrying every REQUIRED field with a valid `risk-tier` and `state` must
parse cleanly through `cards.parse_text`. Guards the happy path of the
coordination unit every agent reads.
