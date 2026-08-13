# W11 — targeted Wave-1 texture retries

- Date: 2026-08-13
- Rate: $0.039 per 1K call; cap: $0.250
- Policy: 4-minute stall -> one re-issue; two 503s park; two FreeTier limit-0 429s halt globally as BILLING.
- No promotion, registry, manifest, or review-store write for these retries.

| Frame | Added local clause | Result | Elapsed | Spend | Staged path |
| --- | --- | --- | ---: | ---: | --- |
| L65 | the floor is one single flat solid colour fill in flat cel shading - no basket-weave, no pattern, no texture; at most one clean darker cel shadow slab | OK | 42.1s | $0.039 | `channels/the-second-take/visual-kit/_staging/L65-w11-retry.png` |
| L86 | the shrink-wrapped cartons use flat wrap fills, clean line-art wrap lines only, no gradient sheen, no airbrushed streaks, no soft highlights | OK | 50.5s | $0.039 | `channels/the-second-take/visual-kit/_staging/L86-w11-retry.png` |
| L112 | the concrete floor is one flat concrete fill and the yellow lane paint is clean flat stripes, no scuff marks, no smears, no feathered gradients | OK | 42.2s | $0.039 | `channels/the-second-take/visual-kit/_staging/L112-w11-retry.png` |
| hr-officer | The long tweed skirt is one single flat solid colour fill in flat cel shading - no crosshatch, no lattice, no weave, no herringbone, no fabric texture of any kind; flat like a paper cut-out; the only shading is the style's simple two-tone cel shadow.  | OK | 32.7s | $0.039 | `channels/the-second-take/visual-kit/_staging/hr-officer-w11-retry-candidate.png` |

**Total:** $0.156 across 4 successful 1K calls; cap remaining $0.094.
