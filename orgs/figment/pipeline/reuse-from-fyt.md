# What figment reuses from FYT (and what it does not)

Source: repo scan of FYT's image engine, 2026-08-31. Rule applied — reuse scaffolding
that is provider-agnostic and battle-tested; rebuild anything whose content encodes
FYT's cartoon-illustration style. Never port at the cost of quality.

## Reuse directly (schema-driven, no style coupling)

| Component | Path | Why it ports |
|---|---|---|
| Three-state review stamp | `skills/image-generation/scripts/stamp_review.py` | The honest `verified` / `parked` / `unreviewed` model with fail-closed semantics and single-writer discipline. Pure stdlib, keyed by shot id — point it at figment manifests and it works. This IS our qa-gate verdict writer. |
| Offline review board | `skills/image-generation/scripts/build_review_artifact.py` | Self-contained HTML contact sheet, images inlined as data-URIs, lightbox + flagged-only filter. Our blinded-grading surface, minus the un-blinding metadata. |
| Gate-2 board generator | `skills/shot-board/scripts/build_board.py` | Richer human review surface with size-budget-aware inlining. |
| Batch / staging / locking scaffold | `skills/image-generation/scripts/forge.py` | PID-owned lock sidecars reserving an output path *before* a paid call, atomic publish, stale-lock reclamation, capped retries with backoff, `--dry-run` prompt preview at zero cost. Provider-agnostic once the call site is swapped. |
| Retry-overlay format | `forge-retry-overlay@1` (forge.py + SKILL.md) | Surgical single-clause fixes without mutating the canonical shot spec. |

## Adapt (right mechanism, wrong content)

- **Registry + canonical-seed chaining.** FYT pins each character to a canonical base
  image plus locked traits in `registry.json`, then generates every pose/expression by
  seeding *that verified canonical* — never composing independently; seeds capped (≤4)
  with strict attribute routing (identity only from the character seed, pose only from
  the pose seed) to prevent dilution; delta-chains for held scenes, re-based every ≤3.
  This is exactly the discipline photoreal persona consistency needs. **Adopt the
  procedure and the registry shape; the rig content (flat-cel proportions, palette
  clauses) is FYT-only.** Our identity anchor is a LoRA + reference sheet rather than a
  cartoon base frame, so seeding becomes conditioning — same law, different mechanism.
- **`proxy-judge` calibration pattern.** A fresh-context judge scoring a draft against a
  calibration set of human-labeled accept/revise/reject examples, naming the closest
  precedent. Strong template for our image-quality judge — needs its own calibration set
  of graded persona images, which W2 produces anyway.
- **Paid-action broker.** `dashboard/server/control/paidActionService.ts` reserves a
  fixed per-call cost before a provider call and journals it centrally, with a global
  ceiling and spend-grant gating; the worker never sees the key. Figment registers its
  own operation + namespace + cost constant rather than reusing FYT's literals. This is
  how figment gets automatic spend ledgering for free.

## Do not reuse

- FYT's style bible (cartoon rig, crowd-rig clauses, palette) — the content is the
  opposite of photoreal.
- Hardcoded FYT strings: `PAID_ARTIFACT_NAMESPACE`, `ROUTE_OPERATION`,
  `FYT_GEMINI_2K_IMAGE_COST_USD_MICROS`.
- **The provider itself.** FYT is 100% cloud API (Gemini `gemini-3-pro-image`, Recraft).
  No ComfyUI, no local SD/Flux, no LoRA training exists anywhere in the repo — so
  figment's identity backbone is genuinely new build, not a port. Gemini also cannot
  serve either of our tiers (mainstream filter), so the `nano()` call site is replaced,
  not reused.

## Net

Figment inherits the *governance* layer nearly free — review states, review surfaces,
staging/locking, retry discipline, spend journaling — and builds the *identity* layer
(LoRA training, reference sheets, photoreal consistency, blinded grading rubric) fresh,
because nothing comparable exists in the repo and FYT's cartoon consistency model does
not transfer to photoreal faces.
