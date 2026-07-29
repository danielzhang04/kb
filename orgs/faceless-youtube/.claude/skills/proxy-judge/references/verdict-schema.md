# judge-verdict.md — output contract

The judge writes exactly one `verdict` block per script to `videos/<slug>/judge-verdict.md`.
`score_agreement.py` parses this block; keep the field names stable.

````markdown
# Judge verdict — <slug>

```verdict
verdict: greenlight        # greenlight | revise | reject
confidence: high           # high | medium | low
calibration_anchor: CJ-014 # the TRAINING calib entry this draft most resembles
flagged:                   # ranked, most-damaging first; [] for a clean greenlight
  - quote: the exact offending line from the script
    where: grammar §1.3    # the grammar section the finding violates
    why: one sentence — the content problem (not phrasing)
    fix: the substantive change wanted (cut / rewrite-toward-X / add-color)
proposed_rule_stub: none   # or: name an uncodified preference this reject relied on
```

## Notes
Free-text reasoning. Content preference only — voice is never imitated.
The judge has ZERO write access to the taste pack; proposed_rule_stub only NAMES a gap.
````

**Verdict mapping (authored in `judge.md`):**
- `greenlight` — no reject-level calibration hit, no unresolved leash defect, voice/story hold the grammar.
- `revise` — fixable defects; `flagged` lists them.
- `reject` — a fabricated fact stands, or the draft is fundamentally off (vapor, no payload, wrong register throughout).
