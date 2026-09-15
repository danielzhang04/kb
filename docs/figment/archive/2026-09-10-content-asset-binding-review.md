# Content asset binding independent review

**Verdict:** READY for the reviewed offline adapter scope. This is a local
code-quality finding, not an approval to generate, publish, or promote assets.

## Scope reviewed

- `orgs/figment/pipeline/content/content_asset_binding.py`
- `orgs/figment/pipeline/content/content_brief.py`
- `orgs/figment/pipeline/content/tests/test_content_asset_binding.py`
- `docs/figment/2026-09-10-content-asset-binding-plan.md`

The adapter preserves `validate_approved_gen_still` as the sole still-approval
authority. It adds slot attribution and a non-promotable local assignment only.
It requires the current brief, exact slot coverage, distinct image IDs, current
authority projections, persona bytes, canonical reference, and full anchor
inventory to agree before it creates a fresh output.

## Review history and repairs

Three initial findings were repaired and covered by regressions:

1. Brief replay now rechecks persona, canonical reference, taxonomy, and
   template dependencies, including mutation during revalidation.
2. A same creator ID cannot bridge a different persona or canonical anchor:
   the plan hash, persona bytes, approval subject anchor inventory, and canonical
   reference hash are cross-checked.
3. Fixed approval evidence is lexically checked before the legacy authority, so
   a `grade/gen` reparse path cannot be resolved away first.

Two final repair cycles closed pre-authority boundary gaps:

1. The legacy `assets.persona_dir` is component-walked for reparse points before
   the authority or adapter resolves it; the walk still supports the established
   relative `..` representation.
2. All fixed `grade/gen` JSON evidence is bounded/depth-validated before the
   legacy authority parses it. Oversized metadata now fails without invoking it.

The focused tests also exercise a CLI failure for invalid slot coverage and
confirm no partial assignment file is written.

## Verification

Executed from the review worktree:

```powershell
C:\Users\danie\AppData\Local\Programs\Python\Python313\python.exe -I -B -m pytest orgs/figment/pipeline/content/tests -q --basetemp C:\Users\danie\kb\_private\figment-content-binding-review-final-v3
```

Result: `47 passed in 25.06s`.

`git diff --check` was clean; Git emitted its existing notice that
`content_brief.py` would convert LF to CRLF if Git rewrote that file.

## Source pins

| File | SHA-256 |
| --- | --- |
| `content_asset_binding.py` | `54321587a5bb655cc28f918e1b2151e216217f44cf7ac7a0637c5f19cb7aec99` |
| `content_brief.py` | `478599e553c9b5cfe792906b1c22f1f26153da3c5d69158fe8675ea5c55d9943` |
| `test_content_asset_binding.py` | `cb6ce7fc2745a17ede58cd2f9e0d34731e5944b061ff68eb85d1d528ee6125d8` |
| `2026-09-10-content-asset-binding-plan.md` | `6a9a53abe25d2b571a687e51d23f0e49beb17729ac3c66a307d9217cdef5963a` |

## Limits

The review did not alter or re-audit legacy image-approval semantics, authorize
non-persona or motion/video sources, approve a selected asset, or test provider
or platform behavior. The assignment remains explicitly non-promotable.
