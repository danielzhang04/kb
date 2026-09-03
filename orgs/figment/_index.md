# figment — index

Disclosed AI creator personas: one reference image → identity expansion → persona LoRA → register
lock → images and video with passes → research-driven content → post and measure → optimise.
Several creators from one dashboard, two content tiers from one identity.

- [MANDATE](MANDATE.md) — the operator's standing end goal. Every spec, plan and brief derives from it.
  Human/boss-edited only.
- [GUARDRAILS](pipeline/GUARDRAILS.md) — hard lines that hold regardless of permission mode. Binds on
  top of the mandate.
- [STATE](STATE.md) — current state (agents keep this current)
- [contract](contract.md) — autonomy policy for this project
- [HEARTBEAT](HEARTBEAT.md) — recurring research and measurement cadences
- [Design spec](../../docs/superpowers/specs/2026-09-03-figment-creator-001-design.md) — creator-001
  end to end (stages 1–9, voice, explicit tier, dashboard). The build plan derives from it.

## Layout

```
personas/<creator>/   persona.yaml (machine source of truth) · identity-spec.md · anchors/ · batches/
pipeline/             pod · expand · train · register · passes · video · content · publish · insights
                      · voice · explicit, plus qa_stamp.py / blind_pool.py / build_grading_board.py
research/             r1–r19 reports, claim-checked; 10sorlabs-package/ bulk is gitignored
```

Image, video and package bulk is gitignored; `batch.json`, `scores.json`, `run.json`, manifests and
review rulings are tracked.

## Reading order for a fresh session

1. `MANDATE.md`, then `pipeline/GUARDRAILS.md`.
2. `STATE.md` (where the arc actually is), then `contract.md`.
3. The design spec above for the stage you are working on.
4. For creator-001 specifically: `personas/creator-001/identity-spec.md` and `pipeline/look-spec-v2.md` §0.
5. For anything touching a pod: `pipeline/pod/README.md` and `pipeline/pod/REVIEW-e-2026-09-03.md`
   (the open defects and the two live-run verdicts).

## Standing rules that catch people out

- Rented compute prohibits adult content: everything unclothed is generated and trained on operator
  hardware, by the operator. Agents build that path with clothed data.
- Every pod is terminated **and verified absent** on every exit path; every live run carries `--max-usd`.
- $50 hard cap on the creator-001 arc; zero spend on any platform, ever.
- `pipeline/qa_stamp.py` is the only writer of `review_status`. `parked` is always a legal answer.
