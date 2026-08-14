# W22 L84 targeted retry

## Scope and preflight ($0)

- L84 `still_prompt` only: chair geometry is now explicit (EXACTLY eight: six far-side plus one at each rounded end); the open teal floor is limited to the near third; two closed grey steel document boxes remain squared on the table; every chair cushion is a single-colour, crisp-edge, unblended matte fill.
- `lint_shots.py`: `HARD violations: none`; 37 pre-existing heads-up rows remain.
- Scoped Forge batch: L84 only; 17 seeding-law violations remained outside this scope and were not acted on.
- Scoped dry: one `L84-w22` request assembled at 1K, the revised payload appeared once, and the tail reported `1 prompts assembled, 0 API calls, 0 files written`.

## Live generation (cap $0.10)

| Request | Result | Staged candidate | SHA-256 | Nominal spend |
| --- | --- | --- | --- | --- |
| L84-w22 | first provider call OK | `_staging/L84-w22.png` | `3ec6ff9fadbd66eb63d1e52573bb2073185830dda6235b0dbe916f7b244b62cd` | $0.039 |

Total: 1 provider call, nominal $0.039 / $0.10 cap. The call completed in about 25 seconds, so the four-minute stall threshold and one permitted re-issue were not triggered. No 503, billing event, promotion, scene-manifest write, or review stamp was performed for L84.

## Deviation

The literal negative phrase `no gradient, no soft highlight` caused the prompt linter's only hard violation because `gradient` is a banned render-technique term. It was replaced, without changing the requested surface constraint, by `single-colour fill with a crisp hard edge and an unblended matte surface`; the subsequent lint had 0 HARD violations.
