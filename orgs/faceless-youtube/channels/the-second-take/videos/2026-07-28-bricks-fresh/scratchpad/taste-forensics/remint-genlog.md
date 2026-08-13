# Task 12 — canonical re-mint to the resting-face law — GEN LOG

Spend law: $0.039/gen. Expected ~$0.39-0.60 incl. retries. **HARD STOP $1.50.**
Worktree `boss-taste-forensics` @ e2a955f. Never commit/push.

Mint path (sanctioned, per image-generation SKILL.md single-asset loop):
`forge.py gen --mode new_character --aspect 2:3 --batch <spec>` with two seeds per item —
`refs/base/base.png` FIRST (form: resting face + resting stance + flat cel render) and the
character's CURRENT canonical SECOND (identity: hair, facial hair, head tone, pinned costume).
Both dry-run clean at $0 before any live call.

## Ledger

| # | frame | batch | gens | retries | cost | running total | note |
|---|-------|-------|------|---------|------|---------------|------|
| — | dry-run A (5) | A | 0 | 0 | $0.000 | $0.000 | 5 prompts assembled, 0 API calls |
| — | dry-run B (5) | B | 0 | 0 | $0.000 | $0.000 | 5 prompts assembled, 0 API calls |
| 1 | qt-wiles-resting | A | 1 | 0 | $0.039 | $0.039 | OK -> _staging/ |
| 2 | ibm-suit-resting | A | 1 | 0 | $0.039 | $0.078 | OK -> _staging/ |
| 3 | terry-johnson-resting | A | 1 | 0 | $0.039 | $0.117 | OK -> _staging/ |
| 4 | auditor-rep-resting | A | 1 | 0 | $0.039 | $0.156 | OK -> _staging/ |
| 5 | miniscribe-rep-resting | A | 1 | 0 | $0.039 | $0.195 | OK -> _staging/ |
| 6 | brick-foreman-resting | B | 1 | 0 | $0.039 | $0.234 | **STALLED** >5min in provider call (batch A averaged ~12s/gen). PID 39016 killed at the 4-min ceiling; one re-issue per stall policy. Counted as spend — a provider call was made. |
| 7 | brick-foreman-resting | B re-issue | 1 | 1 | $0.039 | $0.273 | **STALLED AGAIN** >10min. PID 4312 killed. Two consecutive stalls on the same frame — split it out and ran the rest as a diagnostic. |
| 8 | macgregor-resting | B2 diag | 1 | 0 | $0.039 | $0.312 | **STALLED** at 420s. Proves the stall was NOT brick-foreman-specific → mechanism = `provider_limitation`, a transient degradation window ~02:43–03:05. No prompt was re-rolled against an unchanged mechanism. |
| 9 | macgregor-resting | probe | 1 | 0 | $0.039 | $0.351 | OK in ~20s — provider recovered. |
| 10 | brick-foreman-resting | B3 | 1 | 0 | $0.039 | $0.390 | OK -> _staging/ |
| 11 | hastie-resting | B3 | 1 | 0 | $0.039 | $0.429 | OK -> _staging/ |
| 12 | hastie-wife-resting | B3 | 1 | 0 | $0.039 | $0.468 | OK -> _staging/ |
| 13 | pc-boxy-resting | B3 | 1 | 0 | $0.039 | $0.507 | OK -> _staging/ |

| 14 | pc-boxy-resting-r1 | retry | 1 | 1 | $0.039 | $0.546 | ONE sanctioned surgical retry (stance clause only, changed_spans: 1). **FAILED — defect persisted.** |

**All 10 minted. 14 provider calls, 3 lost to the provider stall window. TOTAL $0.546 of the $1.50 cap.**

## pc-boxy — PARKED, mechanism diagnosis

Verifier A ruled `resting_stance` FAIL on the first attempt: the case renders at a 3/4 turn with a
visible bevelled left side panel, staggered legs, asymmetric arms. One surgical retry rewrote ONLY the
stance clause into a strict orthographic front-elevation spec (no side panel, mirror-symmetric, legs
level) — every other byte held identical.

**The retry was silently ignored.** Measured, not eyeballed:

- mid-case dark-silhouette span, first attempt: cols 133..706 (width 573)
- mid-case dark-silhouette span, retry:         cols 133..706 (width 573) — **IDENTICAL**
- mean-abs-diff retry vs first attempt: 4.66 (near-zero; shading and mouth only, no geometry change)

`suspected_mechanism_layer: seed_recipe`. The identity seed `refs/pc-boxy/pc-boxy.png` is ITSELF drawn
at a 3/4 angle with staggered legs, and it is the only seed carrying this frame's geometry — `base.png`
is a human template and contributes nothing to a box's orientation. The defect therefore lives in the
strongest seed and rides back every time; prose cannot beat it. There is no non-defective frontal
pc-boxy frame to seed from, which is exactly the "a rig FIX never seeds the defective frame" bind with
no clean ancestor available.

Per the law, the retry is exhausted and **no agent clears its own park**. pc-boxy is PARKED and its OLD
canonical is LEFT IN PLACE (not replaced). Note for the boss: the new frame is strictly better than the
old one — it fixes the known painterly-render defect and passes resting_face + 5/6 rig axes, failing
only frontality, which the old frame ALSO fails. Promoting it is a net improvement but requires a human
ruling, not a self-cleared park. Both attempts are kept in `_staging/`.

The real fix is a mechanism change, not another re-roll: mint a frontal pc-boxy from a NON-image route
(an orthographic front-elevation authored with no 3/4 seed), then use that as the identity seed.
