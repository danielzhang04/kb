# judge-verdict.md — output contract

The judge writes exactly one `verdict` block per script to `videos/<slug>/judge-verdict.md`.
`score_agreement.py` parses this block; keep the field names stable.

````markdown
# Judge verdict — <slug>

```verdict
verdict: greenlight        # greenlight | revise | reject
score: 31/36               # rubric total; per-dimension breakdown below the block
confidence: high           # high | medium | low
calibration_anchor: CJ-014 # the TRAINING calib entry this draft most resembles
flagged:                   # ranked, most-damaging first; [] for a clean greenlight
  - quote: the exact offending line from the script
    dimension: 18          # rubric dim # or grammar section
    why: one sentence — the content problem (not phrasing)
    fix: the substantive change wanted (cut / rewrite-toward-X / add-color)
proposed_rule_stub: none   # or: name an uncodified preference this reject relied on
```

## Per-dimension (0/1/2)
1:2 2:2 3:1 4:2 5:1 6:1 7:2 8:2 9:2 10:2 11:2 12:2 13:2 14:2 15:1 16:2 17:1 18:2

## Notes
Free-text reasoning. Content preference only — voice is never imitated.
The judge has ZERO write access to the taste pack; proposed_rule_stub only NAMES a gap.
````

**Verdict mapping (authored in `judge.md`):**
- `greenlight` — rubric gate clears (total ≥ 30, no 0 on {1,4,8,11,13,14,16,17,18}) AND no reject-level calibration hit.
- `revise` — fixable defects; `flagged` lists them.
- `reject` — gate fails or a fundamental calibration-level problem.
